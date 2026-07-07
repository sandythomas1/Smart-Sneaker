import type { LocalSessionStore } from '../storage/session-store';
import type { Unsubscribe } from '../ble/types';
import type { SessionUploader } from './uploader';

/**
 * Background session sync (Req. 5-7): drains the local store to the ingest
 * API whenever connectivity allows, with no athlete-managed files. A session
 * leaves the phone's store only after the server confirms receipt; transient
 * failures retry with backoff and stay queued; permanent rejections stop
 * retrying and surface an actionable, non-technical message. Duplicate
 * retries are safe end-to-end because T6's ingest is idempotent on session ID.
 */

/** Platform connectivity signal; the RN adapter wraps @react-native-community/netinfo. */
export interface ConnectivityMonitor {
  onOnline(listener: () => void): Unsubscribe;
}

export interface SyncEvent {
  sessionId: string;
  status: 'synced' | 'failed' | 'deferred';
  /** Present for 'failed': safe to show the athlete verbatim (Req. 7). */
  userMessage?: string;
}

export interface SyncReport {
  synced: string[];
  /** Permanently rejected this drain (sessionId → athlete-facing message). */
  failed: Array<{ sessionId: string; userMessage: string }>;
  /** Still pending after transient failures — retried on the next drain. */
  deferred: string[];
}

export interface SessionSyncDeps {
  store: LocalSessionStore;
  uploader: SessionUploader;
  /** Upload attempts per session per drain (default 3). */
  maxAttemptsPerDrain?: number;
  /** Base backoff between attempts, doubled per retry (default 2s). */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Sync progress surface for the UI (Req. 7). */
  onEvent?: (event: SyncEvent) => void;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 2_000;

export class SessionSyncManager {
  private readonly store: LocalSessionStore;
  private readonly uploader: SessionUploader;
  private readonly maxAttemptsPerDrain: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onEvent: (event: SyncEvent) => void;

  /** Sessions the server permanently rejected: kept locally (never delete an
   * athlete's data on an error) but excluded from automatic retries. */
  private readonly permanentFailures = new Map<string, string>();
  private draining: Promise<SyncReport> | null = null;
  private detachConnectivity: Unsubscribe | null = null;

  constructor(deps: SessionSyncDeps) {
    this.store = deps.store;
    this.uploader = deps.uploader;
    this.maxAttemptsPerDrain = deps.maxAttemptsPerDrain ?? DEFAULT_MAX_ATTEMPTS;
    this.backoffMs = deps.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.onEvent = deps.onEvent ?? (() => {});
  }

  /** Sessions the server rejected, for the UI to explain (Req. 7). */
  get failedSessions(): ReadonlyMap<string, string> {
    return this.permanentFailures;
  }

  /** Sync automatically whenever connectivity returns (Req. 6). */
  start(connectivity: ConnectivityMonitor): void {
    this.detachConnectivity?.();
    this.detachConnectivity = connectivity.onOnline(() => {
      void this.syncPending();
    });
  }

  stop(): void {
    this.detachConnectivity?.();
    this.detachConnectivity = null;
  }

  /** Forget a permanent failure so the session is retried (e.g. after an app update fixes the payload). */
  retryFailedSession(sessionId: string): void {
    this.permanentFailures.delete(sessionId);
  }

  /**
   * Upload every locally-held session. Concurrent calls share one drain —
   * connectivity events can fire in bursts without double-uploading.
   */
  async syncPending(): Promise<SyncReport> {
    if (this.draining) {
      return this.draining;
    }
    this.draining = this.drain().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drain(): Promise<SyncReport> {
    const report: SyncReport = { synced: [], failed: [], deferred: [] };

    for (const session of await this.store.list()) {
      const sessionId = session.sessionId;
      if (this.permanentFailures.has(sessionId)) {
        continue;
      }

      let settled = false;
      for (let attempt = 1; attempt <= this.maxAttemptsPerDrain && !settled; attempt++) {
        const outcome = await this.uploader.upload(session);
        switch (outcome.kind) {
          case 'accepted':
            // Server-confirmed receipt is the ONLY thing that releases the
            // local copy (Req. 5, Resilience NFR).
            await this.store.remove(sessionId);
            report.synced.push(sessionId);
            this.onEvent({ sessionId, status: 'synced' });
            settled = true;
            break;
          case 'rejected':
            this.permanentFailures.set(sessionId, outcome.userMessage);
            report.failed.push({ sessionId, userMessage: outcome.userMessage });
            this.onEvent({ sessionId, status: 'failed', userMessage: outcome.userMessage });
            settled = true;
            break;
          case 'transient':
            if (attempt < this.maxAttemptsPerDrain) {
              await this.sleep(this.backoffMs * 2 ** (attempt - 1));
            } else {
              report.deferred.push(sessionId);
              this.onEvent({ sessionId, status: 'deferred' });
            }
            break;
        }
      }
    }

    return report;
  }
}

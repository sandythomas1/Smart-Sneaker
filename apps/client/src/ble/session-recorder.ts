import {
  SensorSample,
  Session,
  SessionLabels,
  SessionLabelsSchema,
  SessionSchema,
  validateContract,
} from '@smart-sneaker/data-contracts';
import { decodeSamplePacket } from './packet';
import { BleCentral, ShoeConnection, Unsubscribe } from './types';

/** Proposed default from spec.md Req. 2 — confirm/override when the firmware spec lands. */
export const DEFAULT_DISCONNECT_TOLERANCE_MS = 30_000;
const DEFAULT_RECONNECT_DELAY_MS = 250;

export interface SessionRecorderDeps {
  central: BleCentral;
  sportProfileId: string;
  disconnectToleranceMs?: number;
  reconnectDelayMs?: number;
  /** Injectable clock/sleep/id for deterministic tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Session ID source. Default needs a randomUUID-capable runtime — the RN
   * adapter must inject one (e.g. react-native-get-random-values). */
  newSessionId?: () => string;
}

export type RecorderStatus = 'idle' | 'recording' | 'reconnecting' | 'ended';

export type EndedBy = 'stop-requested' | 'disconnect-tolerance-exceeded';

export interface CompletedRecording {
  session: Session;
  /** Data-quality events observed while recording (dropped packets, disconnect gaps). */
  warnings: string[];
  /** Packets that failed wire/contract validation and were discarded. */
  droppedPacketCount: number;
  endedBy: EndedBy;
}

/** The recording cannot produce a valid session (nothing received, bad labels, contract failure). */
export class RecordingFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordingFailedError';
  }
}

/**
 * Records one session off one shoe (Req. 1-2, 5, 8): subscribes to the packet
 * stream, validates every packet at the radio boundary, and reconstructs a
 * complete, time-ordered `Session`.
 *
 * Disconnect tolerance (Req. 2, buffer/resume not fail-closed): on link drop
 * the recorder keeps everything received and re-connects until the tolerance
 * (default 30s) elapses. The shoe buffers on-shoe while unreachable and
 * replays after resubscription; replayed samples deduplicate on
 * (foot, timestampMs), so a resumed session has no duplicates and no
 * corruption. Beyond tolerance the recording ends with what it has — a
 * degraded-but-valid session beats a lost one (Resilience NFR).
 */
export class SessionRecorder {
  private readonly central: BleCentral;
  private readonly sportProfileId: string;
  private readonly disconnectToleranceMs: number;
  private readonly reconnectDelayMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly newSessionId: () => string;

  private currentStatus: RecorderStatus = 'idle';
  private endedBy: EndedBy = 'stop-requested';
  /** Keyed by `${foot}|${timestampMs}` so buffered replay after a reconnect can't duplicate. */
  private readonly samplesByKey = new Map<string, SensorSample>();
  private readonly warnings: string[] = [];
  private droppedPacketCount = 0;

  private peripheralId = '';
  private sessionId = '';
  private startedAtMs = 0;
  private connection: ShoeConnection | null = null;
  private detachConnection: Unsubscribe | null = null;
  /** In-flight reconnect loop; stop() awaits it so shutdown is race-free. */
  private reconnectLoop: Promise<void> | null = null;

  constructor(deps: SessionRecorderDeps) {
    this.central = deps.central;
    this.sportProfileId = deps.sportProfileId;
    this.disconnectToleranceMs = deps.disconnectToleranceMs ?? DEFAULT_DISCONNECT_TOLERANCE_MS;
    this.reconnectDelayMs = deps.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.newSessionId = deps.newSessionId ?? (() => crypto.randomUUID());
  }

  get status(): RecorderStatus {
    return this.currentStatus;
  }

  get sampleCount(): number {
    return this.samplesByKey.size;
  }

  async start(peripheralId: string): Promise<void> {
    if (this.currentStatus !== 'idle') {
      throw new RecordingFailedError('recorder already started — create a new one per session');
    }
    this.peripheralId = peripheralId;
    this.sessionId = this.newSessionId();
    this.startedAtMs = this.now();
    this.attach(await this.central.connect(peripheralId));
    this.currentStatus = 'recording';
  }

  /**
   * End the recording and reconstruct the session. Callable in any active
   * state — including after the tolerance-exceeded auto-end — and exactly once.
   */
  async stop(options: { labels?: SessionLabels } = {}): Promise<CompletedRecording> {
    if (this.currentStatus === 'idle') {
      throw new RecordingFailedError('recorder was never started');
    }

    const wasEnded = this.currentStatus === 'ended';
    this.currentStatus = 'ended'; // also halts an in-flight reconnect loop
    if (!wasEnded) {
      this.endedBy = 'stop-requested';
    }
    if (this.reconnectLoop) {
      await this.reconnectLoop;
    }
    await this.teardownConnection();

    return this.reconstructSession(options.labels);
  }

  private attach(connection: ShoeConnection): void {
    this.connection = connection;
    const offPacket = connection.onSamplePacket((packet) => this.handlePacket(packet));
    const offDisconnect = connection.onDisconnect(() => this.handleDisconnect());
    this.detachConnection = () => {
      offPacket();
      offDisconnect();
    };
  }

  private handlePacket(packet: Uint8Array): void {
    const decoded = decodeSamplePacket(packet);
    if (!decoded.ok) {
      // A corrupt packet costs one sample, never the session (Req. 2's spirit).
      this.droppedPacketCount += 1;
      if (this.droppedPacketCount === 1) {
        this.warnings.push('one or more packets failed validation and were dropped');
      }
      return;
    }
    const sample = decoded.data;
    this.samplesByKey.set(`${sample.foot}|${sample.timestampMs}`, sample);
  }

  private handleDisconnect(): void {
    if (this.currentStatus !== 'recording') {
      return;
    }
    this.currentStatus = 'reconnecting';
    this.detachConnection?.();
    this.detachConnection = null;
    this.connection = null;
    this.reconnectLoop = this.runReconnectLoop().finally(() => {
      this.reconnectLoop = null;
    });
  }

  private async runReconnectLoop(): Promise<void> {
    const disconnectedAtMs = this.now();
    while (this.currentStatus === 'reconnecting') {
      if (this.now() - disconnectedAtMs > this.disconnectToleranceMs) {
        this.warnings.push(
          `connection lost for more than ${this.disconnectToleranceMs}ms — recording ended early; data up to the disconnect is preserved`,
        );
        this.endedBy = 'disconnect-tolerance-exceeded';
        this.currentStatus = 'ended';
        return;
      }
      try {
        const connection = await this.central.connect(this.peripheralId);
        // stop() may have won the race while we were connecting.
        if (this.currentStatus !== 'reconnecting') {
          await connection.disconnect();
          return;
        }
        this.attach(connection);
        this.currentStatus = 'recording';
        return;
      } catch {
        await this.sleep(this.reconnectDelayMs);
      }
    }
  }

  private async teardownConnection(): Promise<void> {
    this.detachConnection?.();
    this.detachConnection = null;
    if (this.connection) {
      const connection = this.connection;
      this.connection = null;
      await connection.disconnect();
    }
  }

  private reconstructSession(labels: SessionLabels | undefined): CompletedRecording {
    if (this.samplesByKey.size === 0) {
      throw new RecordingFailedError('no samples were received — nothing to save');
    }
    if (labels !== undefined) {
      const labelValidation = validateContract(SessionLabelsSchema, labels);
      if (!labelValidation.ok) {
        const detail = labelValidation.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
        throw new RecordingFailedError(`labels are invalid — ${detail}`);
      }
    }

    const samples = [...this.samplesByKey.values()].sort(
      (a, b) => a.timestampMs - b.timestampMs || a.foot.localeCompare(b.foot),
    );
    const session = {
      schemaVersion: 1 as const,
      sessionId: this.sessionId,
      sportProfileId: this.sportProfileId,
      startedAtMs: this.startedAtMs,
      deviceId: this.peripheralId,
      samples,
      ...(labels !== undefined ? { labels } : {}),
    };

    // The recorder's own output goes through the same contract gate as any
    // other producer — a reconstruction bug fails loudly here, not at upload.
    const validation = validateContract(SessionSchema, session);
    if (!validation.ok) {
      const detail = validation.issues
        .slice(0, 3)
        .map((i) => `${i.path}: ${i.message}`)
        .join('; ');
      throw new RecordingFailedError(`reconstructed session failed contract validation — ${detail}`);
    }

    return {
      session: validation.data,
      warnings: [...this.warnings],
      droppedPacketCount: this.droppedPacketCount,
      endedBy: this.endedBy,
    };
  }
}

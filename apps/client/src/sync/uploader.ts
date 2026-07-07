import type { Session } from '@smart-sneaker/data-contracts';

/**
 * Upload boundary for session sync (Req. 6-7). The sync manager decides *when*
 * to upload and what to do about failure; this port decides *how* one upload
 * happens and classifies its result, so retry policy never parses HTTP
 * details.
 */

export type UploadOutcome =
  /** The server durably has this session (fresh accept or T6's idempotent re-accept). */
  | { kind: 'accepted' }
  /** Permanent for this payload — retrying unchanged can never succeed.
   * `userMessage` is safe to show an athlete verbatim. */
  | { kind: 'rejected'; userMessage: string }
  /** Worth retrying later (network down, server trouble, throttled, stale auth). */
  | { kind: 'transient'; detail: string };

export interface SessionUploader {
  upload(session: Session): Promise<UploadOutcome>;
}

/** Supplies a fresh Firebase ID token per attempt, so an expired token heals on retry. */
export interface AuthTokenProvider {
  getIdToken(): Promise<string>;
}

export interface HttpSessionUploaderConfig {
  /** Ingest API origin, e.g. https://ingest-... .run.app */
  baseUrl: string;
  tokens: AuthTokenProvider;
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

const FALLBACK_REJECTION_MESSAGE =
  'This session was saved on your phone but the server couldn’t accept it. It won’t be retried automatically.';

/**
 * POSTs a session to T6's ingest endpoint and classifies the response:
 * 2xx accepted; 408/429/5xx and network errors transient; 401/403 transient
 * too (the next attempt fetches a fresh token); remaining 4xx are permanent
 * rejections carrying the server's already-user-facing error message.
 */
export class HttpSessionUploader implements SessionUploader {
  constructor(private readonly config: HttpSessionUploaderConfig) {}

  async upload(session: Session): Promise<UploadOutcome> {
    const fetchFn = this.config.fetchFn ?? fetch;
    let response: Response;
    try {
      const token = await this.config.tokens.getIdToken();
      response = await fetchFn(`${this.config.baseUrl}/v1/sessions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(session),
      });
    } catch {
      return { kind: 'transient', detail: 'network unreachable' };
    }

    if (response.status === 201 || response.status === 200) {
      return { kind: 'accepted' };
    }
    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500
    ) {
      return { kind: 'transient', detail: `server responded ${response.status}` };
    }
    return { kind: 'rejected', userMessage: await this.rejectionMessage(response) };
  }

  /** The ingest API's error envelope is already written for end users (T6); pass it through when present. */
  private async rejectionMessage(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error.length > 0) {
        return body.error;
      }
    } catch {
      // fall through to the generic message
    }
    return FALLBACK_REJECTION_MESSAGE;
  }
}

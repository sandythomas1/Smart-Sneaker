import type { ModelVersionRecord } from '@smart-sneaker/data-contracts';

/**
 * Ports for the training pipeline (Req. 21, T14). Production binds Cloud
 * Storage / Firestore adapters; tests bind the in-memory implementations.
 */

export interface SessionBlobReader {
  /** Raw session JSON at the given path, or null if no such blob exists. */
  get(path: string): Promise<string | null>;
}

export interface ModelArtifactStore {
  /** Durably store a model parameters artifact at the given path. */
  put(path: string, contentJson: string): Promise<void>;
}

export type RegisterModelOutcome =
  | { created: true }
  | { created: false; existing: ModelVersionRecord };

export interface ModelRegistry {
  /**
   * Atomically register the model version unless it already exists — what
   * makes re-running a training against the same snapshot idempotent.
   */
  createIfAbsent(record: ModelVersionRecord): Promise<RegisterModelOutcome>;
  get(name: string, version: string): Promise<ModelVersionRecord | null>;
}

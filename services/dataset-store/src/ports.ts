import type { DatasetEntry, DatasetSnapshot } from '@smart-sneaker/data-contracts';

/**
 * Ports for the labeled dataset store (T13). Production binds Firestore
 * adapters over the ingest API's session records and a snapshots collection;
 * tests bind the in-memory implementations.
 */

export interface LabeledSessionQuery {
  /** Every labeled session record for one sport profile, as dataset entries. */
  listLabeled(sportProfileId: string): Promise<DatasetEntry[]>;
}

export type CreateSnapshotOutcome =
  | { created: true }
  | { created: false; existing: DatasetSnapshot };

export interface SnapshotStore {
  /**
   * Atomically create the snapshot unless (name, version) already exists —
   * what makes snapshots immutable-once-written.
   */
  createIfAbsent(snapshot: DatasetSnapshot): Promise<CreateSnapshotOutcome>;
  get(name: string, version: number): Promise<DatasetSnapshot | null>;
  /** Highest existing version for a name; 0 when the name is unused. */
  latestVersion(name: string): Promise<number>;
}

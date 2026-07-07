import type { DatasetEntry, DatasetSnapshot } from '@smart-sneaker/data-contracts';
import type { CreateSnapshotOutcome, LabeledSessionQuery, SnapshotStore } from './ports';

/** In-memory LabeledSessionQuery for unit tests and local development. */
export class InMemoryLabeledSessionQuery implements LabeledSessionQuery {
  private readonly entries: DatasetEntry[] = [];

  add(entry: DatasetEntry): void {
    this.entries.push(entry);
  }

  async listLabeled(sportProfileId: string): Promise<DatasetEntry[]> {
    return this.entries.filter((e) => e.sportProfileId === sportProfileId);
  }
}

/** In-memory SnapshotStore for unit tests and local development. */
export class InMemorySnapshotStore implements SnapshotStore {
  readonly snapshots = new Map<string, DatasetSnapshot>();

  async createIfAbsent(snapshot: DatasetSnapshot): Promise<CreateSnapshotOutcome> {
    const key = this.key(snapshot.name, snapshot.version);
    const existing = this.snapshots.get(key);
    if (existing) {
      return { created: false, existing };
    }
    // Deep-copy on write: an in-memory reference must be as immutable as a Firestore document.
    this.snapshots.set(key, structuredClone(snapshot));
    return { created: true };
  }

  async get(name: string, version: number): Promise<DatasetSnapshot | null> {
    const snapshot = this.snapshots.get(this.key(name, version));
    return snapshot ? structuredClone(snapshot) : null;
  }

  async latestVersion(name: string): Promise<number> {
    let latest = 0;
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.name === name && snapshot.version > latest) {
        latest = snapshot.version;
      }
    }
    return latest;
  }

  private key(name: string, version: number): string {
    return `${name}-v${version}`;
  }
}

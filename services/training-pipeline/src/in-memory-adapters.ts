import type { ModelVersionRecord } from '@smart-sneaker/data-contracts';
import type {
  ModelArtifactStore,
  ModelRegistry,
  RegisterModelOutcome,
  SessionBlobReader,
} from './ports';

/** In-memory SessionBlobReader for unit tests and local development. */
export class InMemorySessionBlobReader implements SessionBlobReader {
  readonly blobs = new Map<string, string>();

  async get(path: string): Promise<string | null> {
    return this.blobs.get(path) ?? null;
  }
}

/** In-memory ModelArtifactStore for unit tests and local development. */
export class InMemoryModelArtifactStore implements ModelArtifactStore {
  readonly artifacts = new Map<string, string>();

  async put(path: string, contentJson: string): Promise<void> {
    this.artifacts.set(path, contentJson);
  }
}

/** In-memory ModelRegistry for unit tests and local development. */
export class InMemoryModelRegistry implements ModelRegistry {
  readonly records = new Map<string, ModelVersionRecord>();

  async createIfAbsent(record: ModelVersionRecord): Promise<RegisterModelOutcome> {
    const key = this.key(record.model.name, record.model.version);
    const existing = this.records.get(key);
    if (existing) {
      return { created: false, existing };
    }
    this.records.set(key, record);
    return { created: true };
  }

  async get(name: string, version: string): Promise<ModelVersionRecord | null> {
    return this.records.get(this.key(name, version)) ?? null;
  }

  private key(name: string, version: string): string {
    return `${name}@${version}`;
  }
}

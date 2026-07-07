import type { Bucket } from '@google-cloud/storage';
import type { Firestore } from 'firebase-admin/firestore';
import {
  ModelVersionRecord,
  ModelVersionRecordSchema,
  validateContract,
} from '@smart-sneaker/data-contracts';
import type {
  ModelArtifactStore,
  ModelRegistry,
  RegisterModelOutcome,
  SessionBlobReader,
} from './ports';

/**
 * Production adapters, kept deliberately thin. Layout:
 *   GCS  raw-sessions bucket        → read-only here (session blobs)
 *   GCS  model-artifacts bucket     → models/{name}/{version}.json
 *   Firestore modelVersions/{name}@{version} → ModelVersionRecord
 */

const MODEL_VERSIONS = 'modelVersions';
/** gRPC status code Firestore uses when `create()` hits an existing document. */
const ALREADY_EXISTS = 6;
/** gRPC-style code GCS surfaces for a missing object. */
const NOT_FOUND = 404;

/** Same shape as the session worker's reader — duplicated to keep this service off the worker's dependency graph. */
export class GcsSessionBlobReader implements SessionBlobReader {
  constructor(private readonly bucket: Bucket) {}

  async get(path: string): Promise<string | null> {
    try {
      const [contents] = await this.bucket.file(path).download();
      return contents.toString('utf8');
    } catch (error) {
      if ((error as { code?: number }).code === NOT_FOUND) {
        return null;
      }
      throw error;
    }
  }
}

export class GcsModelArtifactStore implements ModelArtifactStore {
  constructor(private readonly bucket: Bucket) {}

  async put(path: string, contentJson: string): Promise<void> {
    await this.bucket.file(path).save(contentJson, {
      contentType: 'application/json',
      resumable: false,
    });
  }
}

export class FirestoreModelRegistry implements ModelRegistry {
  constructor(private readonly db: Firestore) {}

  async createIfAbsent(record: ModelVersionRecord): Promise<RegisterModelOutcome> {
    const doc = this.doc(record.model.name, record.model.version);
    try {
      await doc.create(record); // atomic create-or-fail — idempotent retraining
      return { created: true };
    } catch (error) {
      if ((error as { code?: number }).code !== ALREADY_EXISTS) {
        throw error;
      }
      const existing = await this.get(record.model.name, record.model.version);
      if (!existing) {
        throw new Error(
          `model ${record.model.name}@${record.model.version} exists but could not be read`,
        );
      }
      return { created: false, existing };
    }
  }

  async get(name: string, version: string): Promise<ModelVersionRecord | null> {
    const snapshot = await this.doc(name, version).get();
    if (!snapshot.exists) {
      return null;
    }
    const validation = validateContract(ModelVersionRecordSchema, snapshot.data());
    if (!validation.ok) {
      throw new Error(`model record ${name}@${version} failed contract validation`);
    }
    return validation.data;
  }

  private doc(name: string, version: string) {
    return this.db.collection(MODEL_VERSIONS).doc(`${name}@${version}`);
  }
}

import type { Firestore } from 'firebase-admin/firestore';
import {
  DatasetEntry,
  DatasetEntrySchema,
  DatasetSnapshot,
  DatasetSnapshotSchema,
  validateContract,
} from '@smart-sneaker/data-contracts';
import type { CreateSnapshotOutcome, LabeledSessionQuery, SnapshotStore } from './ports';

/**
 * Production adapters. Firestore layout:
 *   sessions/{sessionId}                → ingest API's StoredSessionRecord (read here)
 *   datasetSnapshots/{name}-v{version}  → DatasetSnapshot (owned here)
 * Both reads validate documents against the shared contracts — the store is a
 * boundary, not implicitly trusted state.
 */

const SESSIONS = 'sessions';
const DATASET_SNAPSHOTS = 'datasetSnapshots';
/** gRPC status code Firestore uses when `create()` hits an existing document. */
const ALREADY_EXISTS = 6;

export type WarnLogger = (message: string, context: Record<string, unknown>) => void;

/** Reads the ingest API's session records, filtered to labeled ones (hasLabels, set at upload). */
export class FirestoreLabeledSessionQuery implements LabeledSessionQuery {
  constructor(
    private readonly db: Firestore,
    private readonly warn: WarnLogger = () => {},
  ) {}

  async listLabeled(sportProfileId: string): Promise<DatasetEntry[]> {
    const snapshot = await this.db
      .collection(SESSIONS)
      .where('hasLabels', '==', true)
      .where('sportProfileId', '==', sportProfileId)
      .get();

    const entries: DatasetEntry[] = [];
    for (const doc of snapshot.docs) {
      const record = doc.data();
      const validation = validateContract(DatasetEntrySchema, {
        sessionId: record.sessionId,
        ownerAthleteId: record.ownerAthleteId,
        blobPath: record.blobPath,
        sportProfileId: record.sportProfileId,
        startedAtMs: record.startedAtMs,
        sampleCount: record.sampleCount,
        labels: record.labels,
      });
      if (validation.ok) {
        entries.push(validation.data);
      } else {
        // One malformed record must not block corpus building; it is reported, not silently trained on.
        this.warn('skipping contract-invalid labeled session record', {
          sessionId: doc.id,
          issues: validation.issues,
        });
      }
    }
    return entries;
  }
}

export class FirestoreSnapshotStore implements SnapshotStore {
  constructor(private readonly db: Firestore) {}

  async createIfAbsent(snapshot: DatasetSnapshot): Promise<CreateSnapshotOutcome> {
    const doc = this.doc(snapshot.name, snapshot.version);
    try {
      await doc.create(snapshot); // atomic create-or-fail — snapshots are write-once
      return { created: true };
    } catch (error) {
      if ((error as { code?: number }).code !== ALREADY_EXISTS) {
        throw error;
      }
      const existing = await this.get(snapshot.name, snapshot.version);
      if (!existing) {
        throw new Error(
          `snapshot ${snapshot.name} v${snapshot.version} exists but could not be read`,
        );
      }
      return { created: false, existing };
    }
  }

  async get(name: string, version: number): Promise<DatasetSnapshot | null> {
    const snapshot = await this.doc(name, version).get();
    if (!snapshot.exists) {
      return null;
    }
    const validation = validateContract(DatasetSnapshotSchema, snapshot.data());
    if (!validation.ok) {
      throw new Error(`dataset snapshot ${name} v${version} failed contract validation`);
    }
    return validation.data;
  }

  async latestVersion(name: string): Promise<number> {
    const result = await this.db
      .collection(DATASET_SNAPSHOTS)
      .where('name', '==', name)
      .orderBy('version', 'desc')
      .limit(1)
      .get();
    const doc = result.docs[0];
    const version: unknown = doc?.data().version;
    return typeof version === 'number' ? version : 0;
  }

  private doc(name: string, version: number) {
    return this.db.collection(DATASET_SNAPSHOTS).doc(`${name}-v${version}`);
  }
}

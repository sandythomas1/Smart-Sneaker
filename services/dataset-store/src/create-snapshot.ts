import { z } from 'zod';
import {
  DATASET_SNAPSHOT_SCHEMA_VERSION,
  DatasetNameSchema,
  DatasetSnapshot,
  DatasetSnapshotSchema,
  validateContract,
} from '@smart-sneaker/data-contracts';
import type { LabeledSessionQuery, SnapshotStore } from './ports';

/** Operator input for a snapshot — validated like any other boundary input. */
const CreateSnapshotInputSchema = z.object({
  name: DatasetNameSchema,
  sportProfileId: z.string().min(1).max(100),
});
export type CreateSnapshotInput = z.infer<typeof CreateSnapshotInputSchema>;

export class InvalidSnapshotRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSnapshotRequestError';
  }
}

/** No labeled sessions matched — a snapshot with nothing to train on is a mistake, not a corpus. */
export class EmptyDatasetError extends Error {
  constructor(sportProfileId: string) {
    super(`no labeled sessions exist for sport profile "${sportProfileId}"`);
    this.name = 'EmptyDatasetError';
  }
}

/** Two snapshot creations raced onto the same version — retry to take the next one. */
export class SnapshotConflictError extends Error {
  constructor(name: string, version: number) {
    super(`snapshot ${name} v${version} was created concurrently — retry to take the next version`);
    this.name = 'SnapshotConflictError';
  }
}

export interface CreateSnapshotDeps {
  labeledSessions: LabeledSessionQuery;
  snapshots: SnapshotStore;
  nowMs?: () => number;
}

/**
 * Freeze the current labeled corpus as the next version of a named dataset
 * (T13). Entries are embedded in the snapshot at creation time, so sessions
 * labeled afterwards can never mutate it — reproducing a training run only
 * needs (name, version).
 */
export async function createDatasetSnapshot(
  input: CreateSnapshotInput,
  deps: CreateSnapshotDeps,
): Promise<DatasetSnapshot> {
  const inputValidation = validateContract(CreateSnapshotInputSchema, input);
  if (!inputValidation.ok) {
    const detail = inputValidation.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    throw new InvalidSnapshotRequestError(`invalid snapshot request — ${detail}`);
  }
  const { name, sportProfileId } = inputValidation.data;

  const entries = await deps.labeledSessions.listLabeled(sportProfileId);
  if (entries.length === 0) {
    throw new EmptyDatasetError(sportProfileId);
  }

  const version = (await deps.snapshots.latestVersion(name)) + 1;
  const candidate: DatasetSnapshot = {
    schemaVersion: DATASET_SNAPSHOT_SCHEMA_VERSION,
    name,
    version,
    createdAtMs: (deps.nowMs ?? Date.now)(),
    sportProfileId,
    entries,
  };

  // Self-check against the shared contract before persisting: a corrupt
  // snapshot must fail here, not at training time.
  const validation = validateContract(DatasetSnapshotSchema, candidate);
  if (!validation.ok) {
    const detail = validation.issues
      .slice(0, 3)
      .map((i) => `${i.path}: ${i.message}`)
      .join('; ');
    throw new InvalidSnapshotRequestError(`snapshot failed contract validation — ${detail}`);
  }

  const outcome = await deps.snapshots.createIfAbsent(validation.data);
  if (!outcome.created) {
    throw new SnapshotConflictError(name, version);
  }
  return validation.data;
}

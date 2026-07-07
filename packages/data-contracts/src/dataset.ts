import { z } from 'zod';
import { BlobPathSchema, UserIdSchema } from './event';
import { SessionLabelsSchema } from './session';

export const DATASET_SNAPSHOT_SCHEMA_VERSION = 1;

/** Snapshot names are operator-chosen and become storage/document ids — slug-bounded. */
export const DatasetNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, {
  message: 'must be 1-64 lowercase letters, digits or hyphens, starting alphanumeric',
});

/**
 * One labeled session inside a dataset snapshot (Req. 8, T13): everything a
 * training run needs to fetch the raw data (blobPath) and supervise on it
 * (labels/conditions), plus provenance (owner, session identity, timing).
 */
export const DatasetEntrySchema = z.object({
  sessionId: z.uuid(),
  ownerAthleteId: UserIdSchema,
  blobPath: BlobPathSchema,
  sportProfileId: z.string().min(1).max(100),
  startedAtMs: z.number().int().nonnegative(),
  sampleCount: z.number().int().positive(),
  labels: SessionLabelsSchema,
});
export type DatasetEntry = z.infer<typeof DatasetEntrySchema>;

/**
 * A named, versioned, IMMUTABLE snapshot of the labeled dataset (T13):
 * written once by the dataset store, read by the training pipeline (T14) —
 * a cross-service contract, so it lives here and readers validate against it.
 * Entries are embedded so later uploads can never mutate an existing
 * snapshot; a new snapshot of the same name gets the next version.
 */
export const DatasetSnapshotSchema = z.object({
  schemaVersion: z.literal(DATASET_SNAPSHOT_SCHEMA_VERSION),
  name: DatasetNameSchema,
  /** Monotonic per name, starting at 1. */
  version: z.number().int().positive(),
  createdAtMs: z.number().int().nonnegative(),
  sportProfileId: z.string().min(1).max(100),
  /** Embedded-entry snapshots cap out around Firestore's 1MB document limit
   * (~10k entries); revisit with an external manifest if the corpus outgrows PoC scale. */
  entries: z.array(DatasetEntrySchema).min(1).max(10_000),
});
export type DatasetSnapshot = z.infer<typeof DatasetSnapshotSchema>;

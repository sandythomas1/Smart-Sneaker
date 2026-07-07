import { z } from 'zod';
import { DatasetNameSchema } from './dataset';
import { BlobPathSchema } from './event';
import { ModelRefSchema } from './sport-profile';

export const MODEL_VERSION_RECORD_SCHEMA_VERSION = 1;

/**
 * One trained, versioned model (Req. 21, T14): written by the training
 * pipeline's registry, referenced by sport-profile configs (T2's `model`
 * field resolves to `model` here). Carries full provenance — which dataset
 * snapshot trained it, when, with what evaluation metrics — so any model in
 * production traces back to an immutable corpus.
 */
export const ModelVersionRecordSchema = z.object({
  schemaVersion: z.literal(MODEL_VERSION_RECORD_SCHEMA_VERSION),
  /** The reference sport profiles use (T2 loader resolves exactly this shape). */
  model: ModelRefSchema,
  sportProfileId: z.string().min(1).max(100),
  datasetName: DatasetNameSchema,
  datasetVersion: z.number().int().positive(),
  trainedAtMs: z.number().int().nonnegative(),
  /** Evaluation metrics from the training run, e.g. labelAgreementRate. */
  metrics: z.record(z.string().min(1).max(100), z.number()),
  /** Where the model parameters artifact lives. */
  artifactPath: BlobPathSchema,
});
export type ModelVersionRecord = z.infer<typeof ModelVersionRecordSchema>;

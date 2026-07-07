import { z } from 'zod';
import {
  DatasetNameSchema,
  DatasetSnapshot,
  MODEL_VERSION_RECORD_SCHEMA_VERSION,
  ModelVersionRecord,
  ModelVersionRecordSchema,
  SessionSchema,
  validateContract,
} from '@smart-sneaker/data-contracts';
import type { SnapshotStore } from '@smart-sneaker/dataset-store';
import type { SportProfileRegistry } from '@smart-sneaker/insights-engine';
import { LabeledSession, trainBaselineModel } from './baseline-trainer';
import { ModelArtifactStore, ModelRegistry, SessionBlobReader } from './ports';

/** Trigger input — arrives over HTTP (Cloud Scheduler or an operator), validated like any boundary. */
const TrainingRunRequestSchema = z.object({
  datasetName: DatasetNameSchema,
  /** Omitted = train on the latest snapshot of that name. */
  datasetVersion: z.number().int().positive().optional(),
});
export type TrainingRunRequest = z.infer<typeof TrainingRunRequestSchema>;

export class InvalidTrainingRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTrainingRequestError';
  }
}

export type TrainingRunOutcome =
  | { outcome: 'trained'; record: ModelVersionRecord }
  /** This snapshot already produced this model version — re-triggering is a no-op (idempotent). */
  | { outcome: 'already-trained'; record: ModelVersionRecord }
  | { outcome: 'dataset-not-found' }
  | { outcome: 'no-usable-sessions'; detail: string };

export interface TrainingRunDeps {
  snapshots: SnapshotStore;
  blobReader: SessionBlobReader;
  artifacts: ModelArtifactStore;
  registry: ModelRegistry;
  /** Overridable in tests; defaults to the engine's shipped profiles. */
  profileRegistry?: SportProfileRegistry;
  nowMs?: () => number;
  /** Where skipped-entry problems get reported. */
  warn?: (message: string, context: Record<string, unknown>) => void;
}

/**
 * One training run (Req. 21, T14): resolve an immutable dataset snapshot,
 * load its raw sessions, fit + evaluate the baseline model, store the
 * artifact, and register the model version. The version is a pure function of
 * (dataset name, snapshot version), so re-delivery of the same trigger —
 * scheduled or manual — can never register a duplicate.
 */
export async function runTrainingRun(
  input: unknown,
  deps: TrainingRunDeps,
): Promise<TrainingRunOutcome> {
  const inputValidation = validateContract(TrainingRunRequestSchema, input);
  if (!inputValidation.ok) {
    const detail = inputValidation.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    throw new InvalidTrainingRequestError(`invalid training request — ${detail}`);
  }
  const request = inputValidation.data;

  const version = request.datasetVersion ?? (await deps.snapshots.latestVersion(request.datasetName));
  const snapshot = version > 0 ? await deps.snapshots.get(request.datasetName, version) : null;
  if (!snapshot) {
    return { outcome: 'dataset-not-found' };
  }

  const { labeledSessions, skippedEntries } = await loadSessions(snapshot, deps);
  if (labeledSessions.length === 0) {
    return {
      outcome: 'no-usable-sessions',
      detail: `all ${snapshot.entries.length} snapshot entries were unreadable or contract-invalid`,
    };
  }

  const trained = trainBaselineModel(labeledSessions, deps.profileRegistry);
  const model = {
    // Dataset name in the model name + snapshot version in the model version:
    // every (corpus, freeze) pair maps to exactly one model identity.
    name: `${snapshot.sportProfileId}-baseline-${snapshot.name}`,
    version: `0.1.0-ds-v${snapshot.version}`,
  };
  const artifactPath = `models/${model.name}/${model.version}.json`;
  const nowMs = (deps.nowMs ?? Date.now)();

  const record: ModelVersionRecord = {
    schemaVersion: MODEL_VERSION_RECORD_SCHEMA_VERSION,
    model,
    sportProfileId: snapshot.sportProfileId,
    datasetName: snapshot.name,
    datasetVersion: snapshot.version,
    trainedAtMs: nowMs,
    metrics: { ...trained.metrics, skippedEntries },
    artifactPath,
  };
  // Self-check before persisting: a malformed record fails the run, not a later consumer.
  const recordValidation = validateContract(ModelVersionRecordSchema, record);
  if (!recordValidation.ok) {
    const detail = recordValidation.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    throw new Error(`training produced a contract-invalid model record — ${detail}`);
  }

  // Artifact first: the registry only ever points at an artifact that exists.
  await deps.artifacts.put(
    artifactPath,
    JSON.stringify({
      model,
      parameters: trained.parameters,
      dataset: { name: snapshot.name, version: snapshot.version },
      trainedAtMs: nowMs,
    }),
  );

  const registered = await deps.registry.createIfAbsent(recordValidation.data);
  if (!registered.created) {
    return { outcome: 'already-trained', record: registered.existing };
  }
  return { outcome: 'trained', record: recordValidation.data };
}

/** Load and contract-validate each entry's raw session; skip (and report) unusable ones rather than failing the corpus. */
async function loadSessions(
  snapshot: DatasetSnapshot,
  deps: TrainingRunDeps,
): Promise<{ labeledSessions: LabeledSession[]; skippedEntries: number }> {
  const warn = deps.warn ?? (() => {});
  const labeledSessions: LabeledSession[] = [];
  let skippedEntries = 0;

  for (const entry of snapshot.entries) {
    const blobJson = await deps.blobReader.get(entry.blobPath);
    if (blobJson === null) {
      skippedEntries += 1;
      warn('snapshot entry blob missing', { sessionId: entry.sessionId, blobPath: entry.blobPath });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(blobJson);
    } catch {
      skippedEntries += 1;
      warn('snapshot entry blob is not valid JSON', { sessionId: entry.sessionId });
      continue;
    }
    const validation = validateContract(SessionSchema, parsed);
    if (!validation.ok) {
      skippedEntries += 1;
      warn('snapshot entry failed session contract validation', {
        sessionId: entry.sessionId,
        issues: validation.issues.slice(0, 3),
      });
      continue;
    }
    labeledSessions.push({ session: validation.data, labels: entry.labels });
  }

  return { labeledSessions, skippedEntries };
}

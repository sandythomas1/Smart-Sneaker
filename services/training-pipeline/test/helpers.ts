import { randomUUID } from 'node:crypto';
import type {
  DatasetEntry,
  DatasetSnapshot,
  Session,
  SessionLabels,
} from '@smart-sneaker/data-contracts';
import { InMemorySnapshotStore } from '@smart-sneaker/dataset-store';
import { generateSyntheticRun } from '@smart-sneaker/insights-engine';
import {
  InMemoryModelArtifactStore,
  InMemoryModelRegistry,
  InMemorySessionBlobReader,
} from '../src/in-memory-adapters';
import type { TrainingRunDeps } from '../src/run-training';

const CLEAN_RUN = {
  durationMs: 10_000,
  strideIntervalMs: 700,
  contactMs: 200,
  sampleIntervalMs: 10,
  rightFootOffsetMs: 350,
};

/** A labeled synthetic session; `favoredFoot` skews the pressure the way the label promises. */
export function labeledSession(
  conditions: string[],
  favoredFoot?: 'left' | 'right',
): { session: Session; labels: SessionLabels } {
  const { session } = generateSyntheticRun({
    ...CLEAN_RUN,
    ...(favoredFoot === 'left' ? { peakPressureByFoot: { right: 7 } } : {}),
    ...(favoredFoot === 'right' ? { peakPressureByFoot: { left: 7 } } : {}),
  });
  return {
    session: { ...session, sessionId: randomUUID() },
    labels: { conditions: [...conditions] },
  };
}

export interface TrainingHarness extends TrainingRunDeps {
  snapshots: InMemorySnapshotStore;
  blobReader: InMemorySessionBlobReader;
  artifacts: InMemoryModelArtifactStore;
  registry: InMemoryModelRegistry;
  /** Store the session blob and return its snapshot entry. */
  addSession(input: { session: Session; labels: SessionLabels }): DatasetEntry;
  /** Persist a snapshot from entries added so far. */
  freeze(name: string, version: number, entries: DatasetEntry[]): Promise<DatasetSnapshot>;
}

export function buildTrainingHarness(): TrainingHarness {
  const snapshots = new InMemorySnapshotStore();
  const blobReader = new InMemorySessionBlobReader();
  const artifacts = new InMemoryModelArtifactStore();
  const registry = new InMemoryModelRegistry();

  return {
    snapshots,
    blobReader,
    artifacts,
    registry,
    nowMs: () => 1_750_000_900_000,
    addSession({ session, labels }) {
      const blobPath = `raw-sessions/athlete-1/${session.sessionId}.json`;
      blobReader.blobs.set(blobPath, JSON.stringify(session));
      return {
        sessionId: session.sessionId,
        ownerAthleteId: 'athlete-1',
        blobPath,
        sportProfileId: session.sportProfileId,
        startedAtMs: session.startedAtMs,
        sampleCount: session.samples.length,
        labels,
      };
    },
    async freeze(name, version, entries) {
      const snapshot: DatasetSnapshot = {
        schemaVersion: 1,
        name,
        version,
        createdAtMs: 1_750_000_800_000,
        sportProfileId: 'running-v1',
        entries,
      };
      await snapshots.createIfAbsent(snapshot);
      return snapshot;
    },
  };
}

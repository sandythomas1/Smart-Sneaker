import { randomUUID } from 'node:crypto';
import type { DatasetEntry } from '@smart-sneaker/data-contracts';
import {
  createDatasetSnapshot,
  EmptyDatasetError,
  InvalidSnapshotRequestError,
  SnapshotConflictError,
} from '../src/create-snapshot';
import { InMemoryLabeledSessionQuery, InMemorySnapshotStore } from '../src/in-memory-adapters';

function labeledEntry(overrides: Partial<DatasetEntry> = {}): DatasetEntry {
  const sessionId = randomUUID();
  return {
    sessionId,
    ownerAthleteId: 'athlete-1',
    blobPath: `raw-sessions/athlete-1/${sessionId}.json`,
    sportProfileId: 'running-v1',
    startedAtMs: 1_750_000_000_000,
    sampleCount: 2_000,
    labels: { conditions: ['favor-left-leg'], notes: 'protocol run' },
    ...overrides,
  };
}

function harness() {
  return {
    labeledSessions: new InMemoryLabeledSessionQuery(),
    snapshots: new InMemorySnapshotStore(),
    nowMs: () => 1_750_000_500_000,
  };
}

describe('createDatasetSnapshot (T13)', () => {
  it('freezes the labeled sessions of the requested sport as a named v1 snapshot', async () => {
    const deps = harness();
    const running = labeledEntry();
    deps.labeledSessions.add(running);
    deps.labeledSessions.add(labeledEntry({ sportProfileId: 'basketball-stub' }));

    const snapshot = await createDatasetSnapshot(
      { name: 'running-labeled', sportProfileId: 'running-v1' },
      deps,
    );

    expect(snapshot).toMatchObject({ name: 'running-labeled', version: 1, sportProfileId: 'running-v1' });
    expect(snapshot.entries).toEqual([running]); // other sports' sessions excluded
  });

  it('records enough metadata to reproduce a training run', async () => {
    const deps = harness();
    const entry = labeledEntry();
    deps.labeledSessions.add(entry);

    const snapshot = await createDatasetSnapshot(
      { name: 'running-labeled', sportProfileId: 'running-v1' },
      deps,
    );

    const stored = snapshot.entries[0]!;
    expect(stored.blobPath).toBe(entry.blobPath); // where the raw data lives
    expect(stored.labels.conditions).toEqual(['favor-left-leg']); // what supervises it
    expect(stored.sessionId).toBe(entry.sessionId); // provenance
    expect(stored.ownerAthleteId).toBe(entry.ownerAthleteId);
  });

  it('never mutates an existing snapshot: later labeled sessions only appear in the next version', async () => {
    const deps = harness();
    const first = labeledEntry();
    deps.labeledSessions.add(first);
    const v1 = await createDatasetSnapshot(
      { name: 'running-labeled', sportProfileId: 'running-v1' },
      deps,
    );

    const second = labeledEntry();
    deps.labeledSessions.add(second);
    const v2 = await createDatasetSnapshot(
      { name: 'running-labeled', sportProfileId: 'running-v1' },
      deps,
    );

    expect(v2.version).toBe(v1.version + 1);
    const v1Stored = await deps.snapshots.get('running-labeled', 1);
    expect(v1Stored?.entries.map((e) => e.sessionId)).toEqual([first.sessionId]);
    expect(v2.entries.map((e) => e.sessionId)).toEqual([first.sessionId, second.sessionId]);
    expect(await deps.snapshots.latestVersion('running-labeled')).toBe(2);
  });

  it('refuses to snapshot an empty corpus', async () => {
    const deps = harness();
    await expect(
      createDatasetSnapshot({ name: 'running-labeled', sportProfileId: 'running-v1' }, deps),
    ).rejects.toThrow(EmptyDatasetError);
  });

  it('rejects an invalid snapshot name before touching any store', async () => {
    const deps = harness();
    await expect(
      createDatasetSnapshot(
        { name: 'Not A Valid Name!', sportProfileId: 'running-v1' },
        deps,
      ),
    ).rejects.toThrow(InvalidSnapshotRequestError);
  });

  it('surfaces a concurrent creation as a retryable conflict, never an overwrite', async () => {
    const deps = harness();
    deps.labeledSessions.add(labeledEntry());
    // Another writer takes v1 between our latestVersion() read and create.
    const originalLatest = deps.snapshots.latestVersion.bind(deps.snapshots);
    deps.snapshots.latestVersion = async (name) => {
      const latest = await originalLatest(name);
      if (latest === 0) {
        await deps.snapshots.createIfAbsent({
          schemaVersion: 1,
          name: 'running-labeled',
          version: 1,
          createdAtMs: 1,
          sportProfileId: 'running-v1',
          entries: [labeledEntry()],
        });
      }
      return latest;
    };

    await expect(
      createDatasetSnapshot({ name: 'running-labeled', sportProfileId: 'running-v1' }, deps),
    ).rejects.toThrow(SnapshotConflictError);
  });
});

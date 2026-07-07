import {
  createSportProfileRegistry,
  loadSportProfile,
} from '@smart-sneaker/insights-engine';
import { InvalidTrainingRequestError, runTrainingRun } from '../src/run-training';
import { buildTrainingHarness, labeledSession } from './helpers';

async function frozenCorpus(harness = buildTrainingHarness()) {
  const entries = [
    harness.addSession(labeledSession(['normal'])),
    harness.addSession(labeledSession(['favor-left-leg'], 'left')),
    harness.addSession(labeledSession(['favor-right-leg'], 'right')),
  ];
  await harness.freeze('running-labeled', 1, entries);
  return { harness, entries };
}

describe('runTrainingRun (Req. 21, T14)', () => {
  it('consumes the latest snapshot and produces a versioned model artifact plus evaluation metrics', async () => {
    const { harness } = await frozenCorpus();

    const result = await runTrainingRun({ datasetName: 'running-labeled' }, harness);

    expect(result.outcome).toBe('trained');
    if (result.outcome !== 'trained') return;
    expect(result.record.model).toEqual({
      name: 'running-v1-baseline-running-labeled',
      version: '0.1.0-ds-v1',
    });
    expect(result.record.datasetName).toBe('running-labeled');
    expect(result.record.datasetVersion).toBe(1);
    expect(result.record.metrics.labelAgreementRate).toBe(1);

    // The artifact exists where the record points, with the learned parameters.
    const artifact = JSON.parse(harness.artifacts.artifacts.get(result.record.artifactPath)!);
    expect(artifact.parameters.asymmetryThresholdPercent).toBeGreaterThan(0);
    expect(artifact.dataset).toEqual({ name: 'running-labeled', version: 1 });
  });

  it("produces a model version the sport-profile loader resolves as a candidate reference (T2 AC)", async () => {
    const { harness } = await frozenCorpus();
    const result = await runTrainingRun({ datasetName: 'running-labeled' }, harness);
    if (result.outcome !== 'trained') throw new Error('expected trained');

    // A next-generation profile config referencing the trained model must load unchanged.
    const registry = createSportProfileRegistry([
      {
        profileId: 'running-v2-candidate',
        sport: 'running',
        sensors: [{ kind: 'fsr_array', minSampleRateHz: 100, channels: 4 }],
        segmentationStrategyId: 'peak-detection-v1',
        featureSet: ['left_right_pressure_balance'],
        model: result.record.model,
      },
    ]);
    expect(loadSportProfile('running-v2-candidate', registry).model).toEqual(result.record.model);
  });

  it('re-running against the same snapshot is idempotent — no duplicate model version', async () => {
    const { harness } = await frozenCorpus();
    await runTrainingRun({ datasetName: 'running-labeled' }, harness);

    const second = await runTrainingRun({ datasetName: 'running-labeled', datasetVersion: 1 }, harness);

    expect(second.outcome).toBe('already-trained');
    expect(harness.registry.records.size).toBe(1);
  });

  it('trains each snapshot version into its own model version', async () => {
    const { harness, entries } = await frozenCorpus();
    await harness.freeze('running-labeled', 2, [
      ...entries,
      harness.addSession(labeledSession(['favor-left-leg'], 'left')),
    ]);

    const v1 = await runTrainingRun({ datasetName: 'running-labeled', datasetVersion: 1 }, harness);
    const v2 = await runTrainingRun({ datasetName: 'running-labeled' }, harness); // latest = v2

    if (v1.outcome !== 'trained' || v2.outcome !== 'trained') throw new Error('expected trained');
    expect(v1.record.model.version).toBe('0.1.0-ds-v1');
    expect(v2.record.model.version).toBe('0.1.0-ds-v2');
    expect(harness.registry.records.size).toBe(2);
  });

  it('skips unreadable snapshot entries but still trains on the rest, reporting the skips', async () => {
    const harness = buildTrainingHarness();
    const good = harness.addSession(labeledSession(['favor-left-leg'], 'left'));
    const missingBlob = { ...harness.addSession(labeledSession(['normal'])), blobPath: 'raw-sessions/athlete-1/gone.json' };
    const corrupt = harness.addSession(labeledSession(['normal']));
    harness.blobReader.blobs.set(corrupt.blobPath, '{{not json');
    await harness.freeze('running-labeled', 1, [good, missingBlob, corrupt]);

    const result = await runTrainingRun({ datasetName: 'running-labeled' }, harness);

    expect(result.outcome).toBe('trained');
    if (result.outcome !== 'trained') return;
    expect(result.record.metrics.skippedEntries).toBe(2);
    expect(result.record.metrics.sessionCount).toBe(1);
  });

  it('reports an unusable corpus instead of registering an untrained model', async () => {
    const harness = buildTrainingHarness();
    const entry = { ...harness.addSession(labeledSession(['normal'])), blobPath: 'raw-sessions/athlete-1/gone.json' };
    await harness.freeze('running-labeled', 1, [entry]);

    const result = await runTrainingRun({ datasetName: 'running-labeled' }, harness);

    expect(result.outcome).toBe('no-usable-sessions');
    expect(harness.registry.records.size).toBe(0);
  });

  it('returns dataset-not-found for an unknown name or version', async () => {
    const { harness } = await frozenCorpus();
    expect((await runTrainingRun({ datasetName: 'no-such-set' }, harness)).outcome).toBe('dataset-not-found');
    expect(
      (await runTrainingRun({ datasetName: 'running-labeled', datasetVersion: 99 }, harness)).outcome,
    ).toBe('dataset-not-found');
  });

  it('rejects a malformed trigger before touching any store', async () => {
    const { harness } = await frozenCorpus();
    await expect(runTrainingRun({ datasetName: 'Not Valid!' }, harness)).rejects.toThrow(
      InvalidTrainingRequestError,
    );
  });
});

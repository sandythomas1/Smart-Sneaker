import {
  DEFAULT_ASYMMETRY_THRESHOLD_PERCENT,
  trainBaselineModel,
} from '../src/baseline-trainer';
import { labeledSession } from './helpers';

describe('trainBaselineModel (T14 training step)', () => {
  it('fits a separating asymmetry threshold and reports full label agreement on a clean corpus', () => {
    const corpus = [
      labeledSession(['normal']),
      labeledSession(['normal', 'pace-5min-km']),
      labeledSession(['favor-left-leg'], 'left'),
      labeledSession(['favor-right-leg'], 'right'),
    ];

    const result = trainBaselineModel(corpus);

    expect(result.metrics.sessionCount).toBe(4);
    expect(result.metrics.evaluatedCount).toBe(4);
    expect(result.metrics.directionalCount).toBe(2);
    expect(result.metrics.labelAgreementRate).toBe(1);
    // Threshold sits between the normals' near-zero deviation and the
    // favoring sessions' ~9% deviation — learned, not the default.
    const threshold = result.parameters.asymmetryThresholdPercent;
    expect(threshold).toBeGreaterThan(0.5);
    expect(threshold).toBeLessThan(9);
    expect(threshold).not.toBe(DEFAULT_ASYMMETRY_THRESHOLD_PERCENT);
  });

  it('skips sessions whose balance the engine itself distrusts', () => {
    const good = labeledSession(['normal']);
    const tooShort = labeledSession(['favor-left-leg'], 'left');
    // 2s of data → too few gait cycles for a reliable balance (T4's rule).
    tooShort.session = {
      ...tooShort.session,
      samples: tooShort.session.samples.filter((s) => s.timestampMs <= 2_000),
    };

    const result = trainBaselineModel([good, tooShort]);

    expect(result.metrics.skippedUnreliable).toBe(1);
    expect(result.metrics.evaluatedCount).toBe(1);
  });

  it('falls back to the default threshold when the corpus cannot separate the classes', () => {
    // Directional label on a session that is actually even — classes overlap.
    const mislabeled = labeledSession(['favor-left-leg']);
    const normal = labeledSession(['normal']);

    const result = trainBaselineModel([normal, mislabeled]);

    expect(result.parameters.asymmetryThresholdPercent).toBe(DEFAULT_ASYMMETRY_THRESHOLD_PERCENT);
    expect(result.metrics.labelAgreementRate).toBeLessThan(1);
  });
});

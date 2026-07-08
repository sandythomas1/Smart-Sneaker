import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSeedCorpus } from './seed';

/**
 * Write the deterministic seed corpus to tools/e2e/seed/ as JSON fixtures:
 *
 *   seed/roster.json              — users + sharing grants
 *   seed/manifest.json            — one entry per session (owner, purpose, expectations)
 *   seed/sessions/<slug>.json     — contract-valid session payloads (POST /v1/sessions bodies)
 *   seed/invalid/out-of-order-samples.json — payload ingest must reject with 400
 *
 * Run with: npm run seed --workspace @smart-sneaker/e2e
 */
function main(): void {
  const corpus = buildSeedCorpus();
  const seedDir = join(__dirname, '..', 'seed');
  mkdirSync(join(seedDir, 'sessions'), { recursive: true });
  mkdirSync(join(seedDir, 'invalid'), { recursive: true });

  const writeJson = (path: string, value: unknown): void =>
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

  writeJson(join(seedDir, 'roster.json'), { users: corpus.users, grants: corpus.grants });

  const manifest = corpus.sessions.map((s) => ({
    slug: s.slug,
    ownerUserId: s.ownerUserId,
    description: s.description,
    expectFlaggedForReview: s.expectFlaggedForReview,
    sessionId: s.session.sessionId,
    sportProfileId: s.session.sportProfileId,
    startedAtMs: s.session.startedAtMs,
    sampleCount: s.session.samples.length,
    labeled: s.session.labels !== undefined,
    path: `sessions/${s.slug}.json`,
  }));
  writeJson(join(seedDir, 'manifest.json'), manifest);

  for (const seeded of corpus.sessions) {
    writeJson(join(seedDir, 'sessions', `${seeded.slug}.json`), seeded.session);
  }
  writeJson(join(seedDir, 'invalid', 'out-of-order-samples.json'), corpus.invalidSession);

  const totalSamples = corpus.sessions.reduce((sum, s) => sum + s.session.samples.length, 0);
  // eslint-disable-next-line no-console -- CLI output is the point here
  console.log(
    `wrote ${corpus.sessions.length} sessions (${totalSamples} samples), roster of ${corpus.users.length} users, 1 invalid fixture → ${seedDir}`,
  );
}

main();

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateDemoArtifact } from './demo-data';

/**
 * CLI wrapper: run the in-memory pipeline over the seed corpus and write the
 * demo artifact for apps/demo-web. Exits non-zero WITHOUT writing when any
 * stage misbehaved, so a broken pipeline never ships a healthy-looking demo.
 *
 * Run with: npm run demo-data --workspace @smart-sneaker/e2e
 */
async function main(): Promise<void> {
  const run = await generateDemoArtifact();
  for (const line of run.notes) console.log(`[demo-data] ${line}`);

  if (!run.artifact) {
    for (const problem of run.problems) console.error(`[demo-data] UNEXPECTED — ${problem}`);
    console.error('[demo-data] refusing to write an artifact from a misbehaving pipeline');
    process.exitCode = 1;
    return;
  }

  const outDir = join(__dirname, '..', '..', '..', 'apps', 'demo-web', 'public');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'demo-data.json');
  writeFileSync(outPath, `${JSON.stringify(run.artifact, null, 2)}\n`);
  console.log(
    `[demo-data] wrote ${run.artifact.sessions.length} session summaries, ` +
      `${Object.keys(run.artifact.details).length} details, ` +
      `${run.artifact.pipeline.scenarios.length} scenarios → ${outPath}`,
  );
}

main().catch((error) => {
  console.error('[demo-data] generation failed:', error);
  process.exitCode = 1;
});

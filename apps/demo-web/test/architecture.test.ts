import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Req. 6 guard: views render what the pipeline produced — they may never load
 * or embed data themselves. Data enters exclusively through App's validated
 * artifact load and the DemoContext. (The repo has no ESLint setup, so this
 * static check plays the role a no-restricted-imports rule would.)
 */

const VIEWS_DIR = join(__dirname, '..', 'src', 'views');

const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /from '.*\/data\/load'/, why: 'views must not load the artifact themselves' },
  { pattern: /demo-data\.json/, why: 'views must not reference the artifact file' },
  { pattern: /\bfetch\s*\(/, why: 'views must not fetch — data arrives via DemoContext' },
  { pattern: /from '.*\/generated\//, why: 'views must not import generated data' },
];

describe('views import no data sources (Req. 6)', () => {
  const viewFiles = readdirSync(VIEWS_DIR).filter((f) => f.endsWith('.tsx'));

  it('covers all six views', () => {
    expect(viewFiles.length).toBeGreaterThanOrEqual(6);
  });

  it.each(viewFiles)('%s only receives data via context/props', (file) => {
    const source = readFileSync(join(VIEWS_DIR, file), 'utf8');
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(source)) {
        throw new Error(`${file}: ${rule.why} (matched ${rule.pattern})`);
      }
    }
  });
});

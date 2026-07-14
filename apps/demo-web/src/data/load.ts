import { DemoArtifact, DemoArtifactSchema } from './demo-artifact';

export type ArtifactLoad =
  | { ok: true; artifact: DemoArtifact }
  | { ok: false; message: string };

/**
 * Validate a raw artifact payload at the boundary. An invalid artifact never
 * reaches the views — the caller renders the designed error state instead of
 * trusting a shape the generator didn't promise.
 */
export function parseDemoArtifact(raw: unknown): ArtifactLoad {
  const parsed = DemoArtifactSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      message: `demo data failed validation${first ? ` — ${first.path.join('.')}: ${first.message}` : ''}`,
    };
  }
  return { ok: true, artifact: parsed.data };
}

/**
 * Fetch the generated artifact relative to the page, so the same bundle works
 * under vite dev, a file server, or any static-host subpath.
 */
export async function fetchDemoArtifact(
  fetchFn: typeof fetch = fetch,
): Promise<ArtifactLoad> {
  let raw: unknown;
  try {
    const response = await fetchFn('demo-data.json');
    if (!response.ok) {
      return { ok: false, message: `demo data unavailable (HTTP ${response.status})` };
    }
    raw = await response.json();
  } catch {
    return { ok: false, message: 'demo data could not be loaded — regenerate with `npm run dev`' };
  }
  return parseDemoArtifact(raw);
}

import type { TokenVerifier } from '@smart-sneaker/ingest-api';

/**
 * Maps the seed roster's literal bearer tokens to uids — a stand-in for
 * Firebase verification, shared by the pipeline e2e test and the demo-data
 * generator so both exercise the same auth boundary.
 */
export class SeedTokenVerifier implements TokenVerifier {
  constructor(private readonly tokens: Record<string, string>) {}

  async verifyIdToken(idToken: string): Promise<{ uid: string }> {
    const uid = this.tokens[idToken];
    if (!uid) throw new Error('token rejected by verifier');
    return { uid };
  }
}

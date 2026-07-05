import type { Auth } from 'firebase-admin/auth';
import { TokenVerifier } from './identity';

/**
 * Production TokenVerifier: Firebase Auth ID-token verification (signature,
 * expiry, audience/issuer are all checked by the Admin SDK against Google's
 * public keys). Kept to a thin adapter so everything above it is testable
 * with an injected fake.
 */
export class FirebaseTokenVerifier implements TokenVerifier {
  constructor(private readonly auth: Auth) {}

  async verifyIdToken(idToken: string): Promise<{ uid: string }> {
    const decoded = await this.auth.verifyIdToken(idToken);
    return { uid: decoded.uid };
  }
}

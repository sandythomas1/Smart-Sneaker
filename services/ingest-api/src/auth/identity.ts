import { UserIdSchema } from '@smart-sneaker/data-contracts';

/**
 * Roles in the access model (Req. 16, 20). Athletes own sessions; coaches can
 * only read data athletes have explicitly shared with them.
 */
export type Role = 'athlete' | 'coach';

/** A server-side-resolved identity. Only ever built from a verified auth token — never from request fields. */
export interface AuthenticatedUser {
  userId: string;
  role: Role;
}

/** Re-exported so auth-layer consumers keep one import site for the ID shape. */
export { UserIdSchema };

/** Request could not be tied to a verified identity. Maps to HTTP 401. */
export class AuthenticationError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/** Port over Firebase Auth ID-token verification; tests inject a fake. */
export interface TokenVerifier {
  /** Returns the verified token's subject or throws for an invalid/expired token. */
  verifyIdToken(idToken: string): Promise<{ uid: string }>;
}

/** Port over the users/roles store (Firestore in production). */
export interface UserDirectory {
  getRole(userId: string): Promise<Role | null>;
  setRole(userId: string, role: Role): Promise<void>;
}

/**
 * Resolve an Authorization header to a stable server-side identity (T5 AC 1).
 *
 * Role comes from the user directory; an unknown user defaults to `athlete`,
 * the least-privileged role (can only touch their own data). `coach` is never
 * self-assigned — it must be provisioned explicitly in the directory, because
 * it unlocks reading other users' data once shared (least privilege,
 * constitution Security Bar).
 */
export async function resolveIdentity(
  authorizationHeader: string | undefined,
  verifier: TokenVerifier,
  users: UserDirectory,
): Promise<AuthenticatedUser> {
  if (!authorizationHeader) {
    throw new AuthenticationError('missing Authorization header');
  }
  const [scheme, token, ...rest] = authorizationHeader.split(' ');
  if (scheme !== 'Bearer' || !token || rest.length > 0) {
    throw new AuthenticationError('Authorization header must be "Bearer <token>"');
  }

  let uid: string;
  try {
    uid = (await verifier.verifyIdToken(token)).uid;
  } catch {
    // Deliberately generic: verifier internals (key rotation, clock skew, ...)
    // are logged server-side, never echoed to the caller.
    throw new AuthenticationError('invalid or expired credentials');
  }

  if (!UserIdSchema.safeParse(uid).success) {
    throw new AuthenticationError('invalid or expired credentials');
  }

  const role = (await users.getRole(uid)) ?? 'athlete';
  return { userId: uid, role };
}

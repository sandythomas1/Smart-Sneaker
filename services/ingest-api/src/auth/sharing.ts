import { AuthenticatedUser, UserDirectory, UserIdSchema } from './identity';

/** Caller is authenticated but not allowed to do this. Maps to HTTP 403. */
export class AccessDeniedError extends Error {
  readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

/** Caller-supplied value failed validation. Maps to HTTP 400. */
export class InvalidRequestError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

/** Port over the athlete→coach sharing-grant store (Firestore in production). */
export interface SharingStore {
  grant(athleteId: string, coachId: string): Promise<void>;
  revoke(athleteId: string, coachId: string): Promise<void>;
  isSharedWith(athleteId: string, coachId: string): Promise<boolean>;
  /** Athletes who currently share with this coach — the coach dashboard's roster (Req. 20). */
  listAthleteIdsSharedWith(coachId: string): Promise<string[]>;
}

/**
 * Grant a coach access to the requester's own data (Req. 20). Only the
 * athlete can create a grant for their data — there is deliberately no
 * "coach requests access and it defaults open" path.
 */
export async function grantSharing(
  requester: AuthenticatedUser,
  coachId: string,
  users: UserDirectory,
  sharing: SharingStore,
): Promise<void> {
  const parsed = UserIdSchema.safeParse(coachId);
  if (!parsed.success) {
    throw new InvalidRequestError('coachId must be 1-128 characters of A-Za-z0-9_-');
  }
  if (coachId === requester.userId) {
    throw new InvalidRequestError('cannot share your data with yourself');
  }
  if ((await users.getRole(coachId)) !== 'coach') {
    // Grants only target provisioned coaches — a typo'd or arbitrary user ID
    // must not silently become a standing data grant.
    throw new InvalidRequestError('coachId does not identify a registered coach');
  }
  await sharing.grant(requester.userId, coachId);
}

/** Revoke a previously granted share of the requester's own data. Revoking a non-existent grant is a no-op. */
export async function revokeSharing(
  requester: AuthenticatedUser,
  coachId: string,
  sharing: SharingStore,
): Promise<void> {
  const parsed = UserIdSchema.safeParse(coachId);
  if (!parsed.success) {
    throw new InvalidRequestError('coachId must be 1-128 characters of A-Za-z0-9_-');
  }
  await sharing.revoke(requester.userId, coachId);
}

/**
 * THE access rule for athlete data (Req. 16, 20, Security NFR): the athlete
 * themself, or a coach the athlete has explicitly shared with. Everyone else
 * is denied — server-side, regardless of what any UI hides.
 */
export async function canAccessAthleteData(
  requester: AuthenticatedUser,
  athleteId: string,
  sharing: SharingStore,
): Promise<boolean> {
  if (requester.userId === athleteId) {
    return true;
  }
  if (requester.role !== 'coach') {
    return false;
  }
  return sharing.isSharedWith(athleteId, requester.userId);
}

/** Throwing variant for request handlers. */
export async function assertCanAccessAthleteData(
  requester: AuthenticatedUser,
  athleteId: string,
  sharing: SharingStore,
): Promise<void> {
  if (!(await canAccessAthleteData(requester, athleteId, sharing))) {
    throw new AccessDeniedError('you do not have access to this athlete’s data');
  }
}

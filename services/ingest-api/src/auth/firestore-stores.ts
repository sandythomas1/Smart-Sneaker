import type { Firestore } from 'firebase-admin/firestore';
import { Role, UserDirectory, UserIdSchema } from './identity';
import { SharingStore } from './sharing';

/**
 * Firestore data model (T5):
 *   users/{userId}                          → { role, createdAtMs }
 *   users/{athleteId}/sharingGrants/{coachId} → { grantedAtMs }
 *
 * Grants live under the athlete's document so "who can see this athlete"
 * is one subcollection read, and future Firestore security rules can gate
 * the whole athlete subtree in one place.
 *
 * All IDs are validated against UserIdSchema before being used as document
 * paths — defense in depth against path-segment injection, even though
 * production IDs come from verified Firebase tokens.
 */

const USERS = 'users';
const SHARING_GRANTS = 'sharingGrants';

function assertPathSafe(id: string, label: string): void {
  if (!UserIdSchema.safeParse(id).success) {
    throw new Error(`${label} is not a valid user id`);
  }
}

export class FirestoreUserDirectory implements UserDirectory {
  constructor(private readonly db: Firestore) {}

  async getRole(userId: string): Promise<Role | null> {
    assertPathSafe(userId, 'userId');
    const snapshot = await this.db.collection(USERS).doc(userId).get();
    const role = snapshot.data()?.role;
    return role === 'athlete' || role === 'coach' ? role : null;
  }

  async setRole(userId: string, role: Role): Promise<void> {
    assertPathSafe(userId, 'userId');
    await this.db.collection(USERS).doc(userId).set({ role, createdAtMs: Date.now() }, { merge: true });
  }
}

export class FirestoreSharingStore implements SharingStore {
  constructor(private readonly db: Firestore) {}

  async grant(athleteId: string, coachId: string): Promise<void> {
    // athleteId/coachId are duplicated into the document body so the coach
    // dashboard can find grants via a collection-group query — document IDs
    // alone are not filterable across subcollections.
    await this.grantDoc(athleteId, coachId).set({ athleteId, coachId, grantedAtMs: Date.now() });
  }

  async revoke(athleteId: string, coachId: string): Promise<void> {
    await this.grantDoc(athleteId, coachId).delete();
  }

  async isSharedWith(athleteId: string, coachId: string): Promise<boolean> {
    return (await this.grantDoc(athleteId, coachId).get()).exists;
  }

  async listAthleteIdsSharedWith(coachId: string): Promise<string[]> {
    assertPathSafe(coachId, 'coachId');
    const snapshot = await this.db
      .collectionGroup(SHARING_GRANTS)
      .where('coachId', '==', coachId)
      .get();
    return snapshot.docs
      .map((doc) => doc.data().athleteId)
      .filter((id): id is string => UserIdSchema.safeParse(id).success)
      .sort();
  }

  private grantDoc(athleteId: string, coachId: string) {
    assertPathSafe(athleteId, 'athleteId');
    assertPathSafe(coachId, 'coachId');
    return this.db.collection(USERS).doc(athleteId).collection(SHARING_GRANTS).doc(coachId);
  }
}

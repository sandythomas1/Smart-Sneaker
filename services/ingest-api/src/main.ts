import { PubSub } from '@google-cloud/pubsub';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { FirebaseTokenVerifier } from './auth/firebase-token-verifier';
import { FirestoreSharingStore, FirestoreUserDirectory } from './auth/firestore-stores';
import { FixedWindowRateLimiter } from './rate-limit';
import { buildServer } from './server';
import {
  FirestoreSessionRecordStore,
  GcsSessionBlobStore,
  PubSubSessionEventPublisher,
} from './sessions/gcp-adapters';

/**
 * Cloud Run entry point. All configuration comes from the environment;
 * credentials come from Application Default Credentials — no secrets in code
 * or config files (Security NFR).
 */

const UPLOADS_PER_MINUTE_PER_ACCOUNT = 30;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required environment variable ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const firebaseApp = initializeApp();
  const firestore = getFirestore(firebaseApp);

  const app = buildServer({
    tokenVerifier: new FirebaseTokenVerifier(getAuth(firebaseApp)),
    userDirectory: new FirestoreUserDirectory(firestore),
    sharingStore: new FirestoreSharingStore(firestore),
    sessionRecordStore: new FirestoreSessionRecordStore(firestore),
    sessionBlobStore: new GcsSessionBlobStore(
      getStorage(firebaseApp).bucket(requireEnv('RAW_SESSIONS_BUCKET')),
    ),
    sessionEventPublisher: new PubSubSessionEventPublisher(
      new PubSub(),
      requireEnv('SESSION_EVENTS_TOPIC'),
    ),
    rateLimiter: new FixedWindowRateLimiter(UPLOADS_PER_MINUTE_PER_ACCOUNT, 60_000),
    logger: true,
  });

  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((error) => {
  // eslint-disable-next-line no-console -- nothing else is up yet at startup failure
  console.error('ingest-api failed to start', error);
  process.exit(1);
});

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  FirebaseTokenVerifier,
  FirestoreSharingStore,
  FirestoreUserDirectory,
} from '@smart-sneaker/ingest-api';
import { FirestoreSessionResultQuery } from './gcp-adapters';
import { buildDashboardServer } from './server';

/**
 * Cloud Run entry point. All configuration comes from the environment;
 * credentials come from Application Default Credentials — no secrets in code
 * or config files (Security NFR).
 */
async function main(): Promise<void> {
  const firebaseApp = initializeApp();
  const firestore = getFirestore(firebaseApp);

  const app = buildDashboardServer({
    tokenVerifier: new FirebaseTokenVerifier(getAuth(firebaseApp)),
    userDirectory: new FirestoreUserDirectory(firestore),
    sharingStore: new FirestoreSharingStore(firestore),
    resultQuery: new FirestoreSessionResultQuery(firestore, (message, context) =>
      app.log.warn(context, message),
    ),
    logger: true,
  });

  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((error) => {
  // eslint-disable-next-line no-console -- nothing else is up yet at startup failure
  console.error('dashboard failed to start', error);
  process.exit(1);
});

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { FirestoreAuthoritativeResultStore, GcsSessionBlobReader } from './gcp-adapters';
import { buildWorkerServer } from './server';

/**
 * Cloud Run entry point. All configuration comes from the environment;
 * credentials come from Application Default Credentials — no secrets in code
 * or config files (Security NFR).
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required environment variable ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const firebaseApp = initializeApp();

  const app = buildWorkerServer({
    blobReader: new GcsSessionBlobReader(
      getStorage(firebaseApp).bucket(requireEnv('RAW_SESSIONS_BUCKET')),
    ),
    resultStore: new FirestoreAuthoritativeResultStore(getFirestore(firebaseApp)),
    logger: true,
  });

  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((error) => {
  // eslint-disable-next-line no-console -- nothing else is up yet at startup failure
  console.error('session-worker failed to start', error);
  process.exit(1);
});

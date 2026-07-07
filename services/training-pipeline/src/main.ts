import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { FirestoreLabeledSessionQuery, FirestoreSnapshotStore } from '@smart-sneaker/dataset-store';
import { FirestoreModelRegistry, GcsModelArtifactStore, GcsSessionBlobReader } from './gcp-adapters';
import { buildTrainingServer } from './server';

/**
 * Cloud Run entry point. All configuration comes from the environment;
 * credentials come from Application Default Credentials — no secrets in code
 * or config files (Security NFR). Deploys --no-allow-unauthenticated; Cloud
 * Scheduler (periodic retraining, Req. 21) and operators invoke via IAM.
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
  const firestore = getFirestore(firebaseApp);
  const storage = getStorage(firebaseApp);

  const app = buildTrainingServer({
    labeledSessions: new FirestoreLabeledSessionQuery(firestore, (message, context) =>
      app.log.warn(context, message),
    ),
    snapshots: new FirestoreSnapshotStore(firestore),
    blobReader: new GcsSessionBlobReader(storage.bucket(requireEnv('RAW_SESSIONS_BUCKET'))),
    artifacts: new GcsModelArtifactStore(storage.bucket(requireEnv('MODEL_ARTIFACTS_BUCKET'))),
    registry: new FirestoreModelRegistry(firestore),
    warn: (message, context) => app.log.warn(context, message),
    logger: true,
  });

  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((error) => {
  // eslint-disable-next-line no-console -- nothing else is up yet at startup failure
  console.error('training-pipeline failed to start', error);
  process.exit(1);
});

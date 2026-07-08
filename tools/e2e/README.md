# @smart-sneaker/e2e — seed data & full-pipeline software tests

Deterministic seed corpus plus an end-to-end test that drives it through every
service using in-memory adapters only — no GCP, no network, no emulators.

## Seed data

```sh
npm run seed --workspace @smart-sneaker/e2e
```

Writes regenerable fixtures (gitignored) to `tools/e2e/seed/`:

| File | Contents |
|---|---|
| `roster.json` | 3 athletes + 1 coach with literal bearer tokens, and the sharing grants |
| `manifest.json` | Per-session metadata: owner, purpose, sample count, expected review flag |
| `sessions/*.json` | 7 contract-valid sessions — ready-to-POST `/v1/sessions` bodies |
| `invalid/out-of-order-samples.json` | A payload the ingest API must reject with 400 |

The corpus is built by `src/seed.ts` from the insights engine's synthetic-run
generator with fixed IDs and timestamps, so regeneration is byte-identical.
Scenarios covered: clean run with a matching on-phone result, labeled
`normal` / `favor-left-leg` / `favor-right-leg` protocol sessions (the
training corpus), a BLE-dropout capture, a tampered on-phone result the worker
must flag for review, and a non-sharing athlete used as the access-control probe.

## End-to-end pipeline test

```sh
npm test --workspace @smart-sneaker/e2e
```

`test/pipeline.test.ts` wires the services exactly like their `main.ts`
production entry points, but against in-memory adapters, and pushes the seed
corpus through the full data flow:

1. **Ingest** — uploads via the real Fastify HTTP boundary: 201 accepts,
   idempotent retries, 400 contract rejection, 401 unauthenticated.
2. **Worker** — processes every published event into an authoritative result;
   consistency comparison flags the tampered session; redelivery is a no-op.
3. **Dashboard** — athlete/coach reads via the real HTTP boundary, including
   trends, coach roster, and 403s on every unauthorized access path.
4. **Dataset store** — freezes the labeled sessions into an immutable snapshot.
5. **Training** — trains the baseline model from the snapshot, registers the
   versioned artifact, and proves retriggering is idempotent.

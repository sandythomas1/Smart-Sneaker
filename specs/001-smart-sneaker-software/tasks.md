# Tasks: Spec 001 — Smart Sneaker Software Solution

Stack (see `specs/constitution.md` Tech Stack, decided here): npm-workspaces monorepo —
`apps/client` (React Native/TS), `services/ingest-api` + `services/session-worker` +
`services/training-pipeline` (Node/TS, Fastify), `packages/data-contracts` + `packages/insights-engine`
(shared TS, imported by both client and cloud). Test framework: Jest throughout.

Tasks below cover the full Feature Catalog in `spec.md` except item 1 (`instrumented-shoe-capture`,
firmware — separate spec) and item 13 (`on-device-edge-inference`, Stage D — explicitly out of
scope for this spec). Several tasks are soft-blocked on `spec.md`'s Open Questions; each says so
explicitly rather than silently assuming an answer.

## T1: Core data contracts (Sample, Session, SportProfile, InsightResult)
- Description: Define the shared TypeScript schemas/types every other task builds against —
  timestamped sensor sample, a session (ordered samples + metadata + optional labels), a sport
  profile (sensors/segmentation-strategy id/feature set/model reference), and an insight result
  (value + confidence/quality indicator). Use a runtime-validating schema library (e.g. zod) so the
  same definition gives both compile-time types and the runtime validation Req. 15 needs later.
- Files likely touched: `packages/data-contracts/src/*.ts`
- Depends on: none
- Security-sensitive: no
- Acceptance criteria:
  - A `Session` schema requires ordered, timestamped samples and accepts optional labels/known-condition metadata (Req. 8).
  - A `SportProfile` schema requires a sensors list, a segmentation-strategy identifier, a feature set, and a model reference (Req. 12).
  - An `InsightResult` schema requires a value and a confidence/quality indicator per insight (Req. 10-11).
  - Parsing a malformed or incomplete payload against any schema fails with a descriptive, field-level error (not a generic exception).
- Status: done

## T2: Sport-profile abstraction — loader + "running" profile
- Description: A loader that resolves a named sport profile to its segmentation strategy, feature
  set, and model reference purely from configuration, with no sport-specific branching in caller
  code. Ship the "running" profile as the first real config.
- Files likely touched: `packages/insights-engine/src/sport-profile/*.ts`
- Depends on: T1
- Security-sensitive: no
- Acceptance criteria:
  - Loading `"running"` returns a fully-resolved profile matching the T1 schema.
  - Adding a second, stub profile (e.g. `"basketball-stub"`) requires only a new config entry and test fixture — no changes to loader code (proves Req. 12 at unit-test level).
  - Loading an unknown profile name fails with a clear error, not a silent default.
- Status: done

## T3: Gait segmentation (running profile, baseline algorithm)
- Description: Segment a continuous sample stream into discrete gait cycles for the running
  profile. This is the hardest problem in the pipeline per `plan.md`'s Risks — ship a working
  baseline (e.g. peak-detection/thresholding on the vertical pressure signal) against synthetic
  fixtures now; expect to revisit once real shoe data and a ground-truth method exist (blocked
  question in `spec.md`).
- Files likely touched: `packages/insights-engine/src/segmentation/*.ts`, `packages/insights-engine/test/fixtures/*.ts`
- Depends on: T1, T2
- Security-sensitive: no
- Acceptance criteria:
  - Given a synthetic clean-cadence fixture with known strike timestamps, returned cycle boundaries match within a documented tolerance.
  - Given a fixture with a noisy/dropout region, that region is marked lower-confidence rather than fabricating a plausible-looking cycle (Req. 9, 11).
  - An empty or too-short input is rejected/handled without throwing an unhandled exception.
- Status: done

## T4: Running insights engine (balance, contact time, cadence, strike type)
- Description: Compute the four running insights from segmented gait cycles, each with a
  confidence/quality indicator.
- Files likely touched: `packages/insights-engine/src/insights/*.ts`
- Depends on: T3
- Security-sensitive: no
- Acceptance criteria:
  - Given segmented fixture cycles, computes left/right pressure balance, per-foot ground contact time, cadence, and foot-strike classification (Req. 10).
  - A fixture built to represent one-leg-favoring produces a balance result reflecting that asymmetry (feeds `spec.md`'s asymmetry Acceptance Criterion).
  - An insight derived from a low-confidence segmentation is itself marked low-confidence, not silently reported as reliable (Req. 11).
- Status: todo

## T5: Accounts & access control (auth, roles, sharing relationship)
- Description: Firebase Auth integration plus the athlete/coach role model and the explicit
  athlete↔coach sharing relationship that everything else gates reads/writes on.
- Files likely touched: `services/ingest-api/src/auth/*.ts` (or a shared `services/auth` lib), Firestore data model for users/roles/sharing
- Depends on: T1
- Security-sensitive: yes — authentication, authorization, and the sharing relationship that gates all athlete data access (Req. 16, 20, Security NFR)
- Acceptance criteria:
  - An authenticated request resolves to a stable athlete/coach identity server-side from the auth token.
  - A coach can be granted (and revoked) a sharing relationship to a specific athlete.
  - A non-shared coach's (or arbitrary other user's) attempt to access an athlete's data is rejected server-side.
  - An unauthenticated request to any protected resource is rejected.
- Status: todo

## T6: Ingest API — authenticated upload, validation, ownership derivation
- Description: The Cloud Run endpoint that accepts an uploaded session: enforces auth, validates
  the payload against the T1 schema and size bounds, derives ownership from the caller's identity
  (never a client-supplied field), stores the raw session, and emits a processing event.
- Files likely touched: `services/ingest-api/src/routes/sessions.ts`
- Depends on: T1, T5
- Security-sensitive: yes — the system's primary externally-reachable boundary (Req. 14-16, 18, Security NFR, Abuse Prevention NFR)
- Acceptance criteria:
  - A valid authenticated upload is stored durably and emits a session-processing event keyed by session ID (Req. 14).
  - A payload failing schema validation, or exceeding a defined size bound, is rejected synchronously with an actionable error and is never queued (Req. 15).
  - The stored session's owning athlete always comes from the auth token; a payload containing a different client-supplied athlete ID does not change ownership (Req. 16).
  - Re-submitting the same session ID does not create a duplicate stored record (Req. 18, ingest half).
  - Requests from one account are bounded by a basic per-account rate limit (Abuse Prevention NFR, SHOULD).
- Status: todo

## T7: Session processing worker — authoritative result + consistency check
- Description: The Cloud Run job that consumes the session-processing event, runs T4's
  insights-engine server-side against the stored raw session, and persists the authoritative
  result. If the uploaded session includes the client's on-phone result, compare it against the
  worker's own result and flag sessions that exceed the agreed tolerance.
- Files likely touched: `services/session-worker/src/*.ts`
- Depends on: T4, T6
- Security-sensitive: yes — processes and persists session-derived personal data (Req. 17-18)
- Acceptance criteria:
  - Consuming a session-processing event produces a structured, persisted result using the same insights-engine as the client (Req. 17).
  - Redelivering the same event does not duplicate the stored result (Req. 18, worker half).
  - When an on-phone result is present in the uploaded session, a per-insight comparison against the worker's result is recorded; a session outside the Consistency NFR's tolerance is flagged for review rather than silently accepted.
- Status: todo

## T8: Athlete/coach dashboard
- Description: Web views for an athlete to see a session's insights and their multi-session trend,
  and for a coach to see only athletes who've shared with them.
- Files likely touched: TBD — dashboard delivery surface (web app vs. a view within `apps/client`) is an open implementation choice; default to a small web app (`apps/dashboard`) unless the user prefers folding this into the React Native client.
- Depends on: T5, T7
- Security-sensitive: yes — reads session data gated by ownership/sharing (Req. 19-20)
- Acceptance criteria:
  - An athlete sees their session's authoritative (worker-computed) insights and a trend across multiple sessions (Req. 19).
  - A coach sees only athletes who have shared with them (Req. 20).
  - A direct request for a non-shared athlete's data through the dashboard's data layer is rejected server-side, not merely hidden in the UI.
- Status: todo

## T9: Client BLE ingest & session recording
- Description: Discover/pair with the shoe, receive the BLE packet stream, reconstruct a
  time-synced session, buffer through disconnects, persist locally, and support labeling a
  recording with known conditions.
- Files likely touched: `apps/client/src/ble/*.ts`
- Depends on: T1
- Security-sensitive: no (local BLE + storage only; network upload is T11)
- **Soft-blocked:** the real firmware packet format and single-vs-dual-shoe question are open in `spec.md`. Build and test this task against a mock BLE peripheral emitting the T1 `Sample` schema so it isn't blocked on the (separate, not-yet-written) firmware spec; re-validate the wire parser once that format is fixed.
- Acceptance criteria:
  - Discovers and pairs with a simulated BLE peripheral advertising the agreed service.
  - A full simulated session streams in and reconstructs into a complete, time-ordered `Session` (Req. 1).
  - A simulated disconnect of up to 30s (proposed default, Req. 2) during streaming does not lose or corrupt the session.
  - A recording can be tagged with labels/known conditions (Req. 8).
- Status: todo

## T10: On-phone inference & insights UI
- Description: Run the shared insights-engine on-phone against a recorded session and display all
  four running insights immediately, with no network dependency.
- Files likely touched: `apps/client/src/insights/*.ts`, `apps/client/src/screens/InsightsScreen.tsx`
- Depends on: T4, T9
- Security-sensitive: no
- Acceptance criteria:
  - After a recorded/simulated session completes, all four insights display with confidence indicators, verified with networking mocked/disabled (Req. 4).
  - A deliberately-asymmetric fixture session displays the expected asymmetric balance.
- Status: todo

## T11: Session sync — upload, retry, failure UX
- Description: Automatically upload a completed session to the ingest API once connectivity
  allows, retry on transient failure, and surface a permanent failure to the athlete actionably.
- Files likely touched: `apps/client/src/sync/*.ts`
- Depends on: T6, T9
- Security-sensitive: yes — transmits personal session data to the authenticated ingest boundary (Req. 6-7)
- Acceptance criteria:
  - A completed session uploads automatically when connectivity is available, with no manual file handling (Req. 6).
  - The local copy is retained until the server confirms receipt, and is retried on transient failure.
  - A permanently-rejected upload (e.g. fails T6's validation) surfaces an actionable, non-technical message rather than failing silently (Req. 7).
  - Retrying an already-synced session does not create a duplicate server-side record (relies on T6's idempotency).
- Status: todo

## T12: Sensor/user calibration flow
- Description: A per-user/per-device calibration routine (e.g. stand/sit/walk sequence) that
  produces a correction factor applied to subsequent sessions.
- Files likely touched: `apps/client/src/calibration/*.ts`, calibration hooks in `packages/insights-engine`
- Depends on: T9, T4
- Security-sensitive: no
- Acceptance criteria:
  - Running the calibration routine produces a stored per-user/per-device correction factor.
  - A session recorded after calibration has that correction applied in its computed insights.
  - A session recorded without calibration is still processed, but flagged as uncalibrated (lower confidence) rather than treated as equivalent (Req. 13, SHOULD).
- Status: todo

## T13: Labeled dataset store & versioning
- Description: Store labeled sessions (from T9's labeling) as a named, versioned, queryable
  dataset snapshot for training/evaluation.
- Files likely touched: `services/ingest-api` extension or new `services/dataset-store`, Firestore/Cloud Storage schema for dataset versions
- Depends on: T6, T9
- Security-sensitive: yes — persists and later serves a corpus of personal movement data
- Acceptance criteria:
  - Labeled sessions are queryable as a named dataset snapshot.
  - Adding new labeled sessions after a snapshot is taken does not mutate that snapshot's contents (immutable versioning).
  - A snapshot records enough metadata (labels, conditions, session references) to reproduce a training run.
- Status: todo

## T14: Model training pipeline (Vertex AI)
- Description: Triggered/periodic training against a labeled dataset snapshot, producing a
  versioned model artifact and evaluation metrics resolvable by the sport-profile loader (T2).
- Files likely touched: `services/training-pipeline/*`
- Depends on: T13
- Security-sensitive: yes — external Vertex AI calls; produces artifacts that feed production inference
- Acceptance criteria:
  - A training run consumes a named dataset snapshot and produces a versioned model artifact plus evaluation metrics (Req. 21).
  - The resulting model version is resolvable by T2's sport-profile loader as a candidate reference.
  - A run is triggerable both on a schedule and on-demand.
- Status: todo

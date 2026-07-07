# Decision Log

Append-only log of significant technical decisions across specs. Each entry: what was decided, why, alternatives considered, and which spec/task it came from.

<!-- New entries go at the top, most recent first -->

## 2026-07-06 — Training pipeline: Cloud Run baseline trainer behind a port, deterministic model versions, IAM-only admin surface (Spec 001 / T13-T14)
Decision: `services/dataset-store` is a *library* (no server): labeled sessions become queryable
because ingest now copies `labels` + a `hasLabels` flag into the session record at upload (no
blob scans); snapshots embed their entries and are written once via atomic create at
`datasetSnapshots/{name}-v{version}`, so later labeling can only produce the next version.
`services/training-pipeline` is the only trigger surface (POST /v1/dataset-snapshots,
POST /v1/training-runs), IAM-gated like the worker (--no-allow-unauthenticated); Cloud Scheduler
calling the same idempotent endpoint IS the "scheduled" path. Training itself runs in-process: a
baseline trainer that fits the asymmetry-alert threshold (widest-margin midpoint between labeled
normal and favoring sessions, default 5% on overlap) and evaluates label-agreement, emitting a
JSON artifact + metrics. Model identity is deterministic — name
`{sportProfileId}-baseline-{datasetName}`, version `0.1.0-ds-v{snapshotVersion}` — so re-triggers
register nothing new (registry `modelVersions/{name}@{version}` via atomic create; artifact
written before the registry points at it). Contracts for snapshots and model-version records live
in data-contracts (cross service boundaries).
Why: the current "model" is a heuristic baseline with one learnable parameter — submitting that to
Vertex AI custom jobs would be untestable ceremony around nothing; the `TrainingJobRunner` seam is
the ports themselves, and a Vertex adapter binds behind `runTrainingRun` when a real model exists.
Personal movement data (the corpus) gets no athlete/coach-facing API at all — least privilege.
Alternatives considered: Vertex AI CustomJob submission now — rejected as dead, untestable code
(revisit when model complexity justifies managed training; noted as a deviation from the
constitution's stack table until then); separate CLI for snapshots — rejected, one IAM-gated
service beats loose scripts; timestamped model versions — rejected, breaks retrain idempotency.

## 2026-07-06 — Client: sync manager classifies outcomes at the HTTP boundary; calibration is a bounded per-foot gain (Spec 001 / T11-T12)
Decision: T11 sync splits into an uploader port (owns HTTP + classification: 2xx accepted;
408/429/5xx/network AND 401/403 transient since tokens are re-fetched per attempt; remaining 4xx
permanent, surfacing the server's already-user-facing error string) and a `SessionSyncManager`
(connectivity-triggered drain, exponential backoff in-drain, single shared drain across
concurrent triggers). A permanently rejected session is excluded from auto-retry but NEVER
deleted locally; server-confirmed receipt is the only thing that removes a local copy. T12
calibration: stand-still routine derives per-foot multiplicative pressure gains (each foot scaled
to the two-foot mean), guarded by stillness (coefficient of variation ≤0.25), duration, both-feet
and plausibility (scale within 0.25-4×) checks; contract (`CalibrationSchema`) lives in
data-contracts, correction + uncalibrated-penalty hooks live in the insights engine
(`applyCalibration`, `calibrationStatus` compute option: uncalibrated = ×0.8 confidence + caveat
note, reliability re-derived). The on-phone path always declares a status; the worker passes none
(cloud results stay unadjusted until calibration is part of the upload contract — deferred).
Why: classification-at-the-boundary keeps retry policy free of HTTP knowledge; deleting
athlete data on a server rejection is unrecoverable, so rejects park instead; gain-to-mean
calibration corrects left/right comparability (the balance insight's axis) without pretending to
produce absolute newtons (spec Non-Goal).
Alternatives considered: treating 401/403 as permanent — rejected, a refreshed token usually
heals it; marking sessions "synced" instead of removing — rejected for PoC (Req. 5 only demands
retention until confirmation; revisit if offline insight history is wanted); per-channel
calibration — rejected until the firmware fixes sensor placement (open question).

## 2026-07-05 — Client app: platform-agnostic BLE core, placeholder JSON wire format, dedupe-on-replay recorder (Spec 001 / T9-T10)
Decision: `apps/client` ships T9/T10 as platform-agnostic TypeScript behind BLE ports
(`BleCentral`/`ShoeConnection`); the native adapter (react-native-ble-plx) binds later, and tests
run against a `MockShoePeripheral` that buffers on-shoe while disconnected and replays on
resubscription. Wire format is a documented placeholder (UTF-8 JSON of the T1 `SensorSample`),
isolated in `packet.ts` as the single seam to swap when the firmware spec fixes the real format.
The recorder tolerates disconnects ≤30s (spec Req. 2 proposed default) by reconnect-with-backoff
and dedupes replayed samples on (foot, timestampMs); past tolerance it ends the recording keeping
all received data (degraded beats lost). On-phone inference (T10) wraps the shared engine and
degrades to an "unavailable, session saved" state instead of crashing. Screen tests run under
plain react-test-renderer with `react-native` mapped to a tiny host-component mock — no
Metro/Babel toolchain in CI. The synthetic-run generator moved into the engine package
(`src/testing/synthetic.ts`, exported) since engine tests, the mock peripheral, and UI fixtures
all need the same ground-truth sessions.
Why: keeps every T9 behavior unit-testable now despite the unwritten firmware spec (tasks.md's
soft-block instruction); the ports mirror the services' ports-and-adapters pattern.
Alternatives considered: full RN app scaffold + Metro jest preset — rejected as heavyweight and
orthogonal to the logic under test; failing the session on any disconnect — rejected, spec
explicitly demands buffer/resume; inventing a binary wire format now — rejected, would guess the
firmware contract the spec says not to guess.

## 2026-07-05 — Dashboard: separate web app reading worker results via shared contract; result shape moved to data-contracts (Spec 001 / T8)
Decision: The dashboard is its own deployable (`apps/dashboard`, Fastify on Cloud Run): an
authenticated JSON data layer (athlete sessions/session detail/trends, coach roster) plus a
minimal dependency-free HTML shell that renders only via textContent. It reuses the ingest API's
auth layer (`resolveIdentity`, `canAccessAthleteData`) by importing `@smart-sneaker/ingest-api`
rather than duplicating it — extract a `packages/auth` if a third consumer appears. The worker's
result shape moved to `packages/data-contracts` (`SessionResultSchema`) because worker (writer)
and dashboard (reader) now share it across a service boundary; the dashboard validates every
Firestore document against it (list views skip+log invalid docs; detail views fail loudly).
Results gained `sessionStartedAtMs` so trends order by when sessions happened, not when they were
processed (backfilled uploads land where they belong). Cross-athlete session detail requests
return an indistinguishable 404. Sharing grants now duplicate athleteId/coachId into the document
body so the coach roster is one collection-group query (`listAthleteIdsSharedWith`).
Why: a separate read-only surface keeps the ingest boundary small; contract-validated reads treat
the store as a boundary per the constitution; ordering trends by processing time would misplace
backfilled sessions.
Alternatives considered: folding the dashboard into the React Native client — rejected, coaches
are desktop/web users and tasks.md defaulted to a web app; querying raw session records for start
times — rejected, one contract-validated read beats a cross-service join at PoC scale; a
React/Next.js frontend — deferred, the acceptance criteria hinge on the server-side data layer,
and the PoC shell carries no build toolchain.

## 2026-07-04 — Session worker: push delivery, persisted failures, unreliable insights not compared (Spec 001 / T7)
Decision: The worker is a Cloud Run service receiving Pub/Sub *push* deliveries at POST
/pubsub/sessions (caller auth = Cloud Run IAM: --no-allow-unauthenticated + the push
subscription's service account holding run.invoker; no app-level token check). The
`SessionReceivedEvent` contract moved to `packages/data-contracts` so the worker validates
deliveries against the same schema ingest publishes. Outcome semantics: permanent problems
(malformed envelope, contract-invalid event, unparseable/invalid session blob, unknown sport
profile) are ACKed — invalid-session cases persist an idempotent `failed-validation` result record
(flagged for review) so the failure is visible instead of retried forever; transient problems
(missing blob, store outages) return 5xx so Pub/Sub redelivers. Consistency check: worker result is
the reference; numeric insights within ±10% relative (inclusive, float-epsilon-tolerant),
categorical by label match; pairs keyed by (kind, foot); an insight unreliable on either side is
recorded as `not-compared` rather than failing the session; any out-of-tolerance comparison sets
`flaggedForReview`. Results live at `sessionResults/{sessionId}` via atomic `doc.create()`.
Why: push-to-Cloud-Run is the standard low-ops pattern matching the plan's event-driven diagram;
persisted failures keep Req. 18 idempotency uniform across success and failure paths; not comparing
unreliable insights avoids false alarms on data both sides already distrust (their unreliability is
independently visible via Req. 11's confidence flags).
Alternatives considered: pull subscription in a Cloud Run job — rejected, adds scheduling/lifecycle
management for no PoC benefit; retrying invalid sessions — rejected, input can't improve, poison
retry loops mask real failures; comparing unreliable insights — rejected as noise (dashboards would
flag sessions whose only sin is honest low confidence).

## 2026-07-04 — Ingest API: ports-and-adapters, owner-namespaced blobs, at-least-once event republish (Spec 001 / T6)
Decision: The ingest route depends only on ports (SessionRecordStore/SessionBlobStore/SessionEventPublisher);
Firestore/GCS/Pub/Sub adapters are thin translation classes and unit tests run against in-memory
implementations. Raw blobs live at `raw-sessions/{ownerAthleteId}/{sessionId}.json` — owner-namespaced
so a colliding session ID from another account can never touch a victim's blob. Idempotency commits
via Firestore's atomic `doc.create()`; a duplicate upload by the same owner returns 200 and
*re-publishes* the processing event (at-least-once), so a client retry after a publish failure can
never strand a stored session — the worker (T7) is responsible for deduplication. Rate limiting is a
per-instance in-memory fixed window (30/min/account).
Why: ports keep every branch of the security-critical logic unit-testable without emulators; the
namespaced path closes a cross-tenant overwrite edge; republish-on-duplicate is the simplest design
in which "stored but never processed" is unreachable. Per-instance limiting satisfies the SHOULD-level
Abuse Prevention NFR at PoC scale.
Alternatives considered: record-before-blob ordering — rejected, a crash would leave records pointing
at missing blobs; suppressing the event on duplicates — rejected, loses the stranded-session guarantee;
shared-store (Redis/Firestore) rate limiting — deferred until the Scale NFR's growth materializes.

## 2026-07-04 — Access model: default-athlete role, provisioned-only coaches, athlete-managed grants (Spec 001 / T5)
Decision: Identity resolves server-side from a verified Firebase ID token; an unprovisioned user
defaults to `athlete` (least privilege — can only touch their own data) and `coach` exists only when
explicitly set in the user directory (no self-assignment route). Sharing grants are stored at
`users/{athleteId}/sharingGrants/{coachId}`, are creatable/revocable only by the athlete for their
own data, and only toward provisioned coaches. All user IDs are charset-bounded (`[A-Za-z0-9_-]{1,128}`)
before ever becoming a Firestore path segment.
Why: Req. 16/20 + constitution's least-privilege bar; grants under the athlete's subtree make "who
can see this athlete" one subcollection read and give future Firestore security rules a single gate.
Alternatives considered: auto-provisioning coaches on first login — rejected, coach unlocks reading
other users' data once shared, so it must be a deliberate act; a top-level grants collection —
rejected as harder to rule-gate per athlete.

## 2026-07-04 — Insights engine: feature-computer registry + per-foot results via contract `foot` field (Spec 001 / T4)
Decision: Insights are computed by feature computers registered under the ids sport profiles list in
`featureSet`, dispatched by `computeSessionInsights` — the single shared entry point both client and
worker call. `InsightResult` gained an optional `foot` field so per-foot metrics (ground contact time)
are two typed results keyed by (kind, foot), not prose notes. Reliability rule: an insight is
`reliable` only if its confidence (mean of contributing cycle confidences) ≥ 0.6 AND ≥ 4 cycles
contributed; uncomputable insights are still emitted with `reliable: false` (Req. 11). Foot-strike
classification uses center of pressure across FSR channels **assuming heel→toe channel ordering** — a
documented placeholder until the firmware spec fixes sensor placement (open question); revisit with T9's
wire-format validation.
Why: registry dispatch keeps Req. 12 honest (new sport = new computers + profile entry, no engine
branching); (kind, foot) keying is what T7's per-insight consistency comparison needs.
Alternatives considered: per-foot kinds like `ground_contact_time_left` — rejected, pushes structure
into string conventions; averaging feet into one number — rejected, per-foot values are the task's
acceptance criterion and feed the asymmetry story.

## 2026-07-03 — Baseline gait segmentation: self-calibrating hysteresis thresholding (Spec 001 / T3)
Decision: `peak-detection-v1` segments by hysteresis thresholding on total foot pressure, with
thresholds derived per-foot from the signal's own dynamic range (10th/95th percentiles), plausibility
bounds on contact duration (50-600ms), and explicit capture-gap detection. Clean cycles get
confidence 0.9 — deliberately never 1.0, since a heuristic without ground-truth validation shouldn't
claim certainty. Cycles overlapping a gap drop to 0.4; a stance fully swallowed by a gap produces
no cycle at all (degrade honestly, never fabricate — spec Resilience NFR).
Why: plan.md names segmentation the hardest problem and calls for a working baseline validated
against synthetic fixtures now, revisited when real shoe data and a ground-truth method exist.
Self-derived thresholds avoid depending on absolute calibration (spec Non-Goal: no lab-grade newtons)
and on the unresolved firmware sensor decisions.
Alternatives considered: fixed absolute pressure thresholds — rejected, meaningless across users/
devices before T12's calibration exists; IMU-based strike detection (accel spikes) — deferred, richer
but harder to validate synthetically and unnecessary for a baseline the FSR signal already serves;
ML-based segmentation — premature with zero labeled real sessions (that dataset is T13's job).

## 2026-07-03 — Session contract carries no athlete identity (Spec 001 / T1)
Decision: The `Session` upload schema has no athleteId or user-identity field at all. Ownership is
attached server-side from the authenticated caller when the ingest API stores the session.
Why: Req. 16 (from the spec review's IDOR finding) says ownership MUST derive from the auth token,
never a client-supplied field. Omitting the field from the contract enforces that at the type level —
zod's default key-stripping even discards a smuggled `athleteId`, which a unit test pins down.
Alternatives considered: including athleteId and having the server overwrite/verify it — rejected,
keeps a footgun in the contract that every future endpoint must remember to distrust.


## 2026-07-03 — Client + cloud stack: React Native + TypeScript client, Node/TypeScript Cloud Run services, shared TS package for insight logic (Spec 001 / decompose)
Decision: Client app is React Native (TypeScript); ingest API and session worker are Node.js/TypeScript
on Cloud Run (Fastify); segmentation, sport-profile, and insight-computation logic lives in one
shared TypeScript package (`packages/insights-engine`) imported by both, instead of two separate
implementations. Monorepo via npm workspaces. Test framework: Jest everywhere except firmware.
Why: `plan.md`'s Tradeoffs/Alternatives explicitly deferred the client-platform choice to
`/spec-decompose`, flagging that picking a shared runtime would resolve the "duplicated
intelligence" consistency risk more cleanly than contract-testing two separate implementations.
Same-language client+cloud makes that possible. Also minimizes new tooling surface for a solo
builder already spanning firmware, ML, and cloud.
Alternatives considered: Flutter/Dart client with a separate Python/Node cloud backend — rejected,
would force either a second reimplementation of segmentation/insight logic or cross-language
contract tests, undermining the whole point of picking a stack now; native iOS/Android (Swift +
Kotlin) — rejected, doubles client implementation effort for a solo builder with no App
Store-specific requirement driving it.


## 2026-07-03 — Cloud result is authoritative over on-phone result, within a defined tolerance (Spec 001)
Decision: The cloud worker's insight computation is the authoritative result once available (used
for dashboard/trend display), and must agree with the client app's on-phone result within a defined
tolerance (proposed default: ±10% relative on cadence/contact-time/balance, majority-label
agreement on foot-strike classification). A session exceeding tolerance is flagged for review, not
silently accepted.
Why: `/spec-review 001` found the original "consistent with" language in Req 14 (now Req 17) wasn't
independently testable, and nothing said which value wins if the two disagree. Making the cloud
result canonical matches the architecture's existing framing (cloud owns durability/trends) and
gives implementers an unambiguous, testable target.
Alternatives considered: (a) treat both results as co-equal and show whichever loaded first —
rejected, too ambiguous for a dashboard/trend feature where the same session must show one stable
number over time; (b) require bit-for-bit identical results from both codepaths — rejected as
unrealistic given the client and cloud likely run on different runtimes/languages.

## 2026-07-03 — Session ownership derived server-side from auth identity, not client input (Spec 001)
Decision: The ingest API MUST derive the owning athlete from the authenticated caller's identity;
it must never trust a client-supplied athlete/session-owner field for writes or reads.
Why: `/spec-review 001` identified this as an IDOR gap — without server-side derivation, an
authenticated-but-malicious client could plausibly attribute or access another athlete's session
data, undermining the sharing-relationship guarantee already required elsewhere (Req 20).
Alternatives considered: trusting a signed client-side athlete ID token — rejected as unnecessary
complexity; deriving straight from the Firebase Auth session (already required for authentication)
is simpler and closes the gap with no new infrastructure.


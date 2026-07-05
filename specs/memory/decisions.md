# Decision Log

Append-only log of significant technical decisions across specs. Each entry: what was decided, why, alternatives considered, and which spec/task it came from.

<!-- New entries go at the top, most recent first -->

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


# Decision Log

Append-only log of significant technical decisions across specs. Each entry: what was decided, why, alternatives considered, and which spec/task it came from.

<!-- New entries go at the top, most recent first -->

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


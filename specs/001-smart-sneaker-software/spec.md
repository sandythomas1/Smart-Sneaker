# Spec 001: Smart Sneaker — Software Solution (Client App + Cloud Platform)

Status: Draft

> Formalizes and supersedes the program-level draft at
> `specs/smart-sneaker-platform/spec.md` (kept as historical reference) into this project's
> spec-driven pipeline. Scope: the **software solution** — the client app and the GCP cloud
> platform — plus the data contract the shoe firmware must satisfy. Firmware/hardware
> *implementation* (sensor selection, embedded code, enclosure, power management) is a separate,
> not-yet-written spec; see Non-Goals.
>
> Revised after `/spec-review 001` (see `review.md`): added client/cloud consistency tolerance +
> reconciliation rule, session-ownership derivation, ingest input validation, an error-state UX
> requirement, a proposed BLE-disconnect tolerance, a rate-limiting NFR, and consistent
> "on-phone" vs. "on-shoe" terminology. Requirement numbers below are final post-revision.

## Problem

Athletes and coaches have almost no objective, affordable, per-step feedback about how the body
loads during a sport — asymmetries, timing, fatigue drift go unnoticed until they show up as an
injury or a plateau. Lab-grade force plates and motion capture can answer these questions but cost
thousands of dollars, live in a sports-science lab, and capture a handful of strides in an
unnatural setting rather than a real session in the wild.

The software solution is the part of the system that turns a stream of raw sensor packets off a
shoe into plain-language, sport-specific coaching insight, reliably, cheaply, and — for the
builder — as a portfolio-grade demonstration of embedded-adjacent signal processing, an
event-driven cloud pipeline, and applied ML, not another CRUD web app.

## Goals

- Reliably receive a shoe's raw pressure + motion stream over BLE and record it as a complete,
  replayable session (no data loss on a flaky connection).
- Turn a recorded running session into trustworthy per-session insights — left/right pressure
  balance, per-foot ground contact time, cadence, and foot-strike type — each with a confidence
  indicator, computed first on the client app and durably recomputed/stored in the cloud.
- Give an athlete a responsive, on-phone insights view immediately after a session, then sync the
  session to the cloud automatically once connectivity allows.
- Stand up an event-driven cloud back end (ingest → event → worker → results store → dashboard)
  that persists sessions, computes canonical results, and surfaces trends over multiple sessions.
- Define a **sport-profile abstraction** (sensors expected, segmentation strategy, feature set,
  model) so a second sport is added by configuration + a new model, without changing the shared
  capture/processing/cloud code paths.
- Capture and retain a labeled, versioned dataset of real sessions as a reusable training asset.
- Gate visibility: an athlete's data is visible only to themself and to coaches they've explicitly
  shared with.

## Non-Goals

- **Not** the shoe firmware/hardware implementation. This spec defines the *data contract* the
  firmware must produce (packet format, timestamping, transport) as an external interface the
  software depends on; sensor selection, embedded firmware code, power management, and enclosure
  design belong to a separate hardware/firmware spec.
- **Not** a manufacturable, durable, waterproof consumer product — this targets a proof-of-concept
  rig.
- **Not** medical or clinical diagnosis. Insights are coaching/training feedback; no regulatory
  (e.g. FDA) claims are made.
- **Not** real-time in-stride audio/haptic coaching during the activity — insights are post-session
  only for this spec.
- **Not** supporting all sports at launch. Running is the only fully-specified sport; the
  sport-profile abstraction is proven with a second sport (basketball, per the program vision) once
  running is validated — not built speculatively for sports beyond that now.
- **Not** lab-grade absolute force measurement in newtons — the system targets relative/derived
  metrics (asymmetry %, relative load, timing) unless calibration is later proven to make absolute
  values feasible.
- **Not** on-shoe inference (no phone attached) — that is Stage D of the program, explicitly gated
  on this spec's insights being validated first. (Contrast with Req. 4 below, which runs inference
  on the phone, not the shoe — see terminology note.)
- **Not** a social network, marketplace, e-commerce layer, or third-party wearable/ecosystem
  integration (Strava, Garmin, Apple Health) for this spec.

**Terminology:** this spec says **"on-phone"** for inference/compute that happens in the client
app on the athlete's phone, and **"on-shoe"** for inference that would run on the shoe's own MCU
with no phone present (Stage D, out of scope here). Earlier drafts used "on-device" for both,
which is exactly the kind of ambiguity `/spec-review` flagged — don't reintroduce it.

## Requirements

### Functional

**Client App**
1. The app MUST discover, pair with, and receive a continuous BLE packet stream from the shoe.
2. The app MUST reconstruct a time-synced session from the packet stream, tolerating BLE drops of
   up to a defined duration without losing or corrupting the session (buffer/resume, not
   fail-closed). [Proposed default: tolerate drops ≤30 seconds — confirm in implementation; see
   Open Questions.]
3. The app MUST filter and segment the raw stream into individual gait cycles / foot strikes
   on-phone.
4. The app MUST run the current sport-profile model on-phone to produce the four running insights
   (below) and display them to the athlete immediately after the session ends, without a network
   call.
5. The app MUST persist the complete raw session locally until it has been successfully synced to
   the cloud.
6. The app MUST upload a completed session to the cloud automatically when connectivity is
   available, without requiring the athlete to manage files manually.
7. The app SHOULD surface sync or processing failures to the athlete with an actionable,
   non-technical message rather than failing silently (matches the project's user-facing error
   standard).
8. The app MUST support recording a session with labels/known conditions (e.g. deliberate one-leg
   favoring, controlled pace) for training/validation purposes.

**Insight computation (shared logic — client app and cloud worker)**
9. The system MUST segment a continuous session into discrete gait cycles / sport-specific events.
10. The system MUST compute, for running: (a) left/right pressure balance, (b) per-foot ground
    contact time, (c) cadence, and (d) foot-strike type (heel/midfoot/forefoot).
11. The system MUST attach a confidence/data-quality indicator to each computed insight and MUST be
    able to express which insights are unreliable for a given session rather than silently
    reporting a bad value.
12. The system MUST support adding a new sport by supplying a sport profile (expected sensors,
    segmentation strategy, feature set, model) without modifying shared capture/processing/cloud
    code.
13. The system SHOULD correct for per-user/per-device sensor variation via a calibration step so
    insights are comparable across users and sessions.

**Cloud Platform**
14. The cloud MUST expose an authenticated ingest endpoint that accepts an uploaded session, stores
    the raw data durably, and emits a processing event (event-driven, not synchronous processing in
    the request path).
15. The ingest API MUST validate an uploaded session's structure and size against defined bounds
    before accepting/queuing it; a request that fails validation MUST be rejected synchronously
    with an actionable error, not silently queued for async processing. *(Added in review — closes
    an unvalidated-input gap against `specs/constitution.md`'s "validate at system boundaries" bar.)*
16. The ingest API MUST derive the owning athlete from the authenticated caller's identity, never
    from a client-supplied field; a request MUST NOT be able to write or read a session attributed
    to any athlete other than the authenticated caller, except as permitted by Req. 20's
    coach-sharing exception for reads. *(Added in review — closes an IDOR gap: without this, an
    authenticated client could plausibly attribute or access sessions under another athlete's ID.)*
17. A cloud worker MUST consume the session-processing event, run the segmentation + insight
    pipeline server-side, and persist structured results to a queryable results store. This result
    is **authoritative**: once it is available, it is what the dashboard displays, superseding the
    client's on-phone result for that session. The worker's result MUST agree with the client's
    on-phone result within the tolerance defined under the Consistency NFR below; a session
    exceeding that tolerance MUST be flagged for review rather than silently accepted.
18. Ingest and processing MUST be idempotent — re-delivery of the same session/event must not
    duplicate stored data or results.
19. The cloud MUST present an athlete their per-session insights and their trend across multiple
    sessions via a dashboard, using the worker's authoritative result (Req. 17) once available.
20. The cloud MUST let a coach view sessions/trends only for athletes who have explicitly shared
    with them, and MUST NOT expose an athlete's data to any other user.
21. The cloud SHOULD retrain sport-profile models on the accumulating labeled dataset on a
    triggered/periodic basis, and MUST track model versions and their evaluation metrics.
22. The cloud MUST retain raw session data (not just derived insights) so that improved algorithms
    or retrained models can re-derive insights from past sessions.

**Firmware data contract (interface only — not this spec's implementation)**
23. The firmware MUST emit foot-pressure (FSR array) and motion (IMU: orientation/acceleration)
    samples, each carrying a timestamp sufficient to temporally align left/right and
    pressure/motion streams to the precision needed for gait segmentation (see Open Questions for
    the numeric target).
24. The firmware MUST transmit this data off the shoe over BLE (no wired tether) in a packet format
    the client app's BLE-ingest component can parse deterministically (format to be pinned down
    jointly with the firmware spec, not guessed here).

### Non-Functional

- **Security:** All ingest and dashboard endpoints require Firebase Auth; access to a session's
  data is enforced server-side by ownership/sharing relationship, not client-side filtering alone
  (defends against IDOR — see Req. 16). No secrets in code, logs, or client bundles — cloud
  services read secrets from a secret manager. Raw and derived session data encrypted in transit
  (TLS) and at rest (managed store defaults are acceptable; no custom crypto). Uploaded payloads
  are validated before processing (Req. 15).
- **Abuse prevention:** The ingest API SHOULD apply per-account rate limiting to bound the impact
  of a misbehaving or compromised client, even though this is a low-severity risk at current
  single-builder/small-cohort scale. *(Added in review — revisit as a MUST if the Scale NFR's
  "next order of magnitude" growth materializes.)*
- **Accuracy/trustworthiness:** Each running insight must be validated against an agreed
  ground-truth method to a target agreement threshold before being shown to a user in a
  non-experimental context. [NEEDS CLARIFICATION — see Open Questions.]
- **Client/cloud consistency:** The cloud worker's authoritative result (Req. 17) and the client's
  on-phone result for the same session must agree within a defined tolerance per insight type.
  [Proposed default: cadence, contact-time, and balance metrics within ±10% relative difference;
  foot-strike classification must agree on the majority label — confirm in implementation; see
  Open Questions.] *(Added in review — the original "consistent with" language wasn't independently
  testable.)*
- **Capture fidelity:** BLE ingest and on-phone segmentation must be lossless enough, at the
  firmware's chosen sampling rate, to resolve individual foot strikes and per-foot asymmetry at
  running cadences (~150-190 steps/min). [Proposed default: contract for ≥100 Hz per sensor
  channel — confirm against the firmware spec once written; not this spec's decision to finalize
  alone.]
- **Latency:** Insights are post-session, not real-time. Proposed default: on-phone insights
  visible within seconds of the session ending (local compute only); cloud canonical results and
  dashboard update within a few minutes of upload. [Proposed default — confirm in review.]
- **Resilience:** Uploads and processing MUST be idempotent and retry-safe; a failed upload must
  not lose a recorded session (client retains local copy until server-confirmed); the system
  prefers a degraded result (fewer insights, lower confidence) over total failure.
- **Scale:** Cloud services stateless and horizontally scalable (Cloud Run); state lives in managed
  stores (Cloud Storage, Firestore). Designed for the next order of magnitude of athletes/sessions,
  built for today's single-builder + small test-cohort scale.
- **Observability:** Sessions and processing jobs are traceable end-to-end via a correlation ID
  from client upload through worker completion; metrics on ingestion rate, processing duration, and
  error rate are exported for monitoring.
- **Cost:** Cloud services chosen to stay within GCP's free/low tiers at PoC scale (Cloud Run,
  Pub/Sub, Firestore, Cloud Storage on-demand pricing); no committed/reserved infrastructure spend.

## Feature Catalog (decomposition anchor)

Carried forward from the program-level draft — each item below is a candidate for its own
`/spec-new` once this umbrella spec is reviewed and approved. Items marked *(firmware)* are out of
this spec's scope and belong to the separate hardware spec; they're listed for sequencing context
since the software depends on their output.

**Stage A — Capture & raw pipeline**
1. *(firmware)* `instrumented-shoe-capture` — sensor hardware + firmware sampling and BLE transport.
2. `ble-ingest-and-session-recording` — client app discovery/pairing, reliable BLE receive, session
   recording, failure-state UX (Req. 1-2, 5-7).
3. `sensor-calibration` — per-user/per-device calibration flow (Req. 13).

**Stage B — Intelligence (on-phone + shared)**
4. `gait-segmentation` — segmenting a stream into gait cycles (Req. 3, 9).
5. `running-insights-engine` — the four running insights + confidence (Req. 4, 10-11).
6. `labeled-dataset-collection` — labeled session recording protocol/tooling (Req. 8).
7. `sport-profile-abstraction` — the sensors/segmentation/features/model contract (Req. 12).

**Stage C — Cloud back end**
8. `session-ingest-pipeline` — authenticated ingest, input validation, ownership derivation, event
   emission (Req. 14-16, 18).
9. `session-processing-worker` — event-driven server-side processing, authoritative result,
   consistency check against the client (Req. 17-18).
10. `athlete-coach-dashboard` — session + trend views (Req. 19-20).
11. `model-training-pipeline` — triggered/periodic retraining (Req. 21).
12. `accounts-and-access-control` — auth, roles, sharing relationship, ownership derivation
    (Req. 16, 20, Security NFR).

**Stage D — Edge upgrade (explicitly out of scope for this spec)**
13. *(later milestone)* `on-device-edge-inference` — model runs on the shoe's own MCU (on-shoe, no
    phone present).

## Acceptance Criteria

- [ ] The client app pairs with a shoe, receives a full session over BLE, and survives a simulated
      disconnect of up to the agreed tolerance (proposed default: 30s) without losing session data.
- [ ] For a recorded run, the client app displays all four running insights (balance, contact time,
      cadence, strike type) on-phone, each with a confidence indicator, without a network call.
- [ ] An upload with a malformed or oversized payload is rejected synchronously with an actionable
      error, and is not queued for processing.
- [ ] A completed session syncs to the cloud automatically once connectivity returns, with no
      athlete-initiated file management; if a sync ultimately fails, the athlete sees an actionable,
      non-technical message rather than silence.
- [ ] The cloud ingest → event → worker pipeline processes an uploaded session and produces an
      authoritative result that agrees with the client app's on-phone result within the tolerance
      defined in the Consistency NFR; the dashboard displays the cloud's result once available.
- [ ] A request attempting to write or read a session attributed to an athlete other than the
      authenticated caller is rejected server-side (subject to the coach-sharing exception).
- [ ] Re-uploading/re-delivering the same session does not create duplicate stored data or results
      (idempotency verified).
- [ ] A deliberately-asymmetric labeled session is correctly reflected as asymmetry in both the
      on-phone and cloud-computed output, within the same consistency tolerance.
- [ ] An athlete can view their session insights and a multi-session trend on the dashboard.
- [ ] A coach can view only athletes who have shared with them; a direct-access attempt against a
      non-shared athlete's session is rejected server-side.
- [ ] A second sport profile can be supplied and produces sport-appropriate insights with no change
      to shared capture/segmentation-framework/cloud code (only new profile config + model).
- [ ] A labeled, versioned dataset of multiple sessions exists and is usable to train/evaluate a
      model via the training pipeline.
- [ ] The running insights are validated against the agreed ground-truth method and meet the agreed
      agreement threshold (blocked on Open Questions below).

## Open Questions

Genuine product/scope decisions that need a human call before `/spec-decompose` can fully sequence
the catalog above.

- [NEEDS CLARIFICATION: One instrumented shoe or both feet for the PoC? Left/right balance implies
  two sensor sets; the program's cost target references "one instrumented shoe." These two goals
  are in tension as written — resolve before the firmware contract (Req. 23-24) can be pinned down.]
- [NEEDS CLARIFICATION: Ground-truth validation method (instrumented treadmill / force plate /
  high-speed video / pressure mat) and the numeric agreement threshold that counts as "validated" —
  this gates the last Acceptance Criterion and the Accuracy NFR.]
- [NEEDS CLARIFICATION: Firmware sensor count and placement (pressure sensors + IMU) — needed to
  finalize Req. 23's numeric sampling/timestamp-precision target. Owned jointly with the firmware
  spec, but the software's segmentation approach depends on the answer.]
- [NEEDS CLARIFICATION: Who are the first real users — only the builder, a small test cohort, or
  external athletes/coaches? Drives how much rigor accounts-and-access-control (catalog #12) and
  the privacy/consent posture below need at v1.]
- [NEEDS CLARIFICATION: Data retention and consent posture — how long is raw movement data kept,
  and what consent is required from test subjects, given it's personal biomechanics data?]
- [NEEDS CLARIFICATION: Proposed defaults stated above — sampling rate (≥100 Hz), BLE-disconnect
  tolerance (≤30s), client/cloud consistency tolerance (±10% / majority-label), on-phone latency
  (seconds), and cloud latency (minutes) — are the author's best-guess placeholders, not confirmed
  decisions. Confirm or override each during `/spec-decompose` or implementation.]

## References

- Historical draft (superseded by this spec): `specs/smart-sneaker-platform/spec.md`
- Prior review: `specs/001-smart-sneaker-software/review.md`
- Constitution: `specs/constitution.md`
- Architecture diagrams: `assets/Smart-Sneaker-HighLevel-Diagram.png`,
  `assets/Smart-Sneaker-Diagram.png` (three tiers: Smart Shoe → Client App → GCP Cloud)

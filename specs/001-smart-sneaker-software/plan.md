# Plan 001: Smart Sneaker — Software Solution

## Approach

Build the software solution as three cooperating layers, matching the existing architecture
diagrams: a **client app** that owns the real-time athlete experience (BLE ingest, on-device
segmentation + inference, immediate insights, background sync), and a **GCP cloud platform** that
owns durability, cross-session trends, coach access, and model training — connected by an
**event-driven pipeline** (ingest → Pub/Sub event → worker → results store) rather than synchronous
request/response processing, so a slow or failed processing run never blocks the upload path.

Intelligence is deliberately duplicated in a controlled way: the client app runs the sport-profile
model on-device for a fast, offline-capable insight view, while the cloud worker re-runs the same
segmentation + insight logic server-side to produce the canonical, durable result used for trends,
coach views, and training data. This is the software half of the program's two-stage intelligence
rollout (`specs/constitution.md` → Architecture Principles); on-device inference *on the shoe
itself* (no phone) is explicitly Stage D and out of this plan.

The **sport-profile abstraction** is the seam that keeps the pipeline sport-agnostic: segmentation,
feature extraction, and the model to load are all resolved from a profile keyed by sport, so
"support basketball" becomes "ship a basketball profile + model," not a fork in the capture/process
code path. This plan treats that abstraction as a first-class module, not an afterthought bolted on
when the second sport arrives.

## Architecture

**Client App**
- *BLE Ingest* — discovers/pairs the shoe, receives the packet stream, buffers through brief
  disconnects, reassembles a time-synced session.
- *Preprocess* — filters noise, segments the stream into gait cycles (shared segmentation logic,
  see below).
- *Inference* — loads the active sport profile's model, computes the four running insights with a
  per-insight confidence score.
- *Insights UI* — displays results immediately, no network dependency.
- *Sync* — persists the raw session locally, uploads over HTTPS once connectivity allows, retries
  on failure, clears local copy only after server-confirmed receipt.

**Shared segmentation/insight logic**
- Packaged so the client app and the cloud worker both call the same segmentation + feature +
  confidence-scoring logic against a sport profile, rather than maintaining two implementations
  that can silently drift apart. Exact packaging mechanism (shared library vs. duplicated-but-
  contract-tested implementations across different runtimes) is an implementation decision for
  `/spec-decompose`, not fixed here — client and cloud may not share a language runtime.

**GCP Cloud Platform**
- *Firebase Auth* — authenticates athletes and coaches; identity feeds every downstream
  authorization check.
- *Ingest API (Cloud Run)* — authenticated HTTPS endpoint, writes raw session to storage, emits a
  session-processing event. Idempotent on session ID.
- *Pub/Sub (session event)* — decouples ingest from processing; absorbs backpressure if the worker
  is slower than upload volume.
- *Session Worker (Cloud Run job)* — consumes the event, runs segmentation + insights, writes
  structured results. Idempotent on (session ID, processing-run) so redelivery doesn't duplicate
  results.
- *Data store (Cloud Storage + Firestore)* — Cloud Storage for raw session blobs (cheap, durable,
  replayable); Firestore for structured results/trends (queryable by the dashboard).
- *Dashboard* — athlete and coach views over Firestore results; coach access filtered server-side
  by the sharing relationship, never by client-side query construction alone.
- *Vertex AI* — periodic/triggered training against the growing labeled dataset; produces versioned
  model artifacts and evaluation metrics that feed back into the sport-profile model reference.

**Firmware boundary (consumed, not designed here)**
- The software treats the shoe as a black box that emits timestamped FSR + IMU samples over BLE in
  an agreed packet format. This plan does not choose the packet format, sampling rate, or sensor
  layout — those are firmware-spec decisions this software must be built against, tracked as Open
  Questions in `spec.md` until a firmware spec exists to pin them down.

## Alternatives Considered

- **Cloud-only processing (no on-device inference in the client app)** — rejected as the sole
  approach. Simpler (one implementation of segmentation/insights, not two to keep consistent), but
  it makes the athlete wait on a network round-trip to see any result and defeats the "responsive
  post-session feedback" goal. Kept cloud-only for the *canonical* result but added on-device for
  the *immediate* one — accepting the duplication cost deliberately (see Tradeoffs).
- **Synchronous processing in the ingest request path (no Pub/Sub)** — rejected. Simpler
  infrastructure, but ties upload latency to processing latency and makes a slow/failed processing
  run risk the upload itself. The event-driven split costs one more moving piece (a queue) in
  exchange for the ingest path being fast and reliable independent of processing health.
- **Self-hosted training/inference infra instead of Vertex AI** — rejected for this PoC. More
  control, but materially more ops burden for a solo builder; Vertex AI's managed training fits the
  "prove the pipeline, not build MLOps infra" goal. Revisit only if Vertex AI's constraints (cost,
  format lock-in) become a real blocker.
- **Single shared codebase/runtime for segmentation logic across client and cloud** — considered
  ideal but not assumed as a hard requirement here, since the client app's platform is still TBD and
  may not share a runtime with the Cloud Run worker (e.g., a native mobile app vs. a
  Python/Node/Go backend). Deferred to `/spec-decompose` once the client platform is chosen;
  flagged here so it isn't accidentally lost as a goal (drift risk, see Risks).

## Tradeoffs

- **Duplicated intelligence (on-device + cloud) buys responsiveness and offline capability at the
  cost of a consistency risk**: the client's immediate result and the cloud's canonical result could
  diverge if the two implementations drift. Mitigated by treating "shared segmentation/insight
  logic" as a named architectural requirement (above), not an implementation detail to improvise
  later, and by Acceptance Criteria requiring the two to be checked against each other.
- **Event-driven cloud pipeline adds infrastructure (Pub/Sub, a separate worker deploy) that a
  monolithic request-handler wouldn't need**, in exchange for resilience: a processing bug or spike
  in load degrades gracefully (event sits in the queue) instead of taking down uploads.
- **Managed GCP services (Cloud Run, Firestore, Vertex AI) trade control and portability for
  operational simplicity** — appropriate for a single builder standing up an event-driven pipeline
  as a portfolio artifact; would be revisited if this ever needed to run outside GCP.
- **This plan does not pin down the client app's platform** (native iOS/Android, React Native,
  Flutter, etc.) — that choice materially affects how "shared segmentation logic" is packaged and is
  left to `/spec-decompose` for the `ble-ingest-and-session-recording` and `running-insights-engine`
  catalog items, since it's an implementation detail that doesn't change this spec's shape but does
  change how those specific tasks are built.

## Risks

- **Gait segmentation accuracy is the hardest problem in the pipeline** and every downstream insight
  depends on it; a weak segmenter silently degrades all four insights. Mitigation: ship a
  per-segmentation confidence signal (Req. 10) so downstream consumers can distinguish "no signal"
  from "wrong signal," and validate against ground truth before trusting output (see spec Open
  Questions).
- **Firmware contract is not yet fixed** (packet format, sampling rate, single vs. dual shoe) — this
  plan's Req. 20-21 and the Capture Fidelity NFR are placeholders until a firmware spec exists.
  Building the BLE-ingest component against an unstable contract risks rework. Mitigation: treat the
  firmware data contract as a versioned interface reviewed jointly, not assumed stable.
- **Small initial dataset** limits how much the model-training pipeline (catalog #11) can actually
  learn early on; early "trends" may be noisy. Mitigation: the spec already requires raw data
  retention specifically so past sessions can be reprocessed once the model improves.
- **Consistency drift between on-device and cloud insight computation** (see Tradeoffs) if the two
  aren't built from shared logic — could quietly ship two different answers to the same question.
  Mitigation: named as an explicit architectural requirement above, not left implicit.
- **Privacy/consent exposure**: biomechanics data is personal and potentially re-identifiable across
  sessions. Retention/consent posture is an open question in the spec; shipping accounts-and-access
  control (catalog #12) without that answered risks building the wrong access model. Mitigation:
  resolve before `/spec-decompose` reaches that catalog item.
- **Single-builder bandwidth across four disciplines** (embedded-adjacent signal processing, mobile,
  event-driven cloud backend, applied ML) is itself a delivery risk independent of any technical
  design. Mitigation: the existing stage sequencing (capture → intelligence → cloud → edge) is
  designed to de-risk by proving value early rather than building all four in parallel.

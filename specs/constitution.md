# Project Constitution

Durable engineering principles for this project. Unlike specs (which describe one feature), this file rarely changes — treat edits to it as deliberate, discussed decisions, not implementation detail.

## Engineering Standards
- Code is written for a senior-engineering bar: readable, scalable, secure, idiomatic to the stack.
- No code ships without unit tests covering its behavior, including edge cases and failure modes.
- Every subtask implementation includes a rationale + tradeoffs summary.
- This is a three-tier system (Smart Shoe firmware → Client App → GCP Cloud backend, per
  `assets/Smart-Sneaker-HighLevel-Diagram.png` and `assets/Smart-Sneaker-Diagram.png`). Each tier
  has its own language/runtime constraints — see Tech Stack — and specs should stay scoped to one
  tier's feature unless explicitly cross-cutting.
- Sport support is added via a **sport-profile abstraction** (sensors + segmentation strategy +
  feature set + model per sport), never by branching core capture/processing/cloud code per sport.

## Security Bar
- Treat all external input as untrusted. Validate at system boundaries.
- No secrets, credentials, or tokens committed to the repo or logged.
- Every `/spec-implement` run triggers an automated security review pass before a task is marked done.
- OWASP Top 10 classes are the minimum bar for review (injection, auth, exposure, SSRF, etc.).
- Biomechanics/movement data is personal data: access MUST be authenticated (Firebase Auth) and
  least-privilege; raw and derived session data MUST be protected in transit and at rest; an
  athlete's data MUST NOT be visible to a coach without an explicit sharing relationship.

## Testing Bar
- Unit tests are mandatory for new logic; prefer testing behavior over implementation detail.
- Test framework: <!-- detected: none — no code exists yet. Pick the idiomatic default per tier when
  that tier's first spec is implemented (e.g. a C/C++ unit test framework for firmware, the mobile
  framework's native test runner for the client app, the cloud runtime's idiomatic test framework
  for backend services). Record the actual choice here once made. -->
- Coverage expectations: TBD — fill in when the user states a preference.
- Signal-processing / ML-adjacent logic (gait segmentation, insight computation) additionally needs
  validation against recorded or synthetic ground-truth data, not just unit tests of code paths.

## Architecture Principles
- Event-driven cloud pipeline: ingest API → event (Pub/Sub) → processing worker → results store →
  dashboard, mirroring the pattern in the architecture diagrams.
- Two-stage intelligence rollout: cloud/app-side inference first (the "dumb shoe"), on-device edge
  inference is a later, explicitly gated milestone — do not conflate the two in one spec.
- Raw session data is retained even after processing, so insights can be re-derived later from
  improved algorithms/models.
- <!-- Fill in further decisions as they're made — record them here via /spec-retro, not by guessing now -->

## Tech Stack
<!-- detected: no manifest files exist yet (no package.json/pyproject.toml/go.mod/etc.) — this
     project is pre-code, planning-stage. Stack below is inferred from
     specs/smart-sneaker-platform/spec.md and the architecture diagrams; confirm/refine per-tier as
     each feature's spec is implemented. -->
- **Smart Shoe (firmware):** microcontroller-based, FSR pressure-sensor array + IMU, BLE output. Language/RTOS TBD.
- **Client App:** BLE ingest, on-device filtering/segmentation, sport-profile model inference, insights UI, HTTPS sync. Platform (native mobile / cross-platform) TBD.
- **Cloud (GCP):** Firebase Auth, Cloud Run (ingest API + session worker), Pub/Sub (session events), Cloud Storage + Firestore (raw sessions, summaries/trends), Vertex AI (model training).

## Decision Log Pointer
See `specs/memory/decisions.md` for the running log of significant architectural decisions and their rationale.

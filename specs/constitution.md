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
- Test framework: **Jest** for the client app, cloud services, and shared packages (decided during
  `/spec-decompose 001` — see `specs/memory/decisions.md`). Firmware tier's framework is still TBD,
  chosen when the firmware spec is implemented (a C/C++ unit test framework, not Jest).
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
<!-- Firmware tier is still pre-code/TBD, chosen when its own spec is written. Client + Cloud tiers
     were decided during /spec-decompose 001 (see specs/memory/decisions.md) so that segmentation/
     insight logic could be a single shared package instead of two implementations to keep in sync. -->
- **Smart Shoe (firmware):** microcontroller-based, FSR pressure-sensor array + IMU, BLE output. Language/RTOS TBD — separate hardware spec.
- **Client App:** React Native + TypeScript. BLE ingest, on-phone filtering/segmentation/inference (via `packages/insights-engine`), insights UI, HTTPS sync.
- **Cloud (GCP):** Node.js + TypeScript on Cloud Run (Fastify) for the ingest API and session worker; Firebase Auth; Pub/Sub (session events); Cloud Storage + Firestore (raw sessions, summaries/trends); Vertex AI (model training).
- **Monorepo layout:** npm workspaces — `apps/client` (React Native), `services/ingest-api`,
  `services/session-worker`, `services/training-pipeline`, `packages/data-contracts` (shared schemas/types), `packages/insights-engine` (shared segmentation + insight computation, sport-profile-driven).

## Decision Log Pointer
See `specs/memory/decisions.md` for the running log of significant architectural decisions and their rationale.

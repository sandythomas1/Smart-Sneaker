# Spec: Smart Sneaker — Sport-Specific Biomechanics Insight Platform (Program Overview)

> **Phase:** Specify · **Status:** draft · **Owner:** sandythomas1 · **Date:** 2026-06-26
> The *what* and *why*. No implementation detail — that belongs in `plan.md`.
>
> **This is an umbrella spec.** It maps the whole program and defines a catalog of
> independently-buildable features. Each feature in the catalog is intended to be promoted to
> its own `specs/<feature-slug>/spec.md` via `/specify` when you are ready to build it. This
> document defines the shared problem, vision, boundaries, and the contracts between features —
> it is the source of truth they all inherit from.

## Problem

Athletes and their coaches have almost no objective, affordable, per-step feedback about how
their body actually loads during a sport. A runner cannot tell that they consistently overload
their left foot, shorten their ground contact on one side, or drift their cadence as they
fatigue — until it shows up as an injury or a plateau. Lab-grade force plates and motion
capture answer these questions but cost thousands of dollars, live in a sports-science lab, and
measure a few strides in an unnatural setting rather than a real session. There is a gap for a
shoe-mounted sensor system that captures real movement in the wild and turns it into plain-language,
sport-specific coaching insights ("your left foot carried 8% more load than your right this run"),
cheaply enough for an individual athlete to own.

The secondary problem this program solves for the author is *proof*: demonstrating a complete,
self-built system that spans embedded sensing, on-device/edge ML, signal processing, and a
cloud data pipeline — a portfolio-grade artifact, not another web app.

## Vision (target end-state)

A small sensor module mounts to a sneaker, captures foot-pressure and motion data during a
session, and produces sport-specific biomechanics insights. The system is built in **two
intelligence stages**: first a "dumb shoe" that streams raw data to a companion app/cloud where
all interpretation happens, then an upgrade that pushes the trained model down onto the device
itself (edge inference) so insights are produced with no phone attached. The software is
designed so that supporting a **new sport** means supplying a new *sport profile* (which sensors
matter, how to segment the activity, which features to compute, which model to load) rather than
rewriting the pipeline. Running is sport #1; basketball and cutting sports follow.

## Goals

- Produce trustworthy per-session running insights — left/right pressure balance, per-foot ground
  contact time, cadence, and foot-strike type — that measurably agree with ground truth.
- Validate the insights are real and useful **before** investing in on-device ML (de-risk by
  sequencing: cloud/app intelligence first, edge inference second).
- Establish a sport-profile abstraction so a second sport can be added by configuration + a new
  model, with no change to the core capture/processing/cloud pipeline.
- Capture and retain a labeled dataset of real sessions — the most reusable asset the program
  produces — to power model training and retraining over time.
- Stand up an event-driven cloud back end that ingests sessions, processes them, stores results,
  and surfaces athlete/coach trends over time.
- Keep the proof-of-concept bill of materials for one instrumented shoe affordable (target order
  of ~$100–130 of hardware), and the experience usable by a single non-expert athlete.

## Non-Goals

Explicitly out of scope for this program (prevents scope creep — KISS/YAGNI):

- **Not** building a manufacturable, durable, waterproof consumer product. The hardware target
  is a proof-of-concept rig; long-term durability under 10,000+ foot strikes is explicitly deferred.
- **Not** medical or clinical diagnosis. Insights are coaching/training feedback, not a medical
  device, and the program makes no regulatory (e.g. FDA) claims.
- **Not** real-time in-stride audio/haptic coaching during the activity (post-session insights
  only, for the PoC).
- **Not** supporting all sports at launch. Running is the only fully-specified sport; others are
  designed-for but not built speculatively.
- **Not** lab-grade absolute force measurement in newtons. The system targets relative/derived
  metrics (asymmetry %, relative load, timing) unless calibration proves absolute values feasible.
- **Not** a social network, marketplace, or e-commerce layer.
- **Not** integrating with third-party wearables/ecosystems (Strava, Garmin, Apple Health) for the PoC.

## User Stories

- As a **runner**, I want a per-foot pressure-balance number after my run, so that I can tell if
  I'm overloading one leg before it becomes an injury.
- As a **runner**, I want to see my cadence and ground-contact time per foot, so that I can work
  on running form objectively instead of by feel.
- As a **runner**, I want to know my foot-strike type (heel/midfoot/forefoot), so that I can match
  my form to my goals and footwear.
- As a **coach**, I want to view an athlete's trends across sessions, so that I can spot asymmetry
  or fatigue patterns developing over weeks.
- As an **athlete**, I want my session to upload automatically when I'm back on Wi‑Fi, so that I
  don't have to manage files or cables.
- As the **builder/researcher**, I want to record labeled sessions under known conditions, so that
  I can train and validate the models against ground truth.
- As the **builder/researcher**, I want to add a new sport by writing a sport profile, so that I
  don't have to re-architect the system for basketball.
- As an **athlete (edge mode)**, I want the shoe to produce insights without my phone present, so
  that the device works standalone.

## Feature Catalog (each becomes its own spec)

These are ordered to match the de-risking sequence (cloud-first, edge-second). Slugs are
suggestions for the eventual `/specify <slug>` calls.

**Stage A — Capture & raw pipeline (the "dumb shoe")**

1. **`instrumented-shoe-capture`** — The sensor hardware + firmware that samples foot-pressure
   (FSR array) and motion (IMU), timestamps it, and streams raw packets off the shoe over BLE.
   *Why first:* nothing exists without a clean raw data stream.
2. **`ble-ingest-and-session-recording`** — Companion-app capability to discover/pair the device,
   receive the BLE stream reliably, and record a complete, time-synced session to a file/object.
3. **`sensor-calibration`** — Per-user / per-device calibration flow that corrects FSR noise and
   nonlinearity (e.g. a known-load or stand/sit/walk routine) so readings are comparable across users.

**Stage B — Intelligence (off-device first)**

4. **`gait-segmentation`** — Signal-processing that segments a continuous stream into individual
   gait cycles / foot strikes (the acknowledged hard problem). The contract every insight depends on.
5. **`running-insights-engine`** — Computes the running insight set from segmented cycles:
   left/right pressure balance, per-foot ground-contact time, cadence, and foot-strike
   classification, with a confidence/quality signal per insight.
6. **`labeled-dataset-collection`** — Tooling and protocol to record sessions under labeled,
   controlled conditions (normal, deliberate one-leg favoring, varied paces) and store them as a
   versioned, queryable training dataset.
7. **`sport-profile-abstraction`** — The configuration contract that lets the pipeline support a
   sport by declaring its sensors, segmentation strategy, feature set, and model — proven by adding
   a second sport (e.g. basketball: jump-and-land, lateral load) without changing core code.

**Stage C — Cloud back end**

8. **`session-ingest-pipeline`** — Authenticated cloud ingest that accepts an uploaded session,
   stores raw data, and emits a processing event (event-driven pattern).
9. **`session-processing-worker`** — A worker that consumes the event, runs the
   segmentation+insight pipeline server-side, and writes structured results to a results store.
10. **`athlete-coach-dashboard`** — Web views for an athlete and a coach to see a session's
    insights and trends across sessions over time.
11. **`model-training-pipeline`** — Periodic/triggered training and evaluation on the growing
    labeled dataset, producing versioned model artifacts and quality metrics.
12. **`accounts-and-access-control`** — Authentication, athlete/coach roles, and the
    athlete↔coach sharing relationship that gates who can see whose data.

**Stage D — The edge upgrade**

13. **`on-device-edge-inference`** — Convert the validated model to run on the device's
    microcontroller so the shoe produces insights standalone (no phone). Explicitly a *second
    milestone*, gated on Stage B proving the insights are real.

## Functional Requirements

Program-level requirements. Each numbered item will be inherited and refined by the relevant
feature spec.

**Capture**
1. The system MUST capture foot-pressure data and motion (orientation/acceleration) data from a
   sneaker during a session.
2. The system MUST timestamp samples so that left/right and pressure/motion streams can be
   temporally aligned.
3. The system MUST transmit captured data off the shoe to a companion device without a wired tether.
4. The system MUST record a session as a complete, replayable unit that can be re-processed later.

**Intelligence**
5. The system MUST segment a continuous session into discrete gait cycles / sport-specific events.
6. The system MUST compute, for running: (a) left/right pressure balance, (b) per-foot ground
   contact time, (c) cadence, and (d) foot-strike type.
7. The system MUST attach a confidence or data-quality indicator to each computed insight.
8. The system MUST express which insights it is confident in vs. which were unreliable for a session.
9. The system MUST support adding a new sport by supplying a sport profile (sensors, segmentation,
   features, model) WITHOUT modifying the shared capture, processing, or cloud code.
10. The system SHOULD correct for per-user/per-device sensor variation via a calibration step so
    insights are comparable across users and sessions.

**Cloud & accounts**
11. The system MUST let an authenticated athlete upload a recorded session to the cloud.
12. The system MUST process an uploaded session server-side and persist structured insight results.
13. The system MUST present an athlete their per-session insights and their trend over multiple sessions.
14. The system MUST let a coach view sessions/trends for athletes who have shared with them, and MUST
    NOT expose an athlete's data to coaches/users without that sharing relationship.
15. The system SHOULD retrain models on the accumulating labeled dataset and track model versions and
    their evaluation metrics.

**Edge upgrade**
16. The system SHOULD, as a later milestone, run inference on the device itself and surface insights
    without a connected phone.

**Data & ground truth**
17. The system MUST allow sessions to be recorded with labels/known conditions for training and validation.
18. The system MUST retain raw session data so that improved algorithms/models can re-derive insights
    from past sessions.

## Non-Functional Requirements

- **Accuracy / trustworthiness:** Each running insight must be validated against an agreed ground-truth
  method to a target agreement before it is shown to a user. [NEEDS CLARIFICATION: what ground-truth
  method and what agreement threshold define "trustworthy" — e.g. force plate / instrumented treadmill /
  video, and acceptable % error or asymmetry tolerance?]
- **Capture fidelity:** Sampling rate and sensor count must be sufficient to resolve individual foot
  strikes and per-foot asymmetry at running cadences. [NEEDS CLARIFICATION: target sampling rate, number
  and placement of pressure sensors, one shoe or both for the PoC?]
- **Session length / autonomy:** A single instrumented shoe must capture and stream a realistic session
  on one battery charge. [NEEDS CLARIFICATION: target session duration and battery life for the PoC?]
- **Latency:** Insights are post-session, not real-time. Target: results available to the athlete within
  a short window after upload. [NEEDS CLARIFICATION: acceptable time-to-insight after a session ends?]
- **Cost:** Per-shoe PoC hardware BOM target ~$100–130.
- **Security & privacy:** Biomechanics/movement data is personal data. Access MUST be authenticated and
  least-privilege; raw and derived data MUST be protected in transit and at rest; secrets MUST live in a
  secret manager, never in code or logs; no PII in logs (per constitution).
- **Scale (program target):** Designed for the next 10x (many athletes, many sessions, growing dataset)
  but built for today (single builder + small test cohort). Cloud services stateless and horizontally
  scalable; state in managed stores.
- **Resilience:** Uploads and processing MUST be idempotent and retry-safe; a failed upload must not lose
  a recorded session; degraded insight (fewer metrics) is preferred over total failure.
- **Observability:** Sessions and processing jobs MUST be traceable end-to-end (correlation IDs), with
  metrics on ingestion rate, processing duration, and error rate.

## Acceptance Criteria

The **program** has met this umbrella spec when:

- [ ] A single instrumented shoe captures a real running session and a complete raw session file exists.
- [ ] The pipeline segments that session into individual foot strikes and reports segmentation quality.
- [ ] For a recorded run, the system outputs all four running insights (balance, contact time, cadence,
      strike type), each with a confidence indicator.
- [ ] The running insights are validated against the agreed ground-truth method and meet the agreed
      agreement threshold (see Open Questions).
- [ ] A deliberately-asymmetric session (favoring one leg) is correctly reflected as asymmetry in the output.
- [ ] An athlete can upload a session and view its insights and a multi-session trend via a dashboard.
- [ ] A coach can view only the athletes who have shared with them, and cannot access others' data.
- [ ] A second sport is demonstrably added by supplying a sport profile, with no change to core
      capture/processing/cloud code.
- [ ] A labeled dataset of multiple sessions exists, is versioned, and is usable to train/evaluate a model.
- [ ] (Stretch / Stage D) The device produces at least one insight on-device with no phone connected.
- [ ] Each catalog feature has been promoted to its own spec before it is built.

## Open Questions

Every ambiguity that must be resolved before planning. `/clarify` resolves these.

- [NEEDS CLARIFICATION: Confirm the de-risking sequence — build the "dumb shoe" (cloud/app intelligence)
  fully first and treat on-device edge inference (feature 13) strictly as a later milestone?]
- [NEEDS CLARIFICATION: Is running the only sport to fully build now, with the sport-profile abstraction
  designed-for-but-not-built until running is proven (YAGNI)? Which is the intended second sport?]
- [NEEDS CLARIFICATION: For the PoC, instrument one shoe or both feet? Left/right balance implies both —
  is single-shoe + symmetry assumptions acceptable for the first milestone?]
- [NEEDS CLARIFICATION: What is the ground-truth validation method (instrumented treadmill / force plate /
  high-speed video / pressure mat) and what numeric agreement threshold counts as "validated"?]
- [NEEDS CLARIFICATION: Required pressure-sensor count and placement, and IMU placement, to resolve the
  four target insights?]
- [NEEDS CLARIFICATION: Target sampling rate, session duration, and battery life for the PoC rig?]
- [NEEDS CLARIFICATION: Who are the intended first users — only the builder, a small test cohort, or
  external athletes/coaches? This drives the auth/sharing and privacy scope.]
- [NEEDS CLARIFICATION: Are absolute force values (newtons) a goal, or are relative/derived metrics
  (asymmetry %, timing, relative load) sufficient for the PoC?]
- [NEEDS CLARIFICATION: Acceptable time-to-insight after a session ends (seconds, minutes, or "by next open")?]
- [NEEDS CLARIFICATION: Data retention and consent posture — how long is raw movement data kept, and what
  consent is required from test subjects given it is personal biomechanics data?]
- [NEEDS CLARIFICATION: Does the companion app need to run insights on-device (offline) too, or is
  upload-then-cloud-process acceptable for the PoC?]
- [NEEDS CLARIFICATION: Priority/sequencing across the 13 catalog features beyond the stage grouping —
  which two or three are the immediate next specs to write?]

## References

- Constitution: `~/.claude/CLAUDE.md`, `~/development/memory/engineering_principles.md`
- Architecture diagrams: `assets/Smart-Sneaker-HighLevel-Diagram.png`, `assets/Smart-Sneaker-Diagram.png`
  (three tiers: Smart Shoe → Client App → GCP Cloud)
- Related prior work referenced by the author: Project Nexus event-driven pipeline, Week 9 GCP lab
  (Pub/Sub → Cloud Run worker → Storage/Firestore → Vertex AI → dashboard pattern).
- Cross-project memory: `~/development/memory/architecture_decisions.md`,
  `~/development/memory/lessons_learned.md`

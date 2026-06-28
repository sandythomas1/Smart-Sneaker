# Spec: Smart Sneaker — Software Platform (Client App, Intelligence Pipeline & Cloud Back End)

> **Phase:** Specify · **Status:** draft · **Owner:** sandythomas1 · **Date:** 2026-06-27
> The *what* and *why*. No implementation detail — that belongs in `plan.md`.
>
> **Scope note.** This spec covers the *software aspect* of the Smart Sneaker program: everything
> downstream of the raw sensor stream that leaves the shoe over BLE — the companion/client app, the
> biomechanics intelligence pipeline (segmentation + insights), and the cloud back end (ingest,
> processing, storage, dashboards, accounts, model training). The physical sensor hardware and the
> on-shoe firmware are treated as an **upstream dependency**, not part of this spec; their only
> contract with the software is the BLE raw-packet stream. This spec inherits the shared problem,
> vision, and boundaries from the umbrella program spec at
> [smart-sneaker-platform/spec.md](../smart-sneaker-platform/spec.md).

## Problem

Raw foot-pressure and motion samples streaming off an instrumented sneaker are meaningless to an
athlete on their own — they are high-rate, noisy, per-sensor numbers. The value only appears when
software turns that stream into a small set of trustworthy, plain-language biomechanics insights
("your left foot carried 8% more load than your right this run"), stores them durably, and shows an
athlete and their coach how they change over time. Today no such software exists for this program:
there is no way to reliably receive a session off the device, segment it into individual foot
strikes, compute per-foot metrics with a quality signal, persist the result, or let a coach view a
shared athlete's trends. The software is also where the program's most reusable asset is created and
kept — a labeled dataset of real sessions — and where the sport-profile abstraction must live so
that a second sport is a configuration change, not a rewrite.

## Goals

- Reliably receive a complete running session off the shoe over BLE and persist it as a replayable,
  time-synced raw session that can be re-processed by future algorithm versions.
- Produce the four running insights — left/right pressure balance, per-foot ground-contact time,
  cadence, and foot-strike type — each with a per-insight confidence/quality signal, from a recorded
  session.
- Have exactly one source of truth for the segmentation + insight logic, so app-side and cloud-side
  results are identical for the same input (no algorithm drift between tiers).
- Stand up an authenticated, event-driven cloud back end that ingests a session, processes it,
  persists structured results, and serves athlete and coach views of per-session insights and
  multi-session trends.
- Enforce least-privilege access: an athlete sees only their own data; a coach sees only athletes who
  have explicitly shared with them.
- Capture and retain a **versioned, queryable labeled dataset** of sessions (including deliberately
  asymmetric and varied-pace runs) sufficient to train and evaluate a model.
- Express the running pipeline through a **sport-profile contract** (sensors, segmentation strategy,
  feature set, model reference) so adding a second sport is configuration + a new model with no change
  to shared capture-ingest, processing, or cloud code.

## Non-Goals

Explicitly out of scope for this software spec (KISS/YAGNI; some are owned by sibling specs):

- **Not** the sensor hardware or the on-shoe firmware. The BLE raw-packet stream is an external
  contract this software consumes; producing it belongs to `instrumented-shoe-capture`.
- **Not** on-device / edge inference. Running the model on the microcontroller is a later program
  milestone (`on-device-edge-inference`), gated on this platform proving the insights are real.
- **Not** real-time, in-stride audio/haptic coaching. Insights are post-session only.
- **Not** medical or clinical diagnosis, and no regulatory (e.g. FDA) claims. Insights are
  training/coaching feedback.
- **Not** supporting every sport at launch. Running is the only sport built now; the sport-profile
  abstraction is designed-for and proven by *one* second sport, not built speculatively for many.
- **Not** integrating with third-party ecosystems (Strava, Garmin, Apple Health) for the PoC.
- **Not** a social network, marketplace, or e-commerce layer.
- **Not** absolute force measurement in newtons — relative/derived metrics (asymmetry %, timing,
  relative load) are the target unless calibration later proves absolute values feasible.

## User Stories

- As a **runner**, I want my session to record reliably while I run and upload automatically when I'm
  back on Wi-Fi, so that I never manage files or cables and never lose a run.
- As a **runner**, I want a per-foot pressure-balance number, per-foot ground-contact time, cadence,
  and foot-strike type after my run, each marked with how confident the system is, so that I can act
  on the trustworthy numbers and ignore the unreliable ones.
- As a **runner**, I want a one-time (or occasional) calibration routine, so that my readings are
  comparable to my own past sessions and to other users.
- As a **runner**, I want to see how a metric trends across many sessions, so that I can spot
  asymmetry or fatigue developing over weeks.
- As a **coach**, I want to view sessions and trends only for athletes who have shared with me, so
  that I can guide them without seeing anyone else's private data.
- As an **athlete**, I want to control who can see my biomechanics data and to revoke a coach's
  access, so that I stay in control of personal movement data.
- As the **builder/researcher**, I want to record sessions tagged with known conditions (normal,
  deliberate one-leg favoring, varied paces) and retrieve them as a versioned dataset, so that I can
  train and validate models against ground truth.
- As the **builder/researcher**, I want to add a new sport by writing a sport profile, so that I don't
  re-architect the platform for basketball.
- As the **builder/researcher**, I want past raw sessions re-processed by a new algorithm version, so
  that improvements apply retroactively without re-running real athletes.

## Functional Requirements

Numbered, testable. Grouped by software tier.

**Capture ingest (client app ↔ device boundary)**
1. The system MUST discover and pair with an instrumented-shoe device over BLE and indicate
   connection state to the user.
2. The system MUST receive the device's raw-packet stream and assemble it into a complete, time-synced
   session in which pressure and motion samples (and left/right, if both shoes) can be temporally
   aligned.
3. The system MUST detect and surface capture problems during a session (e.g. dropped packets,
   disconnection, low signal) rather than silently producing a corrupt session.
4. The system MUST persist a recorded session locally as a complete, replayable raw unit before any
   processing or upload, so that a failed upload or processing run never loses the session.

**Calibration**
5. The system SHOULD guide the user through a calibration routine and store a per-user/per-device
   calibration profile that is applied to subsequent sessions so readings are comparable across users
   and over time.

**Intelligence (segmentation + insights)**
6. The system MUST segment a recorded session into discrete gait cycles / individual foot strikes and
   report a segmentation-quality measure for the session.
7. The system MUST compute, for running, all four insights: (a) left/right pressure balance,
   (b) per-foot ground-contact time, (c) cadence, and (d) foot-strike type (heel/midfoot/forefoot).
8. The system MUST attach a confidence or data-quality indicator to each computed insight and MUST
   distinguish, per session, which insights are trustworthy from those that were unreliable.
9. The system MUST degrade gracefully: when some insights cannot be computed reliably, it MUST still
   return the insights it can, rather than failing the whole session.
10. The system MUST drive the running pipeline from a declarative **sport profile** (which sensors
    matter, segmentation strategy, feature set, model reference) and MUST allow a new sport to be added
    by supplying a new sport profile WITHOUT modifying shared capture-ingest, processing, or cloud code.
11. The segmentation + insight logic MUST have a single source of truth such that the same raw session
    yields identical insights regardless of where it is executed (client or cloud).

**Cloud ingest & processing**
12. The system MUST let an authenticated athlete upload a recorded session to the cloud over an
    authenticated, encrypted channel.
13. Session upload and ingest MUST be idempotent: re-uploading the same session MUST NOT create
    duplicate sessions or duplicate results.
14. The system MUST process an uploaded session asynchronously via an event-driven flow (ingest emits
    an event; a worker consumes it), and MUST persist structured insight results to a results store.
15. Session processing MUST be retry-safe; a transient processing failure MUST be retryable without
    data loss or duplicate results, and a permanently failing session MUST be observably marked failed.
16. The system MUST retain raw uploaded session data so that an improved algorithm/model version can
    re-derive insights from past sessions, and MUST record which algorithm/model version produced a
    given result.

**Presentation**
17. The system MUST present an athlete their per-session insights (with confidence indicators) and
    their trend for each metric across multiple sessions.
18. The system MUST let a coach view sessions and trends only for athletes who have shared with them,
    and MUST NOT expose any athlete's data to a coach or user without an active sharing relationship.

**Accounts & access control**
19. The system MUST authenticate every user and support at least two roles — athlete and coach — with
    access enforced server-side (least privilege), not only in the UI.
20. The system MUST let an athlete grant and revoke a coach's access to their data, and revocation MUST
    take effect for all subsequent access.

**Dataset & model lifecycle**
21. The system MUST allow a session to be recorded/tagged with labels or known conditions (e.g.
    normal, one-leg-favoring, pace) for training and validation.
22. The system MUST expose the accumulated labeled sessions as a versioned, queryable dataset suitable
    for training and evaluating a model.
23. The system SHOULD support training/evaluating a model on the labeled dataset and MUST track model
    versions and their evaluation metrics, such that a result can be traced to the model version that
    produced it.

## Non-Functional Requirements

- **Correctness / trustworthiness:** Each running insight must agree with an agreed ground-truth method
  to an agreed threshold before it is shown without a "low-confidence" warning.
  [NEEDS CLARIFICATION: what ground-truth method (instrumented treadmill / force plate / high-speed
  video / pressure mat) and what numeric agreement threshold count as "validated"?]
- **Single-source-of-truth integrity:** App-side and cloud-side execution of the pipeline must produce
  identical insights for identical input (verified by a shared test fixture). Any divergence is a
  defect.
- **Latency (time-to-insight):** Insights are post-session, not real-time.
  [NEEDS CLARIFICATION: acceptable time from end-of-session (or from upload) to insights being
  available — seconds, a few minutes, or "by next app open"?]
- **Reliability of capture/upload:** A recorded session must survive app restart, loss of connectivity,
  and a failed upload, and must eventually upload without user intervention once connectivity returns.
  Target session-loss rate effectively zero for the PoC cohort.
- **Security & privacy:** Biomechanics/movement data is personal data. All access MUST be authenticated
  and least-privilege; raw and derived data MUST be encrypted in transit and at rest; secrets MUST live
  in a secret manager (never in code, committed env files, or logs); no PII in logs (per constitution).
  All external input (BLE packets, uploads, API requests) MUST be validated at the trust boundary.
- **Observability:** A session MUST be traceable end-to-end via a correlation ID from capture → upload
  → processing → result. The back end MUST emit RED metrics (ingest rate, processing duration, error
  rate) and actionable alerts on processing failure / SLO burn.
- **Scale:** Designed for the next 10x (many athletes, many sessions, growing dataset); built for today
  (single builder + small test cohort). Cloud services stateless and horizontally scalable; all state
  in managed stores.
- **Portability / offline:** [NEEDS CLARIFICATION: must the client app compute insights on-device
  (offline) so a user sees results without connectivity, or is record-locally-then-cloud-process
  acceptable for the PoC? This determines whether the shared pipeline must run on the app or only in
  the cloud.]
- **Cost:** Cloud back end must be cost-aware — prefer scale-to-zero / managed serverless so an idle
  small-cohort system costs near nothing.
- **Accessibility:** Athlete-facing views meet WCAG AA (per constitution).

## Acceptance Criteria

The software platform is done when ALL of these are true:

- [ ] A real running session is captured from the device over BLE, recorded locally as a complete raw
      session, and survives an app restart before upload.
- [ ] The pipeline segments that session into individual foot strikes and reports a segmentation-quality
      measure.
- [ ] For a recorded run, the system outputs all four running insights, each with a confidence
      indicator, and clearly separates trustworthy insights from unreliable ones.
- [ ] A deliberately asymmetric run (favoring one leg) is correctly reflected as asymmetry in the
      output.
- [ ] The same raw session produces identical insights when processed on the client and in the cloud
      (shared-fixture test passes).
- [ ] The insights are validated against the agreed ground-truth method and meet the agreed agreement
      threshold (see Open Questions).
- [ ] An authenticated athlete uploads a session and views its insights plus a multi-session trend; a
      duplicate upload does not create a duplicate session or result.
- [ ] A processing failure can be retried and re-processing the same session does not duplicate results;
      a permanently failed session is observably marked failed.
- [ ] A coach can view only athletes who have shared with them; revoking access immediately blocks
      further access; a coach cannot reach a non-sharing athlete's data via the API.
- [ ] A labeled dataset of multiple sessions (including asymmetric and varied-pace) exists, is
      versioned, and is usable to train/evaluate a model; results record their model/algorithm version.
- [ ] A second sport is demonstrably added by supplying a sport profile, with no change to shared
      capture-ingest, processing, or cloud code.
- [ ] A past raw session is re-processed by a newer algorithm/model version and yields an updated,
      version-tagged result.
- [ ] End-to-end correlation IDs and RED metrics are observable for a session through ingest →
      processing → result.

## Open Questions

Every ambiguity that must be resolved before planning. `/clarify` resolves these.

- [NEEDS CLARIFICATION: What client-app platform(s) — iOS, Android, cross-platform mobile, or a
  web/desktop BLE app — for the PoC? This drives the BLE stack and the offline-capability decision.]
- [NEEDS CLARIFICATION: Does the client app need to compute insights on-device/offline, or is
  record-locally → upload → cloud-process sufficient for the PoC? (Determines whether the shared
  pipeline must run on both client and cloud or cloud-only.)]
- [NEEDS CLARIFICATION: One shoe or both feet for the PoC? Left/right balance implies both — is
  single-shoe + a symmetry assumption acceptable for the first milestone?]
- [NEEDS CLARIFICATION: What is the BLE raw-packet contract from firmware (packet schema, sample rate,
  channel layout, timestamp source) that this software must consume? Owned by the hardware/firmware
  spec but required as an input here.]
- [NEEDS CLARIFICATION: What ground-truth validation method and numeric agreement threshold define a
  "validated" insight?]
- [NEEDS CLARIFICATION: Acceptable time-to-insight after a session ends or after upload?]
- [NEEDS CLARIFICATION: Who are the first users — only the builder, a small consented test cohort, or
  external athletes/coaches? This scopes the auth, sharing, and consent requirements.]
- [NEEDS CLARIFICATION: Data retention and consent posture — how long is raw movement data kept, what
  consent is captured from test subjects, and is there a delete/export requirement?]
- [NEEDS CLARIFICATION: Are absolute force values (newtons) ever a goal, or are relative/derived metrics
  sufficient — i.e. is a load-calibration step required by this software?]
- [NEEDS CLARIFICATION: Intended second sport (to prove the sport-profile abstraction) — basketball,
  cutting/lateral sports, or other?]
- [NEEDS CLARIFICATION: Which two or three of the software features (capture ingest, intelligence,
  cloud ingest/worker, dashboard, accounts, dataset, training) are the immediate next specs to write
  and build first?]
- [NEEDS CLARIFICATION: Is model training in-scope for this software milestone, or deferred until a
  sufficient labeled dataset exists (i.e. ship a hand-tuned/heuristic insight engine first)?]

## References

- Constitution: `~/.claude/CLAUDE.md`, `~/development/memory/engineering_principles.md`
- Umbrella program spec: [smart-sneaker-platform/spec.md](../smart-sneaker-platform/spec.md)
- Architecture diagrams: `assets/Smart-Sneaker-HighLevel-Diagram.png`,
  `assets/Smart-Sneaker-Diagram.png` (three tiers: Smart Shoe → Client App → GCP Cloud)
- Related catalog features this spec consolidates the software half of:
  `ble-ingest-and-session-recording`, `sensor-calibration`, `gait-segmentation`,
  `running-insights-engine`, `labeled-dataset-collection`, `sport-profile-abstraction`,
  `session-ingest-pipeline`, `session-processing-worker`, `athlete-coach-dashboard`,
  `model-training-pipeline`, `accounts-and-access-control`.
- Cross-project memory: `~/development/memory/architecture_decisions.md`,
  `~/development/memory/lessons_learned.md`
</content>
</invoke>

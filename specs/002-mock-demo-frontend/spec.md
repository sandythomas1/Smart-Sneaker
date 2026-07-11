# Spec: Mock Demo Frontend — Smart Sneaker Showcase UI

> **Phase:** Specify · **Status:** clarified · **Owner:** sandythomas · **Date:** 2026-07-10
> The *what* and *why*. No implementation detail — that belongs in `plan.md`.

## Problem

The Smart Sneaker software solution (spec 001) is complete as logic and services — capture,
segmentation, insights, ingest, worker, dashboard API — but every piece is headless: `apps/client`
and `apps/dashboard` are TypeScript modules and Fastify handlers with tests, not screens. There is
no way to *see* the product: nothing to show a stakeholder, recruiter, or test user that
demonstrates what an athlete actually experiences after a session, and no visual surface for the
builder to sanity-check that the computed insights (balance, contact time, cadence, foot-strike,
trends) are legible and compelling when rendered. The pain is a demonstration and design-validation
gap, not a missing production feature.

## Goals

- A running, clickable React/TypeScript demo UI that renders the product's core surfaces —
  post-session insights, multi-session trends, session capture state, and coach/sharing views —
  using realistic data so the product "can be seen".
- The demo exercises (and therefore visually tests) the real software outputs: the insights and
  trends it displays are produced by the existing shared logic / seed pipeline, not hand-drawn
  fake numbers, so a wrong-looking screen indicates a wrong-looking computation.
- The demo doubles as a design exploration: it establishes a first visual language (layout,
  hierarchy, charting of biomechanics metrics, confidence indicators, error/degraded states) that
  a future production UI can inherit or reject deliberately.
- Someone with no project context can run one documented command and be looking at the demo in
  under a couple of minutes, with no hardware, no cloud project, and no credentials.

## Non-Goals

- **Not** the production client app UI (React Native) or production dashboard — this is a mock/
  demo to explore how the product can look; production UI work is a later spec.
- **Not** live BLE capture from a real shoe, and **not** a live connection to deployed GCP
  services — the demo runs self-contained on realistic seeded/replayed data.
- **Not** real authentication or account management. Any athlete/coach distinction in the demo is
  simulated (e.g. a persona switcher), with a visible "demo" indication so it can't be mistaken
  for enforced access control.
- **Not** pixel-perfect brand design, a design system library, or Figma deliverables — the output
  is a working coded mock, good enough to judge and iterate on.
- **Not** new insight algorithms, metrics, or data-contract changes — display what spec 001's
  pipeline already computes.
- **Not** deployment/hosting infrastructure (CI, Cloud Run, custom domains) in this spec. The
  demo is expected to be **hosted eventually**, so nothing may assume localhost-only (no absolute
  local paths, no reliance on local services at runtime) — but the hosting work itself is a
  follow-up.

## User Stories

- As the **builder/founder**, I want a clickable demo of the athlete experience, so that I can
  show the product to stakeholders and recruiters without hardware or a cloud account.
- As the **builder/founder**, I want the demo to render outputs from the real insights pipeline
  over seeded sessions, so that visual review becomes an additional test of the software solution.
- As an **athlete (demo persona)**, I want to open a finished session and immediately understand
  my left/right balance, contact time, cadence, and foot-strike — including how confident the
  system is in each — so that the insight presentation itself can be evaluated for clarity.
- As an **athlete (demo persona)**, I want to see my trend across multiple sessions, so that the
  longitudinal value of the product is visible, not just single-session numbers.
- As a **coach (demo persona)**, I want to see only the athletes who shared with me and their
  summaries, so that the sharing/visibility model of the product is demonstrable.
- As a **design reviewer**, I want to see loading, low-confidence, degraded, and error states, so
  that the demo shows how the product behaves when things aren't perfect — not just the happy path.

## Functional Requirements

1. The demo MUST present a **session list** for the active demo athlete showing, per session, at
   minimum: date/time, sport, duration, and sync/processing status.
2. The demo MUST present a **session detail (insights) view** rendering every insight class spec
   001 computes for running — left/right pressure balance, per-foot ground contact time, cadence,
   and foot-strike type — each with its confidence indicator.
3. The demo MUST present a **trends view** showing at least one metric charted across multiple
   sessions for the active demo athlete.
4. The demo MUST present a **session capture view** that simulates the live-recording experience
   (recording state, elapsed time, connection status), driven by replayed/seeded packet data
   rather than real BLE.
5. The demo MUST include a **coach persona view** listing shared athletes and their session
   summaries, and MUST NOT show any athlete who has not (in the seed data) shared with that coach
   — demonstrating the visibility model of spec 001.
6. All insights and trends displayed MUST be computed by the existing shared insight logic (or
   loaded from artifacts that logic produced over the seed corpus); the demo MUST NOT hard-code
   insight values in UI components.
7. The demo MUST render non-happy-path states visibly and deliberately: at least (a) a session
   still processing, (b) an insight flagged low-confidence, (c) a session with a data-quality/
   degraded warning, and (d) an error/empty state. The seed corpus MUST include data that
   triggers each.
8. The demo MUST run locally, fully self-contained (no network dependency on GCP/Firebase), via a
   single documented command from a fresh clone plus install.
9. The demo MUST visibly identify itself as a demo/mock (e.g. persistent badge or banner), so
   screenshots cannot be mistaken for a shipped product.
10. The demo SHOULD allow switching between at least two demo personas (an athlete and a coach)
    without restarting.
11. The demo SHOULD render acceptably on both a phone-sized and a laptop-sized viewport, since it
    is standing in for a mobile product being reviewed on a desktop.
12. The demo MUST include a **pipeline status view** that visualizes the software solution being
    exercised: the stages of the event-driven pipeline (capture → segmentation/insights → ingest →
    worker → results) for the seed corpus, showing which existing e2e scenarios pass/fail so the
    demo "shows the test of the software solution" explicitly, not only implicitly via Req. 6.
13. The demo's visual direction MUST be developed with **Claude Design** (claude.ai's design tool
    — prototype template): the layout/visual language of the athlete-facing views originates as a
    Claude Design prototype, which the coded React app then implements. The prototype (or exports
    of it) is a deliverable alongside the code.

## Non-Functional Requirements

- **Performance:** first meaningful render of any view within ~2s on a developer laptop; chart
  interactions feel instant (<100ms) at the seed-corpus scale (tens of sessions).
- **Security:** no real user data, secrets, or credentials anywhere in the demo or its seed data;
  all personas and sessions are synthetic. Because auth is simulated, the demo must never be
  deployed as-is to a public URL claiming real access control (reinforced by Req. 9).
- **Accessibility:** core flows usable by keyboard; charts and confidence indicators do not rely
  on color alone; WCAG AA contrast for text.
- **Scale:** demo-scale only — a handful of personas, tens of sessions. No pagination,
  virtualization, or load-tuning work is required beyond staying responsive at that size.
- **Maintainability:** the demo consumes shared packages (`data-contracts`, `insights-engine`,
  e2e seed tooling) rather than duplicating their logic, so it stays true to the product as the
  pipeline evolves.
- **Quality bar:** per the project constitution, demo logic (data loading, persona gating,
  state derivation) ships with unit tests; purely presentational components are exercised at
  least by rendering the key states of Req. 7.

## Acceptance Criteria

The feature is done when ALL of these are true:

- [ ] From a fresh clone, one documented command sequence (install + one run command) opens the
      demo in a browser with seeded data visible — no hardware, GCP, or credentials.
- [ ] Session list, session insights, trends, capture simulation, and coach views all render with
      seed-derived data (Reqs. 1–5).
- [ ] A spot-check confirms values shown in the UI match the insights-engine output for the same
      seed session (Req. 6), and no insight numbers are hard-coded in components.
- [ ] Switching to the coach persona hides non-shared athletes (Req. 5) and switching personas
      requires no restart (Req. 10).
- [ ] All four non-happy-path states of Req. 7 are reachable in the demo and visually distinct.
- [ ] The demo badge/banner is visible on every view (Req. 9).
- [ ] The demo is usable at a phone-width and a desktop-width viewport (Req. 11).
- [ ] The pipeline status view shows the pipeline stages and the e2e scenarios' pass/fail state
      for the seed corpus (Req. 12).
- [ ] A Claude Design prototype (or exported views from it) exists for the athlete-facing screens
      and the coded UI recognizably implements it (Req. 13).
- [ ] Unit tests for demo data-loading/persona/state logic pass in CI alongside the existing
      workspaces' tests.

## Open Questions

All resolved by the owner on 2026-07-10:

- **Platform:** React **web** app (not React Native). It stands in visually for the mobile
  client, hence Req. 11's phone-width requirement.
- **Location:** lives **in this monorepo** as a new workspace (e.g. `apps/demo-web`), consuming
  the shared packages per Req. 6.
- **"Shows the test":** yes — an explicit **pipeline/e2e status view** is in scope (Req. 12), in
  addition to rendering seed-pipeline outputs.
- **"Using Claude design":** means the **Claude Design** tool on claude.ai (prototype template) —
  the visual direction is prototyped there first, then implemented in code (Req. 13).
- **Audience/venue:** design **iteration first, eventually hosted** — hosting itself is a
  follow-up (see Non-Goals), but the demo must not bake in localhost-only assumptions, and the
  demo badge / simulated-auth warnings (Req. 9, Security NFR) matter precisely because it will be
  public later.
- **Investment split:** **athlete-first**; the coach view (Req. 5) exists to demonstrate the
  visibility model and gets minimal visual investment.

## References

- Constitution: `~/.claude/CLAUDE.md`, `~/development/memory/engineering_principles.md`,
  project `specs/constitution.md`
- Related: `specs/001-smart-sneaker-software/spec.md` (the software solution this demo
  showcases), `tools/e2e` seed corpus + full-pipeline e2e (`npm run seed`),
  `packages/insights-engine`, `packages/data-contracts`, `specs/memory/decisions.md`

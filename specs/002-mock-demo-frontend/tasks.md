# Tasks: Mock Demo Frontend — Smart Sneaker Showcase UI

> **Phase:** Tasks · **Status:** draft · **Date:** 2026-07-11
> Derived from `plan.md`. Each task is small, ordered, and independently verifiable.
> `/implement` works top to bottom, checking boxes and committing logical units.
> Status note (2026-07-12): all engineering tasks done — 331 tests green repo-wide. Task 2/27
> (Claude Design prototype iteration on claude.ai/design) and task 25 (manual viewport review)
> need the user; the run command, checklist, and design prompt are in apps/demo-web/README.md.
> Constitution note: every implementation task ships *with* its unit tests — the Tests section
> below lists only the cross-cutting suites that span multiple tasks.

## Legend
- `[ ]` todo · `[~]` in progress · `[x]` done
- **(dep: N)** = depends on task N · **[P]** = parallelizable with siblings

## Setup
- [x] 1. Scaffold `apps/demo-web` workspace: Vite + React 19 + TypeScript strict, hash-based
       `react-router-dom` routes (`#/sessions`, `#/sessions/:id`, `#/trends`, `#/capture`,
       `#/coach`, `#/pipeline`), Jest + ts-jest + jsdom + Testing Library config matching the
       repo's conventions, ESLint `no-restricted-imports` rule forbidding data imports in
       `src/views/**` (Req. 6 guard), generated `public/demo-data.json` gitignored, workspace wired into root
       `npm test` / `npm run typecheck`.
- [~] 2. Claude Design prototype (Req. 13): run `design-prompt.md` through Claude Design
       (prototype template), iterate the six screens, and commit exports/screenshots + the
       prototype link under `specs/002-mock-demo-frontend/design/`. Blocks visual tasks only. [P]

## Core Implementation
- [x] 3. Extend `buildSeedCorpus()` in `tools/e2e`: ~9 additional short Asha running sessions
       across ~6 weeks with drifting cadence/balance (trend series, ≥10 total), one
       heavy-dropout session tuned until at least one insight is genuinely low-confidence/
       unreliable under the engine's reliability rule, one session designated still-processing,
       one persona/athlete with zero sessions (empty state). Existing e2e suite stays green;
       `npm run seed` output stays deterministic. [P]
- [x] 4. Define the demo artifact contract in `apps/demo-web/src/data/demo-artifact.ts`: zod
       schemas for `DemoPersona` (no token field), `DemoSessionSummary`, `DemoSessionDetail`
       (embedding `SessionResult` from data-contracts), `DemoTrendSeries`, `DemoCoachRoster`,
       `DemoPipelineStatus`, per plan's Data Model. (dep: 1) [P]
- [x] 5. Demo-data generator `tools/e2e/src/write-demo-data.ts`: run the in-memory full
       pipeline over the seed corpus (same wiring as `pipeline.test.ts`, plus the withheld-
       from-worker "processing" session and the injected `failed-validation` blob scenario),
       derive coach rosters from sharing grants, strip tokens, record per-stage/per-scenario
       pipeline status (incl. the invalid-session 400 probe), validate against the artifact
       schema, write `apps/demo-web/public/demo-data.json`, exit non-zero on any
       unexpected stage outcome with per-stage log lines. Wire `npm run demo-data` in
       `tools/e2e` and `predev`/`prebuild` in `apps/demo-web`. (dep: 3, 4)
- [x] 6. Data layer in `apps/demo-web/src/data/`: validated artifact loading (invalid artifact
       → error state, never a crash), persona gating (athlete sees own sessions; coach sees
       only granted athletes), status-chip derivation, confidence-level mapping via the design
       system's `describeConfidence`, trend-series ordering by `startedAtMs`. Pure functions +
       unit tests. (dep: 4)
- [x] 7. App shell: top bar with persistent `DemoBadge` and persona switcher (athlete ⇄ coach,
       no reload, coach lands on `#/coach`), bottom tab bar at phone width, top-level React
       error boundary rendering the designed error state, base responsive layout per the
       prototype. First end-to-end slice: shell renders over real generated data. (dep: 1, 5, 6)
- [x] 8. Design-system chart primitives per the prototype: accessible SVG line chart (axis
       labels + units, range band, highlighted latest point, non-color series encoding) and
       L/R split bar, plus any shell primitives the prototype established. Unit tests for
       chart geometry/scale math. (dep: 2) [P]
- [x] 9. Session List view: per-session date/time, sport, duration, status chip
       (synced / processing / on-phone-only), data-quality warning icon, empty state (Req. 1,
       7a, 7c-entry, 7d-empty). (dep: 7)
- [x] 10. Session Detail (insights) view: all four running insight classes with value, unit,
        confidence indicator, plain-language takeaway; low-confidence treatment (icon + label,
        not color alone); unreliable-insight state with note; "computed on phone / verified in
        cloud" indicator; flagged-for-review and failed-validation (error) states (Reqs. 2,
        7b–7d). (dep: 7, 8)
- [x] 11. Trends view: cadence line chart across the seeded series with metric toggle
        (balance %, contact time) and drift callout card, ordered by session start time
        (Req. 3). (dep: 7, 8)
- [x] 12. Capture simulation view: in-browser replay of a deterministic
        `generateSyntheticRun` — elapsed timer, REC indicator, connection status, live signal
        indicator, End Session; scripted dropout drives the `Reconnecting…` degraded variant
        with data-retained message (Req. 4). Replay logic as pure, fake-timer-testable
        functions. (dep: 7)
- [x] 13. Coach view: roster of granted athletes with last-session summaries, explicit
        shared-only note; minimal visual investment per spec (Req. 5). (dep: 7)
- [x] 14. Pipeline Status view: five stages (capture → segmentation/insights → ingest → worker
        → results) with pass/fail/running, per-scenario e2e list with pass/fail and
        descriptions (Req. 12). (dep: 5, 7)

## Tests
- [x] 15. Generator integration test (node): artifact validates against schema, contains all
        four Req. 7 trigger states, ≥10-session trend series, coach roster includes Asha + Ben
        and excludes Chike, contains no `token` fields, byte-identical across two runs.
        (dep: 5)
- [x] 16. Req. 6 spot-check test: recompute `computeSessionInsights` for a seed session and
        assert equality with the artifact's stored insight values (AC 3). (dep: 5)
- [x] 17. Component render suite for non-happy paths: processing chip, low-confidence badge,
        data-quality warning, unreliable insight + note, error state, empty state — each
        visually distinct — and `DemoBadge` present in the shell on every route (AC 5, 6).
        (dep: 9, 10)

## Observability & Docs
- [x] 18. `apps/demo-web/README.md`: the single documented run command
        (`npm install && npm run dev --workspace @smart-sneaker/demo-web`), regeneration
        notes, manual checks (phone/desktop viewport review, prototype-vs-implementation
        review), pointer to the Claude Design prototype; root README/AGENTS pointer updated.
        Confirm generator stage logging and error-boundary reporting landed per plan
        (tasks 5, 7). (dep: 5, 7)

## Verification (maps to spec Acceptance Criteria)
- [x] 19. AC 1 — fresh-clone check: `npm install` + the one documented run command opens the
        demo with seeded data; no hardware/GCP/credentials. (dep: 18)
- [x] 20. AC 2 — session list, insights, trends, capture, and coach views all render
        seed-derived data (Reqs. 1–5). (dep: 9–14)
- [x] 21. AC 3 — spot-check test (task 16) green; ESLint views guard active; no hard-coded
        insight numbers in components. (dep: 16)
- [x] 22. AC 4 — coach persona hides non-shared athletes (Chike absent); persona switch needs
        no restart. (dep: 13, 15)
- [x] 23. AC 5 — all four Req. 7 states reachable in the running demo and visually distinct.
        (dep: 17)
- [x] 24. AC 6 — demo badge visible on every view. (dep: 17)
- [~] 25. AC 7 — usable at phone width (~390px) and desktop width; manual viewport review
        recorded in the README checklist. (dep: 18)
- [x] 26. AC 8 — pipeline status view shows stages + e2e scenario pass/fail for the seed
        corpus. (dep: 14)
- [~] 27. AC 9 — Claude Design prototype/exports committed and the coded UI recognizably
        implements it (human review against `design/`). (dep: 2, 9–12)
- [x] 28. AC 10 — demo unit tests pass under root `npm test --workspaces` in CI alongside
        existing workspaces. (dep: 15–17)
- [x] 29. Capture learnings in `specs/memory/learnings.md` and, if cross-project,
        `~/development/memory/lessons_learned.md`. (dep: 19–28)

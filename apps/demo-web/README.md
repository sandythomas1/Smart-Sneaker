# @smart-sneaker/demo-web

Self-contained demo/mock frontend for the Smart Sneaker software solution (spec 002). A static
React SPA that renders **pipeline-produced** seed data: session list, post-session insights,
trends, a live-capture simulation, a coach view, and a pipeline-status screen. No hardware, no
GCP project, no credentials — everything is synthetic and generated locally.

## Run it

From a fresh clone:

```bash
npm install
npm run dev --workspace @smart-sneaker/demo-web
```

Open the printed URL (default `http://localhost:5173`). The `predev` hook first runs the real
in-memory pipeline (ingest → worker → dashboard reads) over the deterministic seed corpus and
writes `public/demo-data.json`; the app refuses to render an artifact that fails schema
validation. `npm run build` produces a fully static `dist/` (hash routing, relative asset paths)
deployable to any static host — but note the demo simulates auth and must not be presented as
having real access control.

## Where the numbers come from

- `tools/e2e/src/demo-data.ts` runs the same wiring as the full-pipeline e2e test and emits the
  artifact; it exits non-zero (writing nothing) if any stage misbehaves.
- Views never load or embed data (enforced by `test/architecture.test.ts`); everything arrives
  through the validated artifact and `DemoContext`.
- The capture screen replays the exact synthetic-run options of the seeded session named in
  `artifact.capture.sourceSlug` — its mid-run dropout drives the "Reconnecting…" state.
- The spot-check test in `tools/e2e/test/demo-data.test.ts` recomputes insights with the shared
  engine and asserts equality with the artifact (spec Req. 6).

## Demo personas

Simulated via the switcher in the top bar — labeled "no real access control". Asha (athlete with
the full six-week history and every edge-case session), Ben, Chike (shares with no coach), Mira
(empty state), Coach Dana (sees exactly Asha + Ben).

## Design direction

The visual language originates from the Claude Design prototype (see
`specs/002-mock-demo-frontend/design-prompt.md`; prototype exports land in
`specs/002-mock-demo-frontend/design/`). Tokens and shared components live in
`packages/design-system` and are synced to the Claude Design project.

## Manual review checklist

Automated tests cover states and gating; these need eyes:

- [ ] Phone width (~390px) and desktop width both render acceptably (spec Req. 11).
- [ ] First meaningful render ≲ 2s on a dev laptop; chart/toggle interactions feel instant
      (<100ms) at seed scale (Performance NFR).
- [ ] Core flows work by keyboard: tab through the shell, switch persona, open a session,
      toggle a trend metric (Accessibility NFR).
- [ ] The coded views recognizably implement the Claude Design prototype (spec Req. 13 / AC 9).

## Tests

```bash
npm test --workspace @smart-sneaker/demo-web   # data layer, replay, views, architecture guard
npm test --workspace @smart-sneaker/e2e        # pipeline e2e + demo-data generator/spot-check
```

# Claude Design Prompt — Smart Sneaker Demo UI (Req. 13)

Paste the block below into Claude Design (Prototype template). Iterate per-screen afterwards;
this prompt sets up the full app in one shot.

---

Design a mobile-first prototype for **Smart Sneaker** — a sports-tech product where a
sensor-equipped running shoe streams pressure + motion data to a phone app, which turns each run
into plain-language biomechanics coaching insights. This prototype is a **demo/mock** of the
athlete experience that will be implemented as a React web app; design at phone width (~390px)
first, but every screen must also work at laptop width.

**Feel:** premium athletic — think Whoop/Strava-level polish, not a medical dashboard. Dark,
confident base with one energetic accent color; big legible numbers; generous spacing; data
feels alive but never cluttered. Every screen carries a small persistent **"DEMO"** badge.

**Accessibility rules (hard requirements):** WCAG AA contrast; never encode meaning by color
alone — pair color with icons, labels, or patterns (especially for confidence and left/right
foot); all charts need visible axis labels and units.

**Core concept the design must communicate:** every insight has a **confidence indicator**
(0–100%) and can be flagged **unreliable** with a human-readable note. Confidence is a
first-class visual element, not fine print.

Design these 6 screens:

**1. Session List (home).** The athlete "Asha"'s runs, newest first. Each card: date/time, sport
(Running), duration, and a status chip — `Synced`, `Processing…`, or `On phone only`. One session
shows a small data-quality warning icon. Include an empty state ("No sessions yet — lace up").

**2. Session Detail — Insights.** The hero screen. For one 32-minute run show four insight
modules, each with its value, unit, confidence, and a one-line plain-language takeaway:
- **Pressure balance:** Left 54% / Right 46% (confidence 92%) — a split bar with L/R labels,
  takeaway "You're loading your left side noticeably harder."
- **Ground contact time (per foot):** Left 245 ms / Right 262 ms (confidence 88%).
- **Cadence:** 172 steps/min (confidence 95%).
- **Foot strike:** "Midfoot" (categorical, confidence 71% — visibly lower) with a low-confidence
  treatment (icon + label, not just muted color).
Also show one insight in its **unreliable state**: value greyed/struck, badge "Not reliable this
session", note "Too many dropped packets during minutes 12–18." Header shows session date,
duration, and a "computed on phone / verified in cloud" indicator.

**3. Trends.** Line chart of one metric (cadence, steps/min) across ~12 sessions over 6 weeks,
with a highlighted most-recent point, a subtle band for typical range, and a toggle to switch
metric (balance %, contact time). Include a callout card: "Your left/right balance has drifted
+3% toward left over 4 weeks."

**4. Live Capture.** The in-run recording screen: large elapsed timer (18:42), pulsing REC
indicator, shoe connection status (`Connected · Left + Right`), live packet/signal indicator, and
a prominent End Session button. Also design its degraded variant: connection status
`Reconnecting…` with a reassuring "still recording, no data lost" message.

**5. Coach View.** A minimal roster for coach persona "Coach Reyes": list of athletes who shared
with them (2 athletes) with last-session summary per athlete; a clear note style indicating
athletes only appear here after explicitly sharing. This screen gets less visual investment —
functional, clean, consistent with the system. Include the persona switcher (Athlete ⇄ Coach) in
the app shell.

**6. Pipeline Status.** A "behind the curtain" screen showing the software pipeline being
exercised on seeded data: five stages as a horizontal flow — Capture → Segmentation & Insights →
Ingest → Worker → Results — each with a pass/fail/running state, plus a list of e2e scenarios
(e.g. "asha-labeled-normal ✓", "ben-labeled-favor-right ✓", "ble-dropout-recovery ✓") with
pass/fail. Style it like a mission-control panel that still belongs to the same design system —
this screen is what makes the demo double as a visible test of the software.

Navigation: bottom tab bar on phone (Sessions, Trends, Record, Pipeline) with the persona
switcher and DEMO badge in the top app bar.

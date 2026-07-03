# Review: Spec 001 — Smart Sneaker Software Solution

Verdict: NEEDS REVISION

## Findings

### 1. [Blocking — Testability/Clarity] "Consistent with" has no defined tolerance, and there's no reconciliation policy between client and cloud results
Requirement 14 says the cloud worker produces results "independent of (and consistent with) the client app's on-device result," and Acceptance Criterion #4 repeats "consistent with" as a pass/fail bar. Neither `spec.md` nor `plan.md` defines what "consistent" means numerically (exact match? ±5% per insight? same directional asymmetry only?). As written, two engineers testing this criterion could reach opposite conclusions on the same data.

This also leaves an unaddressed product question: if the client's on-device number and the cloud's canonical number *do* disagree, which one does the dashboard show, and does the on-device value get overwritten/reconciled once the cloud result lands, or does it just go stale? `plan.md` calls the cloud result "canonical" in prose but no requirement operationalizes that.

**Concrete failure scenario:** client computes cadence=172 spm on-device, cloud worker computes 168 spm from the same raw session (different float precision, different confidence-thresholding logic, or a segmentation edge case). Nothing in the spec says which number the athlete should end up seeing on their trend chart, or whether a 4 spm gap should even fail a test.

**Fix:** Add an NFR (or extend Req 14) with an explicit numeric tolerance per insight type, and a stated reconciliation rule — e.g., "the cloud-computed result is authoritative for dashboard/trend display once available; the on-device result is provisional and local-only until superseded." Rewrite AC #4 to test against that tolerance instead of the word "consistent."

### 2. [Blocking — Security/IDOR] Session ownership isn't required to be derived server-side from the authenticated identity
Req 13 says the ingest API is "authenticated," and Req 17 gates coach *reads* on the sharing relationship — but no requirement says the *write* path derives the owning athlete from the auth token rather than trusting a client-supplied athlete/session field. Without that, an authenticated-but-malicious client could plausibly write a session attributed to a different athlete ID, or later requests could reference another athlete's session ID directly.

**Concrete failure scenario:** Athlete A is authenticated but crafts an upload request with `athleteId: B`'s ID in the payload. If the ingest API trusts that field instead of deriving ownership from the Firebase Auth token server-side, A can write into B's session history — a classic IDOR, and exactly the class of bug `specs/constitution.md`'s Security Bar calls out ("least-privilege," "MUST NOT expose an athlete's data... without that sharing relationship" — this is the write-side mirror of that same gap).

**Fix:** Add an explicit requirement: "The ingest API MUST derive the owning athlete from the authenticated caller's identity, never from a client-supplied field; a request MUST NOT be able to write or read a session attributed to any athlete other than the authenticated caller (subject to Req 17's coach-sharing exception for reads)."

### 3. [Blocking — Security/Completeness] No input validation or size/shape bounds on the ingest API
The spec requires the ingest endpoint to be authenticated (Req 13) but nowhere requires it to validate the *shape* of what's uploaded — schema, size limits, or sanity bounds on sample counts/rates — before storing it and queuing a processing event. `specs/constitution.md`'s Security Bar says "treat all external input as untrusted, validate at system boundaries," and the ingest API is this system's primary externally-reachable boundary (it accepts arbitrary client-constructed payloads, not just firmware-originated ones — the client app, not the shoe, is what actually calls it).

**Concrete failure scenario:** A malformed or deliberately oversized "session" payload (corrupt encoding, absurd sample count, wrong schema version) gets accepted and queued. The worker either crashes repeatedly on it (retry-storms Pub/Sub), silently produces garbage insights, or the payload consumes disproportionate storage — none of which any requirement currently prevents or even acknowledges.

**Fix:** Add a Security NFR: "The ingest API MUST validate uploaded session structure and size against defined bounds before accepting/queuing it; requests failing validation MUST be rejected synchronously with an actionable error, not queued for async processing."

## Non-Blocking Findings

### 4. [Clarity] "On-device" is overloaded — used for both "on the phone" and (by exclusion) "on the shoe"
Req 4 says the client app runs inference "on-device," meaning the phone. The Non-Goals section excludes "on-device inference on the shoe itself." A reader skimming Requirements without cross-referencing Non-Goals carefully could misread Req 4 as the Stage-D shoe-side inference this spec explicitly defers. Suggest renaming consistently to "on-phone / client-side" vs. "on-shoe" throughout `spec.md` and `plan.md`.

### 5. [Completeness] No requirement addresses user-facing failure/error states
There's no requirement for what the athlete sees when a sync permanently fails, a session is rejected by the cloud (e.g., failing the validation from Finding 3), or processing errors out. The org-wide persona (`~/.claude/CLAUDE.md` / project `CLAUDE.md`) requires user-facing errors to be "helpful and non-technical" — nothing in this spec obligates that behavior to exist at all. Suggest a SHOULD-level requirement: "The app SHOULD surface sync or processing failures to the athlete with an actionable, non-technical message rather than failing silently."

### 6. [Clarity] "Brief" BLE disconnect tolerance is undefined
Req 2 and Acceptance Criterion #1 both hinge on "brief" disconnects being tolerated without data loss, with no numeric bound. Unlike the sampling-rate/latency NFRs (which at least propose defaults pending confirmation), this one has no proposed number at all. Recommend adding a proposed default (even a rough one, e.g. "≤30s") or moving it explicitly into Open Questions so it isn't quietly left to whoever implements it.

### 7. [Security — low severity for PoC scale] No rate-limiting/abuse-prevention requirement on the ingest endpoint
Given constitution's OWASP baseline, an authenticated-but-compromised or misbehaving client could still spam uploads. Low risk at the stated single-builder/small-cohort scale, but worth a SHOULD-level NFR so it isn't forgotten if the user base grows per the Scale NFR's "next order of magnitude" goal.

## Non-Issues Considered

- **Idempotency design** (Req 15, plan.md's session-ID / (session-ID, processing-run) keys): sound, specific enough to implement and test.
- **Coach/athlete access separation** (Req 17, AC's explicit "rejected server-side" criterion): correctly requires server-side enforcement, not client-side filtering — matches constitution's least-privilege bar.
- **Event-driven vs. synchronous processing tradeoff** (plan.md Alternatives): a genuine comparison with a real reason for the choice (upload path shouldn't be coupled to processing health), not a strawman.
- **Firmware boundary framing**: consistently applied — Non-Goals, Requirements (labeled "interface only"), and the Feature Catalog all agree firmware implementation is out of scope while its contract is in scope. No internal contradiction found.
- **Constitution consistency**: plan.md's architecture (event-driven pipeline, two-stage intelligence, raw-data retention) matches `specs/constitution.md`'s Architecture Principles with no direct contradiction.
- **Scope of Req 18 (model retraining) at umbrella level**: initially considered flagging as scope creep since it's a whole separate future catalog item, but given this spec explicitly frames itself as the umbrella anchoring the catalog's decomposition, a SHOULD-level platform requirement here is appropriate, not creep.

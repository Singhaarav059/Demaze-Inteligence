# Phase 2 — Pipeline Observability

## Scope decision

The Master Plan's literal Step 2.1 asks for a new `PipelineResult<T>` type
and Step 2.2 lists 17 stages including outbound send/tracking/follow-up.
Per Step 2.1's own instruction ("adapt to existing architecture rather than
blindly introducing duplicate abstractions") and Rule 1 ("if an existing
feature works, preserve it"):

- The research pipeline (`app/api/admin/test-analysis/route.ts`) already
  has a working per-stage result contract — the `gate()` function and
  `ValidationGate[]` array, with `PASS`/`WARN`/`PARTIAL`/`FAIL` statuses,
  free-text `reason`, and a `diagnostics` bag, all logged via `logger` and
  returned in the API response as `validation.gates`. Per-stage durations
  already exist separately in the `timing` object and are returned in the
  same response as `timing`. This already covers most of what
  `PipelineResult<T>` asks for — just as two objects instead of one merged
  shape. Rebuilding it as a new type would be pure duplication.
- The outbound send/tracking/follow-up subsystem (`lib/outbound/**`) has
  its own, different-shaped observability: an immutable
  `outbound_campaign_events` DB table (append-only, timestamped,
  previousState/newState) plus the follow-up engine's own tick summary
  with per-contact errors (see CLAUDE.md's 2026-08-17 entry — this was
  itself just hardened this month to surface real failure reasons). That's
  a legitimately different mechanism for a legitimately different problem
  (auditable state transitions over time vs. a single pipeline run's
  stage-by-stage trace) — not a gap to retrofit with `ValidationGate`.

**This phase's actual work was therefore scoped to extending the existing
`ValidationGate` contract, not replacing it or duplicating it into the
outbound subsystem.**

## What changed

`app/api/admin/test-analysis/route.ts`:

1. **`GateReasonCode`** — new 9-value union type matching the Master
   Plan's Step 2.3 vocabulary exactly (`NO_RELEVANT_CONTENT`, `NO_EVIDENCE`,
   `SOURCE_FAILURE`, `PARSER_FAILURE`, `LANGUAGE_MISMATCH`,
   `IDENTITY_MISMATCH`, `LOW_CONFIDENCE`, `PROVIDER_FAILURE`,
   `VALIDATION_REJECTED`). Optional field on `ValidationGate`, alongside a
   new optional `durationMs`. Both additive — no existing gate call site
   needed to change to keep compiling.
2. **`gate()`** — 6th optional param `{ reasonCode?, durationMs? }`,
   merged into the pushed record and appended to the log line
   (`GATE_WARN stage=SIGNAL reason="..." code=NO_EVIDENCE`).
3. **Retrofitted reason codes + durations onto the gates that represent
   this repo's actual, documented "silent zero" failure points**: SCRAPE
   (empty content → `SOURCE_FAILURE`), PROFILE (stub-only /
   unknown-with-no-evidence → `SOURCE_FAILURE`/`NO_EVIDENCE`, uncertain
   primary_type → `LOW_CONFIDENCE`), SIGNAL (zero signals →
   `NO_EVIDENCE`, thin subject evidence → `LOW_CONFIDENCE`), LLM_PARSE
   (malformed JSON after retry / retry request failure → `PARSER_FAILURE`
   / `PROVIDER_FAILURE`), NORMALIZATION (zero pain_points AND zero
   opportunities → `PARSER_FAILURE`), PAIN_POINTS (empty despite
   sufficient evidence → `PARSER_FAILURE`), BUSINESS_PROFILE (timeout →
   `PROVIDER_FAILURE`, genuinely empty → `NO_EVIDENCE`), COMPETITOR / ICP
   / MARKET_INTEL (insufficient → `NO_EVIDENCE`).
4. **New standalone `OPPORTUNITY` gate**, added directly next to
   `PAIN_POINTS` and reusing its exact rule (`shouldWarnEmptyPainPoints`
   from `normalize.ts` — the boolean logic is identical
   `count === 0 && evidence_sufficiency === 'sufficient'`, so it's reused
   directly rather than adding a same-shaped duplicate function under a
   new name). This is the single highest-value addition in this phase:
   opportunities silently returning 0 is, per CLAUDE.md's own multi-session
   "Research-quality initiative" history, this repo's most recurring real
   bug class — and until now it was only checked *jointly* with
   pain_points inside the `NORMALIZATION` gate (a `0+0` combined WARN),
   never on its own. A run with 0 opportunities but several pain_points
   previously produced zero signal anywhere in `validation.gates` that
   opportunities specifically were the empty one. Now it does.

## Verification

```
npx tsc --noEmit   -> clean
npm test           -> 770/770 passing, 56 files
```

No new test file added for the gate wiring itself — `route.ts` has zero
existing unit-test coverage of any kind (confirmed before starting; this
mirrors the same call already made for the BUSINESS_PROFILE gate session
in CLAUDE.md's history — adding test scaffolding for one file's gate calls
would be new infrastructure, not a regression, given the existing
"verify via tsc+tests+dev-server" precedent this repo already uses for
every prior gate addition). The reused `shouldWarnEmptyPainPoints` logic
itself is already covered by `tests/pain-points-grounding.test.ts`.

**Live-verified via the Phase 1 benchmark re-run** (see
`baseline.md`/benchmark output from the same session) — real pipeline
runs against Ador Welding and others produced real `GATE_PASS`/`GATE_WARN`
log lines including the new `code=` suffix and the new `OPPORTUNITY` gate,
confirming the wiring fires correctly under real traffic, not just
compiles.

## Not done (explicitly out of scope this phase)

- No new `PipelineResult<T>` type — see scope decision above.
- Outbound-side stages (`email_generation`, `email_qa`, `email_send`,
  `tracking`, `followup`) were not touched — they already have their own
  working observability mechanism (DB event log), which is a Phase 7/8
  concern (Email Safety, Campaign State Machine hardening), not this
  phase's.
- `company_discovery` / `people_discovery` stages (the standalone
  `/admin/company-discovery` and decision-maker-discovery flows, separate
  API routes from `test-analysis`) were not instrumented this phase —
  flagged for a future pass if silent-zero problems surface there
  specifically; not a documented recurring bug in CLAUDE.md the way
  opportunities/pain_points are, so not prioritized ahead of Phase 3.
- Reason codes were not retrofitted onto every single `PASS` gate call
  (only WARN/PARTIAL/FAIL, where "why did this fail" actually matters) —
  Phase 2's own Step 2.3 example is specifically about zero/failure
  results, not success paths.

## Phase completion report

```
PHASE: 2 — Pipeline Observability
STATUS: Complete

Changed:
- app/api/admin/test-analysis/route.ts: GateReasonCode type, extended
  ValidationGate + gate(), reason codes + durations on ~12 WARN/PARTIAL
  gate call sites, new standalone OPPORTUNITY gate

Tests:
- npm test: 770/770 passing (no new tests — reused already-tested pure
  logic, no new unit-testable surface added per this repo's own
  route.ts-has-no-test-infra precedent)
- tsc --noEmit: clean

Failures:
- None

New files:
- docs/production-hardening/phase2-observability.md (this file)

Database changes:
- None

External dependencies:
- None

Known limitations:
- Outbound subsystem and company/people-discovery routes not instrumented
  this phase (see "Not done" above)

Next phase:
- Phase 3 — Scrape Relevance Engine (assessScrapeQuality() has no content-
  relevance signal today — quantity-only page/char counting)
```

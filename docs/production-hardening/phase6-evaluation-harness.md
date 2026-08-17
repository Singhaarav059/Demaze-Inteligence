# Phase 6 — 100-Company Evaluation Harness (pilot scope)

## Scope decision (explicit, user-directed)

The Master Plan's literal Phase 6 asks for a 100-company dataset across
regression/adversarial/real-target sets. Per your explicit direction: this
phase was scoped to the **existing 10-company benchmark set** (6 benchmark
companies + Bharat Forge/Chargebee/Muthoot Finance reference set + Lechler,
already a real non-English/adversarial fixture) — no new company fixtures,
no expansion toward 100, no fresh `npm run benchmark` quota spend this
session. Expanding the dataset is deferred to whenever you want to spend
that quota deliberately.

## What already existed (audited first, not rebuilt)

`benchmarks/research-evaluation.ts` (7 scoring dimensions, 0-100 aggregate
score) and `benchmarks/evaluation-history/*.json` (machine-readable,
timestamped, mean-vs-previous-run comparison) already cover most of Step
6.2/6.3/6.4's asks — metrics, machine-readable output, and a per-company
trace via `benchmarks/debug/*.json`. The one genuinely missing piece,
confirmed via search before building anything: **Step 6.5's failure
taxonomy** — nothing in this repo categorized WHY a company failed beyond
a free-text reason string.

## What changed

New `benchmarks/failure-taxonomy.ts` — `categorizeFailures(gates, checks,
topLevelError?)`, pure and deterministic (no new LLM call, Master Plan
Rule 2). Maps data the pipeline already computes onto the Master Plan's
13 fixed categories:

- **Primary signal**: the `GateReasonCode` values added in this same
  effort's Phase 2 work (`SOURCE_FAILURE`→RETRIEVAL_FAILURE,
  `IDENTITY_MISMATCH`→IDENTITY_FAILURE, `NO_EVIDENCE`→EVIDENCE_FAILURE,
  `PARSER_FAILURE`→EXTRACTION_FAILURE, etc.) — a direct 1:1 lookup, no new
  detection logic.
- **Stage overrides** for `COMPETITOR`/`ICP` (both gate WARN with the same
  generic `NO_EVIDENCE` code today, but the real failure is discovery/
  matching, not evidence-availability) → `MATCH_FAILURE`/`ICP_FAILURE`.
- **Stage fallback** for gates with no reasonCode.
- **Benchmark check name** → category (`primary_type`/`profile_flag:*` →
  `CLASSIFICATION_FAILURE`, `no_forbidden:*` → `QA_FAILURE`,
  `min_signals`/`min_opportunities`/`min_challenges` → `EVIDENCE_FAILURE`).
- Only WARN/PARTIAL/FAIL gates and non-PASS checks contribute a category —
  a clean run produces an empty list, never a manufactured one.

Wired into `benchmark-runner.ts`: computed per company, printed in the
console detail block, and included in both the debug dump and
`evaluation-history` JSON.

Two mapping choices were genuine judgment calls (no live example to
verify against, since neither `LANGUAGE_MISMATCH` nor `VALIDATION_REJECTED`
is currently emitted by any real `gate()` call): both documented inline
in the code, both reasoned from existing repo precedent rather than
guessed.

## Verification

```
npx tsc --noEmit   -> clean
npm test           -> 817/817 passing (59 files, +22 from Phase 5's 795)
```

22 new assertions in `tests/failure-taxonomy.test.ts` (the first test
file for `benchmarks/` — confirmed no prior coverage existed). Verified
the actual wiring myself (not just trusting the report): confirmed
`categorizeFailures` is imported and called in `benchmark-runner.ts`,
its result flows into the console output, the debug dump, and evaluation
history.

**Not done this session, deliberately**: `npm run benchmark` was not
re-run — this is a pure categorization/reporting addition over data the
pipeline already produces, verified via `tsc`+tests only, matching this
repo's own established "defer live/quota-spending runs" precedent. The
first real benchmark run after this change will be the first live
confirmation that `reasonCode` actually round-trips through the HTTP
response as expected (it's returned verbatim via `gates: pipelineGates`
in `route.ts`, confirmed by reading the code, but not yet observed over
the wire).

## Not done (explicitly deferred, not forgotten)

- Expanding to 100 companies (regression + adversarial + real-target
  datasets) — deferred per your explicit decision.
- Acceptance criteria / numerical thresholds — the Master Plan's own Step
  6.6 explicitly says not to invent these before seeing a real baseline
  distribution across a larger set; premature with only 10 companies.
- `PEOPLE_DATA_FAILURE`, `EMAIL_FAILURE`, `AUTH_FAILURE` categories exist
  in the type union (per the Master Plan's fixed list) but have no live
  emitter yet in this pipeline's gates/checks — will only ever appear
  once some future code path actually reports one of those failure modes
  through the gate/check mechanism.

## Phase completion report

```
PHASE: 6 — Evaluation Harness (pilot scope: existing 10-company set)
STATUS: Complete (pilot scope)

Changed:
- benchmarks/benchmark-runner.ts: wires categorizeFailures() into console
  output, debug dump, evaluation history
- benchmarks/benchmark-types.ts: failureCategories field on BenchmarkResult

Tests:
- npm test: 817/817 passing (22 new)
- tsc --noEmit: clean

Failures:
- None

New files:
- benchmarks/failure-taxonomy.ts
- tests/failure-taxonomy.test.ts
- docs/production-hardening/phase6-evaluation-harness.md (this file)

Database changes:
- None

External dependencies:
- None

Known limitations:
- Scoped to the existing 10-company set, not the full 100 the Master Plan
  literally asks for — explicit user decision, not an oversight
- Failure-taxonomy wiring not yet exercised against a real live benchmark run

Next phase:
- Phase 7 — Email Safety and Deliverability (Gmail auth reliability, SPF/
  DKIM/DMARC, sending controls, suppression, kill switch, campaign pause)
```

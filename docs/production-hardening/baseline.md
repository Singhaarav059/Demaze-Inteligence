# Production Hardening — Phase 1 Baseline Audit

Snapshot date: 2026-08-17. Captures the state of the repo before any
Production Hardening Master Plan work begins. Re-run the checks below and
diff against this file to measure progress at any later phase.

## Test status

```
npm test  ->  770 passed / 770 total, 56 test files, 16.4s
```

Clean. No failures, no flaky tests observed in this run.

## Typecheck status

```
npx tsc --noEmit  ->  clean (0 errors)
```

One artifact issue found and fixed during this audit: `.next/dev/types/routes.d.ts`
was truncated mid-write (an interrupted `next dev` process), producing ~35
syntax errors that were never real source errors. Deleted `.next/` and let
Next regenerate it — clean afterward. Not a code bug; note for future
sessions so a stale `.next/` dir isn't mistaken for a real typecheck
regression (same failure class CLAUDE.md already documents for the historical
lint-count discrepancy).

## Build status

```
npm run build  ->  succeeds
```

All routes compile: 14 admin pages, ~45 API routes, the public site, and
`/manifest.webmanifest`. No build errors or warnings observed in the tail
output.

## Lint status

```
npx eslint .  ->  17 errors, 5 warnings, 341 files linted
```

This is real, pre-existing debt (not introduced by this audit). Breakdown:

- **`react-hooks/set-state-in-effect` (10 occurrences)** — synchronous
  `setState` calls inside `useEffect` bodies, flagged by React Compiler's
  hooks lint. Locations: `app/admin/auto-gtm/OutreachStep.tsx:332`,
  `app/admin/auto-gtm/page.tsx:205,215`,
  `app/admin/outbound/followups/page.tsx:128`,
  `app/admin/outbound/sales-knowledge/useSalesKnowledge.ts:54`,
  `components/shell/CursorGlow.tsx:23`,
  `components/shell/MagneticButton.tsx:26`,
  `components/shell/SmoothScroll.tsx:22`,
  `components/shell/TiltCard.tsx:24`,
  `components/ui/typewriter-text.tsx:33`.
- **`react/no-unescaped-entities` (4 occurrences)** — raw apostrophes in
  JSX text. `app/admin/auto-gtm/ReviewSendStep.tsx:261`,
  `app/admin/auto-gtm/TrackFollowUpStep.tsx:451,508` (x2),
  `app/admin/outbound/integrations/page.tsx:210`,
  `app/admin/outbound/sales-knowledge/page.tsx:654`.
- **`react-hooks/preserve-manual-memoization` (1)** —
  `app/admin/auto-gtm/useAutoGtmFlow.ts:389`, React Compiler can't verify a
  `useMemo`'s manual deps match its inferred deps.
- **Unused `eslint-disable` directives (4, warning-severity)** — leftover
  suppressions in `OutreachStep.tsx`, `page.tsx` (auto-gtm),
  `useAutoGtmFlow.ts`, `campaigns/page.tsx` for rules that no longer fire.

None of these are crashes or data-correctness bugs — they're React-Compiler
hygiene warnings on effect-based state sync and cosmetic JSX escaping. CI's
lint step is `continue-on-error: true` (not a gate) per CLAUDE.md's own
2026-07-19 Track 6 note. Leaving these as tracked debt rather than fixing
opportunistically — Phase 1 is audit-only, no fixes.

**Correction to CLAUDE.md**: the file's 2026-07-23 entry claims a live
"0 errors, 0 warnings" lint baseline. That was accurate at the time; 17
errors/5 warnings is the real count today. Likely explanation: normal drift
from feature work since 2026-07-23 (React Compiler's hooks rules are
stricter than most and easy to introduce via new `useEffect` code), not a
tooling regression. This file's own "trust the live check over dated
narrative" convention applies here.

## Benchmark status

**Run 2026-08-17** (real Firecrawl/Tavily/LLM quota, explicit user
confirmation given first): first attempt failed instantly for all 10
companies (`fetch failed`, 5-7ms each) — root cause: no `next dev` server
was running yet in this session (the benchmark's own `fetch()` to
`localhost:3000` had nothing to hit), not a real pipeline regression.
Started the dev server via the Browser pane's `preview_start`, confirmed
`Ready`, re-ran:

```
7 passed, 3 warned, 0 failed
Mean evaluation score: 51.64/100 (min 36.75, max 68.29)
vs previous documented run (2026-07-27): 46.08 → +5.56
```

Per-company: A-1 Fence Products/Ace Pipeline/ATE Group WARN (consistent
with CLAUDE.md's own documented pre-existing scrape-content
non-determinism for these specific companies); the rest PASS including
Bharat Forge/Chargebee/Muthoot Finance (the reference set).

**Caveat**: this run's tail end overlapped in wall-clock time with the
Phase 3 agent editing `lib/pipeline/scraper.ts` and
`app/api/admin/test-analysis/route.ts` live against the same running dev
server (Turbopack hot-reload). Some in-flight requests during that window
may have hit a transitional code state. Treating this result as a
directionally-useful real baseline (0 failures, better mean than the last
documented run), not a clean isolated pre/Phase-3 signal — a future
benchmark re-run (Phase 6 builds the real evaluation harness anyway) will
supersede it.

## Known technical debt (from repo history, not re-derived)

- `A-1 Fence Products` / `Bharat Forge` `primary_type` classification
  flakiness — accepted, pre-existing, content-dependent non-determinism.
- Batch-originated shared-campaign resume path — code-complete, never
  exercised against a real multi-company batch campaign (none exists in
  the DB yet).
- Real deliverability caveat: open-tracking test sends landed in Gmail
  spam — flagged, not investigated (self-send pattern / warmup status /
  generic LLM subject lines are plausible, unconfirmed contributors).
- `scraper.ts`'s `assessScrapeQuality()` has no content-relevance signal
  (quantity-only: page/char count) — this is exactly what Master Plan
  Phase 3 (Scrape Relevance Engine) targets.
- India's MCA company registry, LinkedIn automation, mobile/phone
  enrichment — all explicitly excluded/deferred by prior decision, not
  oversights.

## Known external vendor blockers

- **Apollo.io** — Organization Search and People Match are code-complete
  but return `403 API_INACCESSIBLE` on the current Basic/Trial plan; both
  paths are unverified against a real successful response.
- **Gmail OAuth** — has previously hit Testing-mode 7-day refresh-token
  expiry in production use (see CLAUDE.md's 2026-08-17 follow-up-engine
  entry), requiring manual re-authorization. `WARMUP_ENGINE_ENABLED` and
  `FOLLOWUP_ENGINE_ENABLED` both ship off by default.
- **India's MCA registry** — no public API, CAPTCHA-gated only, explicitly
  ruled out (see PROJECT_STATE.md).

## Current feature inventory

Six-phase AutoGTM loop (research → competitors → ICP → company discovery →
decision makers → outreach/send/track/follow-up) is implemented end to end.
Full architecture, pipeline stages, vendor list, and module-by-module
history are already documented exhaustively in `CLAUDE.md` and
`docs/PROJECT_STATE.md` / `docs/ROADMAP.md` / `docs/DECISIONS.md` — not
duplicated here; those remain the canonical reference. Test infra: vitest,
770 assertions across 56 files as of this snapshot (supersedes
PROJECT_STATE.md's "667 across 46" note dated 2026-08-10).

## Phase 1 completion report

```
PHASE: 1 — Baseline Audit
STATUS: Complete

Changed:
- Deleted stale/corrupted .next/ build cache (regenerates automatically)

Tests:
- npm test: 770/770 passing, 56 files, clean

Failures:
- None. Typecheck and build both clean after removing stale .next artifacts.
- Lint: 17 errors / 5 warnings, all pre-existing debt, catalogued above.

New files:
- docs/production-hardening/baseline.md (this file)

Database changes:
- None

External dependencies:
- None touched. Benchmark run deferred pending user confirmation (spends
  real API quota).

Known limitations:
- Benchmark suite not re-run this session — baseline benchmark numbers are
  taken from CLAUDE.md's most recent documented run, not freshly measured.

Next phase:
- Phase 2 — Pipeline observability (standard result contract, per-stage
  instrumentation, explicit empty-state diagnostics for the "silent zero"
  bug class).
```

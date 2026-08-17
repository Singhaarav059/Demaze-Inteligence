# Phase 10 — Product UX Simplification

## Scope decision

Per the Master Plan's own instruction ("Do not redesign the whole app.
Refine the existing interface around user decisions"): audited first,
same discipline as every prior phase. Most of Step 10.1's target workflow
already exists (Auto Flow's 6-step guided journey: Research → Competitors/
ICP → Decision Makers → Contact Info → Outreach & Send → Track & Follow
Up), and most of Step 10.2's "six questions" already have real backing
fields — "why now" and the opening angle were already rendered; "confirmed
evidence vs. reasonable inference" labeling (Step 10.4) was already added
in this same effort's Phase 4. No app-wide redesign was warranted or done.

## The real gap found

Two of the six questions — **"why this company/why now" (`why_contact`)**
and **"why this problem" (`likely_problem`)** — exist as real, populated
fields on every research result (`outreach_intelligence`, confirmed via a
direct DB query showing real, non-empty values) but were only ever
rendered in `intelligence-lab/page.tsx`'s own separate debug-tab section —
never in the shared `PersonalizationSummarySection` component that the
actual production surfaces (`ResearchCard.tsx`, `Step1Research.tsx` used
by run-history, and `AutoFlowResearchSummary.tsx` used by Auto Flow
itself) all render through.

## What changed

`PersonalizationSummarySection` (`ResearchCard.tsx`) gained two new
optional props, `whyContact`/`likelyProblem`, rendered as "Why this
company, why now" / "Why this problem" — additive, matching the section's
existing layout and label conventions exactly. `getResearchCardData()`
now computes both from `outreach_intelligence` the same way `openingAngle`/
`whyNow` already were. All three real consumers updated to pass the new
props through: `ResearchCard.tsx` itself, `Step1Research.tsx` (run-history's
actual render path), and `AutoFlowResearchSummary.tsx` (Auto Flow's own
research summary).

## A real debugging note worth recording

The first attempt only touched `ResearchCard.tsx`, then live-verified
against a real saved run — the fields didn't appear. Initially suspected
CLAUDE.md's own documented Windows dev-server file-watcher gotcha and
restarted the server; still didn't appear even after a hard page reload
and a direct network-response check confirming the real data WAS reaching
the browser. Traced the actual cause by grepping for every consumer of
`PersonalizationSummarySection`: run-history doesn't render `ResearchCard`
directly — it renders `Step1Research.tsx` (a wizard-step component that
happens to reuse `getResearchCardData()` + the same exported section
components), which I hadn't touched. `AutoFlowResearchSummary.tsx` turned
out to be a third, independent consumer of the same pattern. Fixed all
three rather than stopping at the first one that looked complete.

## Verification

```
npx tsc --noEmit   -> clean
npm test           -> 820/820 passing (no new tests — pure UI field
                       threading, no new logic to unit-test)
```

**Live-verified end to end**, not just compiled: reloaded a real saved
run (Flipkart) via `/admin/run-history` → View Report after all three
fixes landed and the dev server restarted — confirmed "WHY THIS COMPANY,
WHY NOW" and "WHY THIS PROBLEM" now render with the real, correct
per-company text pulled directly from the database. Zero console errors
(one harmless HMR websocket reconnect notice from the server restart,
not an application error).

## Not done (explicitly out of scope)

- No broader UI redesign — the Master Plan explicitly warns against this,
  and the existing Auto Flow structure already matches Step 10.1's target
  workflow shape.
- `recommended_service` (the third of the three previously-debug-only
  fields) was deliberately not added to the shared component — it
  overlaps significantly in meaning with the already-rendered "Lead with"
  field (sourced from `executive_brief.what_to_sell`), and adding both
  side by side risked a confusing near-duplicate label rather than a
  genuinely new question answered.
- Pain points still don't carry the same evidence/confidence badge
  treatment opportunities got in Phase 4 — flagged there as a known,
  larger-plumbing follow-up, still not done.

## Phase completion report

```
PHASE: 10 — Product UX Simplification
STATUS: Complete (scoped to the one real, confirmed gap)

Changed:
- app/admin/intelligence-lab/ResearchCard.tsx: whyContact/likelyProblem
  computed + threaded through PersonalizationSummarySection
- components/wizard/steps/Step1Research.tsx: same props threaded through
  (run-history's actual render path)
- app/admin/auto-gtm/AutoFlowResearchSummary.tsx: same props threaded
  through (Auto Flow's own research summary)

Tests:
- npm test: 820/820 passing (no new — pure field-threading, no new logic)
- tsc --noEmit: clean

Failures:
- None (see the debugging note above for the investigation path)

New files:
- docs/production-hardening/phase10-ux-simplification.md (this file)

Database changes:
- None

External dependencies:
- None

Known limitations:
- Pain points don't have the same evidence-confidence UI treatment as
  opportunities (Phase 4's known limitation, still open)

Next phase:
- Phase 11 — Real-World Pilot (needs a real list of 20-30 target
  prospects — business data, not something to fabricate)
```

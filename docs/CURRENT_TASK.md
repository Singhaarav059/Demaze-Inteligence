# Current Task

## Milestone

**Outreach Intelligence Layer field-naming reconciliation** (Roadmap Phase 2,
item 7) — COMPLETE (2026-07-23). Rename-only pass, no new logic: the
already-built `OutreachIntelligence` fields in `lib/pipeline/
analysis-sections.ts` and `lib/pipeline/normalize.ts` were renamed to match
this roadmap's naming — `trigger` → `why_contact`, `problem` →
`likely_problem`, `service` → `recommended_service`, `opening_angle` →
`conversation_angle` (`why_now` was already correctly named). Updated
consistently across the LLM prompt schema (`lib/prompts/analyze-v2.ts`,
`system-v2.ts`), the normalize merge step, both admin UI render sites
(`page.tsx`, `ResearchCard.tsx`), the downloaded-brief export
(`lib/export/brief-html.ts`), outbound email generation's input assembly
(`lib/outbound/generation/assemble-input.ts`), the benchmark runner, and
the one test fixture that referenced the old names. Full detail in
`CLAUDE.md`'s Phase 2 item 7 entry. Verified: `tsc --noEmit` clean, full
suite 483/483 passing — no benchmark run needed for a pure rename.

Prior milestone — **Market Intelligence Layer** (Roadmap Phase 2, item 6) —
COMPLETE, including
live end-to-end verification (2026-07-15). Given an already-researched
company, surfaces 0-8 industry-level statements (trend/growth_indicator/
challenge/shift) for the sector the company operates in. Deliberately
diverges from the Competitor Discovery / ICP Generator "code extracts a name
→ LLM narrates onto it" pattern — confirmed with the user before
implementation — since each item here is already a full statement extracted
from a real search snippet, not a name needing explanation. Pure
deterministic: search (same company-name-anchored query style as
Competitor/ICP, e.g. `"<name>" industry trends`) → classify each candidate
sentence into one of the 4 categories via most-specific-first keyword regex
→ sanity-filter fragments → dedupe → confidence-tier (same mention_count +
"strong indicator" formula as Competitor/ICP) → cap at 8. No new
`analyze-v2.ts` prompt block, no `normalize.ts` merge-by-name step —
`normalize.ts` passes `market_intelligence` straight through.

New `lib/enrichment/market-intelligence.ts`, wired into `route.ts` at the
same pre-scrape timing slot as `competitorDiscoveryPromise`/
`icpDiscoveryPromise` (no `primary_type` dependency — see `DECISIONS.md` for
why that timing was considered and rejected), new non-critical
`MARKET_INTEL` gate, `normalize.ts`/`analysis-sections.ts` plumbing, new
"Market Intelligence" section in `ResearchCard.tsx`, new
`tests/market-intelligence.test.ts` (18 assertions). Full detail in
`DECISIONS.md`.

**Verified**: `tsc --noEmit` clean, full suite 198/198 (180 pre-existing +
18 new).

**Live end-to-end run — done (2026-07-15).** The dev-server-lock blocker
from the prior session was worked around, not resolved by killing anything:
another chat's `next dev` instance was already running on port 3000 for
this same project, so the live run hit that server's API directly via
`curl` instead of starting a second instance (which the directory-scoped
lock would have refused anyway). Ran `discoverMarketIntelligence()` against
Ador Welding through the real `/api/admin/test-analysis` endpoint with real
Tavily/Serper quota (explicit user confirmation given first), reusing the
existing scrape cache for that company. Result: `MARKET_INTEL:PASS`, `4
item(s) found | 4 of 4 raw candidate(s) survived filtering`,
`market_intelligence_sufficiency: "sufficient"`. All 4 items were real,
source-attributed `growth_indicator` statements at `medium` confidence
(mention_count=1 each — correctly short of `high`, which requires 2+
mentions) — e.g. a welding-materials-market CAGR figure sourced to a real
Yahoo Finance article, and a growth forecast sourced to Ador's own 2021-22
annual-report PDF. No `challenge`/`trend`/`shift` items surfaced this
particular run — plausible given the real search results returned, not
evidence of a category-detection gap. Competitor Discovery and ICP
Generator both stayed regression-free on the same run (`COMPETITOR:PASS` 5
found, `ICP:PASS` 5 found, consistent with their own prior live runs
against this company). `ResearchCard.tsx`'s render path (`marketIntel.length
> 0` gate, `statement`/`category`/`confidence` fields) was confirmed
against the actual returned JSON shape by reading the component rather than
re-spending quota on a second UI-driven run — a full browser-driven render
pass with real data was already done for Competitor Discovery/ICP Generator
earlier this phase and established that `ResearchCard`'s render conventions
work correctly.

Prior milestones (items 1-5 of Phase 2 — Competitor Discovery Engine, ICP
Generator, Company Discovery Engine, Research Quality Framework, Research
Evaluation Framework) are all COMPLETE with live end-to-end verification.
Full history for each is in `DECISIONS.md`, not repeated here.

## Next milestone

Items 1-7 of Phase 2 (Competitor Discovery Engine, ICP Generator, Company
Discovery Engine, Research Quality Framework, Research Evaluation
Framework, Market Intelligence Layer, Outreach Intelligence Layer) are all
now complete. Items 8-9 (decision-maker discovery, outreach send) stay
blocked on their respective vendor decisions (people-data API; sending
infrastructure), unchanged from the standing scope note in `CLAUDE.md` —
do not start either without that decision being made first.

## Do not start

Items 8-9 (decision-maker discovery, outreach send) until their vendor
decisions are made — see `CLAUDE.md`'s "DO NOT WORK ON RIGHT NOW" section.

# Phase 3 — Scrape Relevance Engine

## What changed

New `lib/pipeline/scrape-relevance.ts` — `selectResearchCorpus(pages, companyName)`,
a deterministic post-scrape corpus selector. `assessScrapeQuality()`
(existing) scores the scrape as a whole from URL-shape proxies; this scores
each already-scraped page from its own content and decides what actually
reaches evidence extraction.

- **Per-page score** = `classifyUrl()`'s existing URL category score
  (reused, not reinvented) ± an identity-match bonus/penalty (via
  `mentionsCompany()`, the existing word-boundary-safe matcher — never a
  naive `.includes()`, matching this repo's own historical 'ir'-inside-'wire'
  bug-class discipline) ± a content-density bonus.
- **Identity mismatch**: a page whose weak-URL-category content never
  mentions the company gets rejected. Careers/media/article pages are
  exempted from this check (legitimate content routinely omits the brand
  name) — calibrated so a well-classified page never gets excluded on
  identity grounds alone.
- **Boilerplate**: privacy/cookie/terms/login/search/etc. URL shapes,
  independent of identity/score.
- **Near-duplicate detection**: Jaccard word-set similarity, no new
  dependency — catches regional-locale clones and re-scraped duplicates,
  keeping the higher-scored twin.
- **Safety net**: if every page would be rejected, falls back to the full
  unfiltered set — this stage can never leave the pipeline worse off than
  not running it.

Wired into `app/api/admin/test-analysis/route.ts` as a new Stage 2.5
(`SCRAPE_RELEVANCE` gate, reusing Phase 2's `reasonCode` infra), between
scrape and evidence extraction. Rebuilds `fullContent` from the selected
corpus before the first `extractSignals()` call. Skipped entirely when the
scrape was a domain-only stub (nothing real to score). Result surfaced in
the API response for diagnosability (`scrapeRelevance.selectedUrls` /
`rejectedUrls` / `rejectionReasons` / `relevanceScores` / `fallbackApplied`).

Scope, deliberately conservative per Master Plan Rule 1 (preserve working
functionality) and this repo's own documented history of over-filtering
regressions: only rejects pages for a clear, confident reason. A
merely-low-but-plausible page stays in the corpus, just at a lower
reported score. Does not touch pre-scrape page selection
(`classifyUrl()`/`selectUrlsToScrape()`) or enrichment's externally-fetched
sources — same-domain scraped pages only.

## Verification

```
npx tsc --noEmit   -> clean
npm test           -> 786/786 passing (57 files, was 770/56 pre-Phase-3)
```

16 new assertions in `tests/scrape-relevance.test.ts` covering every Step
3.6 fixture category: correct-company content, identity mismatch (wrong
company / similarly-named-but-unrelated company), near-duplicate regional
clones, boilerplate pages, non-English-but-relevant content (not zeroed),
the never-reject-everything safety net, and the careers/blog exemption
specifically (a legitimate page that never repeats the company name is
kept, not penalized).

Three real logic bugs were found and fixed during test-writing (not
shipped broken): the identity-exemption wasn't fully honored in the
rejection-floor check; two fixtures accidentally collided with existing
`classifyUrl()` keywords; several single-page fixtures were being silently
rescued by the safety net rather than exercising the mechanism under test.

Manually re-verified the module's core logic and the route.ts wiring
directly (not just trusting the subagent's report): confirmed
`fullContent` is declared `let` and reassigned before the first
`extractSignals()` call, confirmed the gate correctly skips when
`scrapeStubInjected`, confirmed `ScrapePageResult` has the fields the new
module assumes.

**Not done**: no live benchmark re-run isolated to this change specifically
(the Phase 1 benchmark re-run happened concurrently with this phase's
edits — see baseline.md's caveat). Phase 6 builds the real evaluation
harness this repo needs for a trustworthy before/after comparison; a
one-off re-run now would be lower-value than waiting for that.

## Phase completion report

```
PHASE: 3 — Scrape Relevance Engine
STATUS: Complete

Changed:
- lib/pipeline/scraper.ts: exported MIN_USEFUL_CHARS and classifyUrl()
  (were private) for reuse — zero behavior change
- app/api/admin/test-analysis/route.ts: new SCRAPE_RELEVANCE stage,
  fullContent rebuilt from selected corpus, new scrapeRelevance response field

Tests:
- npm test: 786/786 passing (16 new)
- tsc --noEmit: clean

Failures:
- None (3 bugs found and fixed during test-writing, none shipped)

New files:
- lib/pipeline/scrape-relevance.ts
- tests/scrape-relevance.test.ts
- docs/production-hardening/phase3-scrape-relevance.md (this file)

Database changes:
- None

External dependencies:
- None added

Known limitations:
- Scope is same-domain scraped pages only, not enrichment's external sources
- classifyUrl()'s existing category taxonomy reused as-is, not redesigned
- No isolated live benchmark re-run for this specific change (see above)

Next phase:
- Phase 4 — Evidence Provenance System (Source -> Evidence -> Signal ->
  Problem -> Opportunity -> Stakeholder -> Outreach angle traceability)
```

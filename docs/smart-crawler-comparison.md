# Smart Crawler (G5)

Date: 2026-08-18
Status: Code + tests + live verification against real domains. Not wired
into the live scrape chain.
Scope: `demaze_master_research_optimization_plan.md` §42 G5 ("Implement:
robots, sitemap, URL discovery, URL scoring, deduplication, page limits,
early stopping."), a crawl-POLICY layer on top of G3's `directFetch()` and
G4's `extractCleanText()`/`fetchAndExtract()`.

## What was built

`lib/pipeline/smart-crawler.ts`, `crawlWebsite(baseUrl, options?)`:

- **robots.txt** — `fetchRobotsTxt()` (via G3's `directFetch()`, not a bare
  `fetch()`) + pure `parseRobotsTxt()`/`isPathAllowed()`. Parses the
  `User-agent: *` group (plus any group whose token mentions "demaze"),
  standard longest-prefix-wins semantics with an exact-length Allow-over-
  Disallow tie-break. Fails OPEN (`fetched: false` → every path allowed) on
  a 404, fetch error, or any other failure — matches this codebase's
  standing "prefer under-confidence, never silently block legitimate
  research" discipline (`website-discovery.ts`'s ambiguous-match handling)
  and standard crawler behavior for a missing robots.txt.
- **Sitemap discovery** — `discoverSitemapUrls()`, fetched via G3's
  `directFetch()` (not Firecrawl). Mirrors `scraper.ts`'s own
  `fetchSitemapUrls()`: a sitemap index only follows corporate-shaped
  sub-sitemaps (same allowlist regex — investor/about/sustainability/
  careers/etc — skips product/image/video sitemaps on large sites).
- **URL discovery** — sitemap URLs (above) + same-domain homepage link
  extraction, `extractSameDomainLinks()` (new — neither G3 nor G4 extracts
  links; reuses `cheerio`, already a dependency since G4).
- **URL scoring / selection** — imported directly from `scraper.ts`
  (`classifyUrl`, `selectUrlsToScrape`, `detectLocalizedUrlStructure`,
  `isEnglishLocaleSegment`), not reimplemented. This logic is substantial
  and has been fixed through several real, documented bug sessions
  (word-boundary keyword matching, lechler.com locale-scoring regression —
  see CLAUDE.md's own history on `scraper.ts`); duplicating it here would
  risk silently drifting out of sync with `scraper.ts`'s own future fixes.
  Sitemap XML tag extraction, URL dedup, and the corporate-sub-sitemap
  allowlist ARE small enough to duplicate (a few lines each) — same
  duplication-over-sharing convention `website-discovery.ts`/
  `evidence-extractor.ts`/`competitor-discovery.ts` already each use for
  their own copy of `normalizeName`/`escapeRegex`.
- **Deduplication** — `dedupeUrls()`, a trivial `Set`-based unique filter,
  same class as `scraper.ts`'s own private `deduplicateUrls()` (not
  exported there, so duplicated here rather than exporting a one-liner).
- **Page limits** — `options.maxPages` (default 15, mirrors `scraper.ts`'s
  private `MAX_DISCOVERED_PAGES`), enforced beyond the always-fetched
  homepage.
- **Early stopping** — once at least 4 successfully-fetched candidate pages
  score above the "high value" floor (>15, matching `scraper.ts`'s own
  article=15/product=20+ tiering) AND span at least 3 of `scraper.ts`'s own
  `VALUABLE_CATEGORIES` (investor/leadership/corporate/manufacturing/
  sustainability/careers/technology/media/b2b_services), the crawl stops
  even if `maxPages` hasn't been reached. This inverts `scraper.ts`'s own
  existing probe-trigger condition (`selectedHighValue < 4 ||
  categoriesSeen.size < 3`) into a stop condition rather than inventing a
  new threshold. Checked `evidence-ledger.ts` first per this session's own
  instruction — its confidence scoring runs post-claim-verification ("is
  this specific claim trustworthy"), not "is there enough raw content yet,"
  so it isn't a fit for a pre-extraction crawl-stop decision; flagged with
  a `ponytail:` comment as a flat heuristic, not a real evidence-
  sufficiency model, upgrade only if it proves too coarse in practice.

`CrawlResult` (`{ baseUrl, pages: FetchAndExtractResult[], debug }`) reuses
G4's `FetchAndExtractResult` shape directly — no new page-result type.

**Real bug found and fixed via live verification, not just documented**
(see below): `discoverSitemapUrls()` didn't filter non-HTML file
extensions the way `extractSameDomainLinks()` already did for homepage
links — a sitemap-heavy, investor-PDF-heavy site (bharatforge.com) had its
entire top-15-by-score candidate list be `.pdf` URLs (the `investor`
category scores 100, the ceiling), and G4's `extractCleanText()` only
handles HTML, so every one of those 15 fetches failed
(`non-HTML content-type`) with 0 usable pages beyond the homepage. Fixed by
extracting the extension-exclusion regex `extractSameDomainLinks()` already
had into a shared `NON_PAGE_EXTENSION_RE` and applying it to
`discoverSitemapUrls()`'s output too (both the plain-sitemap and
sitemap-index-sub-sitemap branches). New regression test added
(`tests/smart-crawler.test.ts`), and re-verified live — see below.

## Tests

`tests/smart-crawler.test.ts`, 18 assertions (`global.fetch` mocked, same
precedent as `tests/direct-fetcher.test.ts`/`tests/html-extractor.test.ts`,
routed by URL substring since `crawlWebsite()` fires several fetches —
robots.txt, sitemap.xml, homepage, N candidate pages — per call):
`parseRobotsTxt`/`isPathAllowed` (Disallow/Allow parsing, unrelated
user-agent groups ignored, longest-prefix + Allow-override-tie),
`fetchRobotsTxt` (404 fails open, thrown fetch error fails open, a real
parse), `discoverSitemapUrls` (plain sitemap, sitemap-index following only
corporate-shaped sub-sitemaps, 404 → `[]`, and the new PDF-filtering
regression case), `extractSameDomainLinks` (same-domain/non-file/non-self
filtering, dedup), `dedupeUrls`, and 3 `crawlWebsite()` orchestration cases
(sitemap discovery + homepage + maxPages enforcement, a robots.txt-
disallowed candidate correctly skipped, early-stopping firing before
`maxPages` and never reaching a lower-priority candidate).

`npx tsc --noEmit` clean. Full suite 952/952 passing (934 pre-existing + 18
new), zero regressions.

## Live verification — real crawls against 3 real domains, zero paid API cost

Per plan §44 ("run the benchmark, record actual metrics, never claim
completion from unit tests alone"). `crawlWebsite()` only uses G3's plain
`directFetch()` — no Firecrawl/Tavily/Serper/LLM calls, so this cost
nothing. Ran directly via a throwaway `npx tsx` script (deleted after),
`maxPages: 15`, against 3 real companies already in this repo's benchmark
set:

| Company | Result (before PDF-extension fix) | Result (after fix) |
|---|---|---|
| adorwelding.com | 9 pages, 9 successful, 86,463 chars, early-stopped after 8 candidates (11.5s) | unchanged — no `.pdf`-heavy sitemap on this run (`discoveryMethod: homepage_links`, 0 sitemap URLs found) |
| bharatforge.com | **1 page** (homepage only), **0/15** candidate fetches succeeded — every top-scored candidate was an investor-report `.pdf` (5.9s) | **16 pages, 16/16 successful**, 43,524 chars, real investor/corporate-governance/financial pages (agm, board-committees, quarterly-results, balance-sheet, etc.), hit `maxPages` without early-stopping (5.9s) |
| a-1fenceproducts.com | 9 pages, 9 successful, 82,409 chars, sitemap discovery found 125 URLs, early-stopped after 8 candidates (18.8s) | unchanged (10.6s) |

`robots.txt` was fetched successfully (`fetched: true`, 0 Disallow rules
present) for both bharatforge.com and a-1fenceproducts.com; adorwelding.com
had no confirmed `.pdf`-shaped sitemap this run, so the fix had no visible
effect there — consistent with this file's own documentation elsewhere
that adorwelding.com's real-world discovery method varies run to run
(`sitemapUrlsFound: 0` here vs. `discoveryMethod: sitemap` on other
sessions' runs against the same domain — real content/site-structure
non-determinism this repo already documents extensively for this exact
company, not something this session's code caused). No robots.txt
Disallow rule was actually exercised live on any of the 3 real domains
(all had `robotsDisallowedSkipped: 0`) — the Disallow-filtering path is
proven correct only by the mocked unit test, not by a real site that
happened to disallow a candidate this session touched; not manufactured
via a synthetic robots.txt override, since that would misrepresent what
was "live-verified" vs. unit-tested.

Sitemap-index sub-sitemap allowlisting was exercised for real: both
bharatforge.com and a-1fenceproducts.com resolved a real sitemap with
120-500 total `<loc>` entries, correctly narrowed by the corporate-shaped
sub-sitemap regex and (after the fix) the non-HTML extension filter, down
to a real investor/corporate/CSR/careers page mix — the same category
diversity `scraper.ts`'s own probe-trigger logic targets.

## Not done

- No side-by-side comparison against a fresh Firecrawl `mapUrl`+scrape run
  for the same 3 domains — that would spend real Firecrawl credits and,
  per this repo's "only remove/demote a provider after measured success"
  rule, isn't a decision this session needs to make (G8's job, not G5's).
- Early-stopping's threshold (4 high-value pages / 3 categories) was only
  exercised against 2 of 3 live domains (adorwelding.com,
  a-1fenceproducts.com both early-stopped; bharatforge.com hit `maxPages`
  first without early-stopping, since its real page-scoring mix under the
  fixed extension filter didn't clear the category-diversity floor within
  15 fetches) — not independently tuned against a broader sample.
- robots.txt Disallow-filtering was not live-exercised against a real
  disallow rule (see above) — only unit-tested.
- No PDF content extraction — `.pdf` URLs are now filtered out of the
  candidate list entirely (this session's fix) rather than fetched and
  parsed; G4's `extractCleanText()` has no PDF-handling path, and building
  one is out of scope for G5 (the existing `web-enricher.ts`'s
  `pdf-parse`-based path, from Phase 1 Item 3, is a separate, already-live
  mechanism this module doesn't touch or duplicate).
- Not wired into the live scrape chain or `app/api/admin/test-analysis` —
  that's explicitly G8's job ("move Firecrawl from default to fallback"),
  per the plan's own phase ordering. This module is standalone and
  directly callable, proven against real sites, nothing more.

## Next step

G6 — Cache (page cache, search cache, evidence cache, content hashing,
TTL), per plan §46. Not started this session.

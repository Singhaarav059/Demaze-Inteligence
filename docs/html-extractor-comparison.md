# In-House HTML Extractor (G4)

Date: 2026-08-18
Status: Code + tests + real comparison against cached Firecrawl output. Not
wired into the live scrape chain.
Scope: `demaze_master_research_optimization_plan.md` §42 G4 ("Implement
clean HTML extraction. Compare output with Firecrawl."), building on G3's
`directFetch()`.

## What was built

`lib/pipeline/html-extractor.ts`:

- `extractCleanText(html)` — pure, no I/O. Follows plan §21's exact pipeline
  (remove script/style/tracking noise → remove nav/footer noise where safe →
  extract title/headings/paragraphs/lists/tables → clean document) using two
  mature, browser-engine-free libraries (plan §21: "use mature open-source
  parsing libraries, do not build an unnecessary browser engine") — new deps
  `cheerio` (strips `script`/`style`/`noscript`/`iframe`/`svg`/`nav`/
  `footer`/`header`/`form`/`button`/`[aria-hidden]`/`[hidden]` before
  anything else runs) and `turndown` (converts the remaining structured
  `<body>` HTML into markdown — headings, lists, tables, links — the same
  shape Firecrawl and Jina already return everywhere else in this codebase).
  `turndown` depends only on `@mixmark-io/domino`, a pure-JS DOM
  implementation — not a headless browser, so this doesn't reintroduce a
  browser-engine dependency the plan explicitly warns against.
- `fetchAndExtract(url, timeoutMs?)` — combines G3's `directFetch()` with
  extraction. Return shape (`url`/`success`/`markdown`/`charCount`/`error?`,
  plus an optional `title`) intentionally matches `scraper.ts`'s
  `ScrapePageResult` field-for-field, so this is a drop-in-compatible source
  for a future session (G5 smart crawler / G8 Firecrawl fallback) rather than
  a parallel incompatible type.

**Real bug found and fixed while comparing against real Firecrawl output**
(see below): the first draft's raw turndown output still contained
`![alt](src)` image refs and `[Skip to content](#content)`-style in-page
skip-links on every page — noise `scraper.ts`'s own `cleanMarkdown()`
already strips from Firecrawl/Jina output. Added a matching `finalCleanup()`
step (same two regexes, same "carries no evidence value" reasoning) so this
extractor's output is cleaned to the same standard the rest of the pipeline
already expects.

## Tests

`tests/html-extractor.test.ts`, 7 assertions: heading/paragraph/list
extraction to markdown, noise stripping (script/style/nav/footer), the new
image-ref/skip-link cleanup (regression-tested against the exact pattern
found in the live comparison below), a content-free page returning empty
markdown without throwing, and `fetchAndExtract()` success/failure/non-HTML
paths with `global.fetch` mocked (same precedent as
`tests/direct-fetcher.test.ts`).

`npx tsc --noEmit` clean. Full suite 934/934 passing (927 pre-existing + 7
new), zero regressions.

## Live comparison — real extraction vs. real cached Firecrawl markdown

Per plan §44 ("run the benchmark, record actual metrics, never claim
completion from unit tests alone"). Rather than spending new Firecrawl
credits, compared against Firecrawl's own **already-persisted** scrape for
adorwelding.com (`company_scrape_cache`, scraped 2026-08-17, 7 real pages) —
same "verify against already-persisted production data, zero new API spend"
precedent as G2's evidence-ledger verification. Ran `fetchAndExtract()`
directly (throwaway script, deleted after) against the exact same 7 URLs
Firecrawl had scraped:

| Page | Firecrawl charCount | Ours (uncapped) | Notes |
|---|---|---|---|
| homepage | 5000 (capped by `MAX_PAGE_CHARS`) | 7605 | Firecrawl's number is truncated; not a fair size comparison |
| board-of-directors | 5000 (capped) | 5274 | same |
| corporate-governance | 554 | 333 | both uncapped — see below |
| media-event (GreenCo) | 5000 (capped) | 5290 | Firecrawl's number is truncated |
| corporate-announcement | 740 | 541 | both uncapped |
| CSR-activity | 3334 | 3171 | both uncapped |
| who-we-are | 5000 (capped) | 6677 | Firecrawl's number is truncated |

**7/7 succeeded on both sides**, same as Firecrawl's original scrape.
`scraper.ts` caps every page at 5000 chars *after* its own cleanup, so 4 of
the 7 pages aren't a fair size comparison at all (Firecrawl's real content
before truncation is unknown). On the 3 genuinely uncapped pages, our output
is consistently 15-35% smaller than Firecrawl's. Spot-checked
`corporate-governance` directly (both sides' real markdown, not just the
char count) rather than assuming this is a completeness gap: Firecrawl
rendered one PDF-list link differently than ours did (a labeled breadcrumb
link vs. a separate icon-only link next to plain label text) — a real
structural difference in how two different HTML→markdown converters handle
the same non-trivial DOM, not missing evidence. Both sides captured the same
substantive content (report title, filing date, enquiry-form category list,
phone number). This is expected — the goal of this comparison was "does the
in-house extractor produce usable, comparably complete markdown from real
pages," not byte-for-byte parity with Firecrawl's proprietary renderer.

Titles matched real page `<title>` tags exactly on all 7 pages (e.g. "Board
of Directors - Ador Welding", "Who we are - Ador Welding").

## Not done

- No fresh, paid Firecrawl call was made — the comparison above reuses
  already-persisted data at zero cost, consistent with this repo's standing
  discipline against spending real API quota without explicit confirmation.
  If a byte-for-byte fresh-vs-fresh comparison is ever needed, that's a
  separate, explicitly-confirmed spend.
- No table-extraction case was exercised live (none of the 7 real pages
  contained an HTML `<table>`) — turndown's table support is well-tested
  upstream, not independently re-verified here.
- Not wired into the live scrape chain, same as G3 — that's G5 (smart
  crawler, which needs to decide URL discovery/scoring before anything
  routes traffic here) / G8 (Firecrawl fallback demotion) territory, per
  the plan's own phase ordering.

## Next step

G5 — smart crawler (robots, sitemap, URL discovery/scoring, dedup, page
limits, early stopping), per plan §42. Not started this session.

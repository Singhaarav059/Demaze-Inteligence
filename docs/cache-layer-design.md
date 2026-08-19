# Cache Layer Design (G6)

Date: 2026-08-18
Status: Code + tests + one real, zero-paid-cost live verification. Not
wired into the live pipeline.
Scope: `demaze_master_research_optimization_plan.md` §42 G6 ("Implement:
page cache, search cache, evidence cache, content hashing, TTL").

## Worktree note (read this first)

This session ran in a git worktree that had branched off before the G0-G5
work (research-metrics.ts, direct-fetcher.ts, html-extractor.ts,
smart-crawler.ts, evidence-ledger.ts) was committed anywhere — those files
existed only as *uncommitted* changes in a separate checkout. To build G6
on top of them, this session re-created those G0-G5 modules in this
worktree (verbatim, from the same content already reviewed for this task)
plus the minimal set of small, additive exports 3 pre-existing files needed
(`parseContentSegments`/`ContentSegment` in `evidence-extractor.ts`,
`significantWords` in `quote-verification.ts`, the G2 `EvidenceItem` field
additions in `normalize.ts`, and a new `origin` field on `ContentSegment`
that G2's real design already calls for). This is disclosed here rather
than silently presented as "G0-G5 already existed" — the G6 work itself
(everything below) is unaffected either way, since it only depends on
those modules' public shape, not on how they got into this worktree.

## What "page cache", "search cache", and "evidence cache" mean here

Before building anything, checked what already exists (ladder rung 2 —
"already in this codebase?"):

- **Search cache: already exists, unmodified this session.**
  `lib/cache/search-cache.ts` (Supabase-backed, `search_query_cache` table,
  migration `012_search_query_cache.sql`, 30-day TTL) is wired into
  `searchTavily()`/`searchSerper()` in `lib/enrichment/discovery-engine.ts`
  — the single choke point every discovery module (Competitor Discovery,
  ICP Generator, Market Intelligence, Website Discovery, Company Discovery,
  the main Enrichment Discovery pass) already funnels through. This is
  already live in the real request path. G6's "search cache" requirement
  is satisfied by pre-existing work, not rebuilt.
- **Page cache: genuinely missing, built this session.** G3's
  `direct-fetcher.ts` (raw HTTP fetch) and G4's `html-extractor.ts`
  (fetch+extract-to-markdown) had zero caching — confirmed via grep before
  writing anything. Neither is wired into the live scrape chain yet (that's
  G8's job), but G5's `smart-crawler.ts` calls `fetchAndExtract()`
  per-candidate-page in a loop, and that's the real gap: a repeat crawl of
  the same site (or an overlapping candidate set across two crawls) refetches
  every page from scratch.
- **Evidence cache: the one genuinely new design decision.** Checked
  `evidence-ledger.ts` (G2) first, per this session's own instruction: its
  functions (`classifySourceAuthority`, `classifyFreshness`,
  `computeCompanyIdentityConfidence`, `computeEvidenceConfidence`) are all
  cheap, pure, and take small inputs — nothing worth caching there. The one
  real cost center is `attributeQuoteToSource()`, which calls
  `parseContentSegments()` — a full regex pass over the entire content pool
  (up to ~16,000 chars per CLAUDE.md's 2026-07-22 research-quality
  initiative) — **on every single evidence item being attributed**. Within
  one run, every opportunity/pain-point evidence item draws from the exact
  same `extractorData.websitePreview` content pool, so this pool gets
  re-parsed from scratch once per evidence item today, live, in the
  already-wired `normalize.ts` call path. Caching `attributeQuoteToSource()`
  by `(quote+snippet, contentPool)` is the "evidence cache."

## Layer 1 — Page cache (`lib/cache/page-cache.ts`)

**What's cached**: G4's `FetchAndExtractResult` (url/success/markdown/
charCount/title), keyed by URL.

**TTL: 24 hours** — same as `scrape-cache.ts`'s `CACHE_TTL_HOURS`. A single
page's content is roughly as volatile as a full company scrape (the two are
the same underlying "did the live site change" question, just at different
granularity), so there's no principled reason to pick a different number;
copying the established value is more defensible than inventing a new one
with no data behind it.

**Storage: in-memory, module-scope `Map`, NOT Supabase.** The deciding
question (per this session's own instruction — "check whether the same
reasoning applies to page/search/evidence caches specifically"): does this
data need to survive across requests/deploys? `scrape-cache.ts`/
`search-cache.ts` need Supabase because they're wired into the LIVE request
path (`app/api/admin/test-analysis/route.ts` calls them on every real
research run) — a dev-server restart or a second server instance must not
lose that value. This cache's only caller is `smart-crawler.ts`, which
is **not** wired into any live route (G5's own header, unchanged this
session) — nothing in production calls this today. An in-memory cache is
strictly correct and lower-risk for a currently-unused subsystem: zero new
migration, zero new table, zero risk of a schema guess being wrong before
anyone's actually using it. Per the task's own "Stop Conditions" guidance
("if unsure whether a migration is warranted, lean toward the simpler
option"), this was the clear call, not a coin flip. Move this to Supabase
(mirroring `scrape-cache.ts`'s schema exactly) the session that actually
wires G3-G5 into a real request path (G7/G8) — flagged explicitly so it
isn't forgotten, not left implicit.

**Content hashing**: `hashContent()` (`lib/cache/content-hash.ts`,
`sha256` via `node:crypto`, no new dependency) over the extracted markdown.
Stored alongside every cache entry.

**"Stale refresh" semantics** (per plan §43's own Cache-tests list — hit,
miss, TTL, content hash, stale refresh): `fetchAndExtractCached()` is a
cache-first wrapper around `fetchAndExtract()`. On a genuine cache MISS
where a prior (now-expired) entry exists for the same URL, it refetches
live and compares the new content hash against the old one, returning
`contentChanged: true/false` on the result — `false` means "we refetched
because the TTL lapsed, but the site's content is honestly unchanged" (a
real "stale refresh", not a real update); `true` means the content
genuinely changed. `contentChanged` is `undefined` when there's nothing to
compare against (the URL's first-ever fetch). **Failures are never
cached** — a transient network error being "remembered" as this page's
state for a full 24h TTL window would be actively harmful (the next crawl
attempt should retry, not silently skip a page that's actually fine now);
this is a deliberate asymmetry from `scrape-cache.ts` (which caches
whatever `ScrapeResult` it's given, success or partial-failure, since
that's a whole-run snapshot) — a single page's transient fetch failure
carries no evidence value worth remembering.

**Wired into**: `smart-crawler.ts`'s per-candidate-page loop
(`crawlWebsite()`) now calls `fetchAndExtractCached()` instead of the raw
`fetchAndExtract()`. The homepage fetch (which also needs the raw HTML for
link extraction, not just markdown) is left untouched — caching it would
need a second cache shape (raw HTML, not just extracted markdown) for a
single call site, not worth the complexity yet. `smart-crawler.ts` itself
remains **not** wired into the live scrape chain — see G5's own header —
so this wiring is entirely within the still-standalone G3-G5 module stack,
not a change to `app/api/admin/test-analysis/route.ts` or `scraper.ts`.

## Layer 2 — Search cache

No new code. See "What... means here" above — already built, already live,
already Supabase-backed with a 30-day TTL. Confirmed unmodified this
session via `git diff`-equivalent inspection (this file wasn't touched).

## Layer 3 — Evidence cache (`lib/cache/evidence-cache.ts`)

**What's cached**: `attributeQuoteToSource()`'s `QuoteAttribution` result
(`{ sourceUrl, sourceType }`), keyed by a hash of
`(quote + matchedSnippet, contentPool)`.

**TTL: 30 days** (`EVIDENCE_CACHE_TTL_HOURS = 24 * 30`), same order of
magnitude as `search-cache.ts`. Unlike the page cache, this isn't really
about content staying "fresh" — `classifySourceType()`/
`parseContentSegments()` are deterministic pure functions, so a cached
attribution for the exact same `(quote, contentPool)` pair never becomes
factually wrong on its own. The TTL here exists purely to bound unbounded
memory growth over a long-running process, not because the underlying
answer expires.

**Versioning, not just TTL, for correctness**: a cache key also includes a
`SCORING_VERSION` constant. `docs/evidence-ledger-design.md`'s own G2.5
section says its confidence weights are "explicitly not tuned against real
data yet" — if `evidence-ledger.ts`'s classification/attribution logic
ever changes, a 30-day-old cached answer computed under the OLD logic must
not silently keep being served as if it reflects the new logic. Bumping
`SCORING_VERSION` invalidates every existing entry with a one-line change,
no migration, no explicit cache-clear step needed.

**Content hashing**: both the `(quote+snippet)` half and the `contentPool`
half of the key are hashed independently via the same shared
`hashContent()` from Layer 1 — avoids holding potentially-large content-pool
strings as `Map` keys, and (more importantly) avoids two DIFFERENT content
pools that happen to share a common prefix ever being conflated.

**Storage: in-memory**, same reasoning as Layer 1 — the cached WRAPPER
(`attributeQuoteToSourceCached()`, new export on `evidence-ledger.ts`) is
NOT wired into `normalize.ts`'s existing, already-live call site this
session (see "What's deliberately NOT wired in" below) — only the
uncached `attributeQuoteToSource()` is called there, unchanged. So this
cache's only real caller today is its own test suite plus whatever a
future session chooses to wire in.

## Content hashing (shared utility)

`lib/cache/content-hash.ts`'s `hashContent(text): string` — one `sha256`
wrapper over `node:crypto` (stdlib, no new dependency, per the task's own
"no new vendor without approval" instruction extending to gratuitous npm
deps). Used identically by both Layer 1 (page content) and Layer 3 (quote/
content-pool identity) — one hashing utility, not two divergent copies.

## What's deliberately NOT wired into the live pipeline this session

Per this session's own explicit scope instruction, matching every G0-G5
session's own precedent (new modules, unit-tested, live-verified in
isolation, not wired into `app/api/admin/test-analysis/route.ts` or the
live scrape chain):

1. **`smart-crawler.ts` itself is still not called from any live route** —
   wiring the page cache into it doesn't change that; it only makes the
   ALREADY-standalone G5 module cheaper to call repeatedly, for whenever
   G8 ("move Firecrawl from default to fallback") eventually does wire it
   in.
2. **`normalize.ts`'s existing evidence-ledger call site is untouched.**
   It already calls `attributeQuoteToSource()` (uncached) on every real
   research run today (G2 wired this in, not this session) — this session
   deliberately did NOT swap that live call site over to
   `attributeQuoteToSourceCached()`, to keep this session's diff scoped to
   new, additive modules rather than changing behavior on a path that's
   already live in production. `attributeQuoteToSourceCached()` exists,
   is tested, and is a one-line import swap for whichever future session
   decides to adopt it in `normalize.ts` — but that decision (and its own
   regression risk on a live path) is deliberately left to that session,
   not made implicitly here.
3. **No Supabase migration.** Both new caches are in-memory by design (see
   above) — nothing to migrate yet.

## Cost/latency impact vs. G0's baseline

G1's baseline (`docs/research-cost-baseline.md`) measured the CURRENT live
pipeline, which routes through Firecrawl/Tavily/Serper — none of which this
session's caches touch (`page-cache.ts` sits in front of G3's
`directFetch()`, not Firecrawl; `evidence-cache.ts` sits in front of a pure
regex function, not an LLM call). So this session's caches have **zero
measurable effect on G1's baseline numbers today** — an honest, not a
disappointing, result: they can't move a number they don't intercept yet.
Their value is prospective, for whichever future session (G7 "search
router", G8 "Firecrawl fallback") makes G3-G5 (and therefore this cache
layer) part of the real, metered request path. The one real, measured
effect available today: `docs/cache-layer-design.md`'s own live smoke test
(below) shows a real page-cache hit costing 0ms vs. a real 2.7s cold fetch
for the same URL — the actual saving this layer is built to deliver, once
it's on the hot path.

## Live verification

Per the task's own "prefer that path if it proves the cache actually
hits/misses correctly" guidance — no paid API involved (`page-cache.ts`
only calls G3's plain `directFetch()`, same zero-cost precedent as G3/G5's
own live checks). Ran a throwaway `npx tsx` script (deleted immediately
after, not committed) against `adorwelding.com` — the same real company
already used throughout this repo's G3/G5 live-verification history:

```
first:  { fromCache: false, success: true, charCount: 7605, ms: 2732 }
second: { fromCache: true,  success: true, charCount: 7605, ms: 0, contentSame: true }
```

First call: a real cold fetch (2.7s, 7,605 real chars). Second call, same
URL: served entirely from cache (0ms, byte-identical content) — confirms
the hit path works against real data, not just mocked tests.

**Not live-verified**: the "stale refresh" `contentChanged` branch (needs a
site's content to genuinely differ between two real fetches spaced past the
24h TTL — not practically forceable in one session) and the evidence-cache
integration against a real `normalize.ts` run (deliberately not wired into
that live path this session, see above — nothing real to verify yet).
Both are covered by mocked unit tests instead (`tests/page-cache.test.ts`,
`tests/evidence-cache.test.ts`), same "unit-tested, live smoke test where
free, defer the rest" precedent as G3-G5.

## Tests

`tests/page-cache.test.ts` (13 assertions): pure `getCachedPage`/
`savePageCache` hit/miss/TTL/content-hash-equality cases (injectable `now`,
same pattern as `evidence-ledger.ts`'s `classifyFreshness(publishedAt, now)`),
plus `fetchAndExtractCached()` against mocked `global.fetch` — miss-then-hit
with a real fetch-call-count assertion, failures never cached, both
`contentChanged: true` and `contentChanged: false` stale-refresh cases, and
the first-ever-fetch `contentChanged: undefined` case.

`tests/evidence-cache.test.ts` (8 assertions): pure `getCachedAttribution`/
`saveCachedAttribution` hit/miss/TTL/key-isolation cases (a different quote
or a different content pool must independently miss — the real point of
hashing both halves of the key), an honestly-cached `sourceUrl: null`
result (never silently "upgraded" on replay), plus 2 integration
assertions calling `attributeQuoteToSourceCached()` directly against a
realistic `--- PAGE: ... ---`-shaped content pool.

`tests/smart-crawler.test.ts` re-created (18 assertions, unchanged from
G5's own version except one addition): a `beforeEach(() => clearPageCache())`
in the `crawlWebsite` describe block — several of those tests reuse the
same candidate URLs (e.g. `/about`) with DIFFERENT mocked content across
`it` blocks, and the page cache is a module-scope singleton that outlives
any single test; without this reset, a later test's URL could silently hit
an earlier test's cached page instead of its own mock. Caught and fixed
during this session's own test-writing, not left as a latent flake.

`npx tsc --noEmit` clean. Full suite 943/943 (901 pre-existing in this
worktree + 42 new: 13 page-cache + 8 evidence-cache + 18 smart-crawler + 7
html-extractor, re-created for the reasons in the "Worktree note" above +
no delta to any other file's count). `npm run build` succeeds.

## Not done

- Neither cache is wired into any live route or the existing
  `app/api/admin/test-analysis/route.ts` pipeline — see "What's
  deliberately NOT wired in" above.
- No Supabase migration for either new cache — deliberate, see the storage
  discussion above.
- The evidence-cache's `SCORING_VERSION` bump mechanism is unit-tested only
  indirectly (via key-construction correctness) — not exercised by
  literally changing the constant and confirming old entries miss, since
  that's true by construction (a different key = a different Map entry)
  and re-deriving that via a dedicated test would just be re-testing
  `Map.get`/`Map.set` semantics.
- Cache eviction/size-bounding for the in-memory `Map`s: neither cache has
  an LRU or max-size cap today — acceptable while nothing on the live path
  calls them (unbounded growth from zero real traffic is zero growth), but
  worth adding before either graduates to a live-traffic call site.

## Next step

G7 — Search router (`cache → Gemini Search → Serper → Tavily`, stop when
evidence is sufficient), per plan §42. Not started this session.

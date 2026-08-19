# Search Router Design — G7 (Master Research Optimization Plan)

## Worktree note (read this first)

This module was built in an isolated agent worktree that branched off git
`HEAD` before G0–G6 of this plan had ever been committed. That's expected —
**none of G0–G6 has been committed to this repo at all** as of this
writing; every G0–G6 file
(`demaze_master_research_optimization_plan.md`,
`docs/research-architecture-audit.md`, `docs/cache-layer-design.md`,
`lib/pipeline/evidence-ledger.ts`, `direct-fetcher.ts`, `html-extractor.ts`,
`smart-crawler.ts`, `research-metrics.ts`, `lib/cache/page-cache.ts`,
`evidence-cache.ts`, `content-hash.ts`) exists only as **uncommitted
changes** in the main working tree (same "Worktree note" situation
`docs/cache-layer-design.md` itself already flagged for G6). The build
agent's own worktree couldn't see any of it and said so plainly rather than
guessing — see the original text of that finding preserved below. This file
was copied back into the main working tree afterward (uncommitted, same as
every other G-phase file) once that was confirmed, so the discrepancy is
resolved for this doc's purposes: G0–G6 genuinely are present alongside
this file right now, just not yet committed by anyone.

Preserved from the build session, for the record of how it found this:

This session's brief said G0–G6 were already committed in this worktree and
pointed at `demaze_master_research_optimization_plan.md`,
`docs/research-architecture-audit.md`, and `docs/cache-layer-design.md` as
required reading. **None of those files, nor any of the G0–G6 `lib/`
modules they describe (`lib/pipeline/evidence-ledger.ts`,
`lib/pipeline/direct-fetcher.ts`, `lib/pipeline/html-extractor.ts`,
`lib/pipeline/smart-crawler.ts`, `lib/pipeline/research-metrics.ts`,
`lib/cache/page-cache.ts`, `lib/cache/evidence-cache.ts`,
`lib/cache/content-hash.ts`) exist in this worktree**, in any commit, on any
branch (`git log --all -- <path>` returns nothing for every one of them).
`CLAUDE.md` *does* already contain the full G0–G6 narrative (it's identical
to what's quoted in this session's own task text) and is fully committed at
this worktree's HEAD — so the documentation of that work landed in version
control, but the actual code apparently only ever existed as uncommitted
changes in a different, sibling agent worktree and never made it into any
commit reachable from here.

This is stated plainly rather than worked around silently: this session
could not read `docs/cache-layer-design.md`/`docs/research-architecture-
audit.md` (they don't exist to read) and could not build G7 "on top of" G3–
G6's actual code (there is none in this worktree). What this session
**did** do instead: verified the two concrete things G7 actually depends on
by reading the real, present code directly —

1. `lib/cache/search-cache.ts` (Supabase-backed, `search_query_cache`
   table, migration `012_search_query_cache.sql`, 30-day TTL) is real,
   committed, and already the one live cache every discovery module funnels
   through via `searchTavily()`/`searchSerper()` in
   `lib/enrichment/discovery-engine.ts`. Confirmed by reading both files
   directly, not assumed from CLAUDE.md's prose.
2. Gemini's native Google Search grounding tool is genuinely never wired in
   anywhere in this codebase — `lib/ai/providers/vertex-gemini.ts`'s
   `generateContent()` call passes no `tools` field, confirmed by reading
   the file directly. This is the one specific gap the task brief cited
   from `docs/research-architecture-audit.md` (a file this worktree doesn't
   have), and it independently checks out against the real code regardless
   of whether that audit doc exists here.

Given that, this session built G7 as a standalone, additive module against
the actual codebase state, using the same discipline (pure functions,
mocked-dependency unit tests, `tsc --noEmit` + full suite, explicit
"deferred" section, live-verification skipped and stated as skipped) that
CLAUDE.md's own G2/G4/G5/G6 narrative describes for the *reachable* parts of
those sessions — not because those files could be read here, but because
that discipline is independently visible throughout this repo's actual
commit history and CLAUDE.md's own narrative conventions.

**Practical consequence, now resolved**: the real G0–G6 code does exist —
uncommitted in the main working tree this file now lives in too. Nobody has
committed any of G0–G7 to git yet. That's a real, standing gap (a lot of
work sitting only in an uncommitted working tree), but it's an ordinary
"commit this when ready" gap, not a lost/orphaned-work situation.

## What G7 asks for (per the task's own inlined description)

A search router with priority `cache → Gemini Search → Serper → Tavily`,
stopping once evidence is judged sufficient for a query. Two real gaps to
close:

1. Gemini has no Google Search grounding capability wired in anywhere —
   confirmed directly (see above).
2. No router exists that tries multiple search providers in a stated
   priority order with an explicit stop condition — `discoverEvidenceSources()`
   in `discovery-engine.ts` has a two-tier Tavily→Serper fallback (Serper
   only tried when Tavily comes back with zero results, no notion of
   "sufficient"), but nothing resembling a 4-tier priority chain with a
   sufficiency check.

## What was built

### `lib/ai/providers/vertex-gemini-search.ts` — Gemini Search grounding

`searchWithGeminiGrounding(query, apiKey, maxResults)` — a single
`generateContent()` call with `tools: [{ googleSearch: {} }]` attached
(Gemini's native grounding tool, confirmed via `@google/genai`'s own
`.d.ts` — `GoogleSearch`/`GroundingMetadata`/`GroundingChunk`/
`GroundingChunkWeb` types, `Tool.googleSearch?: GoogleSearch`,
`GenerateContentResponse.candidates[0].groundingMetadata.groundingChunks[].
web.{uri,title}`). Deliberately a **sibling file** to
`vertex-gemini.ts`, not a method added to `VertexGeminiProvider` — this
returns search results (a list of sources), not a `CompletionResponse`, so
it doesn't fit `AIProvider`'s shape, and keeping it in its own file means
zero risk of touching the live text-completion chain
`provider-factory.ts` already depends on for every narrative/business-
profile/subject-line call in the app.

**Not a new vendor.** Vertex AI Gemini is already an approved, live vendor
in this codebase (`GEMINI_VERTEX_API_KEY`, already the default entry in
`getCompletion()`'s chain). This is a new *capability* on that same
already-approved vendor (attaching its search-grounding tool to a call),
not a new external dependency — flagged explicitly here per the task's own
instruction not to let that reasoning go unstated.

**Real, honest limitation, not hidden**: Gemini's grounding metadata gives
a source URL + title per grounded chunk, but — unlike Tavily/Serper — no
distinct per-source snippet. Every result for one query shares the same
`content` field: the model's own synthesized answer text (capped to 300
chars, matching `discoverEvidenceSources()`'s own snippet cap). This means
a caller that needs a *verified quote from a specific source* still has to
fetch and check that source directly — same "a quote must be verified
against real source text, and even a real quote's interpretation must be
checked" discipline this codebase already applies elsewhere
(`lib/pipeline/quote-verification.ts`, `lib/enrichment/extraction-
guards.ts`'s adversarial-content filter). This module produces a discovery
signal, not a pre-verified claim.

**Deliberately no `jsonMode`/`responseMimeType: 'application/json'`** on
this call. Gemini's structured-output mode and Search grounding are not
confirmed combinable (found no definitive same-call precedent in this
codebase or the SDK's own types to settle it either way, and this module is
not live-verified this session — see "Deferred" below) — so the function
reads `groundingMetadata` directly off the typed response object instead of
asking the model to emit JSON, sidestepping the question entirely rather
than guessing.

**Caching**: in-memory only (module-scope `Map`, 24h TTL, same shape as G6's
`page-cache.ts`/`evidence-cache.ts` per CLAUDE.md's own description of that
work — this worktree doesn't have those files to import from, so this is a
small, self-contained duplicate of the same pattern, not a shared import).
**Why not the existing Supabase `search_query_cache` table**: its
`provider` column has a hard `CHECK (provider IN ('tavily', 'serper'))`
constraint (migration `012_search_query_cache.sql`, confirmed by reading
it directly) — widening that constraint for a capability with zero live
callers this session would be a premature migration. Revisit once this is
actually wired into a live route.

### `lib/enrichment/search-router.ts` — the router itself

`routedSearch(query, options)` tries, in order: cache (tier 0) → Gemini
Search (tier 1) → Serper (tier 2) → Tavily (tier 3, last) — stopping at the
first tier whose results clear `isSearchSufficient()`. Each live tier
(Gemini/Serper/Tavily) is skipped outright when its API key isn't
configured, same "absent key = not set up, not an error" discipline every
other search caller in this codebase already uses. If no tier clears the
sufficiency bar, the function returns the single largest result set seen
across every tier that was actually tried (never a hard empty if *any* tier
returned something) — same graceful-degradation precedent as
`discoverEvidenceSources()`'s own per-query Tavily→Serper fallback.

**Cache is genuinely tier 0, not "whichever provider happens to have its
own cache checked first."** `readCacheOnly()` checks Gemini's own
in-memory cache AND the Supabase `search_query_cache` table under both the
`'serper'` and `'tavily'` tags, before any live call on any tier — a cache
hit means real evidence already exists for this exact `(query,
maxResults)` key, and it doesn't matter which vendor originally produced
it; re-fetching from the "highest priority" live tier just to respect
tier ordering would waste a paid call for a result the caller already has.
This is a real design decision, not an oversight: the alternative (only
check the cache for whichever *live* tier is about to be tried) would make
"cache" not really its own tier at all, since `searchSerper()`/
`searchTavily()` already do that internally — the whole point of listing
"cache" first in the plan's priority order is that it should be checked
*before* deciding which live tier to call, not folded into one of them.

**Priority order deliberately differs from `discovery-engine.ts`'s live
order.** Today, `discoverEvidenceSources()` tries Tavily first, Serper only
as a fallback when Tavily returns zero results. This plan's stated G7
order puts Tavily *last*. That's not a mistake — it's what was explicitly
asked for, and `discovery-engine.ts` itself is completely untouched this
session (see "Deferred" below). A future session deciding whether/how to
actually point `discovery-engine.ts`'s 5 call sites at this router needs to
resolve that ordering question explicitly, not silently inherit whichever
order happened to land first.

**`isSearchSufficient(results, options)`** — the "is this enough evidence
to stop searching" check, kept deliberately lightweight and pure:

```ts
function isSearchSufficient(results, { minResults = 3, minContentChars = 40 } = {}) {
  const usable = results.filter(r => (r.content ?? '').trim().length >= minContentChars)
  return usable.length >= minResults
}
```

Why this shape and not something reusing an existing pipeline concept:

- **Not `evidence-ledger.ts`'s confidence scoring** — that module doesn't
  exist in this worktree (see the discrepancy note above), and even if it
  did, per CLAUDE.md's own description it scores already-*extracted claims*
  against source-authority/freshness/company-identity confidence. A router
  operating at search time has no claim yet to score — it's choosing
  whether to keep searching, not whether to trust a specific sentence.
  Reusing a post-extraction confidence pipeline for a pre-extraction
  "enough raw material yet" decision would be forcing a fit, the exact
  anti-pattern this repo's own discipline warns against.
- **Same shape of heuristic G5's smart-crawler early-stopping used**, per
  CLAUDE.md's description of that (also-unavailable-here) module: a simple
  count-based threshold over already-cheap-to-check signals, not a deep
  content-quality pass. A result-count floor, with a minimum content length
  so a page of near-empty snippets doesn't count as 3 "results," is the
  direct search-time analog.
- **Considered and explicitly deferred**: reusing
  `lib/enrichment/extraction-guards.ts`'s `mentionsTopic()`/
  `filterTopicallyRelevantResults()` (both real, present, already used by
  the offering-driven competitor/ICP discovery passes) to also require
  topical relevance, not just a raw count. Not done this session —
  those functions need a topic phrase derived from the *specific query
  shape* `discovery-engine.ts`'s own query-building already produces
  (`buildDiscoveryQueries`/`buildCompetitorQueries`-style), which a
  generic single-query router primitive doesn't have on its own. Layering
  topic-awareness in later (as an optional parameter, once a caller wants
  it) is a small, backward-compatible addition to `isSearchSufficient()`'s
  signature — not a redesign.

### Result shape

`SearchResultItem = { title, url, content }` — structurally identical to
what `searchTavily()`/`searchSerper()` already return. This is deliberate:
a `routedSearch()` result is a drop-in substitute anywhere that shape is
already consumed. No caller was changed to actually consume it this
session (see "Deferred" below) — this just means a future wiring pass
doesn't also have to reconcile a shape mismatch.

## Verification

- `npx tsc --noEmit`: clean.
- Full suite: **922/922 passing** (901 pre-existing in this worktree + 21
  new — 8 in `tests/vertex-gemini-search.test.ts`, 13 in
  `tests/search-router.test.ts`). Confirmed the pre-existing count directly
  by counting `it(` blocks in the two new files and subtracting from the
  final total, rather than trusting a stale figure from CLAUDE.md (whose
  own test counts, per the discrepancy note above, describe a different,
  more-advanced worktree state than what's actually here).
- `tests/vertex-gemini-search.test.ts` mocks `@google/genai`'s `GoogleGenAI`
  class directly (no precedent for mocking this specific SDK elsewhere in
  the repo — closest analog is `tests/prospeo-client.test.ts`'s mocked
  `global.fetch`). **Real bug caught and fixed while writing this test,
  not left broken**: the first mock implementation used an arrow function
  (`vi.fn().mockImplementation(() => ({...}))`) — arrow functions cannot be
  used as JS constructors, and `vertex-gemini-search.ts` calls `new
  GoogleGenAI(...)`, which threw `"... is not a constructor"` inside the
  module's own try/catch, silently degrading every test to the empty-array
  failure path (6 of 8 tests failed with `[]` instead of their expected
  results, one specifically because the mock was never even invoked).
  Fixed by using a named `function` expression instead. Left as a genuine
  regression-test lesson in the test file's own header comment, not
  silently fixed and forgotten — this exact mistake is easy to reintroduce
  if anyone writes a similar SDK-class mock elsewhere in this repo later.
- `tests/search-router.test.ts` mocks `@/lib/cache/search-cache`,
  `lib/enrichment/discovery-engine`, and
  `@/lib/ai/providers/vertex-gemini-search` — covers every tier-selection
  branch (cache sufficient/stops there, falls through Gemini→Serper→
  Tavily in order, a tier skipped when its key is absent, "largest result
  set wins when nothing clears the bar," env-var key fallback when no
  explicit option is passed) plus `isSearchSufficient()`'s pure logic in
  isolation (default floor, custom `minResults`/`minContentChars`
  overrides, near-empty content not counted). Explicit env-var isolation
  (`beforeEach`/`afterEach` saving and clearing
  `TAVILY_API_KEY`/`SERPER_API_KEY`/`GEMINI_VERTEX_API_KEY`) so a stray
  real value in whatever shell runs these tests can never make a
  "this tier is unconfigured" assertion flaky.

## Deferred — explicitly, per this session's own scope instructions

1. **No live API call was made.** No real Vertex AI Gemini Search-grounding
   call, no real Tavily/Serper call through the router. This session ran
   under explicit instruction not to spend real paid API quota
   autonomously (unlike the user-confirmed live-verification passes
   CLAUDE.md describes for G2–G6's reachable parts). Whoever next has a
   real `GEMINI_VERTEX_API_KEY` and explicit authorization to spend quota
   should run one real `searchWithGeminiGrounding()` call directly (a
   throwaway script, same precedent as every other vendor-capability
   live-check in this repo's history) before trusting: (a) that
   `tools: [{ googleSearch: {} }]` actually returns grounding metadata
   under Vertex Express Mode specifically (some Gemini API surfaces gate
   Search grounding behind billing-enabled projects, not just an Express
   Mode key — unconfirmed here), and (b) whether combining `jsonMode` with
   search grounding is actually viable, in case a future caller wants
   structured output alongside grounding instead of parsing free text.
2. **Not wired into `discovery-engine.ts` or any of its 5 call sites**
   (Enrichment Discovery, Competitor Discovery, ICP Generator, Market
   Intelligence, Website Discovery, Company Discovery). This is a
   standalone, additive module only. A future G8+ session decides whether
   and how to point any of those at `routedSearch()` instead of their own
   direct `searchTavily()`/`searchSerper()` calls — including resolving
   the Tavily-last-vs-Tavily-first ordering question flagged above, and
   whether per-query topical-relevance filtering needs to be layered into
   `isSearchSufficient()` before that wiring would be safe.
3. **Gemini Search results are not cached in the durable, DB-backed
   `search_query_cache` table** — only in-memory, for the reasons given
   above (the `provider` CHECK constraint). If this module gets wired into
   a live route with real query volume, that in-memory cache should either
   move to Supabase (via a small migration widening the constraint) or get
   its own dedicated table — not left in-memory once real traffic depends
   on it surviving a server restart.
4. **Nothing in G0–G7 has been committed to git yet.** All of it (this
   module included) is uncommitted in the main working tree — a real,
   standing gap worth closing at some point, not something this session
   resolved.

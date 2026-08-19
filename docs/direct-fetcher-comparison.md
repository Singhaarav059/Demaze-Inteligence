# In-House Direct Fetcher (G3)

Date: 2026-08-18
Status: Code + tests + live comparison. Not wired into the live scrape chain.
Scope: `demaze_master_research_optimization_plan.md` §42 G3 ("Implement direct
HTTP fetch. Test against the 30-company benchmark. Do not remove Firecrawl.").

## What was built

`lib/pipeline/direct-fetcher.ts` — `directFetch(url, timeoutMs?)`. Consolidates
the ad-hoc `fetch()`-with-browser-UA-and-`AbortController` pattern already
duplicated across `scraper.ts`/`web-enricher.ts`/`website-discovery.ts` into
one reusable function, additive only — none of those existing call sites were
touched. Handles: timeout (`AbortController`), one retry on a transient
failure (network error, timeout, or 5xx — not on a definitive 4xx), redirect
(native `fetch` follow, final URL reported back), non-HTML content-type
(flagged via `isHtml`, not rejected), and an 8MB response-size cap (checked
against both `content-length` and the actual decoded size, since a server can
omit or lie about the header). Instrumented via the existing G1
`recordMetric('directFetchCalls')` counter — no new metrics plumbing needed.

**Deferred to G5 (smart crawler), not built here**: robots.txt checking and
duplicate-URL dedup. Both are crawl-policy concerns, not raw-fetch mechanics,
and G5's own implementation list in the plan already owns "robots" and
"deduplication" — building them into the fetcher now would duplicate work G5
is explicitly scoped to do.

**Not wired into the live scrape chain.** There is no in-house HTML→text
extractor until G4 — raw HTML from this fetcher isn't safe to feed into
`evidence-extractor.ts` today (it expects markdown-shaped content). Wiring
this in now would risk polluting real evidence extraction with unparsed
`<div>`/`<script>` noise. This module exists to prove the fetch layer itself
works against real sites before G4 builds extraction on top of it — exactly
the ordering the plan's own G3→G4 split implies.

## Tests

`tests/direct-fetcher.test.ts`, 8 assertions, `global.fetch` mocked (same
precedent as `tests/edgar-client.test.ts`/`tests/prospeo-client.test.ts`):
clean 200/HTML, redirect (final URL reported), non-HTML content-type handled
without failing, a definitive 404 does NOT retry, a 5xx retries once and
succeeds, a thrown network error retries once and succeeds, a timeout reports
as `"timed out..."` not a generic error, an oversized declared
`content-length` is rejected. Covers plan §43's "Fetching tests" list minus
`robots`/`duplicate URL` (deferred to G5, see above).

`npx tsc --noEmit` clean. Full suite 927/927 passing (919 pre-existing + 8
new), zero regressions.

## Live comparison — real fetch against all 10 benchmark company URLs

Per plan §44 ("run the benchmark, record actual metrics, never claim
completion from unit tests alone") — this is plain HTTP, no paid API, safe to
run for real with no quota cost. Ran `directFetch()` directly (throwaway
script, deleted after) against every URL in `benchmarks/companies/*.json`:

| Company | URL | Result |
|---|---|---|
| A-1 Fence Products | a-1fenceproducts.com | **OK** — 200, 199,835 bytes, 1993ms |
| Ace Pipeline | acepipeline.co.in | **OK** — 200, 200,786 bytes, 4100ms |
| Ador Welding | adorwelding.com | **OK** — 200, 150,588 bytes, 2129ms |
| AITG | aitg.co | **OK** — 200, 58,021 bytes, 938ms |
| AS Agri & Aqua | sites.google.com/.../asagriaqua | **OK** — 200, 155,125 bytes, 1005ms |
| ATE Group | ategroup.com | **FAIL** — `fetch failed`, no status, 3325ms |
| Bharat Forge | bharatforge.com | **OK** — 200, 174,640 bytes, 518ms |
| Chargebee | chargebee.com | **OK** — 200, 658,273 bytes, 275ms |
| Lechler | lechler.com/de-en | **OK** — 200, 70,282 bytes, 1778ms |
| Muthoot Finance | muthootfinance.com | **OK** — 200, 389,454 bytes, 1317ms |

**9/10 succeeded with real HTML.** Two results are worth calling out
specifically because `CLAUDE.md` already documents them as historically
unreliable for other fetch paths in this pipeline:

- **A-1 Fence Products** — `CLAUDE.md` documents a real `fetch failed`/
  homepage-timeout history for this domain in `scraper.ts`'s Firecrawl path.
  Succeeded cleanly here, consistent with `CLAUDE.md`'s own conclusion that
  the domain itself is healthy and the historical failures were either
  transient or specific to Firecrawl's headless-browser fingerprint.
- **Muthoot Finance** — `CLAUDE.md` documents a confirmed CloudFront WAF rule
  that 403-blocks any request with no/bot-shaped User-Agent, fixed in this
  codebase's *existing* direct-fetch call sites by sending a real browser UA.
  `direct-fetcher.ts` reuses that same browser UA by construction, and
  succeeded here as expected — not a new finding, but a real confirmation
  that the new module correctly inherits the fix rather than reintroducing
  the bug.
- **ATE Group** — failed, consistent with `CLAUDE.md`'s own pre-existing note
  ("the real domain wasn't surfaced... homepage fetch failed or timed out...
  a real precision gap"). Not investigated further here — same domain, same
  known limitation, not something this session's fetcher introduced.

**Not done**: no side-by-side timing/success-rate comparison against a fresh
`FORCE_FRESH` Firecrawl run for the same 10 companies — that would spend real
Firecrawl credits and, per the plan's own "only remove a provider after
measured success" rule, isn't a decision this session needs to make yet
(Firecrawl isn't being removed or demoted by G3). The comparison that matters
for G3 specifically — does an in-house fetcher work at all against real
company sites — is answered: yes, for 9 of 10.

## Next step

G4 — in-house extractor (clean HTML → text/markdown from `directFetch()`'s
raw HTML), compared against Firecrawl's own markdown output, per plan §42.
Not started this session.

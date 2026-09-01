# Provider Audit: Exa / Tavily / Firecrawl / Serper

**Date:** 2026-09-01
**Type:** Architecture audit only — no code changed, no defaults touched, nothing removed.

## 0. Current state snapshot (important, changes the whole analysis)

As of this audit, per [`benchmarks/exa/ROLLOUT.md`](ROLLOUT.md), a rollout already happened same-day:

| Capability | Live production provider | Confirmed by |
|---|---|---|
| Company discovery | **Exa** (default flipped from Explee) | `lib/enrichment/company-discovery-provider-factory.ts:133` |
| Decision-maker discovery | **Exa** (DB row flipped from Prospeo) | ROLLOUT.md §2, `.env.example:102` |
| Email finder | **Prospeo** (Exa unusable — Websets Pro-gated) | unchanged |
| Contact enrichment | **Prospeo** primary, **Exa** selective supplement | `app/api/admin/outbound/contacts/[id]/enrich/route.ts` |
| **Core 7-stage research pipeline (web search/evidence/scraping)** | **Firecrawl + Tavily + Serper**, unchanged | explicitly "not benchmarked this round" per ROLLOUT.md §1 row 7 |

So: Exa already displaced Tavily/Serper/Firecrawl from company discovery and decision-maker discovery months before this audit — those two capabilities are not really in question anymore, they've been decided on real benchmark evidence. What's actually undecided is the **core research pipeline** (scraping, evidence discovery, ICP/competitor/market-intel search) — Exa has never been benchmarked against that workload.

## 1. Every actual provider usage (file / function / endpoint)

### Exa

| # | File | Function | Endpoint | Purpose | Trigger | Frequency |
|---|---|---|---|---|---|---|
| E1 | `lib/enrichment/sources/exa-company-discovery.ts:308` | `discoverCompanies` | `POST /search` (`category:'company'`, `outputSchema`) | Find NEW companies matching an ICP definition | User-triggered (Company Discovery page search) | 1 call/search |
| E2 | `lib/outbound/decision-maker-discovery/providers/exa.ts:118` | `discoverDecisionMakers` | `POST /search` (`category:'people'`, `outputSchema`) | Find named execs at a company | User-triggered (Auto-GTM "find decision makers") | 1 call/company |
| E3 | `lib/outbound/email-finder/providers/exa.ts:91` | `findEmail` | `POST /v0/websets` + poll + `GET items` | Find one person's email (async Webset) | Registered as a provider, but not selectable in practice — 401'd, Pro-plan-gated on the live account | 0 (non-functional today) |
| E4 | `lib/outbound/enrichment/providers/exa.ts:68` | `enrichContact` | `POST /answer` (`outputSchema`) | Department/seniority/location for a contact | Automatic, only when Prospeo's result is "thin" | Rare, bounded supplement |

### Tavily / Serper

Both funnel through two shared functions in `lib/enrichment/discovery-engine.ts` — `searchTavily()` (L234, `POST api.tavily.com/search`) and `searchSerper()` (L269, `POST google.serper.dev/search`, Tavily-fails-first fallback). Six call sites reuse them:

| # | File | Function | Purpose | Trigger | Queries/run |
|---|---|---|---|---|---|
| T1 | `discovery-engine.ts:301` `discoverEvidenceSources` | Find investor/hiring/expansion/leadership/risk URLs to fetch as evidence | Every run, parallel with scraping | 21 |
| T2 | `website-discovery.ts:353` `searchCandidateDomains` | Resolve a company name → homepage domain | Every `discoverCompanyWebsite()` call (primary company + each of up to 5 competitors) | 2 × up to 6 |
| T3 | `icp-generator.ts` (L318/334/348, own `searchWithFallback` copy) | Find "who does this company sell to" segments | Every run | ~10-15 (across base + synthesis + supplements) |
| T4 | `competitor-discovery.ts` (L390/406/420, own copy) | Find named competitors | Every run | ~6-10 |
| T5 | `market-intelligence.ts:183` `discoverMarketIntelligence` | Industry trends/growth/challenges/outlook | Every run, unconditional | 4 |

Total: ~50-65 Tavily/Serper queries per company-research run. Every query is cached 30 days by `(provider, query, maxResults)` in `lib/cache/search-cache.ts` — a re-run of an already-researched company costs ~0 live queries.

A legacy Tavily/Serper-based company-discovery engine (regex extraction of company names from search results) that used to live in `company-discovery.ts` was retired 2026-08-22 — replaced by Explee, now Exa.

### Firecrawl

| # | File | Function | Method | Purpose | Trigger | Fallback |
|---|---|---|---|---|---|---|
| F1 | `scraper.ts:1312` `scrapeHomepageWithLinks` | `client.scrape()` | Homepage markdown + nav links | Every run | → Jina reader → Tier-2 search fallback |
| F2 | `scraper.ts:772` `fetchMapUrls` | `client.mapUrl()` | Discover every URL on the site (incl. JS-rendered nav) | Every run, parallel with F1 | Returns `[]`, other discovery still runs |
| F3 | `scraper.ts:1393` `scrapeSinglePage` | `client.scrape()` (`rawHtml`) | Scrape up to 15 selected high-value pages, early-exits at 12k chars | Every run | Individual page fail just drops that page |
| F4 | `scraper.ts:866` `searchFallbackScrape` | `client.search()` w/ `scrapeOptions` | Web search + scrape as last resort | Only when homepage scrape fails or content <800 chars | Returns `null` |
| F5 | `web-enricher.ts:159` `fetchWithFirecrawl` | `app.scrape()` | Fetch content of a Tavily/Serper-discovered evidence URL | For every non-PDF prioritized/recovery source | → snippet-only block if fetch fails |
| F6 | `website-discovery.ts:241` `fetchHomepageIdentityViaFirecrawl` | `app.scrapeUrl()` (deprecated method) | Confirm a candidate domain's identity when a plain `fetch()` failed | Rare | Candidate scores `confidence:'none'` |

Firecrawl scrape results ARE cached, but only at the outer `scrapeCompanyWebsite()` level (`lib/cache/scrape-cache.ts`, wired in `test-analysis/route.ts`) — a cache hit skips F1-F4 entirely. F5/F6 are never cached, re-fetched every run.

## 2. Capability matrix

| Demaze capability | Current provider | Exa capable? | Tavily capable? | Firecrawl capable? | Serper capable? | Best candidate | Evidence |
|---|---|---|---|---|---|---|---|
| Company discovery | Exa (live) | ✅ (already primary) | ⚠️ regex-extraction only, retired | ❌ | ⚠️ same as Tavily | Exa | REPORT.md §1-3 |
| Decision-maker discovery | Exa (live) | ✅ (already primary) | ❌ | ❌ | ❌ | Exa | REPORT.md §4 |
| Known-URL website scraping | Firecrawl | ⚠️ Contents API exists, never benchmarked | ❌ | ✅ (current) | ❌ | Firecrawl (unproven challenger: Exa) | scraper.ts F1/F3; `exaGetContents` has zero callers |
| Whole-site URL discovery (map/crawl) | Firecrawl `mapUrl` | ❌ no equivalent endpoint | ❌ | ✅ (current) | ❌ | Firecrawl | scraper.ts:772 |
| Fresh web search / evidence discovery | Tavily → Serper fallback | ⚠️ never benchmarked against this workload | ✅ (current) | ❌ | ✅ (current fallback) | Unknown — needs benchmark | T1-T5 |
| Google-specific SERP | Serper (fallback only) | ❌ | N/A | N/A | ✅ (current) | Serper, if it matters | Low trigger rate by design |
| Structured entity extraction (financials, headcount, HQ) | Exa only | ✅ confirmed live | ❌ | ❌ | ❌ | Exa | exa-client.ts:75-90 |
| PDF extraction | pdf-parse (none of the four) | N/A | N/A | ❌ explicitly unreliable on raw PDFs | N/A | pdf-parse, unaffected | web-enricher.ts:175 |
| Email finding | Prospeo | ❌ Pro-gated | N/A | N/A | N/A | Prospeo | REPORT.md §5 |

## 3. Overlapping capabilities — genuine or superficial?

- **Tavily Search vs Exa Search** — genuinely untested for this workload. Exa's neural search beats keyword search for entity lookup; whether it beats Tavily on Demaze's evidence-discovery keyword-style queries (`"Company" annual report 2026`) is unproven.
- **Serper Search vs Exa Search** — same gap, plus Serper is already a low-volume last-resort fallback today.
- **Firecrawl Scrape vs Exa Contents** — superficially similar, not validated. `exaGetContents()` exists but has zero callers anywhere in the codebase.
- **Firecrawl Crawl/Map vs any Exa equivalent** — Exa has no site-crawl/map endpoint at all. Not interchangeable.
- **Firecrawl Search (F4) vs Tavily/Serper vs Exa Search** — three-way overlap, but F4 is a narrow last-resort path structurally unrelated to evidence-discovery search.

## 4. Unique capabilities (what's actually lost if removed)

- **Firecrawl**: whole-site URL mapping, JS-rendered content, `rawHtml` for JSON-LD person extraction — the entire scraper page-selection pipeline depends on it.
- **Tavily**: the evidence-discovery query set and ICP/competitor/market-intel search-grounding depend on keyword-style search returning real indexed pages with snippets. Whether Exa reproduces this for the same query phrasing is the single biggest open question.
- **Serper**: today a low-volume fallback (fires on Tavily-empty only).
- **Exa**: entity-structured company/people search, semantic decision-maker recall — already validated (REPORT.md).

## 5. Cost

| Provider | Documented $ in this repo | Basis |
|---|---|---|
| Tavily | $0.008/credit | `discovery-engine.ts:229` comment |
| Exa | $7/1k base + $1/1k extra results; Answer $5/1k | REPORT.md §7, confirmed live |
| Serper | Not documented anywhere in this repo | Cannot determine from code |
| Firecrawl | Not documented anywhere in this repo | Cannot determine from code |
| Explee/Prospeo | Not documented — bill in account credits | REPORT.md §7 |

Approximate calls/month is not determinable from code — no provider-call-volume analytics table exists in this repo.

## 6. Quality — benchmarked vs. unknown

| Comparison | Status |
|---|---|
| Exa vs Explee (company discovery) | ✅ Benchmarked, decided, live |
| Exa vs Prospeo (decision-maker discovery) | ✅ Benchmarked, decided, live |
| Exa vs Prospeo (email finder / enrichment) | ✅ Benchmarked |
| **Exa vs Tavily** (evidence-discovery search, same query set) | ❌ Unknown — never run |
| **Exa vs Firecrawl** (page-content extraction) | ❌ Unknown — never run |
| **Exa vs Serper** (SERP-style queries) | ❌ Unknown — never run |
| Exa Search+Contents+Answer vs current 7-stage pipeline, end to end | ❌ Unknown — explicitly gated as "Phase 7," not started |

## 7. What can safely be removed today

Nothing, on current evidence. Every Tavily/Firecrawl/Serper call site is load-bearing for the core research pipeline, and none has a benchmarked replacement wired in. `exaGetContents()` is the one piece of dead code — built, zero callers.

## 8. What requires benchmarking before any decision

1. Tavily/Serper vs Exa Search on the actual evidence-discovery/ICP/competitor/market-intel query set.
2. Firecrawl vs Exa Contents on known-URL scraping (investor-relations/careers/press pages, JS-heavy pages).
3. Firecrawl `mapUrl` has no Exa equivalent — moot unless Exa ships a crawl/map capability later.
4. Only after 1-3: revisit whether the 7-stage pipeline should route any stage through Exa (Phase 7 gate, not started).

## 9. Recommendation (pre-benchmark)

| Provider | Classification | Reasoning |
|---|---|---|
| Exa | A. KEEP AS PRIMARY (discovery, decision-maker) | Evidence-backed, live |
| Firecrawl | C. KEEP TEMPORARILY — NEEDS BENCHMARK | Load-bearing; unique `mapUrl`; Contents API unwired/unproven |
| Tavily | C. KEEP TEMPORARILY — NEEDS BENCHMARK | Primary evidence-discovery search; never benchmarked against Exa |
| Serper | C. KEEP TEMPORARILY — NEEDS BENCHMARK, lowest priority | Thin fallback layer already; removal risk proportional to unmeasured trigger rate |

## 10. Migration order (once benchmarked)

1. Benchmark Exa Search vs Tavily/Serper on the real evidence-discovery + ICP/competitor/market-intel query set — see `benchmarks/exa/web-search-benchmark/`.
2. Benchmark Exa Contents vs Firecrawl scrape on real scraper-selected pages.
3. If both clear a quality bar comparable to the Explee/Prospeo evidence — introduce Exa as a selectable, non-default provider.
4. Controlled side-by-side on live company research before touching any default.
5. Only after that: revisit Serper's removal, backed by measured real-world fallback-trigger frequency.

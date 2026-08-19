# Research Cost & Latency Baseline (G1)

Date: 2026-08-18
Status: First real instrumented run. Baseline for future before/after comparisons (plan §41).
Run: `benchmarks/debug/run-2026-08-18T03-51-16.json`, `benchmarks/evaluation-history/eval-2026-08-18T03-51-16.json`

## What was built

- `lib/pipeline/research-metrics.ts` — per-request provider-call/token/cache counters via `node:async_hooks` (`AsyncLocalStorage`), so every scraper/discovery/LLM call site can call `recordMetric()` without threading a counter object through dozens of function signatures. No-op outside a wrapped request context (tests, scripts) rather than throwing.
- Instrumented every call site identified in the G0 audit: Firecrawl (`scraper.ts`, `web-enricher.ts`, `website-discovery.ts` — 3 independent clients), Tavily/Serper (single choke point in `discovery-engine.ts`, benefits all 6 discovery modules automatically), Jina, direct `fetch()` (sitemap, corporate/universal path probing, EDGAR, PDF), and Gemini/NVIDIA NIM call+token counts in `provider-factory.ts`.
- Search-cache and scrape-cache hit/miss counters wired into the existing cache read paths.
- `app/api/admin/test-analysis/route.ts` wraps its whole handler in `runWithResearchMetrics()`; the computed metrics + an estimated USD cost are threaded through `normalize.ts` (`research_metrics` field, `getResearchMetrics()` getter in `analysis-sections.ts`, same convention as `getCompetitors()`/`getMarketIntelligence()`) so they persist into `pipeline_test_runs.final_result` on every future saved run, not just benchmark runs.
- `benchmarks/benchmark-runner.ts` captures `researchMetrics` per company and prints an aggregate `COST / LATENCY BASELINE` block after every run.
- Cost model is a flat per-unit USD estimate (Firecrawl ~$0.0015/page, Tavily ~$0.008/call, Serper ~$0.001/call, Gemini/NVIDIA ~$0.2-0.3/M tokens) — approximate, not live vendor pricing; good enough for relative before/after comparison, not for exact billing reconciliation (re-check each provider's pricing page per plan §16-19 before trusting for real budgeting).

**Real bug found and fixed while wiring this in**: the new `research-metrics.ts` module's `node:async_hooks` import was transitively reachable from a **client** bundle (`app/admin/company-discovery/page.tsx` value-imported `DEMAZE_URL` from `lib/enrichment/demaze-leads.ts`, which imports `company-discovery.ts`/`icp-generator.ts` → `discovery-engine.ts` → the new module) — a hard Turbopack build failure, not a warning. Root cause was pre-existing architectural coupling (a trivial UI constant living in the same file as heavy server-only search logic); fixed by extracting `DEMAZE_URL`/`DEMAZE_DOMAIN`/`DEMAZE_EXCLUDE_NAMES` into a new zero-dependency `lib/enrichment/demaze-constants.ts`, re-exported from `demaze-leads.ts` for the two existing server-side consumers. `npm run build` is clean after the fix.

## Known gap vs. the plan's assumption

The plan (§40, §41, §42 G0/G1/G15) repeatedly refers to "the existing 30-company pilot." **The actual benchmark fixture set has 10 companies** (`benchmarks/companies/*.json`), not 30 — confirmed by directory listing, not assumed. This baseline run used the real 10. Curating 20 more benchmark fixtures is a separate, real task (picking real companies, verifying expected classifications by hand — same discipline as every existing fixture's `CLAUDE.md` history) — out of scope for G1's cost-instrumentation mandate, not attempted here rather than fabricated.

## Baseline numbers (n=10, cached scrape where available — not `FORCE_FRESH`)

```
Wall time:        339.0s total, 33.9s/company avg
Firecrawl:        60 calls, 0 pages     (scrape cache hit for every company; the 60 calls are
                                          web-enricher's external-source fetches + homepage-identity
                                          fallback + mapUrl/search-fallback attempts, none of which
                                          hit the page-scrape counter)
Tavily:           40 calls
Serper:           36 calls
Jina:             0 calls
Direct fetch:     147 calls              (sitemap, corporate/universal path probes, EDGAR, homepage
                                          identity plain-fetch)
Gemini:           42 calls, 167,307 tokens   (100% of LLM calls resolved on Gemini; zero NVIDIA
                                              fallback needed this run)
NVIDIA NIM:       0 calls, 0 tokens
Cache hit rate:   387/463 (83.6%)        (search-cache; scrape-cache also hit for all 10 companies
                                          — the pipeline's own cache-first design already at work,
                                          not something G1 changed)
Estimated cost:   $0.406 total, $0.0406/company avg
```

Research Evaluation Framework mean score: **65.91/100** (min 35.5, max 81.67) — up from the previous run's 51.64 (+14.27), consistent with ongoing pipeline-quality work in this repo, not something this session changed.

Gate outcomes: 5 PASS, 4 WARN, 1 FAIL (AITG — `primary_type: healthcare_provider` instead of `manufacturer`, a pre-existing, already-documented `CLAUDE.md` flakiness class for this exact company, not caused by this session's instrumentation work, which touches none of the classification code).

## Interpretation

- **This run is cache-heavy** (83.6% search cache hit rate, 100% scrape cache hit rate) — it under-counts what a genuinely cold/first-time research run costs. A `FORCE_FRESH=true` re-run would give the true "cold" cost per company, at the cost of spending real Firecrawl/Tavily/Serper credits on all 10 companies again — not run this session, since the instrumentation itself needed verifying first, not a maximally-expensive number.
- **Gemini is currently absorbing 100% of LLM calls with zero NVIDIA fallback** in this run — consistent with `provider-factory.ts`'s own header history (Gemini promoted to default 2026-07-30, NVIDIA kept only as a cost/outage fallback).
- **The `firecrawlPages: 0` result, despite 60 `firecrawlCalls`, is a real and correct signal**, not a bug: it means every company's actual page-scrape step was fully cache-hit (`company_scrape_cache`), so the 60 Firecrawl calls all came from paths that don't scrape pages (external-source fetch in `web-enricher.ts`, homepage-identity fallback, mapUrl probes). This is exactly the kind of per-provider breakdown plan §35 asked for that a simple "N Firecrawl calls" number would have hidden.
- **$0.0406/company is a floor, not a realistic per-lead cost** given the cache-heavy run — treat it as this session's baseline for detecting regressions/improvements in instrumentation-covered cost, not as the number to plug into a pricing model.

## Not done this session (real next steps)

1. A `FORCE_FRESH=true` re-run to get a true cold-cache cost baseline (real added quota spend — needs its own explicit go-ahead, not assumed here).
2. Expanding the benchmark set from 10 to a genuine 30 companies, if the plan's "30-company" assumption is meant to become real going forward.
3. G2 onward per the plan's own implementation order (§42) — evidence ledger, in-house fetcher, etc. — none of that was touched this session; G1 was scoped to instrumentation + baseline only, per the plan's own "do not optimize before the baseline exists" rule.

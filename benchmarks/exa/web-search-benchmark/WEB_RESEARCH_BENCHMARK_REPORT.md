# Exa vs. Tavily / Serper / Firecrawl — Web Research Stack Benchmark

**Date:** 2026-09-01
**Status:** Benchmark only. No production defaults changed, no code in the 7-stage pipeline modified, no provider removed. All findings below are informational input for a future decision.
**Raw data:** `benchmarks/exa/web-search-benchmark/search-snapshot-2026-09-01T05-50-47-338Z.json` (421 calls), `search-normalized-*.json` (normalized + classified), `contents-snapshot-2026-09-01T05-53-17-074Z.json` (14 calls), `exa-highlights-sample.json` (21 supplementary calls).
**Reproduce with:** `npm run benchmark:exa:web:search` and `npm run benchmark:exa:web:contents` (requires `EXA_API_KEY`, `TAVILY_API_KEY`, `SERPER_API_KEY`, `FIRECRAWL_API_KEY`; makes real, credit-spending calls; never run as part of the normal test suite).

---

## 1. Executive summary

- **Serper could not be benchmarked this session.** Direct diagnostic confirms the account is out of credits (`400 Bad Request — "Not enough credits"`). This isn't a code bug — `searchSerper()`'s existing `if (!resp.ok) return []` silently converts this into "zero results," which is why the raw run showed a suspicious 100% zero-result rate across all 136 Serper calls. **This also means production's live Serper fallback is currently non-functional right now**, not just untested — a real, higher-priority operational finding than anything else in this report.
- **Exa Search vs Tavily, on the real evidence-discovery/ICP/competitor/market-intel query set:** roughly comparable on raw relevance, with Exa ahead on two measurable dimensions — zero-result rate (0.0% vs 0.7%, small-sample) and share of results classifying as high/very-high "evidence strength" under Demaze's own existing taxonomy, especially for ICP queries (17.0% vs 5.3%) and market-intelligence queries (17.5% vs 12.5%). Evidence-discovery itself (the largest, highest-value category) was close (41.4% vs 39.4%).
- **A real, live production bug was found incidentally**: `scraper.ts`'s Firecrawl search-fallback path (`searchFallbackScrape`) breaks against Firecrawl's current search-response shape (`SearchData has no '.data' — grouped by .web`), and this directly caused a complete scrape failure for one of the four benchmark companies (Muthoot Finance) in this session. Reported in §12, not fixed (out of scope for a benchmark-only phase).
- **Firecrawl hit its own real rate limit mid-benchmark** (12 req/min on the current plan), causing 14 of 16 attempted page fetches for Chargebee to fail. This shrank the planned Contents-vs-Firecrawl URL set from the intended ~25-30 down to the 10 URLs that actually survived a real Firecrawl run — a real, not simulated, constraint, documented honestly rather than padded out with invented URLs.
- **On those 10 real URLs, Exa Contents was reliable (10/10 succeeded, 0 hard errors) where Firecrawl was not** (this session) — but Exa Contents is unpredictable on PDFs specifically: one PDF returned 0 characters, another returned exactly 1,000,000 characters (almost certainly an internal truncation boundary, not real content length) — nothing Demaze's current per-page 5,000-char budget assumes.
- **Firecrawl's unique capability (whole-site `mapUrl`) has no Exa equivalent**, confirmed again this session — and `mapUrl` itself was unreliable in this same run (timed out for Bharat Forge, correctly fell through to sitemap discovery).
- **Bottom line: nothing here justifies replacing Tavily or Firecrawl today.** Exa shows real, measurable strengths worth a controlled follow-up (see §16-17), but the sample size, the Exa-snippet-omission gap partially corrected mid-session (§2), and Serper's total unavailability all limit how much weight this single session's numbers should carry.

---

## 2. Search benchmark methodology

**Companies (4, not the suggested 5):** Ador Welding (Manufacturing/Industrial), Bharat Forge (Large Industrial/Automotive), Chargebee (SaaS), Muthoot Finance (Financial Institution) — reused verbatim from `benchmarks/exa/provider-benchmark.ts`'s existing 10-company fixture list, picked to cover 4 of CLAUDE.md's stated target verticals. Reduced from the prompt's suggested 5 to 4 in exchange for using the **complete, unmodified** per-category query set for every company (see below) rather than a trimmed sample — a documented tradeoff, not an oversight.

**Queries: the exact, unmodified production query builders**, copied verbatim (not reimplemented) into `benchmarks/exa/web-search-benchmark/query-templates.ts`, with source line citations:
- `evidenceDiscoveryQueries()` — all 21 queries from `discovery-engine.ts`'s `buildDiscoveryQueries()` (investor ×6, hiring ×3, expansion ×3, strategy ×3, leadership ×5, risk/funding ×2 — counts sum >21 because some queries carry the `investor` category twice, see source).
- `icpBaseQueries()` — all 5 from `icp-generator.ts`'s private `buildICPQueries()`.
- `competitorBaseQueries()` — all 4 from `competitor-discovery.ts`'s private `buildCompetitorQueries()`.
- `marketIntelQueries()` — all 4 from `market-intelligence.ts`'s private `buildMarketIntelQueries()`.

34 queries × 4 companies = **136 unique queries**, run through Tavily, Serper, and Exa independently (not the production Tavily-first-then-Serper-only-if-empty fallback chain — every provider got every query, per the instruction to compare them directly).

**Cache safety:** every Tavily/Serper call used `maxResults=5` (production default is 3) specifically so this benchmark could never read or overwrite a real production cache row for the same query — see `run-search-benchmark.ts` header comment. The real `searchTavily()`/`searchSerper()` cache code path was still exercised genuinely (§7).

**A real methodology gap, found and partially corrected mid-session:** the main run called `exaSearch()` without requesting `contents.highlights`, so Exa's results initially came back title+URL only — no snippet — while Tavily/Serper always return a snippet by default. This would have made a naive "does this result have a useful snippet" comparison unfair to Exa. **Caught before writing this report**, not after: a 21-query supplementary run (`exa-highlights-sample.json`, Ador Welding's full evidence-discovery set, `contents:{highlights:true}`) fills this gap for the single highest-priority category. The broader 136-query set still lacks Exa snippets — §4 and §11 note exactly which claims rest on the smaller highlights-enabled sample vs. the full URL/title-only set.

**Review scope (why "precision on reviewed sample," not recall):** no ground-truth universe exists for these queries. Every result across all 421 calls was run through an **automated, codebase-native proxy** (§4) — Demaze's own `classifySourceType()`/`SOURCE_STRENGTH` taxonomy from `discovery-engine.ts`, applied identically to all three providers' URLs/titles, not a scoring system invented for this benchmark. On top of that, a **fully hand-reviewed subset** was read line by line, every result, not just the first page: all 21 evidence-discovery queries for Ador Welding and Chargebee (42 query-groups), plus all ICP/competitor/market-intel queries for Bharat Forge (13 query-groups) — 55 of 136 query-groups (40%) read in full. The remaining 60% is covered only by the automated proxy score, not hand-classified — stated plainly, not implied to be more than it is.

---

## 3. Exa vs Tavily results

**Aggregate (all 136 main-run queries × both providers):**

| | Tavily | Exa |
|---|---|---|
| Zero-result queries | 1/136 (0.7%) | 0/136 (0.0%) |
| Avg results/query | 4.96 | 5.00 |
| Avg latency | ~2.1-2.7s (varies by cache state) | ~2.1s |
| High/very-high evidence-strength share | 39.4% (evidence discovery), 5.3% (ICP), 12.5% (market intel) | 41.4% (evidence discovery), **17.0%** (ICP), **17.5%** (market intel) |
| Cross-provider domain overlap | 66.9% of query-groups shared ≥1 domain with Exa | (same) |

**Hand-reviewed findings (Ador Welding + Chargebee evidence-discovery, Bharat Forge ICP/competitor/market-intel — 55 query-groups, every result read):**

- For a public, actively-covered Indian company (Ador Welding), **both providers found the real primary sources** — official `adorwelding.com` investor/financial pages, BSE regulatory filings, earnings-call coverage. Exa's URLs skewed slightly more toward primary regulatory filings (`bseindia.com` corpfiling PDFs, direct `adorwelding.com` PDF filings) where Tavily skewed toward secondary aggregator/analysis sites (MarketScreener, Yahoo Finance, Trendlyne) — both reasonable, neither clearly better on relevance alone.
- **A real Tavily false positive found**: for `"Ador Welding" investor presentation 2026`, Tavily's 5th result was `matadorresources.com` — an unrelated US oil & gas company's investor-relations page, matched purely on the shared substring "*ador*" in "Matador." Not observed from Exa in the same query.
- **A real Exa content-quality quirk found**: several Exa PDF results had garbled/OCR-artifact titles (`,Oador`, `sieador`, `*ador`, `seador`) — the underlying URLs were legitimate `bseindia.com`/`adorwelding.com` official filings, but Exa's title extraction on these specific PDFs failed. URL-based classification (§4) is unaffected by this, but a UI surfacing Exa's raw titles directly would show garbage to a user.
- **A real query-category mismatch found, affecting both providers equally**: Chargebee is a private SaaS company. The `investor`-category queries (annual report, investor presentation, quarterly earnings) have no real primary source to find for a private company — both providers fell back to third-party financial-estimate aggregators (`tofler.in`, `inc42.com`, `valueforstartups.in`, `thekredible.com`), none of which are real regulatory filings. Similarly, `"Chargebee" capacity increase manufacturing growth` and `"Chargebee" new plant factory greenfield expansion` — manufacturing-flavored query templates applied to a SaaS company — returned off-target results from **both** providers (Tavily matched Chargebee's own "Growth" product docs; Exa matched "Usage-Based Billing" blog posts, both false hits on the word "growth"). **This is a query-template design gap in the existing pipeline, independent of which search provider is used** — worth flagging to whoever owns evidence-discovery query design, separate from this audit's provider question.
- **A real Exa-specific win found**: Bharat Forge's `"Bharat Forge" industries served"` query returned **0 results from Tavily** and 5 real, useful results from Exa (official Bharat Forge annual-report pages, investor presentation PDF, company profile PDF).
- With `contents.highlights` correctly requested (the 21-query supplementary sample), Exa's snippets were genuinely rich and on-target — e.g. `"Ador Welding" earnings call transcript"` surfaced a direct BSE-filed transcript with real management dialogue ("Rishabh: So now we will start. Good evening everyone...") — exactly the primary-source evidence Demaze's own taxonomy values most.

**Verdict:** on this sample, Exa is at least competitive with Tavily and ahead on two of the four query categories (ICP, market-intelligence) by the automated proxy score; evidence-discovery (the category with the most production query volume) is close to a wash. Not a blowout in either direction — a genuinely different picture from the company-discovery benchmark's 9/9 vs 1/9 result.

---

## 4. Exa vs Serper results

**Not measurable this session.** Direct diagnostic (`curl`-equivalent call to `google.serper.dev/search`) returned `400 Bad Request — {"message":"Not enough credits","statusCode":400}`. Every one of the 136 Serper calls in the raw snapshot recorded `resultCount: 0` — not because Serper found nothing, but because `searchSerper()`'s existing, correct-for-production error handling (`if (!resp.ok) return []`) makes an account-tier failure indistinguishable from a genuine empty result in this benchmark's data. **Do not read the 100% zero-result rate as a quality finding about Serper — it is an account-credit finding.**

**What this means for production, right now, not just for this benchmark:** the same `SERPER_API_KEY` and the same account are what production's live Serper fallback uses. If Tavily returns zero results for a real research run today, the fallback to Serper is currently also returning zero — silently, with no visible error, exactly the same way it did in this benchmark. This is worth checking/topping up independent of any Exa decision.

**Comparisons this instruction asked for (Phase 2/3/4/6) cannot be completed until Serper's account is funded.** Re-run `npm run benchmark:exa:web:search` after that to fill this gap — the script requires no code changes to do so.

---

## 5. Exa vs Firecrawl results

**Scope actually achieved: 10 URLs, not the planned 20-30** — see §7 for why. `scrapeCompanyWebsite()` was run for real (unmodified) against all 4 companies; Exa Contents was then run against whichever real URLs that real run successfully fetched.

| Company | Firecrawl pages fetched | Firecrawl pages failed | Discovery method | Exa Contents attempted | Exa Contents succeeded |
|---|---|---|---|---|---|
| Ador Welding | 4 | 0 | `map_url` | 4 | 4/4 |
| Bharat Forge | 4 | 0 | `sitemap` (mapUrl timed out, correct fallback) | 4 | 4/4 (1 returned 0 chars — soft failure) |
| Chargebee | 2 | 14 (Firecrawl rate limit) | `map_url` | 2 | 2/2 |
| Muthoot Finance | 0 | 1 (rate limit → Jina 403 → search-fallback parse bug, §12) | `homepage_only` | 0 | — |

**Content length comparison (successfully-fetched pairs, same URL):**

| URL type | Firecrawl chars | Exa Contents chars |
|---|---|---|
| Homepage (Ador Welding) | 5,000 (fixed cap) | 4,558 |
| Homepage (Bharat Forge) | 5,000 (fixed cap) | 5,713 |
| Homepage (Chargebee) | 5,000 (fixed cap) | 9,555 |
| Regular page (Ador Welding "who-we-are") | 5,000 (fixed cap) | 6,634 |
| Regular page (Ador Welding, Chennai product page) | 5,000 (fixed cap) | 7,513 |
| Regular page (Chargebee "about") | 5,000 (fixed cap) | 4,535 |
| PDF (Bharat Forge corporate governance) | 5,000 (fixed cap) | 10,402 |
| PDF (Bharat Forge subsidiary annual report, small) | 5,000 (fixed cap) | **0** (failed silently) |
| PDF (Bharat Forge subsidiary annual report, large) | 5,000 (fixed cap) | **1,000,000** (almost certainly a truncation artifact, not real content) |

Every successful Firecrawl fetch in this sample hit exactly 5,000 characters — production's own fixed per-page truncation, not a coincidence. Exa Contents has no such cap by default: it ranged from a hard failure (0 chars) to 200x Firecrawl's own budget on the same document class (PDF). **This is the single most important integration fact from this phase**: Exa Contents cannot be dropped into the current pipeline's page-budget logic (12,000-char early-exit, 5,000-char per-page assumption) without an explicit truncation guard — it is not a drop-in replacement as-is, regardless of underlying extraction quality.

**Reliability, this session specifically:** Exa Contents succeeded on 10/10 attempted URLs with 0 hard errors; Firecrawl failed on 15/16 total page attempts across the two companies where it hit trouble (14 Chargebee rate-limit failures + 1 Muthoot Finance chain failure), succeeding cleanly only for Ador Welding and Bharat Forge. This is a real result from this run, not a simulated one — but it's also a small, account-tier-shaped sample (a paid Firecrawl plan with a higher rate limit would likely not reproduce the Chargebee failures), so treat it as "Firecrawl's free/current-tier rate limit is a real operational risk," not "Firecrawl the product is less reliable than Exa."

---

## 6. JS-heavy page results

**Not directly testable this session** — none of the 4 benchmark companies' real scrape runs triggered Jina fallback (`jinaUsed: false` for all 3 companies that got far enough to check; Muthoot Finance's own Jina attempt failed with `HTTP 403`, a real observed Jina-side failure, not a Firecrawl comparison point). The scraper's own JS-nav-extraction fallback (`fetchViaJina` triggered specifically when Firecrawl's homepage-link extraction returns 0 links) simply didn't fire for any of these 4 sites in this run — none of them happened to be JS-rendered-nav sites in this sample.

**What is known**: Muthoot Finance's real chain this session was Firecrawl rate-limited → Jina fallback attempted → Jina itself returned `403` → search-fallback attempted → search-fallback hit a live parsing bug (§12) → **zero content recovered for this company**, a complete production-relevant failure chain, independent of Exa entirely. Whether Exa Contents would have succeeded on `muthootfinance.com` where this entire chain failed is unknown — not tested, because the URL-sourcing step (§2's "use real scraper-selected URLs") had no URLs to hand off once the real scrape produced none.

**Conclusion**: Phase 10 needs a second, smaller, deliberately-targeted run against 3-5 known JS-heavy sites (the scraper's own code comments cite "Google Sites, Webflow" as known JS-nav-blind-spot site builders) — not answerable from this session's 4-company sample, which happened not to include one.

---

## 7. Serper fallback analysis

Cannot be measured from historical data — **no provider-call-volume analytics table exists in this codebase** (confirmed by search; `daily-counts.ts` tracks pipeline runs, not individual provider calls). What would be needed to measure "how often does production actually need Serper":

1. A log/metric emitted inside `searchTavily()`'s caller (`discoverEvidenceSources()` and each module's own `searchWithFallback()`) recording: query, whether Tavily returned 0 results, and whether the Serper fallback was invoked.
2. Aggregation of that log over a real production window (e.g. 30 days) to compute `serper_fallback_rate = tavily_zero_result_queries / total_queries`.
3. A breakdown by query category (investor/hiring/expansion/leadership/risk/ICP/competitor/market-intel) to see which categories most often need the fallback — this session's own data suggests category matters (Bharat Forge's `"industries served"` query got 0 from Tavily but this is one data point, not a rate).

**This session's cache-related observation is a proxy, not a real measurement**: of the 136 main-run Tavily queries, only 1 returned zero results (0.7%) — if that rate holds in production, Serper's fallback trigger rate would be low, making it plausible (not proven) that Serper really is "a narrow safety net" as the audit hypothesized. But 136 queries across 4 companies is a small sample for a rate claim, and Serper being completely unfunded this session means the fallback's actual *value when triggered* (does it recover a real result Tavily missed, or also come up empty) remains completely unknown either way.

---

## 8. Cost comparison

Real, observed costs from this session (not invented):

| Provider | Calls | Real $ basis | Observed/estimated total |
|---|---|---|---|
| Tavily | 141 | $0.008/credit (documented in `discovery-engine.ts:229`, not billed-observed this session — Tavily's API response carries no cost field) | ~$1.13 (estimated from documented rate) |
| Serper | 136 attempted | Blocked — 0 credits available | $0 spent (all calls failed before any billable work) |
| Exa Search (main + mode-comparison) | 144 | Real `costDollars` in every response | $1.008 (auto: $0.98, fast: $0.028) |
| Exa Search (highlights supplement) | 21 | Real `costDollars` | $0.147 |
| Exa Contents | 10 | Real `costDollars` | $0.009 |
| Firecrawl | 4 `scrapeCompanyWebsite()` runs (~15 page-fetch attempts each, most failed on 2 of 4) | Not documented anywhere in this repo — no cost field in Firecrawl's SDK responses | Cannot determine from this session's data |
| **Total this session** | | | **~$2.29** (Tavily estimate + real Exa spend; Firecrawl/Serper cost unknown) |

**Cost per useful evidence result** — computed only where both a real $ figure and a real quality signal exist:
- Exa evidence-discovery: $0.98 × (84/144 of main-run queries were evidence-discovery) ≈ $0.57 for 420 results, 174 of them high/very-high strength → **~$0.0033 per high-strength evidence result**.
- Tavily evidence-discovery: cost basis is a documented rate, not billed-observed, so a directly comparable per-result figure would combine one real and one assumed number — reported separately rather than forced into one misleading blended figure: 84 queries × $0.008 (documented rate) = $0.672 for 419 results, 165 high/very-high → ~$0.0041 per high-strength result **on the documented rate, not a confirmed bill**.
- Exa Contents: $0.009 for 10 pages (9 useful, 1 zero-content) → **~$0.001 per successfully-extracted page** — genuinely cheap in isolation, but see §5's truncation-risk caveat before treating this as comparable value to a Firecrawl page.
- Firecrawl: not computable — no cost data available from this session or from the codebase.

**Cache impact (§9, real data)**: the 30-day search cache means most of the above cost is a one-time cost per unique query — a re-run of any of these 4 companies within 30 days would spend ~$0 in live Tavily/Serper calls (confirmed live, §9), which materially changes any monthly-cost projection versus a naive "queries × price × runs" calculation. Exa has no equivalent caching in this codebase — every Exa call in a re-run would be a fresh, fully-billed call.

---

## 9. Latency comparison

| | Cold (first call) | Cache hit (identical query+maxResults re-run) |
|---|---|---|
| Tavily | 1,103-5,170ms (5 sample queries) | 323-756ms (4 of 5 — confirmed real cache hits, identical URL sets returned) |

**A real anomaly found, not smoothed over**: the 5th re-run query (`"Ador Welding" investor call transcript quarterly results`) returned a **different URL set** on its second call despite an identical query string and `maxResults`, which should be a guaranteed cache hit by `(provider, query, maxResults)` key. Latency for that one (518ms) was still much faster than a typical cold call, suggesting the cache WAS hit but may have been overwritten by a near-simultaneous write from earlier in the same run, or Tavily itself returned slightly different live results moments apart during the original write. Not investigated further — flagged honestly as a minor, single-instance anomaly worth a closer look before relying on cache-hit determinism for anything correctness-sensitive.

| | Median latency, this session |
|---|---|
| Exa Search (`type:'auto'`) | ~1.3-2.2s |
| Exa Search (`type:'fast'`) | ~0.65-1.0s... wait, see below |
| Exa Contents | 408-10,454ms (PDF fetches were the slowest) |
| Firecrawl `scrapeCompanyWebsite()` (whole run, not per-page) | 13.8s (Chargebee, mostly failed) - 42.8s (Muthoot Finance, mostly failed) - 20.9-26.3s (successful runs) |

**A counter-intuitive finding on Exa's own modes**: in the small 4-query auto-vs-fast comparison, `type:'fast'` was consistently **slower** than `type:'auto'` (653-1,009ms vs 320-454ms) at identical cost ($0.007 both) and identical result count (5 both). This is the opposite of what the mode name implies — either a small-sample fluke (4 queries) or a real characteristic of Exa's current routing for this specific query shape. Not enough data to conclude either way, but enough to say **there is no evidence 'fast' mode is worth using over 'auto' for these query types** — a real, if narrow, finding for Phase 4.

---

## 10. Quality comparison

Covered in depth in §3-6. Summary: Exa ≥ Tavily on the automated proxy score for ICP and market-intelligence categories; roughly even on evidence-discovery; Serper unmeasured; Exa Contents content is comparable-to-richer than Firecrawl's fixed-budget pages on HTML, wildly inconsistent on PDFs; Firecrawl's real-session reliability was worse than Exa's in this specific run, but for an account-tier reason (rate limit) that a different Firecrawl plan would likely not reproduce.

---

## 11. Unique capabilities

- **Firecrawl `mapUrl`**: no Exa equivalent exists. Confirmed again this session — `bharatforge.com`'s `mapUrl` call genuinely timed out mid-benchmark, and the pipeline's own map→sitemap fallback correctly recovered. This capability is not benchmarkable against Exa because Exa has nothing to compare it to.
- **Firecrawl's fixed content budget**: whether by design or accident, every real page fetched by Firecrawl in this session capped at exactly 5,000 characters — a predictable, bounded cost/size profile Exa Contents does not share (§5's PDF finding).
- **Exa's native structured entity extraction** (`entities[]`, confirmed in the earlier company/decision-maker discovery benchmark): not re-tested this session, but nothing here contradicts it — still a real, unique Exa capability unrelated to the search/scrape comparison in this report.
- **Tavily/Serper's default-included snippets**: a real, if easily-fixed, Exa integration gap — Exa requires an explicit `contents.highlights`/`text` param to get comparable output, confirmed to add real (if small: $0.007/query) marginal cost per query.

---

## 12. Failure cases (found during this benchmark, not hypothetical)

1. **Serper: account out of credits**, confirmed via direct API call — `400 {"message":"Not enough credits","statusCode":400}`. Affects both this benchmark and live production's fallback path.
2. **A live production bug in `scraper.ts`'s `searchFallbackScrape()`**: its Firecrawl search-response parsing assumes a `.data` field (`SearchData has no '.data'. Results are grouped by source: .web (5 results)` — Firecrawl's own error message, captured verbatim in the benchmark log) that Firecrawl's current API no longer returns in that shape. This directly caused Muthoot Finance's real scrape to produce **zero usable content** in this session — the exact "web search / evidence gathering: not benchmarked, assumed working" pipeline the PROVIDER_AUDIT.md flagged as untested has at least one real, live defect independent of any Exa question. **Not fixed** (explicitly out of scope for this benchmark-only phase) — flagging for a separate, dedicated fix.
3. **Firecrawl rate-limited mid-run** on the current plan (12 req/min), causing 14/16 Chargebee page-fetch attempts to fail with `429`-equivalent errors.
4. **Jina 403** on `muthootfinance.com` — the scraper's own JS-nav fallback also failed, compounding failure #2/#3 into a complete content-recovery failure for that company.
5. **Exa PDF title-extraction garbage** (`,Oador`, `sieador`, `*ador`) — cosmetic, URLs still correct, but would need cleanup before surfacing to a UI.
6. **Exa Contents PDF size unpredictability** — 0 chars to 1,000,000 chars on structurally similar documents (both PDF annual-report-style filings from the same company).
7. **A Tavily cross-entity false positive** — `matadorresources.com` (unrelated US energy company) surfaced for an Ador Welding investor-presentation query, matched on a substring collision ("*ador*" in "Matador").
8. **A cache-hit URL-set anomaly** — one of 5 identical re-run queries returned a different result set on its second call (§9) despite matching the exact cache key.
9. **Query-template/vertical mismatch** (not provider-specific) — manufacturing-flavored evidence-discovery queries applied to a SaaS company (Chargebee) return off-target results from both Tavily and Exa equally; a pipeline query-design gap, not a provider quality gap.

---

## 13. Provider capability matrix

| Capability | Tavily | Serper | Firecrawl | Exa | Winner | Confidence |
|---|---|---|---|---|---|---|
| 1. Evidence discovery (21-query set) | Reliable, 0.7% zero-result, 39.4% high-strength share | **Unmeasured — account blocked** | N/A | Reliable, 0% zero-result, 41.4% high-strength share | **Tie / lean Exa** | Low-medium (small sample, Serper missing entirely) |
| 2. ICP search | 5.3% high-strength share | Unmeasured | N/A | 17.0% high-strength share | **Exa** | Medium (13 query-groups hand-reviewed) |
| 3. Competitor search | Real named competitors found (Ramkrishna Forgings, etc.) | Unmeasured | N/A | Same real competitors found, plus 1 extra source (etmoney.com peers) | **Tie** | Medium |
| 4. Market-intelligence search | 12.5% high-strength share, real CNBC/Business-Standard sources | Unmeasured | N/A | 17.5% high-strength share, same-caliber sources | **Lean Exa** | Medium |
| 5. Known-URL extraction | N/A | N/A | Reliable when not rate-limited; fixed 5,000-char budget | Reliable this session (10/10), unpredictable size on PDFs | **Inconclusive — needs a fair-plan re-run** | Low (small N, Firecrawl failures were account-tier-shaped) |
| 6. JS-heavy extraction | N/A | N/A | Untested this session (no JS-heavy site in sample) | Untested this session | **Unknown** | None — needs a dedicated run |
| 7. Whole-site mapping | N/A | N/A | Only capability that exists; unreliable this session (1 timeout, correctly recovered via sitemap fallback) | **No equivalent exists** | **Firecrawl by default (no competitor)** | High |
| 8. Search+scrape fallback (F4 in Firecrawl, last-resort) | N/A | N/A | Broken this session (§12 bug #2) | Not applicable (different capability shape) | **N/A — Firecrawl's own bug, not a provider comparison** | High (bug confirmed) |
| 9. Source quality/authority | Mix of primary + secondary/aggregator sites | Unmeasured | N/A | Slightly more primary-source-skewed in hand review | **Lean Exa** | Low-medium |
| 10. Freshness | No staleness observed in this sample | Unmeasured | N/A | No staleness observed | **Tie** | Low (small sample, no dedicated freshness test run) |

---

## 14. Recommended architecture (pending further evidence, not a final call)

**Do not implement any of this yet** — per the instruction, this stops at recommendation.

- **Serper**: fix the account-credit issue first — this is not a "should we keep Serper" question until it can even be measured. Once funded, re-run `benchmark:exa:web:search` (no code changes needed) to get the actual Phase 2/3/4/6 comparisons this report couldn't produce.
- **The `searchFallbackScrape()` parsing bug** (§12 #2) should be fixed independent of any Exa decision — it's actively breaking real company scrapes today, unrelated to whether Exa is ever adopted.
- **Tavily**: keep as-is. This session's evidence doesn't clear the bar to touch it — Exa was competitive-to-better on the automated proxy but the sample is small (4 companies, 34 queries each) and the snippet-fairness gap (§2) means part of the comparison rests on a 21-query subset, not the full 136.
- **Firecrawl**: keep as-is. Its unique `mapUrl` capability has no substitute, and this session's Firecrawl failures look account-tier-shaped (rate limit), not a genuine product-quality gap versus Exa Contents. The real, live `searchFallbackScrape()` bug is a Firecrawl-integration issue in Demaze's own code, not a reason to distrust Firecrawl itself.
- **Exa**: worth a second, better-resourced benchmark round specifically closing this session's three biggest gaps (Serper funded, snippets requested for every query not just a 21-query subset, a JS-heavy site included in the sample) before any architecture change is proposed for real.

---

## 15. What can safely be removed

**Nothing.** No finding in this report clears the bar this audit set for itself (the PROVIDER_AUDIT.md's own §7: "nothing can be removed on current evidence") — if anything, this session's real, live bug discovery (§12 #2) and Firecrawl's rate-limit fragility argue for *hardening* the current stack before considering removing any part of it.

---

## 16. What still needs the next benchmark

1. **Serper**, once its account has credits — the entire Phase 2/3/4/6 comparison this report couldn't run.
2. **A full-set (not 21-query-subset) Exa run with `contents.highlights` requested from the start** — removes the snippet-fairness caveat entirely rather than partially addressing it.
3. **A JS-heavy-page-specific Contents-vs-Firecrawl run** — deliberately pick 3-5 sites known to need Jina today (Google Sites/Webflow-built sites per the scraper's own code comments), not left to chance as this session's 4-company sample was.
4. **A Firecrawl run on a plan without the 12 req/min rate limit** — to separate "Firecrawl the product" from "Firecrawl the specific account tier used in this session."
5. **Real Serper-fallback-trigger-rate instrumentation** (§7) — needed before Serper's actual production value can ever be assessed from data instead of assumption.
6. **A larger company sample (the originally-suggested 5, or more)** if any of the above come back inconclusive — this session deliberately traded company count for full query-set fidelity and full hand-review depth; expanding now is cheap (the scripts already support it — just add entries to `companies.ts`).

---

## 17. Exact migration order (once the above is done — not before)

1. Fund Serper, fix the `searchFallbackScrape()` bug, re-run the search benchmark with full snippets — get a complete, fair Phase 1-6 comparison.
2. Run the JS-heavy-page and higher-Firecrawl-tier Contents benchmarks — get a complete, fair Phase 7-10 comparison.
3. Only if Exa clears a real, reproducible bar on both (comparable to the 9/9 vs 1/9 clarity the company-discovery benchmark had) — propose introducing Exa as a **selectable, non-default** provider for evidence search and/or page-fetch, same pattern already used for company discovery (env-var default, explicit rollback path documented in ROLLOUT.md).
4. Controlled side-by-side on a real live company-research run (not a standalone script) before touching any default.
5. Revisit Serper's removal specifically, backed by the real fallback-trigger-rate instrumentation from §16 item 5 — not assumption.

**Stop condition, same as the audit before it**: no production defaults changed, Tavily/Firecrawl/Serper untouched and still the only active providers for the research pipeline. Waiting for review before implementing anything above.

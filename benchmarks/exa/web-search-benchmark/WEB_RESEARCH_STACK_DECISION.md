# Web Research Stack Decision

**Date:** 2026-09-01
**Status:** Analysis only. No new live API calls made — this reuses `WEB_RESEARCH_BENCHMARK_REPORT.md`'s existing evidence, `PROVIDER_AUDIT.md`'s call-site trace, and direct reading of the current (post-Serper-removal, post-Firecrawl-fix) production code.
**What already shipped this session** (see `docs/DECISIONS.md`): Serper removed completely; `searchFallbackScrape()`'s real `.data`-getter-throws bug fixed with a regression test; `searchTavily()` now logs a distinct warning on failure vs. genuine zero-result. Nothing else in production changed. This document is the requested capability analysis — it recommends, it does not implement, anything beyond that.

---

## 1. Current Stack

```
Tavily (primary search)
  → (no fallback — Serper removed 2026-09-01)
       ↓
Firecrawl (scrape / map / search-as-last-resort)
  → Jina (3 distinct roles — see §6)
       ↓
pdf-parse (PDFs, never Firecrawl/Jina)
       ↓
7-stage research pipeline
```

Separately, already decided and live (not in question here): **Exa** is primary for company discovery and decision-maker discovery; **Prospeo** is primary for email finding and contact enrichment (Exa as a rare, selective enrichment supplement). This document is only about the **web search / evidence / page-extraction** side of the stack — the part `ROLLOUT.md` explicitly left untouched and unbenchmarked until `WEB_RESEARCH_BENCHMARK_REPORT.md`.

---

## 2. What Serper Removal Changes

- **Nothing behavioral changes for a healthy Tavily.** Serper only ever fired when Tavily returned zero results — and it turned out to already be non-functional (out of credits) at the time it was removed, so its removal is closer to "stopped pretending a broken fallback existed" than "removed a working safety net."
- **What's actually lost**: whatever fraction of Tavily-zero-result queries Serper would have recovered, if its account had been funded and if it would have found something Tavily didn't. This was never measured (§16 of the benchmark report) — it's an honest unknown, not a proven-zero loss.
- **A real gap closed in the same pass**: `searchTavily()` failures are no longer silently indistinguishable from genuine zero-result queries (now logged distinctly) — this makes a *future* Tavily-side outage visible in logs even with no second provider to fall through to, which is a net reliability improvement independent of Serper.
- **No fallback provider was added to replace Serper's slot.** Every search-calling module (`discoverEvidenceSources`, `website-discovery.ts`, `icp-generator.ts`, `competitor-discovery.ts`, `market-intelligence.ts`, `linkedin-search.ts`) is now Tavily-only, full stop. Whether that slot should ever be filled (by Exa or anything else) is exactly what §5 below investigates.

---

## 3. Capability Matrix

| Capability | Exa | Tavily | Firecrawl | Jina | Current Owner | Recommended Owner |
|---|---|---|---|---|---|---|
| A. Web search / evidence discovery | Untested on this exact 21-query set at full fidelity (snippet gap, see benchmark §2); automated proxy score comparable-to-ahead | Current, reliable, 0.7% zero-result in benchmark | ✗ (its own `search()` is last-resort scrape-fallback only, not evidence discovery) | ✗ | **Tavily** | **Tavily** — no proven case to change yet |
| B. ICP research | Ahead on automated proxy (17.0% vs 5.3% high-strength share) | Current | ✗ | ✗ | **Tavily** | **Tavily**, pending a full (non-subset) fair comparison — see §16 |
| C. Competitor research | Roughly tied in hand review | Current | ✗ | ✗ | **Tavily** | **Tavily** |
| D. Market intelligence | Ahead on automated proxy (17.5% vs 12.5%) | Current | ✗ | ✗ | **Tavily** | **Tavily**, same caveat as B |
| E. Known-URL extraction | Reliable in this session's small sample (10/10 succeeded); PDF size unpredictable (§8) | ✗ | Current, reliable when not rate-limited; fixed ~5,000-char/page budget | ✗ (Jina's role here is JS-rendering, not general extraction — see §6) | **Firecrawl** | **Firecrawl**, Exa Contents a documented candidate once §8's normalization question is answered |
| F. Whole-site URL discovery (`mapUrl`) | **No equivalent exists** | ✗ | Current, only option | ✗ | **Firecrawl** | **Firecrawl** — not a real choice, no alternative |
| G. Whole-site crawling | **No equivalent exists** | ✗ | Current (via `mapUrl` + sitemap discovery) | ✗ | **Firecrawl** | **Firecrawl** |
| H. JS-heavy website extraction | Never tested (no JS-heavy site landed in the 4-company sample) | ✗ | Partial — depends on Firecrawl's own JS rendering, which the code's own comments say is incomplete (hence Jina existing at all) | Current, purpose-built for this | **Jina** (supplement to Firecrawl) | **Jina**, pending the dedicated test §16 calls for |
| I. PDF extraction | Untested for reliability at scale; one 0-char and one suspicious-1,000,000-char result in the benchmark | ✗ | Explicitly documented as unreliable on raw PDFs (that's *why* pdf-parse exists) | ✗ | **pdf-parse** (neither Firecrawl nor any of the other three) | **pdf-parse** — out of scope for this whole comparison |
| J. Search fallback (when Tavily/primary search fails) | Not wired anywhere as a search fallback today | N/A (is the primary) | `searchFallbackScrape()` is Firecrawl's *own* internal scrape-recovery mechanism (see §7), not a general search-provider fallback | ✗ | **None** (Serper's old slot is empty) | **Leave empty** — no evidence justifies filling it yet (§5) |
| K. Page-extraction fallback (when Firecrawl scrape fails) | Not wired in today | ✗ | N/A (is the primary) | **Current**, 3 distinct roles (§6) | **Jina** | **Jina** |
| L. Structured company/entity extraction | **Current, unique** — native `entities[]` on company/people search, confirmed live and richer than any synthesis-only approach | ✗ | ✗ | ✗ | **Exa** | **Exa** — not contested, unrelated to this document's open questions |

---

## 4. Exa vs Tavily

### What Tavily-specific capability does Demaze actually use today?

Every one of Tavily's 6 call sites (`discovery-engine.ts`, `website-discovery.ts`, `icp-generator.ts`, `competitor-discovery.ts`, `market-intelligence.ts`, `linkedin-search.ts`) uses it identically: a keyword/quoted-phrase query string in, a list of `{title, url, content}` snippet results out, cached 30 days by `(provider, query, maxResults)`. There is no Tavily-specific feature (no domain filter, no date filter, no special query syntax) actually exercised anywhere in this codebase — every caller could, mechanically, swap in any provider returning the same `{title, url, content}[]` shape without changing its own logic.

**So "what would we lose if Tavily were removed" is really "what would we lose if Exa's search quality is worse for these specific queries" — not an integration-capability question, a data-quality one.**

### What the benchmark evidence actually supports, and what it doesn't

| Claim | Evidence level |
|---|---|
| Exa's zero-result rate is lower (0.0% vs 0.7%) | **Confirmed**, full 136-query sample |
| Exa's automated evidence-strength proxy score is higher on ICP/market-intelligence queries | **Confirmed**, full 136-query sample, using Demaze's own `classifySourceType()` taxonomy applied identically to both |
| Exa's automated evidence-strength proxy score is roughly tied on evidence-discovery (the largest, most-queried category) | **Confirmed**, full 136-query sample |
| Exa's actual snippet/content usefulness is comparable to Tavily's | **UNKNOWN at full scale** — the main 136-query run never requested Exa's `contents.highlights`, so most of the sample has URL/title only. A 21-query supplementary run (Ador Welding, evidence-discovery category only) with highlights requested showed genuinely rich, on-target snippets (a real BSE-filed transcript with direct management quotes) — but that's 21 of 136 query-groups, not the whole set. |
| Exa handles a company/vertical with no real primary-source disclosures (a private SaaS company) any better than Tavily | **UNKNOWN — evidence says NO difference.** Both providers returned equally off-target results for Chargebee's investor-category and manufacturing-flavored queries. This is a query-template design issue, not a provider quality gap either way. |
| Exa is cheaper per useful result | **Roughly UNKNOWN** — Tavily's cost basis in this repo is a documented flat rate ($0.008/credit), not a billed-observed figure; Exa's is real observed `costDollars`. The two aren't on equal footing for a direct $-comparison (benchmark report §8 flags this explicitly). |
| Exa is faster | **Roughly tied**, small-sample (~1.3-2.2s Exa vs ~2.1-2.7s Tavily, but Tavily's cache-warm calls skew this comparison — not apples-to-apples without controlling for cache state on both sides, which wasn't done). |

### Verdict

**Nothing here clears a "replace Tavily" bar.** The company-discovery and decision-maker-discovery decisions each had a stark, repeated, multi-angle result (9/9 vs 1/9; 10/10 vs 2/10) — this comparison has a mild, single-session lean toward Exa on 2 of 4 query categories and a tie on the rest, with a real methodology gap (snippets) only partially closed. That's evidence worth a proper follow-up, not evidence that justifies a default change.

---

## 5. Exa vs Firecrawl

The prompt's own framing is right: **this is two separate questions, and conflating them is exactly the mistake to avoid.**

### Single-page extraction (known URL → content)

- Firecrawl: `client.scrape(url)` (or the deprecated `scrapeUrl()` in `website-discovery.ts` — noted as a pre-existing debt, not touched by this document). Fixed ~5,000-char-per-page budget, confirmed in this session's own real scrape runs (every successful Firecrawl page fetch capped at exactly 5,000 chars — production's own truncation, not a coincidence).
- Exa: `exaGetContents()` — exists in `lib/enrichment/sources/exa-client.ts`, **zero production callers today**. In this session's 10-URL sample: 10/10 succeeded (0 hard errors), content length ranged 3,302-9,555 chars on HTML pages (comparable-to-richer than Firecrawl's fixed budget) but wildly inconsistent on PDFs (0 chars on one, exactly 1,000,000 on another — almost certainly a truncation artifact, not real content).
- **This is the one place Exa Contents is a real, evidence-backed candidate to supplement or replace a Firecrawl call** — but only after §8's normalization question is answered, and only re-tested at a larger, non-rate-limited scale (this session's Firecrawl failures were real but plan-tier-shaped, not necessarily representative of a properly-provisioned account).

### Site mapping / crawling / whole-site discovery

- Firecrawl: `client.mapUrl(baseUrl)` — the **primary URL-discovery mechanism** in `scraper.ts`, confirmed still load-bearing this session (used for 2 of 4 benchmark companies; timed out for a 3rd, correctly falling through to sitemap discovery — the fallback chain itself worked, but `mapUrl` unreliability is real and observed, not hypothetical).
- Exa: **nothing**. No site-map, no crawl, no bulk-URL-discovery endpoint exists in Exa's API surface as used by this codebase or documented in `exa-client.ts`.
- **This capability cannot be consolidated onto Exa. Full stop, not "pending more evidence."** Any recommendation that touches Firecrawl must leave this capability with Firecrawl.

### Does the current pipeline actually need mapUrl/sitemap/crawl/page-discovery?

**Yes, unambiguously.** `scrapeCompanyWebsite()`'s entire page-selection pipeline (`selectUrlsToScrape()`, `classifyUrl()`, the up-to-15-page cap, the 12,000-char early exit) operates on the URL list `mapUrl`/sitemap/homepage-links produces. There is no path in the current architecture that researches a company without first discovering *which* pages on their site are worth fetching — that discovery step has no Exa equivalent. Removing Firecrawl would require redesigning this entire stage, which is explicitly out of scope (`Do not redesign the scraper`).

### JS rendering

Covered in §6 — this is Jina's role, not something either Firecrawl or Exa Contents was shown this session to own outright. Firecrawl's own comments (`scraper.ts`) acknowledge incomplete JS-nav-link visibility; Exa Contents' JS-rendering behavior was never tested this session (no JS-heavy site in the 4-company sample).

### Verdict

**Firecrawl stays, full stop, for mapping/crawling — no serious argument otherwise.** For single-page extraction specifically, Exa Contents is a real, if unproven-at-scale, candidate — worth a dedicated follow-up benchmark (§16), not a switch today.

---

## 6. Jina

### Every usage, traced directly in `lib/pipeline/scraper.ts`

Jina is **not** a single fallback-of-last-resort — it has three distinct, separately-triggered roles:

1. **Tier-1 full-scrape rescue** (`jinaFullScrape()`, called at scraper.ts line ~1071): triggered when Firecrawl's homepage scrape *fails outright*. Fetches the homepage plus up to 5 high-value paths via `r.jina.ai`.
2. **JS-rendered nav-link extraction supplement** (`fetchViaJina()` on just the homepage, line ~1146): triggered when Firecrawl's homepage scrape *succeeds* but returns **zero same-domain links** — a real, specific JS-rendered-navigation blind spot the code's own comments name (Google Sites, Webflow). Jina renders the page's JS and its links become extractable from the resulting markdown; this is the ONE role that is genuinely, structurally different from anything Firecrawl or Exa Contents does in this codebase today.
3. **Final content-quality rescue** (`jinaFullScrape()` again, line ~1303): triggered when the fully-selected-and-scraped result is still under 800 total characters — a last "did we actually get anything useful" check.

### Is it essential, fallback-only, redundant, or dead?

**Fallback-only, but genuinely load-bearing, not dead and not redundant.** It never runs on a healthy Firecrawl scrape (confirmed: none of this session's 4 real scrape runs triggered Jina — `jinaUsed: false` for all 3 that got far enough to check). But role #2 (nav-link extraction) has no substitute anywhere else in the current pipeline — if Jina were removed, a JS-rendered-nav site where Firecrawl's homepage scrape "succeeds" (200 OK, some markdown) but surfaces 0 links would have literally no page-discovery path left except `mapUrl`, and `mapUrl` was itself shown this session to be unreliable (timeout on 1 of 4 companies).

### Did it fail this session? Does that mean remove it?

**No — the one Jina failure observed (Muthoot Finance, `HTTP 403`) is not evidence Jina is broken; it's one data point in a chain where Firecrawl had already failed for an unrelated reason (rate limit) and the pipeline's OWN search-fallback then hit the real bug fixed in §2 of `docs/DECISIONS.md`.** Removing Jina because it 403'd once, on a site where the primary provider was also failing, would be exactly the kind of small-sample overreaction the prompt itself warns against ("do not remove it simply because it failed once").

### What's still unknown, and what evidence would resolve it

**JS-heavy-page coverage was never properly benchmarked** — none of the 4 companies in the search/contents benchmark happened to be a JS-rendered-nav site, so role #1 and role #2 above have zero head-to-head data against Exa Contents in this session. To make a real decision:

1. A dedicated 3-5 site sample specifically chosen for known JS-heavy navigation (Google Sites/Webflow-built sites per the scraper's own code comments — these are namable, findable targets, not hypothetical).
2. Run Firecrawl scrape → Jina fallback (current path) vs. Exa Contents directly on the same URLs, checking specifically whether Exa Contents' response actually contains the JS-rendered content (not just "did the call succeed" — the same "both returned markdown" trap the original benchmark spec warned against for Firecrawl).

**Until that exists, Jina's unique role (#2 specifically) is unproven-but-plausible, not proven — keep it, don't expand or shrink its role.**

---

## 7. Duplication

Capabilities currently handled by more than one provider:

| Capability | Providers involved | Why the duplication exists | Necessary? | Recommended owner |
|---|---|---|---|---|
| Search-and-scrape-as-last-resort | Firecrawl (`searchFallbackScrape`, F4) vs. Tavily/Exa (general search) | Historical accretion, not a designed overlap — F4 is a narrow path inside `scraper.ts` triggered only when direct scraping fails, structurally unrelated to `discovery-engine.ts`'s evidence search | Low-priority duplication, not urgent — F4 serves a different purpose (rescue a failed scrape, not discover new evidence URLs) even though both ultimately call a "search" endpoint | **Firecrawl for this specific narrow role** (it already has the client instantiated, no reason to add a second provider dependency for a rare rescue path) |
| Page rendering for JS-heavy content | Firecrawl (own JS handling, incomplete per its own code comments) vs. Jina (purpose-built) | Genuine capability gap in Firecrawl that Jina fills — not redundant, complementary | **Necessary** — see §6 | **Jina**, supplementing Firecrawl, as today |
| Homepage-identity confirmation for a candidate domain | `website-discovery.ts`'s plain `fetch()` (primary) vs. Firecrawl's deprecated `scrapeUrl()` (fallback when plain fetch fails) | Plain fetch has no anti-bot/JS handling; Firecrawl is the reliability upgrade for the rare case it's needed | **Necessary**, but uses a **deprecated SDK method** — a real, separate cleanup item (not touched by this document, flagged for a future session) | **Firecrawl**, but migrate off `scrapeUrl()` to `scrape()` when next touched |
| General web search | Tavily (primary, everywhere) vs. Exa (proven for company/people entity search, unproven for this workload) | Not currently duplicated in production — Exa is not wired into any of Tavily's 6 call sites today. The "duplication" here is only a future risk if Exa were added as a second search provider without removing Tavily first | **N/A — not actually duplicated today** | **Tavily**, until/unless §16's follow-up benchmark changes this |

**No genuine, currently-live duplication was found where two providers do the identical job on the identical call path today** — Serper was the one real case of that, and it's now removed.

---

## 8. Fixing the Exa Contents size problem (analysis only — not implemented)

The benchmark found real, reproducible unpredictability: 0 chars on one PDF, 1,000,000 chars on a structurally similar one, vs. Firecrawl's own reliable fixed ~5,000-char-per-page budget baked into the current pipeline's assumptions (the 12,000-char early-exit logic in `scrapeCompanyWebsite()`, the per-page truncation).

**Where the normalization boundary belongs, per the existing architecture:** the prompt's own suggested shape is correct and matches how this codebase already treats every other provider —

```
raw provider result (exaGetContents(), full fidelity, untouched)
  → a normalization/truncation step, analogous to how scraper.ts's own
    scrapeSinglePage()/cleanMarkdown() already caps Firecrawl's own output,
    NOT inside exa-client.ts itself (exa-client.ts's own header comment is
    explicit that it "only owns: auth, request shaping, response typing,
    error handling" — no business logic, matching the split already used
    for Prospeo/Explee/every other source client in this repo)
  → existing pipeline (whatever eventually calls it — no caller exists yet)
```

This means: **if/when Exa Contents is ever wired into a real call site**, the truncation/normalization belongs in that call site's own adapter (the same pattern `exa-company-discovery.ts`/`exa-outbound-client.ts` already use — a thin adapter file per feature, not logic inside `exa-client.ts`), not as a change to `exa-client.ts` itself. Since **no such call site exists in production today** (confirmed: `exaGetContents` has zero callers), there is nothing to narrowly-scope a fix onto right now — this section documents *where the fix would go*, per the instruction not to implement a broad rewrite for a capability that isn't wired in yet.

---

## 9. Cost Matters

Reusing `WEB_RESEARCH_BENCHMARK_REPORT.md` §8's real numbers (Firecrawl cost genuinely unavailable — not invented here either):

| Provider | Basis | Cost/useful-result, where computable |
|---|---|---|
| Exa Search (evidence-discovery) | Real observed `costDollars` | ~$0.0033/high-evidence-strength result |
| Tavily (evidence-discovery) | Documented rate, not billed-observed | ~$0.0041/high-evidence-strength result **on the documented rate**, not a confirmed bill — not directly comparable to Exa's real figure on equal footing |
| Exa Contents | Real observed `costDollars` | ~$0.001/successfully-extracted page — but see §8's normalization caveat before treating this as apples-to-apples with a bounded Firecrawl page |
| Firecrawl | **Not documented anywhere in this repo, not invented here** | Not computable |

**The 30-day Tavily cache changes this materially**, as the benchmark report already established: a repeat research run of an already-researched company costs ~$0 in live Tavily calls. Exa has **no equivalent caching mechanism in this codebase** — every Exa call in a hypothetical repeat run would be fresh, fully-billed. **This is a real, structural cost asymmetry that favors keeping Tavily as primary for any capability where companies get re-researched** (batch retries, reprocessing) — not a minor detail, a first-order economic fact any "switch to Exa" proposal has to account for, and didn't exist as a consideration for the company-discovery/decision-maker-discovery decisions (those aren't cached the same way).

---

## 10. Recommended Final Architecture

**One concrete architecture, not a menu:**

```
Tavily
  → evidence discovery, ICP research, competitor research, market
    intelligence, website-domain candidate search, LinkedIn-search
    decision-maker discovery's search step
  → no fallback provider (Serper's old slot stays empty)

Firecrawl
  → homepage scrape + mapUrl (site discovery) + up-to-15-page selective
    scrape (KNOWN-URL extraction AND whole-site mapping/crawling — both
    roles, unchanged)
  → own search() as a narrow last-resort scrape-rescue only (F4)

Jina
  → Tier-1 full-scrape rescue when Firecrawl's homepage scrape fails
    outright
  → JS-rendered nav-link extraction supplement when Firecrawl's homepage
    succeeds but surfaces 0 same-domain links
  → final content-quality rescue when total scraped content is under 800
    chars

pdf-parse
  → all PDFs, never Firecrawl/Jina/Exa (unchanged, untouched, not part of
    this comparison)

Exa
  → company discovery (primary, live)
  → decision-maker discovery (primary, live)
  → contact enrichment (selective supplement to Prospeo, live)
  → NOT wired into web search/evidence/page-extraction today — candidate
    for a future, narrower role pending §16's follow-up benchmarks, not a
    default anywhere in that path yet
```

This is **the current architecture, confirmed correct by re-tracing every call site this session**, not a proposed change. The investigation did not surface evidence clearing the bar to alter it.

---

## 11. Providers To Remove

**None, beyond Serper (already done).** No finding in this document or the underlying benchmark clears the "earn its place" bar for removing Tavily, Firecrawl, or Jina. Specifically:

- Tavily: competitive-to-behind Exa on an incomplete comparison (snippet gap, single-session sample) — not a removal case.
- Firecrawl: uniquely owns whole-site mapping/crawling with no substitute; single-page extraction has an unproven-at-scale Exa candidate, not a proven replacement.
- Jina: no substitute exists for its JS-rendered-nav-link-extraction role; the one observed failure this session was compounded by an unrelated Firecrawl rate-limit issue, not evidence Jina itself is broken.

---

## 12. Providers To Keep

| Provider | Unique capability that justifies keeping it |
|---|---|
| **Tavily** | Primary, proven, reliable, cache-integrated evidence/ICP/competitor/market-intel search. Every alternative (Exa) is evidenced as *competitive*, not *clearly better*, on the actual query workload — not yet a case for displacement, especially given the real cache-cost asymmetry (§9). |
| **Firecrawl** | Sole owner of whole-site URL discovery (`mapUrl`) and sitemap-based crawling — **no alternative exists in this stack for this specific capability**, full stop. Also the current, working (when not rate-limited) known-URL scraper with a bounded, predictable content budget. |
| **Jina** | Sole owner of JS-rendered-navigation-link extraction when Firecrawl's own homepage scrape returns zero links — a specific, real, code-documented gap in Firecrawl's own JS handling that nothing else in the current stack fills. |
| **Exa** | Already earning its keep on company discovery and decision-maker discovery with strong, repeated, multi-angle evidence — unrelated to and unaffected by this document's findings on the web-search/scrape side. |

---

## 13. Remaining Unknowns

Stated explicitly, not glossed over:

1. **Exa Search vs. Tavily at full snippet fidelity** — only 21 of 136 query-groups in the existing benchmark have Exa's `contents.highlights` requested; the rest is URL/title-only, an unfair comparison for judging snippet usefulness at scale.
2. **Exa Contents vs. Firecrawl on a non-rate-limited Firecrawl plan** — this session's 10-URL sample was shaped by a real Firecrawl account-tier rate limit, not necessarily representative of Firecrawl's real capability.
3. **JS-heavy-page handling, for both Exa Contents and the current Firecrawl+Jina chain** — zero data exists; none of the 4 benchmark companies happened to be JS-heavy.
4. **Exa Contents' PDF-size unpredictability's root cause** — is the 1,000,000-char result a documented Exa behavior, a bug, or an untested edge case? Not investigated this session.
5. **Serper's actual fallback value, had it been funded** — permanently unknowable now that it's removed, unless a future session decides to test a different SERP-style provider for comparison; not recommended without a specific new capability gap motivating it.
6. **Real production Tavily-failure rate** — the new logging (docs/DECISIONS.md) makes this observable going forward, but no historical data exists yet to know how often it actually fires in production.
7. **Firecrawl's real (undocumented in this repo) $ cost** — every cost comparison in §9 is asymmetric because of this; a real pricing lookup (not another benchmark) would resolve it cheaply.

---

## 14. Migration Plan

**Only if/when the unknowns in §13 are resolved with real evidence — nothing here is scheduled or approved by this document:**

1. Close unknown #1 (Exa full-snippet Tavily comparison) — reuses the existing `benchmarks/exa/web-search-benchmark/run-search-benchmark.ts` script with `contents.highlights` requested from the start; cheapest, most self-contained next step.
2. Close unknown #2 (Firecrawl on a proper plan) and #3 (JS-heavy pages) together — a single, deliberately-scoped follow-up run (`run-contents-benchmark.ts`, extended with 3-5 named JS-heavy sites) against a Firecrawl account without the 12 req/min limit.
3. Only if both come back with a clear, reproducible, multi-angle result (the same bar company-discovery and decision-maker-discovery cleared) — propose introducing Exa as a **selectable, non-default** provider for one narrow capability at a time (e.g., evidence-discovery search only, not all four search modules at once), same rollback-safe pattern already used (env-var default, DB-governed where applicable, explicit rollback path documented).
4. Controlled side-by-side on a real live company-research run, not a standalone script, before touching any default — same discipline as the company-discovery/decision-maker-discovery rollout.
5. Only after that: revisit whether Exa Contents can take over any Firecrawl single-page-extraction calls specifically (never the mapping/crawling role, which stays Firecrawl regardless of any other outcome) — requires the §8 normalization adapter to actually be built first, which has zero urgency while zero callers exist.

**Nothing in this plan is scheduled.** This document stops at the decision/analysis layer, per instruction.

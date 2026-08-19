# Research Architecture Audit (G0)

Date: 2026-08-18
Status: Read-only. No production behavior changed by this document.
Scope: `demaze_master_research_optimization_plan.md` §42 (G0) / §50 (first command).

---

## 1. Current Architecture

### 1.1 LLM provider chain (`lib/ai/provider-factory.ts`)

`getCompletion()` tries, in order, one shot per model (no in-model retry):

1. **Gemini via Vertex AI Express Mode** (`tryVertexGeminiChain`, `provider-factory.ts:238`) — `gemini-3.6-flash`, gated on `GEMINI_VERTEX_API_KEY`, via `VertexGeminiProvider` (`lib/ai/providers/vertex-gemini.ts`) calling `@google/genai`'s native `generateContent` with `thinkingConfig.thinkingLevel: MINIMAL`.
2. **NVIDIA NIM** (`tryVendorChain`, `provider-factory.ts:193`) — `openai/gpt-oss-120b` → `deepseek-ai/deepseek-v4-pro`, gated on `NVIDIA_NIM_API_KEY`, via `OpenAICompatibleProvider`.
3. All exhausted → throws with collected errors.

Shared machinery: per-attempt `Promise.race` timeout (default 150s), a `looksLikeJson()` guard against reasoning-channel leakage, and a per-vendor 60s in-memory rate-limit cooldown.

**Gemini's native Google Search grounding tool is not wired in anywhere.** `vertex-gemini.ts`'s `generateContent` call passes no `tools` field. All live web research goes through Firecrawl/Tavily/Serper/Jina/direct-fetch/EDGAR — Gemini is used purely as a text completion model, with zero web access of its own. This is the single biggest gap relative to §16 of the plan, which proposes testing Gemini Search grounding as a primary discovery method.

Ten `getCompletion()` call sites: `business-profile.ts:179`, `company-discovery.ts:439`, `icp-generator.ts:732,952`, `competitor-discovery.ts:855,1080`, `sales-knowledge/reasoning.ts:56`, `outbound/generation/generate-email.ts:29`, `generate-subject-lines.ts:40`, `generate-followups.ts:61`. No shared caller-side retry wrapper beyond the factory's own internal Gemini→NVIDIA fallback — the three outbound-generation sites explicitly removed an outer retry loop after it stacked badly with the internal fallback and caused multi-minute hangs.

### 1.2 Search providers

- **Tavily** — one implementation, `searchTavily()` (`lib/enrichment/discovery-engine.ts:206`). Checks `search_query_cache` first, 10s timeout, swallows errors to `[]`.
- **Serper** — one implementation, `searchSerper()` (`discovery-engine.ts:241`), same cache/timeout/error-swallow shape. Called only as a per-query fallback when the corresponding Tavily call in the same function returned zero results.

Both are called from 6 independent sites, each with its own copy-pasted "Tavily then Serper" wrapper: `discovery-engine.ts:300` (main evidence discovery), `website-discovery.ts:346` (URL resolution), `market-intelligence.ts:162`, `icp-generator.ts:311`, `competitor-discovery.ts:383`, `company-discovery.ts:318`. **No shared `searchWithFallback()` helper across files** — the same 4-line pattern is duplicated 5 times outside `discovery-engine.ts` itself.

- **Gemini Google Search grounding** — not implemented (see 1.1).

### 1.3 Fetch providers

- **Firecrawl** — three independent client instantiations, no shared wrapper:
  - `lib/pipeline/scraper.ts` (primary): `getFirecrawlClient()` (`:328`), used for homepage scrape (`:1305`), per-page batch scrape (`:1386`, 3-at-a-time), `mapUrl` (`:765`), and a `search()` fallback (`:859`) triggered when content is thin.
  - `lib/enrichment/web-enricher.ts:150` `fetchWithFirecrawl()` — separate `new Firecrawl()`, dynamic-imported, used for discovered external evidence sources (annual reports, news, etc.) and recovery-path probing.
  - `lib/enrichment/website-discovery.ts:232` `fetchHomepageIdentityViaFirecrawl()` — third instance, still calls the deprecated `scrapeUrl()` method (the other two use `scrape()`), used only as a fallback after a plain `fetch()` attempt fails.
- **Jina** (`r.jina.ai`) — single implementation, `fetchViaJina()` (`scraper.ts:941`), no API key needed. Used as: homepage-scrape fallback when Firecrawl fails (`:1047`), thin-content retry (`:1279`), and a JS-nav-link rescue when Firecrawl returns zero same-domain links (`:1122`).
- **Direct `fetch()`** — `probeCorporateSeeds()`/`probeUniversalPaths()` (`scraper.ts:660,706`, Range-header probes), `fetchSitemapUrls()` (`scraper.ts:446`, unconditional, parallel with homepage scrape), `fetchHomepageIdentityPlain()` (`website-discovery.ts:203`, primary path before Firecrawl fallback), `fetchPdfText()` (`web-enricher.ts:225`, for `.pdf` URLs specifically), EDGAR client (`sources/edgar-client.ts:65,218`, free government API, called unconditionally whenever a company name is known).
- **Apollo** — no live HTTP client exists in the repo despite being referenced in `docs/production-hardening/phase9-apollo-decision.md`; not a real call site today. (Out of scope per plan §0 anyway — "Apollo is completely out of scope for now.")

### 1.4 Caching

- **`company_scrape_cache`** (`lib/cache/scrape-cache.ts`, migration 003) — full `ScrapeResult` JSONB, keyed on exact normalized URL, 24h app-side TTL, read at `test-analysis/route.ts:324`, write is fire-and-forget.
- **`search_query_cache`** (`lib/cache/search-cache.ts`, migration 012) — keyed on `(provider, exact query text, max_results)`, 30-day TTL, read/written transparently inside `searchTavily()`/`searchSerper()` — every discovery module benefits without knowing it exists.
- **`outbound_decision_maker_searches`** (migration 015) and Prospeo's `outbound_contacts.prospeo_raw` (migration 013) — outbound-side caches, not company research.

No evidence cache, no content-hash-keyed cache, no cross-run "verified claim" reuse — every research run re-derives evidence from scratch even for a company researched last week (only the raw scrape/search results are cached, not the extracted claims).

### 1.5 Relevant DB tables

- **`pipeline_test_runs`** (migration 002) — the actual live table. Denormalized columns for timing/tokens/provider, plus three JSONB blobs (`scrape_result`, `final_result`, `prompts`). No per-claim decomposition.
- **`signals`** (migration 001) — genuinely evidence-shaped (`type`, `strength`, `evidence` text, `source_url`, `detected_at`) but **confirmed unused** — zero `.from('signals')` call sites anywhere in the codebase. Same for `companies`/`analyses` from the same migration. Legacy/dead tables.
- **`outbound_sales_intelligence`** (migration 022) — the one table with a real evidence-hierarchy CHECK constraint (`confidence_tier`: `confirmed_fact | research_supported_signal | industry_pattern | hypothesis`), but evidence still lives as prose in a `reasoning` JSONB column, not as structured citations with URLs/dates.

### 1.6 Evidence/provenance fields that already exist in code

- `StructuredPainPoint.claim_type` (`normalize.ts:143`, `observed|inferred`) — `observed` claims are quote-verified against shown content via `isQuoteGrounded()`/`verifyQuoteInContent()` (`lib/pipeline/quote-verification.ts:74`, exact/close/none tiers) or dropped; `inferred` claims are kept without a quote.
- `opportunities[].source` (`normalize.ts:351`, `llm|deterministic|llm_verified|llm_inferred`) plus `claim_type`, `observed_basis`, `inferred_from`, `demaze_fit_score`.
- `CompetitorProfile.source`/`.source_urls` and `ICPSegment.source`/`.source_urls` (`competitor-discovery.ts:66,79`, `icp-generator.ts:80`) — the most complete provenance shape in the repo: `search | ai_knowledge | search_synthesis`, with real URLs for two of the three paths (`ai_knowledge` has none by design — nothing to cite from parametric recall).
- `service-evidence.ts`'s per-service `Evidence/Disqualifier/Threshold` engine (`none|weak|medium|strong`) — deterministic regex matching against shown content, each match carries a snippet but **no source URL or timestamp**.
- `SourceType`/`EvidenceStrength`/`priority_score` (`discovery-engine.ts:15-128`, `source-prioritizer.ts`) — a **document-type** hierarchy (annual_report, investor_presentation, regulatory_filing, press_release, news_article, corporate_website, etc.), not a **source-authority** hierarchy. First-party vs. regulatory vs. independent-third-party vs. low-authority is only implicit in the priority number, never an explicit separate field.
- `lib/sector-playbook/qualify.ts:82` — the closest existing "confirmed vs. inferred" discipline outside normalize.ts: a `confirmed` opportunity tier requires a real `medium`/`strong` `service-evidence.ts` hit; `inferred` is a looser keyword match on an already-`inferred` pain point. Both surfaced with an explicit label, never silently merged.

**What is structurally absent, confirmed by direct grep, not assumed:** no publish/fetch date on any evidence item; no content hash anywhere; no source-authority tier attached to individual claims; no confidence ceiling derived from source tier; no contradiction-detection code anywhere in the repo (confirmed absent — the only related code is `CLAUDE.md`'s explicit note that website-conflict resolution was "considered and explicitly rejected as out-of-scope"); no general "does this company already use a competing vendor" check — only 5 narrow per-service regex disqualifiers inside `service-evidence.ts` that catch a named competing tool only if it's explicitly mentioned in already-scraped text.

### 1.7 Batch execution and concurrency

**Outer loop (multi-company batch) is strictly sequential** in both entry points — `app/admin/wizard/page.tsx:266` and `app/admin/auto-gtm/useAutoGtmFlow.ts:639` both run:

```ts
for (let i = 0; i < queue.length; i++) {
  const res = await fetch('/api/admin/test-analysis', { method: 'POST', ... });
  const data = await res.json();
  await persistBatchResult(...);
}
```

No `Promise.all`/`Promise.allSettled`/worker pool anywhere in either loop. `lib/batch/quota-pause.ts`'s pause-after-3-consecutive-failures logic is written assuming strict sequential execution.

**Inner loop (single-company pipeline, `app/api/admin/test-analysis/route.ts`, ~1700 lines) is already substantially parallel:**
- Stage 0 (website discovery) awaited first, only when no URL given.
- Immediately after: `discoveryPromise` (external-source discovery+fetch), `icpDiscoveryPromise`, `marketIntelPromise` fired unawaited, running concurrently with Stage 1 SCRAPE.
- Stage 1 SCRAPE checks `company_scrape_cache` first.
- After signal extraction: `businessProfilePromise`, `offeringCompetitorPromise`, `offeringIcpPromise`, `competitorKnowledgePromise`, `icpKnowledgePromise` all fired unawaited.
- Enrichment is raced against both a hard 70s timeout and an 8s soft timeout (prompt builds website-only past 8s, enrichment keeps running in background).
- Final stage: `Promise.all([getCompletion(...), enrichmentPromise])`.

So the "more than one hour for 30 companies" problem the plan cites (§30) is a **cross-company** concurrency gap, not a within-company one — the single-company pipeline already overlaps most of its own I/O.

### 1.8 Benchmark mechanism (`benchmarks/benchmark-runner.ts`)

Sequential `for` loop over `benchmarks/companies/*.json`, one HTTP POST to `/api/admin/test-analysis` per company (8-minute abort timeout), no concurrency. Records per company: duration, signal/opportunity/challenge counts, gate pass/warn/fail, a 0-100 `evaluateResearch()` score compared against `benchmarks/evaluation-history/*.json` (regression flagged if mean drops >5 points). **No token/cost tracking at all** in the runner, despite `pipeline_test_runs.token_usage`/`ai_latency_ms` already existing on the underlying API response — the benchmark's own `ApiResponse` type doesn't capture it.

### 1.9 Cost/latency observability

Exists: `tokensUsed`/`latencyMs` on every `CompletionResponse`, `[AI] Success: ... | tokens: X | latency: Yms` console logs per provider attempt, and an extensive per-stage `timing: Record<string, number>` object in `test-analysis/route.ts` (scrape, discoveryFetch, extraction, businessProfile, competitorDiscovery, icpDiscovery, marketIntel, promptBuild, llmAnalysis, enrichment, synthesis, total), persisted to `pipeline_test_runs`.

Absent: no dollar-cost computation anywhere in the repo (confirmed by grep — no pricing tables, no cost multiplication). No per-call cost logged next to the token/latency log line. No aggregation across a batch run (each `pipeline_test_runs` row is per-company only). The benchmark runner never reads the cost/timing columns it already has available.

---

## 2. Current Bottlenecks

1. **Cross-company sequencing is the dominant latency cost**, not any single provider call. 30 companies × ~1-2 min/company sequential ≈ the ">1 hour" figure the plan cites. This is a pure architecture gap (§30/§42 G10) — the per-company pipeline itself is already parallelized internally.
2. **No search-result reuse across sibling discovery modules within one run.** Competitor discovery, ICP discovery, market intelligence, and website discovery each independently call `searchTavily`/`searchSerper` with their own query sets — `search_query_cache` dedupes only exact-text-repeat queries, not semantically-overlapping ones, so a single company run can issue 15-20+ distinct search calls.
3. **Firecrawl is still the default/first-tried scraper**, not a fallback (plan §19 wants it demoted). Its three independent client instantiations (scraper.ts, web-enricher.ts, website-discovery.ts) mean any future "move to fallback" change has three places to touch, not one.
4. **`assessScrapeQuality()` (referenced by the plan §24) has no content-relevance signal** — already flagged as an open item in `CLAUDE.md`'s own audit chain from 2026-07-24, never fixed. This directly blocks any real quality-gated early-stopping (plan §28).

---

## 3. Current Cost Drivers

In descending order of unmeasured-but-likely impact (no dollar figures exist yet — this is qualitative, per the "instrument before optimizing" discipline in plan §29/§35):

1. **LLM completion calls** — 10 call sites per company run, several unconditionally fired even when their upstream evidence is thin (e.g., `discoverCompetitorsFromKnowledge`/`discoverICPSegmentsFromKnowledge` fire on every run before falling through to search-synthesis).
2. **Firecrawl scrape/mapUrl calls** — up to ~15 page scrapes + 1 mapUrl + up to 2 search-fallback calls per company, all metered per Firecrawl's credit pricing.
3. **Tavily/Serper search calls** — 6 independent discovery modules × up to 4-5 queries each, partially mitigated by the 30-day search cache but only for byte-identical repeated queries.
4. **No visibility into which of the three above actually dominates real spend** — this is exactly the gap plan §35 (cost instrumentation) exists to close, and it is a real prerequisite before any provider-removal decision (plan §41).

---

## 4. Current Evidence Gaps

Directly maps to plan §§1-11:

| Plan requirement | Current state |
|---|---|
| Source authority tier (first-party/regulatory/third-party/low) | Absent as an explicit field; implicit only in `priority_score` |
| Publish date / retrieval date per claim | Absent everywhere |
| Content hash / staleness detection | Absent everywhere |
| Confidence ceiling derived from source tier | Absent — confidence is set by LLM or regex-tier mapping, never capped by source authority |
| Contradiction detection | Absent, confirmed by grep — zero implementation |
| Existing-solution verification (general) | Only 5 narrow per-service regex disqualifiers in `service-evidence.ts`, not a standalone check |
| Fact vs. inference labeling | **Partially exists and works well** — `claim_type` on pain points and opportunities, `qualify.ts`'s confirmed/inferred tiers |
| Freshness TTL by claim type | Absent — only cache TTLs exist (24h scrape, 30-day search), which are storage-layer TTLs, not claim-freshness TTLs |
| Evidence reuse across runs (research memory) | Absent — only raw scrape/search caching exists, not verified-claim caching |

---

## 5. Proposed Minimal Changes (for G1 onward, not this session)

Per the plan's own phase ordering (§42), the next real step is **G1: cost/latency instrumentation + the 30-company baseline run**, not code changes. Once that baseline exists, the highest-leverage minimal changes appear to be, roughly in the order the plan itself sequences them:

1. Add cost-per-call estimation next to the existing `tokensUsed`/`latencyMs` logging (small, additive, no behavior change) — closes the §35 gap immediately.
2. Wire the job queue for cross-company concurrency (§30/§42 G10) — the highest-measured-impact item, since the inner pipeline is already parallel and the outer loop is the confirmed bottleneck.
3. Consolidate the 5 duplicated `searchTavily`-then-`searchSerper` call sites into the one shared helper `discovery-engine.ts` already has internally — reduces duplication without changing behavior.
4. Everything evidence-ledger-shaped (§3-11) is additive on top of fields that partially already exist (`claim_type`, `source`, `source_urls`) — extend those types rather than building a parallel schema.

This section is intentionally not a committed plan — it restates the plan document's own ordering against what this audit found, per §42's "no production behavior changes" instruction for G0.

---

## 6. Files Likely to Change (future phases, not this session)

- `lib/ai/provider-factory.ts`, `lib/ai/providers/vertex-gemini.ts` — Gemini Search grounding (if adopted after benchmarking).
- `lib/enrichment/discovery-engine.ts` and its 5 duplicated call sites (`website-discovery.ts`, `market-intelligence.ts`, `icp-generator.ts`, `competitor-discovery.ts`, `company-discovery.ts`) — shared search-fallback helper.
- `lib/pipeline/scraper.ts`, `lib/enrichment/web-enricher.ts`, `lib/enrichment/website-discovery.ts` — Firecrawl-to-fallback demotion (three independent clients need touching).
- `app/admin/wizard/page.tsx`, `app/admin/auto-gtm/useAutoGtmFlow.ts`, `lib/batch/quota-pause.ts` — job queue / concurrency for cross-company batches.
- `lib/pipeline/normalize.ts`, `lib/enrichment/competitor-discovery.ts`, `lib/enrichment/icp-generator.ts` — evidence-ledger field extensions (source authority, publish date, confidence ceiling).
- `benchmarks/benchmark-runner.ts` — add cost/token capture to the existing per-company metrics.

---

## 7. DB Migrations Required (future, not this session)

- Extend existing JSONB-embedded provenance (`opportunities[].source`, `CompetitorProfile.source_urls`, etc.) with `published_at`/`retrieved_at`/`content_hash` — likely a new normalized `research_evidence` table rather than more ad-hoc JSONB fields, given `pipeline_test_runs` and `outbound_sales_intelligence` already show the JSONB-blob pattern reaching its limits for anything queryable (per plan §3's suggested `IntelligenceEvidence` shape).
- Possibly a `research_job_state` table for the resumable job states in plan §33, separate from `pipeline_test_runs` (which is a completed-run record, not a mid-flight job state machine).
- The legacy `signals`/`analyses`/`companies` tables (migration 001) are confirmed dead — a candidate for removal in a later cleanup phase, not blocking anything.

---

## 8. Risks

- **Three independent Firecrawl clients** means any change to its role (default → fallback) risks inconsistent behavior across scraper.ts/web-enricher.ts/website-discovery.ts if only one is updated.
- **Cross-company concurrency** directly risks tripping Firecrawl/Tavily/Serper rate limits that today are naturally throttled by sequential execution — the plan's own §31 (start at 5 workers, benchmark up) is the right guard, not skippable.
- **Evidence-ledger fields are additive**, but the merge logic in `normalize.ts` that already discards LLM-only claims with no code-derived match (competitors, ICP, opportunities) is exactly the mechanism that must be preserved, not bypassed, when a new "search-synthesis" or "AI-knowledge" claim path is added.
- **The benchmark runner has no cost tracking today** — any before/after cost comparison (plan §41) requires G1's instrumentation to land first, or the comparison will have no real numbers to report (violating plan §49's "must contain numbers" requirement).

---

## 9. Test Plan (for later phases, not this session)

Per plan §43: evidence tests (source required, quote-verified, inference stays inference, confidence ceiling enforced), fetch tests (timeout/retry/redirect/robots), cache tests (hit/miss/TTL), routing tests (cache prevents provider call, fallback ordering, no infinite loops), concurrency tests (duplicate-company guard, resumability, backoff, partial-batch completion). The existing `tests/` suite (vitest, currently green per `CLAUDE.md`'s own tracked count) is the base to extend — no new test framework needed.

---

## 10. Exact Implementation Order

Following plan §42 verbatim (G0 → G15), unchanged by this audit — no reordering is proposed. This document satisfies G0. The next step is **G1: cost and latency instrumentation, then the 30-company benchmark baseline**, before any code in G2 onward.

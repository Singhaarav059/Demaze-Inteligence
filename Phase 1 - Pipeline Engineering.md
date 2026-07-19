---
tags: [demaze, pipeline, phase-1]
updated: 2026-07-13
---

# Phase 1 — Pipeline Engineering

← [[PROJECT_STATUS]]

> [!success] Status: complete
> Items 1, 5, 6, 7 fully done and verified. Item 2 done and verified. Item 3 done in code, one live verification run still open. Item 4 was explicitly deferred, not abandoned — see [[Left To Do]].

- [x] **Item 1 — Company-name → website discovery** (`lib/enrichment/website-discovery.ts`)
  Content-based verification only (word-boundary title/description match — not URL/domain string similarity). Confidence tiers: high / medium / none, with an honest `ambiguous` outcome when two candidates tie rather than guessing.
  - [x] Tavily→Serper fallback bug fixed (`searchWithFallback` — original code only fell back to Serper when Tavily wasn't *configured*, not when it *failed*, e.g. quota exhaustion)
  - [x] Single-word company-name false positive fixed (AITG was matching an unrelated wiki, `aitg.miraheze.org`) — single-word names now require an actual title match, not just a body-text hit
  - [x] Real same-name collision handled correctly, not just the synthetic test case — A-1 Fence Products (India) vs. A-1 Fence Company (Anaheim, CA) correctly returns `ambiguous`
  - [x] `r.url.includes(domain)` empty-string-always-matches bug fixed (would've silently accepted every search result when discovery ran on name-only input)

- [x] **Item 2 — Enrichment discovery+fetch repositioned to run parallel with scraping**, not sequentially after it
  Split the old monolithic `enrichCompanyIntelligence()` into `discoverAndFetchExternalSources(domain, companyName)` (stages 1–3, no scrape dependency, kicked off *before* Stage 1 SCRAPE even begins) + `probeRecoveryPaths()` (stage 4, still gated on post-scrape content quality).
  - [x] Measured on a real Ador Welding run: discovery+fetch (19.6s) fully overlapped with a slow scrape (45.6s) → ~20s / ~22% total pipeline latency reduction
  - [x] Knock-on quality win: enrichment reaches the LLM's *first* prompt attempt instead of arriving late (post-prompt, re-extraction-only)
  - [x] `detectConsumerSite` — was imported but never called pre-refactor (dead import) — now genuinely wired up

- [x] **Item 3 — PDF sources fetched and parsed, not dropped**
  `isFetchable()` in `source-prioritizer.ts` no longer excludes `.pdf` — the three highest-value `very_high` source types (`annual_report`/`investor_presentation`/`earnings_release`) are disproportionately PDF-published and were being silently discarded. New route in `web-enricher.ts`: `isPdfUrl()` → `fetchPdfText()` (15s timeout, content-type + 10MB guards) → `extractPdfText()` (pdf-parse v2's `PDFParse` class API, *not* the classic `pdf(buffer)` function).
  - [x] 10 new unit tests (`tests/enrichment-pdf.test.ts`) — `isPdfUrl` routing incl. mid-path-"pdf" false-positive guard, `extractPdfText` against a real fixture, graceful `null` on garbage/empty buffers
  - [ ] **Open:** a live end-to-end run proving a real annual-report PDF that used to get dropped now fetches/parses/lands in `enriched_context` — deliberately deferred to a quota-spending session with explicit confirmation (see [[Left To Do]])

- [x] **Item 5 — Opportunity engine rebuilt against the 8 confirmed Demaze services**
  Root cause of the old bug: `normalize.ts` builds the final `opportunities` array *exclusively* from `deterministic_opportunities` — so the old ~20-entry invented `OPPORTUNITY_CATALOG` (e.g. "Predictive Maintenance AI") was never an LLM hallucination, it was a literal catalog entry. Replaced with `lib/pipeline/service-evidence.ts` — direct regex-based Evidence/Disqualifier/Threshold detection per real service, matching [[SERVICE_TO_OUTREACH_MAPPING]] exactly.
  - [x] `weak` matches computed but suppressed from the report (kept only for debugging) — avoids recreating the "Digital Transformation for everyone" anti-pattern
  - [x] No cap on qualifying services — a company clearing 2+ shows all, ranked by evidence strength
  - [x] Verified: AITG surfaces exactly 1 real opportunity instead of invented titles; Ace Pipeline and AS Agri correctly surface zero (thin real evidence, not a detection gap)

- [x] **Item 6 — Buyer/contact fields fully removed from code**, not just docs
  `recommended_contacts`, `recommended_contact_roles`, `target_buyer`, `target_contact`, `who_to_contact`, `target_contacts`, and the whole `OutreachCard`/`outreach-engine.ts` concept deleted from `normalize.ts`, `lib/prompts/analyze-v2.ts`/`system-v2.ts`, `lib/synthesis/*`, and the admin UI.
  - [x] Old pre-`-v2` prompt files (`analyze.ts`, `schema.ts`, `system.ts`) deleted outright; their 2 still-used helpers (`formatScrapedPages`, `estimateTokenCount`) extracted to `lib/prompts/scrape-utils.ts`

- [x] **Item 7 — Batch lead-list upload** (`/admin/batch-upload`)
  xlsx/csv/docx/pdf parsing (`lib/batch/file-parser.ts`, header-aliasing, 3-tier graceful degradation) → company dedup (`lib/batch/company-dedup.ts`, tiered domain/exact-name/acronym matching, weak matches flagged `possibleDuplicateOf` rather than auto-merged) → user selects companies → existing 4-step pipeline runs **sequentially by design** (parallel batch runs rejected given real quota limits) → each result persisted to run-history immediately as it completes (a closed tab mid-batch never loses already-paid-for research).
  - [x] Consecutive-quota-hit pause detection extracted to pure `lib/batch/quota-pause.ts`; closed out via 17 unit-test assertions (`tests/batch-quota-pause.test.ts`) rather than a real quota burn — distinguishes a real quota-hit error signature from an `LLM_PARSE_FAIL`/truncation retry, which must never be miscounted as one
  - [x] "Research Selected" sequential loop **re-verified live** in-browser: 3 real companies, real API calls, progress indicator + per-company run-history persistence all confirmed against server logs (not just inferred)

- [x] **Phase 1 formally closed out** (2026-07-12) — items 1, 6, 7 done and verified; items 2–4 explicitly deferred, not abandoned

## See also
- [[Left To Do]] — Item 3's pending live run, Item 4 (not started)
- [[Known Issues]] — scraper-reliability gaps that Item 2's speed win doesn't fix (they're a separate, pre-existing problem)
- [[Classifier and Extraction Fixes]] — the signal/classification bugs found via real-data validation while building these items

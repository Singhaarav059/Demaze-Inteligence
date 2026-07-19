---
tags: [demaze, classifier, bugfixes]
updated: 2026-07-13
---

# Classifier & Extraction Bug Fixes

← [[PROJECT_STATUS]]

> [!info] Why this note exists
> These were all found via **manual read-through of real scrape-cache content**, not hypothesized — each one is a confirmed root cause behind a live benchmark failure. Grouped here separately from [[Phase 1 - Pipeline Engineering]] because they're classifier/extraction correctness fixes, not new pipeline capability.

- [x] `primary_type` cascade bug — `conglomerate` (then 5 more soft categories: `financial_institution`, `pharma_biotech`, `healthcare_provider`, `logistics_operator`, `retailer`) was checked *before* `manufacturer`/`industrial_vendor`/`services_provider` in the if/else cascade, so generic marketing copy ("trusted partner to diverse sectors") or a CSR mention ("healthcare services") silently mislabeled real manufacturers
  - Fixed in two passes: first `conglomerate` alone, then found the same bug class still present for the other 5 soft categories after AITG showed `primary_type: healthcare_provider` from a genuine founder-history anecdote
  - [x] Verified across all affected companies: ATE Group, AITG, A-1 Fence Products all now resolve to `manufacturer`; Bharat Forge and Chargebee re-verified as zero-regression
- [x] `manufacturer` regex widened — required direct word-adjacency to plant/facility/unit, missing ATE Group's actual list-style copy ("fabrication, machining, control system design facility"). Added enumerated-capability-list pattern
- [x] Bare `\bbank\b` false-positive fixed — was matching "data bank" in a job posting. Now excludes data/food/test/word/blood/piggy/river bank compounds (same bug class as the URL short-keyword fix below)
- [x] URL classifier short-keyword substring bug fixed — `ir`/`sec`/`ai`/`bse`/`nse` (≤3 chars) were matching as plain substrings (`/barbed-wire.php` contains "ir" → scored investor/100; a URL with "security" contains "sec" → same false positive). Fixed: short keywords now require word-separator boundaries (`/ - _ .`)
- [x] New `b2b_services` URL category added (score 75): solutions, services, industries, industry, application, capabilities, warranty, partner — previously scored 0
- [x] `classifySubject()` third-person self-reference gap fixed, scoped to **'about' pages only** — A-1 Fence's "A-1 Fence's operations..." / AITG's "Companies under AITG..." pattern wasn't caught by the existing generic "the company/group/firm" rule, which only fired on `pageType === 'other'`. Deliberately not extended to 'other'/enrichment content, to avoid third-party-mention and competitor-bleed-through false positives
- [x] `SIGNAL_PATTERNS` coverage gaps closed (the actual root cause of AITG/Ace Pipeline/A-1 Fence's "0 signals" state — not a subject-classifier floor problem as originally assumed):
  - [x] Named ERP/CRM tools embedded in job postings (e.g. "SAP MM," "SAP FICO" as mandatory skills) — evidences existing-ERP-no-AI-layer
  - [x] Job-posting task/responsibility bullet lists as workflow evidence (ATE Group's BOQ→procurement→compliance chain came from a job listing, not marketing copy)
  - [x] Training/workshop/consultant-engagement mentions as an indirect pain signal
- [x] Global disqualifier validated: customer-facing evidence (what a company *sells*) must not be scored as evidence of the company's own internal operational gap — reused the existing `classifySubject()` `product_capability` vs. `company_operations`/`company_strategy` distinction rather than rebuilding it per service
- [x] `LLM_PARSE_FAIL` hard-fail fixed — retries with a `finishReason`-aware larger token budget instead of a 422; confirmed working live against a real `finishReason=length` truncation, correctly *not* miscounted as a batch quota-pause hit
- [x] Validation gate has PASS/WARN/**PARTIAL**/FAIL — never a hard fail when any fallback source returned content

## Still open from this area
- [ ] Ace Pipeline's actual `primary_type` — the cascade fix removed the wrong `conglomerate` label, but nothing else fires for its content either, so the correct classification is genuinely unknown (not assumed `manufacturer`) — see [[Known Issues]]
- [ ] `classifySubject()` widening to catch by-name third-person self-reference (not just generic "the company/group/firm") — low priority, ~4 evidence snippets across 2 companies — see [[Left To Do]]
- [ ] `detectPageType()` URL-vs-bare-path bug, coupled with the homepage→`generic_marketing` unconditional return — needs a dedicated session fixing both together — see [[Left To Do]]
- [ ] Adversarial URL-classifier test matrix for the `ir`/`sec` short-keyword class — never actually written down as an automated test despite older notes implying it existed — see [[Left To Do]]

## See also
- [[Phase 1 - Pipeline Engineering]]
- [[DEMAZE_CAPABILITY_MAP]] · [[SERVICE_TO_OUTREACH_MAPPING]]

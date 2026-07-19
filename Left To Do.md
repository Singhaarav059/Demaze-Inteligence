---
tags: [demaze, backlog, roadmap]
updated: 2026-07-14
---

# Left To Do

← [[PROJECT_STATUS]]

> [!todo] How to read this
> Split into horizons: Phase 2 priorities (new, scope-pivot work), near-term pipeline/enrichment work, the known issues from [[Known Issues]] once someone's ready to root-cause them, and longer-horizon architecture items from the original target-pipeline vision. Nothing here is scheduled — this is "what's next," not a sprint plan.

## Phase 2 — full AutoGTM-loop expansion (new, 2026-07-14 scope pivot, extended same day)
See [[Scope and Architecture Decisions]] for the decision and [[CLAUDE]]'s "SCOPE PIVOT" section for full reasoning (two decisions same day: Decision A opened company discovery, Decision B — after live Explee screenshots — opened contact discovery + send too). Reference product: explee.com (AutoGTM), all 6 phases now the actual target. Not started — architecture-first, one item per session, per the pasted plan doc's own rules.
- [ ] **1. Competitor Discovery Engine** — competitors, why they compete, market position, differentiators, for a company already being researched
- [ ] **2. ICP Generator** — target-company ICPs (name/reason/signals/buying indicators). Reconcile with the existing demoted `company_fit`/ICP scoring in `normalize.ts` rather than building a parallel system
- [ ] **3. Company Discovery Engine** — given an ICP, find matching companies via search/public-web to start (Explee-level accuracy — real traffic/firmographic data — may need a paid API later; not decided)
- [ ] **4. Research Quality Framework** — scoring methodology for signal/pain-point/opportunity/competitor accuracy
- [ ] **5. Research Evaluation Framework** — 0-100 objective scoring, for future benchmarking
- [ ] **6. Market Intelligence Layer** — industry trends, growth indicators, market challenges, industry shifts
- [ ] **7. Outreach Intelligence Layer** — **already substantially built**, not a gap. `OutreachIntelligence` (`trigger/problem/service/opening_angle/why_now`) in `lib/pipeline/analysis-sections.ts`, populated by `lib/prompts/analyze-v2.ts`, rendered in `ResearchCard.tsx`. Just needs a field-naming/coverage check against this list, not new build
- [ ] **8. Decision-maker discovery** (Explee phase 5, newly in scope) — named contacts per matched company. **Blocked on a vendor decision**: needs a people-data API (Apollo/PDL/Proxycurl/Hunter or similar) since Tavily/Serper/Firecrawl can't match Explee's shown accuracy/scale here. Pick a provider before any code
- [ ] **9. Outreach send** (Explee phase 6, newly in scope) — personalized email generation + actual sending. **Blocked on a vendor/infra decision**: domain warming, deliverability management, a sending provider, reply handling. Real emails to real prospects need explicit per-batch confirmation once this exists — that's a standing operational rule, not a scope note

## Pipeline / enrichment depth
- [ ] **Item 4** — executive-change-announcement query template + a dedicated investor-call-transcript/financial-filings targeting pass (not started; see [[Phase 1 - Pipeline Engineering]] for items 1–7)
- [ ] Government-filings APIs (EDGAR/MCA) — explicitly logged as a *future* category; intentionally not being built now
- [ ] `anchor-text-scorer.ts` — score URLs using the link's visible text (e.g. `<a href="/p1.php">Warranty</a>` → "Warranty" signal), not just the URL path. Fixes the currently-unfixable-by-keyword cases: `.php` URL structures, Google Sites (nav is plain text, no `<a href>` to discover), and numeric/custom-CMS slugs. Planned, not built — confirmed this session it genuinely doesn't exist yet
- [ ] `classifySubject()` widened to recognize third-person self-reference **by company name** (currently only catches generic "the company/group/firm" phrasing), scoped to `'about'` pages only if built — low priority, rescues ~4 evidence snippets across 2 companies (see [[Classifier and Extraction Fixes]])
- [ ] `detectPageType()` URL-vs-bare-path bug, together with the `pageType === 'homepage'` → unconditional `generic_marketing` return — needs a **dedicated session fixing both halves at once**; fixing either alone regresses Ador Welding (its homepage evidence currently only classifies correctly *because* of the bug)
- [ ] Adversarial URL-classifier test matrix for the `ir`/`sec` short-keyword false-positive class — older notes implied this was already covered by a test; confirmed this session it never actually was. Write it fresh in `tests/` using the now-set-up vitest
- [ ] Clean up `benchmarks/companies/*.json` filename/content mismatch and restore real automated regression coverage for the original reference set (Bharat Forge, Muthoot Finance, Chargebee)
- [ ] Live end-to-end verification that a real annual-report PDF previously dropped now fetches/parses/lands in `enriched_context` (Item 3's code + unit tests are done — this is the one deferred live-run check, needs a quota-spending session with explicit confirmation first)

## Known issues, promoted to root-cause work
See [[Known Issues]] for full detail on each.
- [ ] Investigate A-1 Fence Products' `fetch failed`
- [ ] Investigate Muthoot Finance's scrape failure
- [ ] Verify/fix AS Agri & Aqua's Tavily search-fallback parser bug
- [ ] Determine Ace Pipeline's actual `primary_type`
- [ ] Firm up ATE Group's website-discovery verification step (swap the plain `fetch()` candidate check for something more robust against anti-bot/slow sites — e.g. reuse Firecrawl)

## Architecture / longer-horizon (from the target-pipeline vision, not yet built)
- [ ] Full "Identity resolution" stage for arbitrary company-identity inputs (CRM/Apollo/Clay exports, LinkedIn URL, bare company name with no domain) — Item 7's batch upload covers xlsx/csv/docx/pdf lead lists specifically, not a generic identity-resolution layer
- [ ] `AnalysisViewer` (JSX, on-screen) and `buildAnalysisAppendix` (HTML string, exported) still independently *render* the same sections — extraction is now shared via `lib/pipeline/analysis-sections.ts` (see [[UI Export and Code Review]]), but a full merge into one shared formatting layer consumed by both would be a larger, riskier refactor. Deliberately not attempted yet; revisit only if the two visibly drift again

## Explicitly not on this list
Per [[Scope and Architecture Decisions]]'s 2026-07-14 pivot, email-finding/generation/send and contact-level discovery are no longer permanently excluded — see Phase 2 items 8-9 above. What's still genuinely excluded, unchanged: **LinkedIn scraping/automation** specifically (contact discovery should use a people-data API instead), and treating a low `company_fit` score as a reason to skip research (leads still arrive pre-qualified). Re-adding either of those needs its own fresh decision.

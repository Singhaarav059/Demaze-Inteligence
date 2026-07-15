# Decisions

Durable architectural/scope calls only. Not a changelog — see git log and
`Latest Session Handoff.md` for that. Superseded decisions are marked, not
deleted, so a fresh session knows what used to be true.

## Scope

- **What this is**: a Company Intelligence Engine for Demaze outbound sales.
  Target industries: Manufacturing, Automotive, Industrial, SaaS, Financial
  Institutions, SMBs.
- **2026-07-14 scope pivot**: the full Explee-style 6-phase AutoGTM loop is
  now the target (research company → explore competitors → define ICP →
  find companies → find decision makers → outreach send). Only phase 1
  (research) is built. Phases 5-6 (contact discovery, email send) are
  in-scope-but-blocked on vendor decisions (people-data API, sending infra)
  that have not happened yet — do not start building them opportunistically.
- **Buyer identity is input, not output.** A lead row's named
  person+title arrives already attached (Sales Navigator-style export).
  This pipeline never infers, ranks, or generates a buyer/contact field.
  Do not reintroduce `recommended_contacts`/`target_buyer`-shaped fields.
- **LinkedIn stays excluded**, regardless of the phase-5/6 reversal above.
  Contact discovery, if/when built, goes through a people-data API
  (Apollo/PDL/Proxycurl/Hunter-class), not LinkedIn scraping.
- **Once send infra exists**: sending real emails always requires explicit
  per-batch user confirmation. Building the capability is not standing
  authorization to use it.
- **Output schema (5 fields, core of every report)**: Company Description,
  Pain Points, AI Opportunities, Recent News, Personalization Summary.

## Architecture

- Business model classification runs through `CompanyProfile`
  (`lib/pipeline/evidence-extractor.ts`), not the old `BusinessModel` type.
- `company_fit` / ICP scoring is demoted to informational-only — it feeds
  `outreach_priority_score`'s weighting (35%) but gates nothing. Leads
  arrive pre-qualified; a low score should never skip research.
- Enrichment discovery+fetch (`lib/enrichment/web-enricher.ts`) runs
  **parallel** with scraping, not as a post-scrape fallback — kicked off as
  soon as `domain` is known, before Stage 1 SCRAPE even starts.
- PDFs are fetched and parsed (`pdf-parse`), not dropped — see
  `isPdfUrl()`/`fetchPdfText()`/`extractPdfText()` in `web-enricher.ts`.
- Opportunities are generated deterministically from the 8 confirmed
  Demaze service lines (`lib/pipeline/service-evidence.ts` +
  `opportunity-engine.ts`), never invented by the LLM. The LLM only
  narrates/explains a code-derived list; LLM-only titles that don't match
  a catalog entry are discarded. **This is the reference pattern** for any
  future deterministic-list + LLM-narration feature (competitors included).
- Validation gates return PASS / WARN / PARTIAL — never a hard FAIL as long
  as any fallback source returned content.

## Known environment gotcha

The Next.js dev server on Windows does not pick up file changes made from a
Linux shell (cross-OS file watcher issue). Restart `npm run dev` after any
scraper/classifier/prompt file edit before trusting a live run reflects it.

## Competitor Discovery Engine (Phase 2, item 1)

- Search-grounded, not LLM-narrated — supersedes/deprecates the dead
  `competitive_context` free-text field.
- Pipeline: query construction → candidate extraction → filtering
  (self-name/customer/supplier/certifying-body/news-outlet/association
  rejection, word-boundary matching, same discipline as `matchesKeyword()`)
  → confidence tiering (`high`/`medium`/`low`, cap ~5) → sufficiency gate.
- LLM integration: reuses the existing single narrative call. LLM only
  narrates `why_they_compete`/`market_position`/`differentiator` for
  candidates already supplied by code; it never introduces a new name.
  `confidence` is always code-derived, never an LLM output field (same as
  `opportunities.relevance`).
- New non-critical `COMPETITOR` gate, same WARN-only tier as `ENRICHMENT`.
- Non-goals: no market-share/firmographic data, no scraping competitor
  sites, not recursive (does not chain into researching the competitors
  themselves).

## ICP Generator (Phase 2, item 2)

- Answers a different question than `company_fit`: not "is this company a
  good lead for Demaze" (a single 0-100 number, unchanged), but "who does
  the RESEARCHED COMPANY itself sell to" — named target-customer segments.
  No code overlap with `company_fit`'s scoring — this is not a second "fit"
  score, it's a structurally different output (a list of segments).
- Same architecture as Competitor Discovery Engine (the documented reference
  pattern above), same file: `lib/enrichment/icp-generator.ts`. Search-
  grounded, not LLM-narrated — every segment NAME comes from regex
  extraction over search results, never from the LLM.
- Pipeline: query construction (`"we serve"`/`"clients include"`/`"industries
  served"`/`"customers include"` framing) → segment-list extraction
  (`extractSegmentsAfterTrigger`, comma/and-delimited, unlike competitor
  names segment names are frequently lowercase industry terms not proper
  nouns) → filtering (self-name via the shared `isSelfName()` from
  competitor-discovery.ts, generic-term rejection) → confidence tiering
  (`high`/`medium`/`low`, cap 5) → sufficiency gate.
- LLM integration: reuses the existing single narrative call via a new
  `[ICP CANDIDATES]` prompt block and `icp_segments` output field
  (`lib/prompts/analyze-v2.ts`). LLM only narrates
  `reason`/`criteria`/`buying_indicators`/`example_companies` for segment
  names already supplied by code; it never introduces a new segment.
  `confidence` is always code-derived, never an LLM output field.
- Merge in `normalize.ts` uses the same normalized-exact-match identity
  matcher as the competitors merge (renamed `competitorNameMatch` →
  `identityNameMatch` since it's now shared by both).
- New non-critical `ICP` gate, same WARN-only tier as `COMPETITOR`/
  `ENRICHMENT`. Rendered in `ResearchCard.tsx` as "Target Customer
  Segments," same non-empty-only-render discipline as Competitors.
- `tests/icp-generator.test.ts` (19 assertions) covers extraction/
  filtering/tiering/fallback text. Full suite: 98/98 pass, `tsc --noEmit`
  clean.
- **Live end-to-end run — done (2026-07-15).** Ran against Ador Welding with
  real Tavily/Serper/LLM quota: 5 segments surfaced (shipbuilding, oil and
  gas, infrastructure, power, railways), all `high` confidence,
  `icp_sufficiency: sufficient`. Found and fixed one real bug in the same
  session: `splitSegmentList()` split on every `\band\b`, breaking idiomatic
  two-word terms like "oil and gas" into two segments — fixed via a
  `COMPOUND_SEGMENT_IDIOMS` swap-before-split/restore-after approach (a
  placeholder-character approach didn't work, since `\band\b`'s `\b` is a
  `\w`/`\W` transition and still matched around a non-word placeholder).
- Non-goals: no company-matching (that's Company Discovery Engine, Roadmap
  item 3, a separate later milestone that will consume these segments as
  input); no scoring/ranking of segments beyond confidence tier; not
  recursive.

## Company Discovery Engine (Phase 2, item 3)

- Answers the reverse question from Competitor Discovery Engine / ICP
  Generator: those two enrich a report for a company ALREADY being
  researched; this one finds NEW companies to research, given an ICP
  segment (free text — typed by a user, or copied from a prior run's
  `icp_segments`). No LLM narration step at all — a discovered company
  doesn't get "narrated," it either gets sent into the existing 4-step
  pipeline or it doesn't. Every candidate name still comes only from
  search-result regex extraction, same anti-hallucination discipline as
  every other discovery module.
- File: `lib/enrichment/company-discovery.ts`. Pipeline: query construction
  (`top companies in X` / `leading X companies` / `list of X companies`
  framing) → candidate extraction (trigger-phrase list via
  `extractCompaniesAfterTrigger`, PLUS a second numbered-list extractor
  `extractNumberedListCompanies` — "Top 10 X Companies" search snippets
  frequently flatten to "1. Zoho 2. Freshworks…" with no single trigger
  sentence to anchor on, a shape the sibling modules didn't need) →
  filtering (`classifyCompanyRejection`, reuses `isSelfName()` from
  `competitor-discovery.ts` directly plus a local directory/aggregator
  list) → confidence tiering (`high`/`medium`/`low` by mention count only —
  no "vs"/"serve"-framing signal exists for a company-list result, so
  tiering is simpler than the sibling modules') → cap at 6.
- Domain resolution is the one genuinely new, expensive step: reuses
  `discoverCompanyWebsite()` from `website-discovery.ts` directly (Item 1's
  content-based, word-boundary-verified resolver — not reinvented), run
  sequentially and only against the capped survivor set (2 search queries +
  up to 4 homepage fetches per candidate). `domain`/`domain_confidence` are
  only set on a `'confirmed'` result; an unconfirmed candidate still
  surfaces with just name+reason and gets researched by name instead of URL
  downstream.
- New route `POST /api/admin/company-discovery`
  (`{ icpSegment, excludeCompanyName? }`), thin wrapper matching
  `batch-parse/route.ts`'s shape.
- New standalone page `/admin/company-discovery` (added to `nav-config.ts`)
  rather than embedding into `ResearchCard` — deliberate: the ICP
  Generator session already flagged company-matching as a separate later
  milestone, not something to fold into "research this company." The
  page's "Research Selected" loop is copied verbatim in shape from
  `batch-upload/page.tsx` (`DedupedCompany` handoff type, `quota-pause.ts`
  detection, as-you-go `persistResult` to run-history) — same reasoning as
  `ResearchCard` being extracted into its own file for exactly this kind of
  reuse (CLAUDE.md Item 7).
- `tests/company-discovery.test.ts` (20 assertions) covers both extraction
  strategies, filtering, and tiering. Full suite: 120/120 pass, `tsc
  --noEmit` clean.
- **Live end-to-end run — done (2026-07-15).** Ran against segment "oil and
  gas" (excluding Ador Welding) with real Tavily/Serper quota: 2 of 2 raw
  candidates survived filtering (Anadarko Petroleum, Hess Corp, both `high`
  confidence), `sufficiency: sufficient`. One real, non-blocking false
  positive found: `discoverCompanyWebsite()` (reused from
  `website-discovery.ts`) resolved Anadarko Petroleum to `petroleum.gov.gy`
  (a Guyana government site) at `medium` confidence — the same loose
  body-text-match limitation already documented for that function elsewhere
  (e.g. the AITG/miraheze false positive), now confirmed manifesting via
  this module's reuse of it too. Hess Corp correctly returned with no domain
  rather than guessing. Not fixed this session — logged as a precision gap
  in the shared resolver, not new code.
- Non-goals: no scoring/ranking beyond confidence tier + domain-resolution
  status; not recursive (does not chain into discovering ICP segments FOR
  the discovered companies); no LLM involvement anywhere in this module.

## Research Evaluation Framework (Phase 2, item 5) — 2026-07-15

- **Boundary vs item 4** (already recorded above, restated here for
  locality): item 4 (`lib/pipeline/research-quality.ts`) runs LIVE inside
  every real pipeline call, per-run, for a human reviewer. Item 5 is a
  separate, OFFLINE, `benchmarks/`-only aggregator that produces one 0-100
  score per company run (plus a mean across a whole benchmark run) for
  comparing pipeline versions over time. It consumes item 4's
  `items_flagged/items_audited` ratio as one of seven input signals — it
  does not recompute anything item 4 already computes, and it does not gate,
  suppress, or downgrade any pipeline output. No new LLM calls, no new
  vendor calls, no live-pipeline wiring at all.
- New `benchmarks/research-evaluation.ts`: pure, sync `evaluateResearch(input:
  EvaluationInput): ResearchEvaluationScore` plus `aggregateEvaluations()`.
  Zero I/O — reads only fields already present in a benchmark run's API
  response (`analysisResult`, which IS the full `NormalizedAnalysis`) plus
  the `CheckResult[]` `benchmark-runner.ts` already computes via its
  existing `runChecks()`.
- **Rubric — 7 dimensions summing to 100**, each operationalizing a
  documented quality goal from `CLAUDE.md` rather than an arbitrary metric:
  1. Pipeline reliability (20) — success required or the whole score is 0
     (not just this dimension — a failed run has no trustworthy
     `analysisResult`, so letting other dimensions read "empty" as "honest
     nothing" would hand out undeserved credit); otherwise scored by the
     validation gate tier (PASS 20 / WARN 14 / PARTIAL 8 / FAIL 0).
  2. Evidence-backed opportunities (20) — ratio of opportunities carrying a
     real `evidence_id`, operationalizing the "evidence → problem →
     capability, not invented titles" target pattern. Zero opportunities
     scores full credit when `evidence_sufficiency: 'insufficient'` (the
     documented "9th outcome," CLAUDE.md rule 2) — an honest "nothing found"
     is not a defect — but only half credit when evidence was `'sufficient'`
     and still produced nothing.
  3. Evidence sufficiency & signal depth (15) — half for
     `evidence_sufficiency === 'sufficient'`, half scaled by
     `min(1, signals/minSignals)` against the benchmark spec's own threshold.
  4. Pain-point quality (10) — same evidence-backed-ratio logic as dimension
     2, applied to `pain_points_structured`, additionally excluding
     `confidence: 'low'` entries from the "backed" count.
  5. Competitor / ICP discovery yield (10) — 5 pts each for
     `competitor_sufficiency`/`icp_sufficiency` === `'sufficient'`, rewarding
     Phase 2 items 1-2 actually surfacing something on a real run, not just
     being wired with safe empty defaults.
  6. Research quality flag ratio (15) — `(1 - items_flagged/items_audited) *
     15`, full credit when nothing was auditable. This is the dimension that
     consumes item 4's output, per the boundary above.
  7. Narrative safety (10) — binary, reuses `benchmark-runner.ts`'s existing
     `no_forbidden:"..."` checks rather than re-scanning narrative text; a
     single cross-industry contamination is a real defect, not partial
     credit.
- **Wired into `benchmarks/benchmark-runner.ts`**, not a separate script:
  `buildEvaluationInput()` assembles the narrow `EvaluationInput` from the
  same `spec`/`apiResponse`/`checks` the existing per-company loop already
  has; `evaluateResearch()` runs after `runChecks()`; the score is attached
  to `BenchmarkResult.evaluation` and printed under each company's existing
  check output. After the loop: `aggregateEvaluations()` computes the
  mean/min/max across companies, printed in a new "RESEARCH EVALUATION
  FRAMEWORK" summary block, then written to
  `benchmarks/evaluation-history/eval-<timestamp>.json` (a new directory,
  separate from `benchmarks/debug/`'s per-run raw dumps, since this is
  specifically the "scores over time" record item 5 exists for).
  `readPreviousEvaluation()` loads the most recent prior history file
  (sorted by filename timestamp) BEFORE the new one is written, and prints a
  delta against it — flags a `⚠ Regression` when the mean drops by more than
  5 points, informational only, does not fail the run or change its exit
  code (`npm run benchmark`'s exit code stays governed solely by
  `checks`-derived FAILs, unchanged).
- `ApiResponse.analysisResult`'s type in `benchmark-runner.ts` was widened
  (not the API itself — it already returns the full `NormalizedAnalysis`
  under this field) to include the fields dimensions 2-6 read:
  `pain_points_structured`, `evidence_id`/`confidence`/
  `opportunity_confidence`/`relevance` on `opportunities`,
  `evidence_sufficiency`, `competitor_sufficiency`, `icp_sufficiency`,
  `research_quality`.
- New `tests/research-evaluation.test.ts` (18 assertions) covers all 7
  dimensions plus `aggregateEvaluations()`, including the "failed pipeline
  zeros the whole score" case (caught by a first draft of the aggregate test
  that assumed only the reliability dimension would be zero — the fix
  short-circuits `evaluateResearch()` to an all-zero result when
  `!input.success`, before dimensions 2-7 ever run).
- **Verified**: `tsc --noEmit` clean, full suite 180/180 pass (162
  pre-existing + 18 new). Dry-run of `benchmarks/benchmark-runner.ts`
  against an unreachable host (`BASE_URL=http://127.0.0.1:9`, zero real API
  quota spent) confirmed the full wiring executes end-to-end with no
  crash — all 6 companies correctly scored 0/100 via the
  `pipeline_success: false` path, the evaluation summary printed, and
  `benchmarks/evaluation-history/eval-<ts>.json` was written successfully.
  Dry-run artifacts deleted afterward (both the debug dump and the
  evaluation-history file/directory) rather than left as noise. A live
  benchmark run against a real dev server (real Tavily/Serper/LLM quota)
  was deliberately NOT done in this session — same "verify offline harness
  wiring via a dry run, defer live-quota runs" judgment call as this
  module's own zero-network design intends; nothing about this feature
  needs live pipeline output to prove correct, since it's a pure function
  over the same API response shape the pre-existing benchmark checks
  already consume.
- Non-goals: no gating of any pipeline run, no new pipeline stage, no
  per-item scoring UI (this is a `benchmarks/`-only CLI tool, not rendered
  in `ResearchCard.tsx`), no regression-blocking (the `⚠ Regression` line is
  informational, doesn't change the process exit code).

## Research Quality Framework (Phase 2, item 4) — architecture only, 2026-07-15

- **Problem**: every item type already computes its own confidence
  independently — signals via `evidence_strength`/`SignalStrength`
  (`evidence-extractor.ts`), opportunities via `ServiceThreshold`
  (`service-evidence.ts`), competitors/ICP segments via `tierConfidence()`
  (`competitor-discovery.ts`/`icp-generator.ts`), pain points via an
  LLM-assigned `confidence` field. Nothing cross-checks whether an item's
  stated confidence is actually justified by its evidence, and nothing rolls
  these up into one reviewable audit trail.
- **Scope decision**: a per-item confidence AUDIT, not a new scoring engine
  and not a replacement for any existing confidence field. Purely
  informational — never gates, suppresses, or downgrades an item, same
  discipline as `evidence_sufficiency`.
- **Design**: a pure, sync, rule-based function,
  `auditResearchQuality(normalized: NormalizedAnalysis)`, run at the end of
  `normalize.ts` after everything else is assembled. No new LLM calls, no
  new vendor calls, no new pipeline stage/timing concerns (unlike
  Competitor/ICP discovery, needs zero network I/O). Checks reuse signals
  that already exist rather than recomputing confidence — e.g. flag an item
  whose confidence is "high" but whose evidence is tagged
  `product_capability` (the documented customer-facing-evidence-misread-as-
  internal-pain false positive from `classifySubject()`); flag single-mention
  items marked "high" where that type's own tiering logic normally requires
  2+ mentions; flag cross-item name collisions that slipped past a module's
  own self-name filter.
- **Output shape**: additive-only `research_quality: { flags: QualityFlag[],
  items_audited, items_flagged }` on `NormalizedAnalysis`. `QualityFlag` =
  `{ item_type, item_ref, flag, reason, severity: 'info'|'warn' }` — no
  `'error'` severity, since this never gates.
- **Item 4 vs item 5 boundary (resolved this session)**: item 4 runs LIVE
  inside every real pipeline call, for a human reviewer (rendered in the
  admin UI next to Signals/Opportunities/Competitors). Item 5 (Research
  Evaluation Framework) stays a separate, OFFLINE, benchmark-harness-only
  aggregator producing one 0-100 score across many reports for comparing
  pipeline versions over time — it may consume item 4's
  `items_flagged/items_audited` ratio as one input signal, but lives in
  `benchmark/`, not in the live pipeline. Do not conflate the two.
- **Non-goals**: no new confidence computation, no gating, no new vendor/API
  calls, no LLM narration.

## Research Quality Framework (Phase 2, item 4) — implementation done, 2026-07-15

- New `lib/pipeline/research-quality.ts`: `QualityFlag`/`QualityFlagType`
  (`evidence_subject_mismatch` | `single_mention_high_confidence` |
  `self_name_collision`) / `ResearchQualityAudit` types, plus
  `auditResearchQuality(normalized: NormalizedAnalysis)`. Pure/sync, zero
  network I/O, per the architecture session's design.
- Three checks implemented, all reusing existing signals rather than
  recomputing confidence: (1) evidence-subject mismatch — a high-confidence
  opportunity (`opportunity_confidence`/`confidence` = 'high' or
  `relevance` = 'High') or structured pain point whose `evidence_id`
  resolves to an evidence item tagged `subject: 'product_capability'`; (2)
  single-mention high confidence — a competitor/ICP segment with
  `confidence: 'high'` but fewer than 2 `source_urls` (a close proxy for
  `mention_count`, since the final merged shape on `NormalizedAnalysis`
  doesn't carry `mention_count` directly — only the pre-merge `candidates`
  array in `CompetitorDiscoveryResult`/`ICPDiscoveryResult` does, and that
  isn't threaded through to `NormalizedAnalysis`); (3) self-name collision —
  re-runs `isSelfName()` (imported from `competitor-discovery.ts`, not
  duplicated) against `company_name` for every competitor/ICP segment name,
  as a safety net over the final merged output in case one slipped past a
  module's own discovery-time self-name filter.
- Wired into `normalize.ts`: the fully-assembled object (minus
  `research_quality`) is built first as `withoutQuality`, then
  `auditResearchQuality(withoutQuality as NormalizedAnalysis)` runs against
  it, then the final return spreads `withoutQuality` plus the computed
  `research_quality` field — necessary because the audit cross-checks
  fields (evidence vs. opportunity confidence, competitor/ICP confidence vs.
  source count) that only exist once everything else is assembled.
- `items_flagged` counts distinct flagged items, not flag count — an item
  can receive multiple flags (e.g. a competitor that's both a single-mention
  high-confidence match AND a self-name collision) and is still one flagged
  item, tracked via a `Set<"item_type:item_ref">` key.
- **Not done this session, deliberately deferred**: no UI rendering yet
  (`ResearchCard.tsx` doesn't have a "Research Quality" section) — same
  "schema/logic session, UI session separately" split Competitor Discovery
  Engine and ICP Generator each used before their own UI passes. No
  `getResearchQuality()` getter added to `analysis-sections.ts` yet either,
  for the same reason — add both together when the UI section is built, not
  before.
- **Verified**: `tsc --noEmit` clean. New `tests/research-quality.test.ts`,
  15 assertions covering all three check types plus
  `items_audited`/`items_flagged` accounting (including the
  one-item-two-flags case). Full suite 135/135 pass (120 pre-existing + 15
  new). No live dev-server pass — this session added no new UI-observable
  surface (see "not done" above), consistent with this repo's own
  `<when_to_verify>` guidance to skip browser verification when a change
  isn't observable in the preview.

## Research Quality Framework (Phase 2, item 4) — UI pass, 2026-07-15

- Closes the "deferred to a future session" note above. Added
  `getResearchQuality(data): ResearchQualityAudit | undefined` to
  `lib/pipeline/analysis-sections.ts` — same loosened-optional-field
  convention as `getCompetitors()`/`getICPSegments()` (a local
  `QualityFlag`/`ResearchQualityAudit` pair, not imported directly from
  `research-quality.ts`, since this file reads off raw
  `Record<string, unknown>` data, not the strict `NormalizedAnalysis`
  type).
- Added a "Research Quality" section to `ResearchCard.tsx`, placed after
  Target Customer Segments and before Personalization Summary — matches
  DECISIONS.md's original architecture note ("rendered in the admin UI next
  to Signals/Opportunities/Competitors"). Same "only render when there's
  something real" discipline as Competitors/ICP segments: gated on
  `items_flagged > 0`, so a clean audit (the common case) shows no section
  at all rather than a "0 flags" empty state. Each flag renders item name,
  reason text, item type, and a severity badge (only `warn` exists today,
  styled with the same signal-medium tokens Competitors/ICP segments use
  for their own medium-confidence badge — no new color introduced).
- **No new test file** — this is presentation-only over an already-tested
  pure function (`auditResearchQuality()`'s own 15 assertions in
  `tests/research-quality.test.ts` already cover the logic this section
  renders).
- **Verified**: `tsc --noEmit` clean, full suite still 135/135 (unchanged —
  no new logic to test). Live dev-server pass over `/admin/intelligence-lab`
  and `/admin/run-history` — both compile and render with zero console/
  server errors.
- **Live end-to-end run — done (2026-07-15), same session.** Real Full-mode
  analysis via `/admin/intelligence-lab` with real Tavily/Serper/LLM quota
  (explicit user confirmation given first). The section rendered 4 real
  flags exactly as designed: 2 `self_name_collision` competitors ("Bharat
  Forge", "Compare Bharat Forge Quotes" — both slipped past
  `competitor-discovery.ts`'s own discovery-time self-name filter) and 2
  `single_mention_high_confidence` ICP segments ("power", "oil and gas" —
  both marked `confidence: high` with only 1 source URL, violating
  `icp-generator.ts`'s own 2+-mention rule for high confidence). Each flag
  rendered the correct item name, reason text, item-type badge
  (`COMPETITOR`/`ICP_SEGMENT`), and `Warn` severity badge; the summary line
  correctly read "4 of 10 audited items flagged for review". This is exactly
  the failure mode item 4 was built to catch — real safety-net value, not
  just a UI smoke test, and closes the "not verified against a real flagged
  item" gap this entry originally left open.
  - **Incidental input note, not part of this change**: the run that
    produced this data was against a URL field that hadn't been cleared
    before typing, so the request actually went out as domain
    `bharatforge.comhttps` (a `bharatforge.com` value with `https://
    adorwelding.com` appended rather than replacing it) — a pre-existing
    text-input behavior in `intelligence-lab/page.tsx`, unrelated to
    Research Quality, not something this session's diff touches. The scrape
    itself failed (DNS resolution failure on the malformed hostname), which
    is exactly the scenario this repo's stub-injection/enrichment-primary
    path is built for — enrichment, competitor discovery, and ICP discovery
    all still ran successfully off the LLM's own name guess ("Bharat Forge
    Limited"), and produced a real, useful report despite the malformed
    input. Flagged separately via `spawn_task` rather than fixed here, since
    it's out of scope for this UI pass.

## Market Intelligence Layer (Phase 2, item 6) — 2026-07-15

- **Deliberate divergence from the Competitor Discovery / ICP Generator
  pattern, confirmed with the user before implementation.** Both of those
  are "code extracts a NAME → LLM narrates an explanation, merged back by
  identity match." A trend/growth-indicator/challenge/shift item is already
  a full statement pulled verbatim from a real search snippet — there is no
  name to explain and no LLM narration layer would add. So
  `lib/enrichment/market-intelligence.ts` is pure deterministic: search →
  classify each candidate sentence into one of 4 categories via keyword
  regex → dedupe → confidence-tier → cap. No new `analyze-v2.ts` prompt
  block, no `normalize.ts` merge-by-name step — `normalize.ts` passes
  `items` straight through from `_market_intelligence`.
- **Timing differs from Competitor/ICP for a real reason, not an
  oversight**: unlike those two, this module was considered for a
  post-classification timing slot (since "industry" could have been sourced
  from `primary_type`), but `primary_type`'s buckets (`manufacturer`,
  `industrial_vendor`, etc.) are too generic to search well on their own
  ("manufacturer industry trends" is too vague). Queries are anchored on
  the company name instead (`"<name>" industry trends`, etc.) — same
  anchor Competitor/ICP already use — so this module has no
  `primary_type`/classification dependency and is kicked off at the exact
  same pre-scrape point as `competitorDiscoveryPromise`/`icpDiscoveryPromise`
  in `route.ts`, with the same bounded (12s) await pattern and a new
  non-critical `MARKET_INTEL` gate (WARN-only, same tier as
  `COMPETITOR`/`ICP`/`ENRICHMENT`).
- **Category classification, most-specific-first**: `growth_indicator`
  (CAGR/market-size/numeric growth claims) → `challenge` (shortage/
  pressure/disruption language) → `shift` ("shifting toward"/"transitioning
  to" language) → `trend` (generic explicit "trend"/"emerging" language, the
  catch-all). A sentence containing both a numeric growth claim and the
  word "trend" classifies as `growth_indicator` — the more specific, more
  useful signal wins. Confidence tiering reuses the same
  `mention_count` + "strong indicator" (a concrete %/$/CAGR figure) formula
  Competitor/ICP already use for their `explicit_vs_framing`/
  `explicit_serve_framing` signals.
- **Sanity filter, not a second classification pass**: `classifyStatementRejection()`
  only runs on sentences that already matched a category pattern — it
  rejects fragments (too short/long, too few words, ALL-CAPS
  navigation-style headings), it does not decide topical relevance a second
  time.
- New "Market Intelligence" section in `ResearchCard.tsx`, same "only
  render when there's something real" discipline as Competitors/Target
  Customer Segments — statements render as-extracted, grouped by category
  label, with the code-derived confidence badge.
- New `tests/market-intelligence.test.ts` (18 assertions): category
  classification incl. the most-specific-first priority, the strong-
  indicator check, confidence tiering, and the statement sanity filter.
- **Verified**: `tsc --noEmit` clean, full suite 198/198 (180 pre-existing +
  18 new).
- **Live end-to-end run — done (2026-07-15).** The dev-server lock blocker
  from the implementation session (a second `next dev` instance refusing to
  start while another chat's server held the directory-scoped lock) was
  worked around rather than resolved by killing anything: that other
  server was already running on port 3000 for this same project, so this
  run hit its API directly via `curl` instead of starting a competing
  instance. Ran `discoverMarketIntelligence()` against Ador Welding through
  the real `/api/admin/test-analysis` endpoint with real Tavily/Serper
  quota (explicit user confirmation given first), reusing the existing
  scrape cache. Result: `MARKET_INTEL:PASS`, 4 items found, all 4 of 4 raw
  candidates survived filtering, `market_intelligence_sufficiency:
  "sufficient"`. All 4 were real, source-attributed `growth_indicator`
  statements at `medium` confidence (mention_count=1 each — correctly short
  of `high`, which needs 2+ mentions per `tierConfidence`): a welding-
  materials-market CAGR figure sourced to a real Yahoo Finance article, and
  a growth forecast sourced to Ador's own 2021-22 annual-report PDF. No
  `challenge`/`trend`/`shift` items surfaced this run — plausible given the
  real search results, not evidence of a category-detection gap (no
  regression test exercises "must find all 4 categories in one real run,"
  since that was never the module's contract). Competitor Discovery and ICP
  Generator both stayed regression-free on the same run (`COMPETITOR:PASS`
  5 found, `ICP:PASS` 5 found — consistent with their own earlier live runs
  against this company). `ResearchCard.tsx`'s render path (the
  `marketIntel.length > 0` gate, `statement`/`category`/`confidence`
  fields) was confirmed against the actual returned JSON shape by reading
  the component rather than re-spending quota on a second UI-driven run —
  the Competitor Discovery/ICP Generator sessions already did a full
  browser-driven render pass with real data and established that
  `ResearchCard`'s render conventions work correctly for this same
  "list of confidence-badged items" shape.

**Market Intelligence Layer (Phase 2 item 6) is now COMPLETE, including live
verification.**

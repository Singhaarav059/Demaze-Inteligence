# Demaze AI Outbound Intelligence Platform — Project Context

> **This file is the lean, current-state reference.** The full chronological
> session-by-session narrative (every bug root-caused, every fix, every
> live-verification) that used to live here was moved verbatim to
> [`docs/PROJECT_HISTORY.md`](docs/PROJECT_HISTORY.md) on 2026-08-24 — nothing
> was deleted, only relocated, to cut what gets loaded into every session.
> Check that file for "why does this code look like this" or "has this bug
> already been hit before." Check `docs/DECISIONS.md`, `docs/ROADMAP.md`,
> `docs/PROJECT_STATE.md`, `docs/CURRENT_TASK.md` for current living status —
> those are kept up to date; this file's job is standing rules and
> architecture facts that don't change session to session.

## What this is
A **Company Intelligence Engine** for Demaze outbound sales — not a generic
website analyzer. The target is Explee's (explee.com) full 6-phase AutoGTM
loop, and as of the current state, **all 6 phases are built**: research
company → explore competitors → define ICP segments → find potential
customers (company discovery) → find decision makers → outreach send
(including tracking + automatic follow-ups). Target industries: Manufacturing,
Automotive, Industrial, SaaS, Financial Institutions, SMBs — plus E-commerce,
added as a third active sector-playbook vertical alongside Manufacturing and
Automotive (see `lib/sector-playbook/`).

A lead row's buyer/contact, when it arrives via an already-attached
Sales-Navigator-style export, is input data — this pipeline never infers or
ranks WHO the buyer is from such a row. Separately, **decision-maker
discovery is now a real, built capability** (via Prospeo) for the company-
discovery flow, where no contact was ever given — the "buyer is input, not
inferred" rule applies specifically to rows that already carry a named
person, not to the whole product.

## Output schema
Core 5 fields per company: **Company Description, Pain Points, AI
Opportunities, Recent News, Personalization Summary.** Layered on top:
Competitors, Target Customer Segments (ICP), Market Intelligence, Outreach
Intelligence (`why_contact`/`likely_problem`/`recommended_service`/
`conversation_angle`/`why_now`), and sector-playbook qualification
(sector fit / company fit / opportunity evidence / contactability scores,
each opportunity tagged "Confirmed evidence" vs "Reasonable inference").
No buyer/stakeholder field on the core report — that's the input-data rule
above, still standing for Sales-Navigator-shaped rows.

## Scope boundary — standing rules
- **LinkedIn scraping/automation stays permanently excluded**, regardless of
  any other scope expansion. Contact discovery goes through a people-data API
  (Prospeo), never LinkedIn. A manually-pasted LinkedIn URL field is fine;
  scraping or session automation against LinkedIn is not.
- **India's MCA company registry is ruled out** — no public API exists, only
  a CAPTCHA-gated portal. Building CAPTCHA-solving automation is a hard line,
  not a judgment call. If India filing data is wanted later, that's a paid
  third-party aggregator decision (Probe42/Tofler/Zauba), not something to
  build toward.
- **Sending real email to real prospects always requires explicit, per-batch
  user confirmation** — building the capability to send is not standing
  authorization to actually send.
- **Don't install or wire in third-party tools/MCP servers/vendors on the
  strength of a marketing thread or unverified recommendation.** Vet the
  actual repo/API first. (See `docs/DECISIONS.md` for the real vendor
  decisions made and why — Prospeo for decision-maker/email-finder/
  enrichment, Gmail for sending, Explee under POC evaluation, Coresignal/
  Apollo/Lemlist/OpenRouter all evaluated and removed.)

## Business context — ground truth lives in dedicated files
Do not use inline business-context guesses anywhere in this codebase as
authoritative. Two files hold this and supersede any inline version:
- **`DEMAZE_CAPABILITY_MAP.md`** — the 8 confirmed Demaze service lines
  (given directly, not inferred).
- **`SERVICE_TO_OUTREACH_MAPPING.md`** — Evidence → Disqualifiers → Likely
  Pain → Why Demaze → Threshold → Outreach Angle for all 8 services,
  validated against real scraped data. This is the actual blueprint
  `generateDeterministicOpportunities()`/`service-evidence.ts` target.

## Cross-cutting rules — apply before touching signal/opportunity code
1. **Customer-facing evidence ≠ internal pain.** A company's own
   product/service copy (what it sells to ITS customers) must not be scored
   as evidence of the company's own internal operational gap. Use
   `classifySubject()`'s `product_capability` vs `company_operations`/
   `company_strategy` distinction, already built for this.
2. **Insufficient evidence → no forced output.** Not every company clears a
   threshold on every service. The correct output when evidence is thin is
   no forced fit, not a template stretched over nothing.
3. **Buyer identity is input, not generated**, for rows that arrive with a
   named person already attached (see "What this is" above). Named-
   individual evidence extraction still feeds general company signals, just
   never a "buyer:" field.
4. Evidence describing what a company **sells to its own customers** must
   never be scored as evidence of that company's own internal gap — same
   rule as #1, called out separately because it's the single highest-
   frequency false-positive class found across real benchmark companies.
5. A `quote-verification` discipline (`lib/pipeline/quote-verification.ts`)
   gates any LLM-claimed "observed" evidence — a claim must contain a real,
   verbatim-matchable quote from content the LLM was actually shown, or it's
   dropped. "Inferred" claims don't need a quote but must be honestly
   labeled as inferred, never dressed up as observed.

## Known environment gotcha — read before debugging "why isn't my fix working"
The Next.js dev server on Windows does not reliably pick up file changes made
from a different shell context (cross-OS file-watcher issue). After editing
scraper/classifier files, restart the dev server before trusting a benchmark
result reflects the change.

## Current architecture facts (don't re-derive — build on these)
- Business/company classification runs through `CompanyProfile`, not a
  legacy `BusinessModel` type.
- `clusterSignals()` and `generateDeterministicOpportunities()` are active in
  the pipeline.
- Validation stage returns PASS / WARN / PARTIAL / FAIL — the pipeline is
  designed to never hard-fail when any fallback source returned content.
- `ENRICHMENT_TIMEOUT_MS` is 70000.
- LLM JSON responses are fence-stripped before `JSON.parse()` — considered
  solved, don't re-solve.
- Analysis mode defaults to `full` everywhere (was `lightweight`); the
  Lightweight/Full toggle is still available per-run.
- Enrichment discovery (`discoverAndFetchExternalSources()`) runs in
  parallel with scraping, not after it — kicked off as soon as `domain` is
  known, before Stage 1 SCRAPE starts.
- PDFs are fetched and parsed via `pdf-parse`, not dropped or routed through
  Firecrawl.
- Competitor Discovery / ICP Generator both try, in order: (1) AI direct-
  knowledge (a single LLM call, explicit `has_knowledge: false` decline
  path), (2) search-grounded LLM synthesis (real search results, quote-
  verified claims, real `source_urls`), (3) legacy regex-extraction search
  pipeline as the final fallback. All three tiers are live.
- A shared `extraction-guards.ts` filters adversarial/scam-shaped source
  content (fraud/scam vocabulary) before it ever reaches search-based
  extraction or LLM synthesis, across every discovery module.
- Name/company matching across the codebase (`website-discovery.ts`,
  `evidence-extractor.ts`, `competitor-discovery.ts`, `icp-generator.ts`,
  `company-discovery.ts`, `company-dedup.ts`) uses Unicode-aware
  normalization (`\p{L}\p{N}`, not ASCII `\w`) and a custom
  `wordBoundaryRegex()` helper (JS's native `\b` is always ASCII-only,
  even with the `u` flag) — needed for any company name with a diacritic.
- The automatic follow-up engine, warmup engine, and open-tracking pixel are
  all built and code-complete. `FOLLOWUP_ENGINE_ENABLED` and
  `WARMUP_ENGINE_ENABLED` ship unset by default — flipping them on is a
  deliberate user action, not something to enable proactively.
- **Vendor/provider "is X actually active right now" is runtime DB state,
  not something this file should assert a snapshot of.** Check
  `/admin/outbound/integrations` or the live `outbound_integrations` table
  directly — this file's dated history can lag actual state.

## Model chain (current)
Narrative/completion calls: NVIDIA NIM — `openai/gpt-oss-120b` (default) →
`deepseek-ai/deepseek-v4-pro` (fallback). OpenRouter was removed entirely.
Gemini calls (direct-knowledge competitor/ICP discovery, some synthesis
paths) go through **Vertex AI Express Mode** (`VertexGeminiProvider`,
`gemini-3.6-flash`), not an AI Studio key — env var is
`GEMINI_VERTEX_API_KEY`, and `thinkingConfig.thinkingLevel: 'MINIMAL'` is
set deliberately (Gemini 3 models can't fully disable thinking, and an
unbounded thinking budget was the root cause of a historical empty-response
bug under the old OpenAI-compatible shim).

## Benchmark set (current, 10 companies)
Ace Pipeline, Ador Welding, AS Agri & Aqua, AITG, A-1 Fence Products, ATE
Group, Bharat Forge, Muthoot Finance, Chargebee, Lechler (the non-English/
multi-locale regression fixture). Run `npm run benchmark` after pipeline
changes; compare against the previous snapshot before claiming a fix worked.
Some companies have documented, accepted scrape-content non-determinism
between runs (Ador Welding, AITG, A-1 Fence Products, Bharat Forge) — see
`docs/PROJECT_HISTORY.md` before treating a single WARN/FAIL as a
regression; re-run the individual company first.

## The actual goal
NOT "10/10 benchmark PASS." The goal is: any company input → pipeline always
returns usable intelligence → no hard crashes → no hard FAILs → graceful
degradation on ugly real-world sites.

## DO NOT WORK ON RIGHT NOW
- More model swaps or classifier/regex tweaking without a specific,
  validated real-data gap to fix — speculative tuning is out.
- **LinkedIn-driven architecture decisions.** Stays excluded regardless of
  any other scope discussion — flag and stop rather than proceeding if a
  future request pushes toward it.
- MCA (India company registry) automation — CAPTCHA-gated, hard line.
- Auto-installing third-party tools/MCP servers on the strength of a
  marketing thread — vet first.
- Re-litigating already-resolved architecture decisions (model chain,
  vendor choice, scope boundary) without new evidence — check
  `docs/DECISIONS.md` and `docs/PROJECT_HISTORY.md` first.

## Known still-open gaps (as of 2026-08-24)
- Gmail OAuth for the sending capability needs periodic manual
  re-authorization (Testing-mode 7-day refresh-token expiry) — check
  `/admin/outbound/integrations` before assuming send/follow-up capability
  is live.
- `scraper.ts`'s `assessScrapeQuality()` still has no content-relevance
  signal (page/char count only) — a long-flagged, not-yet-fixed precision
  gap.
- A non-English/diacritic-name benchmark fixture beyond Lechler still
  doesn't exist for most of the codebase's Unicode-normalization fixes.
- Several admin table/list pages had no dedicated mobile card layout until
  2026-08-24 (run-history, outbound/overview, outbound/followups,
  company-discovery, intelligence-lab/ComparisonPanel) — now built; see
  `docs/PROJECT_HISTORY.md` for the verification details.

## Benchmark workflow
Run `benchmark/run-benchmark.ts` (or `npm run benchmark`) after every change
to the pipeline. Write output to `benchmark/results-history/<date>.json`.
Compare against the previous snapshot before claiming a fix worked — a fix
for one company should not silently regress another that was previously
passing.

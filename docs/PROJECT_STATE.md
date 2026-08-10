# Project State

Snapshot as of 2026-08-10. For how we got here, see `docs/DECISIONS.md`. For
what's next, see `docs/ROADMAP.md` and `CURRENT_TASK.md`.

## Pipeline (implemented, Phase 1 + Phase 2)

```
Company URL (or name, via website-discovery.ts if no URL given)
  -> Scraper (multi-tier fallback: Firecrawl -> Jina Reader -> Tavily -> direct fetch)
  -> Enrichment discovery+fetch (parallel with scrape, not a fallback — web-enricher.ts,
     includes SEC EDGAR filings when a company matches a public ticker)
  -> Competitor discovery (parallel with scrape — competitor-discovery.ts, Phase 2 item 1)
  -> ICP Generator (parallel with scrape — icp-generator.ts, Phase 2 item 2)
  -> Market Intelligence (parallel with scrape — market-intelligence.ts, Phase 2 item 6)
  -> Company identification / CompanyProfile classification (evidence-extractor.ts)
  -> Signal extraction (SIGNAL_PATTERNS)
  -> Deterministic opportunity generation (service-evidence.ts, 8 confirmed services)
  -> Single LLM narrative call (analyze-v2.ts) — enriches/narrates, doesn't invent
     (competitor candidates narrated via [COMPETITOR CANDIDATES], ICP segments
     via [ICP CANDIDATES]); also produces Outreach Intelligence
     (why_contact/why_now/likely_problem/recommended_service/conversation_angle)
  -> normalize.ts merges deterministic + LLM output (opportunities, competitors, ICP segments)
  -> Research Quality audit (research-quality.ts, pure/sync, zero network I/O,
     Phase 2 item 4) — cross-checks stated confidence against evidence, informational only
  -> Validation gate (PASS / WARN / PARTIAL, never hard FAIL)
  -> Final report: locked 5 fields + Competitors + Target Customer Segments
     + Market Intelligence + Outreach Intelligence + Research Quality
```

Entry point: `app/api/admin/test-analysis/route.ts`. Admin UI:
`app/admin/intelligence-lab/`, `app/admin/batch-upload/`, `app/admin/company-discovery/`.

## Outbound execution (Phase 3 — Company Discovery Engine onward)

Given a researched company, the guided **Auto Flow** (`app/admin/auto-gtm/`)
walks: Research → Find Decision Makers (Prospeo `search-person`, grounded
against scraped leadership evidence) → Outreach & Send (LLM-generated
subject/email/follow-ups, real Gmail send) → Track & Follow Up (open
tracking via a real pixel, manual or automatic follow-ups). See
`docs/ROADMAP.md`'s "Phase 3" section for the full module list and
`docs/DECISIONS.md` for the vendor/architecture decisions behind each.

Two autonomous background engines exist (`instrumentation.ts`), both
mechanically live-verified against real Gmail data but **both left off by
default** — turning either on is a deliberate user decision, not implied
by verification being complete:
- `WARMUP_ENGINE_ENABLED` — DIY warmup engine, pools the user's own
  connected Gmail accounts.
- `FOLLOWUP_ENGINE_ENABLED` — auto-sends the next follow-up only for
  contacts confirmed unopened past cadence; fails closed if open-tracking
  isn't configured.

## Known-good (do not regress)

Benchmark set: Ace Pipeline, Ador Welding, AS Agri & Aqua, AITG, A-1 Fence
Products, ATE Group, Lechler (the non-English/multi-locale regression
fixture) — all classify correctly per `benchmarks/run-benchmark.ts`.
Reference set (Bharat Forge, Muthoot Finance, Chargebee) — wired into the
same automated run since 2026-07-23.

## Known gaps (not blocking, not being worked on right now)

- **Batch-originated shared-campaign resume path** — `resumeFromRun()`'s
  fix for a campaign shared across multiple batch-researched companies has
  never been exercised against a real batch campaign, because none exists
  in the database yet. Deferred at the user's own request.
- **India's MCA company registry — explicitly excluded, not deferred.**
  No public API exists, only a CAPTCHA-gated portal; building automation to
  bypass a CAPTCHA is a hard line. A paid third-party aggregator would be a
  separate future vendor decision if this data is ever wanted.
- **Mobile/phone enrichment via Prospeo** — deliberately not wired (real
  per-lookup cost), same "needs its own explicit go-ahead" reasoning as
  every other paid-per-call capability in this app.
- **LinkedIn scraping/automation** — stays permanently excluded regardless
  of any other decision. Contact discovery goes through Prospeo, never
  LinkedIn.
- **Real deliverability caveat, not a code bug**: test sends during the
  open-tracking verification landed in Gmail spam. Flagged as worth a
  future look (self-send pattern, mailbox warmup status, generic
  LLM-drafted subject lines are plausible contributors), not investigated.
- Scraper reliability flakiness for a handful of specific companies
  (A-1 Fence Products, Bharat Forge `primary_type` non-determinism) is
  real, pre-existing, and accepted — see `CLAUDE.md`'s "Company-specific
  known issues" section, don't diagnose a re-occurrence as a fresh
  regression without retrying first.

## Test infra

`vitest` (`npm test`). 667 assertions across 46 files as of 2026-08-10 —
run `npm test` for the current count, don't trust a stale number here.

## Env gotcha

Windows dev server does not pick up file changes made from a Linux shell —
restart `npm run dev` after editing scraper/classifier/prompt files before
trusting a live run.

# Project State

Snapshot as of 2026-07-15. For how we got here, see `docs/DECISIONS.md`. For
what's next, see `docs/ROADMAP.md` and `CURRENT_TASK.md`.

## Pipeline (implemented, Phase 1)

```
Company URL (or name, via website-discovery.ts if no URL given)
  -> Scraper (multi-tier fallback: Firecrawl -> Jina Reader -> Tavily -> direct fetch)
  -> Enrichment discovery+fetch (parallel with scrape, not a fallback — web-enricher.ts)
  -> Competitor discovery (parallel with scrape — competitor-discovery.ts, Phase 2 item 1)
  -> ICP Generator (parallel with scrape — icp-generator.ts, Phase 2 item 2)
  -> Company identification / CompanyProfile classification (evidence-extractor.ts)
  -> Signal extraction (SIGNAL_PATTERNS)
  -> Deterministic opportunity generation (service-evidence.ts, 8 confirmed services)
  -> Single LLM narrative call (analyze-v2.ts) — enriches/narrates, doesn't invent
     (competitor candidates narrated via [COMPETITOR CANDIDATES], ICP segments
     via [ICP CANDIDATES])
  -> normalize.ts merges deterministic + LLM output (opportunities, competitors, ICP segments)
  -> Research Quality audit (research-quality.ts, pure/sync, zero network I/O,
     Phase 2 item 4) — cross-checks stated confidence against evidence, informational only
  -> Validation gate (PASS / WARN / PARTIAL, never hard FAIL)
  -> Final report: locked 5 fields + Competitors + Target Customer Segments
     + Research Quality (additive, Phase 2)
```

Entry point: `app/api/admin/test-analysis/route.ts`. Admin UI:
`app/admin/intelligence-lab/`, `app/admin/batch-upload/`.

## Known-good (do not regress)

Benchmark set: Ace Pipeline, Ador Welding, AS Agri & Aqua, AITG, A-1 Fence
Products, ATE Group — all classify correctly per
`benchmark/run-benchmark.ts`. Reference set (Bharat Forge, Muthoot Finance,
Chargebee) verified manually, not in the automated run.

## Known gaps (not blocking, not being worked on right now)

- Muthoot Finance direct scrape fails entirely (`fetch failed`) — separate,
  pre-existing scraper-reliability issue, not classifier-related.
- A-1 Fence Products: `fetch failed` — Cloudflare/SSL/slow-site suspected,
  not root-caused.
- `detectPageType()` receives full URL not bare path (homepage
  mislabeling) — deliberately NOT fixed in isolation, needs a dedicated
  session (see `DECISIONS.md` history in CLAUDE.md if detail is needed).
- Item 4 (executive-change/investor-transcript query targeting) — deferred.
- Government-filings APIs (EDGAR/MCA) — future category, not built.

## Test infra

`vitest` (`npm test`). 98 assertions across 6 files as of 2026-07-15
(URL-classifier adversarial matrix, PDF fetch/parse, batch-quota-pause
detection, brief-html/humanize, competitor-discovery extraction/filtering/
tiering, icp-generator extraction/filtering/tiering — run `npm test` for
current count, don't trust a stale number here).

## Env gotcha

Windows dev server does not pick up file changes made from a Linux shell —
restart `npm run dev` after editing scraper/classifier/prompt files before
trusting a live run.

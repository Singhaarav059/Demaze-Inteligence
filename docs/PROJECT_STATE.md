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
`benchmarks/run-benchmark.ts`. Reference set (Bharat Forge, Muthoot Finance,
Chargebee) — **as of 2026-07-23, now wired into the same automated run** (see
below), no longer "verified manually only."

## Known gaps (not blocking, not being worked on right now)

- **RESOLVED 2026-07-23 — benchmark fixture filename/content mismatch.**
  `benchmarks/companies/bharat-forge.json` / `hdfc-bank.json` / `zoho.json`
  used to hold the AITG / A-1 Fence Products / ATE Group specs respectively —
  renamed to `aitg.json` / `a1-fence-products.json` / `ate-group.json` to
  match their actual content (confirmed via reading
  `benchmarks/benchmark-runner.ts`'s `loadSpecs()` that the runner loads
  every `*.json` file in the directory regardless of filename, so this was a
  pure rename, zero behavior change). New fixtures created for the original
  3-company reference set — `bharat-forge.json` (bharatforge.com,
  `manufacturer`), `muthoot-finance.json` (muthootfinance.com, see below),
  `chargebee.json` (chargebee.com, `software_saas`) — so `npm run benchmark`
  now covers all 9 companies automatically, closing the "reference set not in
  the automated run" gap. New `tests/benchmark-fixtures.test.ts` (5
  assertions, no network) guards the filename/content mapping and the full
  9-company set going forward.
- **Muthoot Finance root-caused 2026-07-23 (was: "`fetch failed`, separate
  pre-existing scraper-reliability issue").** Direct `curl` testing (no API
  keys/quota needed) found the real cause: `muthootfinance.com` sits behind a
  CloudFront WAF rule that hard-blocks (403, "Request blocked") any request
  whose User-Agent is either absent or self-identifies as a bot — confirmed
  the identical request succeeds (200, real Drupal-rendered content) with a
  realistic browser User-Agent and fails with either no UA (Node's `fetch`
  default) or this codebase's own old `'Mozilla/5.0 (compatible;
  DemazeBot/1.0)'` string. **Fixed** within this codebase's own direct-fetch
  tiers (`lib/pipeline/scraper.ts`'s sitemap fetch + corporate/B2B path
  probing + Jina reader fetch, `lib/enrichment/website-discovery.ts`'s
  candidate-verification fetch, `lib/enrichment/web-enricher.ts`'s PDF fetch)
  — all now send a real browser-shaped User-Agent instead of no UA or the old
  self-identifying bot string. **Not fully verified end-to-end**: this fixes
  every direct-fetch path in this codebase, but the PRIMARY scraper
  (Firecrawl's managed SDK) controls its own request headers internally,
  outside this codebase's control — whether Firecrawl itself gets through
  this same WAF rule is unconfirmed without spending real Firecrawl quota.
  The `muthoot-finance.json` benchmark fixture deliberately leaves
  `requiredProfileFlags`/`expectedPrimaryType` unset (same pattern as
  `acepipeline.json`'s genuine-uncertainty case) so the automated benchmark
  doesn't hard-FAIL on a scraper-reliability question that's improved-but-
  unconfirmed, not classifier-related either way.
- **A-1 Fence Products root-caused 2026-07-23 (was: "`fetch failed`,
  Cloudflare/SSL/slow-site suspected, not root-caused").** Direct testing
  (curl + `openssl s_client`) found the domain is currently healthy: valid
  TLS 1.3 handshake, consistent 200 OK in ~1.8-3.3s across multiple User-
  Agents (default curl UA, the old DemazeBot UA, a real browser UA) and both
  `www`/bare-domain forms — real page content returned every time, no
  Cloudflare interstitial/challenge page, no rate limiting observed. No
  anti-bot block, slow-site issue, or DNS/redirect problem reproduces today.
  The historically-reported `fetch failed` is most likely one of: (a)
  transient site downtime/flakiness at the original test time — this repo
  already documents this exact flakiness pattern extensively for this same
  company and others (AITG, Ador Welding) — or (b) Cloudflare's bot-
  management triggering specifically against Firecrawl's headless-browser
  fingerprint in a way plain HTTP doesn't reproduce, which cannot be
  confirmed without spending real Firecrawl quota. Per this investigation's
  own instructions, not forcing a workaround for an unreproducible/
  out-of-this-codebase's-control cause — documenting the finding instead.
  The same User-Agent fix applied for Muthoot Finance (above) also covers
  this domain's own direct-fetch fallback tiers, as a side benefit.
- `detectPageType()` receives full URL not bare path (homepage
  mislabeling) — deliberately NOT fixed in isolation, needs a dedicated
  session (see `DECISIONS.md` history in CLAUDE.md if detail is needed).
- ~~Item 4 (executive-change/investor-transcript query targeting) —
  deferred.~~ **DONE (2026-07-23), code + unit tests; live verification
  pending.** `lib/enrichment/discovery-engine.ts` gained 5 new query
  templates (2 investor-call-transcript, 3 executive-change-announcement)
  and 2 new `SourceType`s (`earnings_call_transcript`,
  `executive_change_announcement`) with dedicated `classifySourceType()`
  detection; `source-prioritizer.ts`'s `mustHave` pass now also guarantees
  a transcript slot when available. See CLAUDE.md's Implementation
  sequence, Item 4, for full detail.
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

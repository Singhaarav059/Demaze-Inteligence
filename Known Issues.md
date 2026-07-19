---
tags: [demaze, bugs, known-issues]
updated: 2026-07-13
---

# Known Issues

← [[PROJECT_STATUS]]

> [!warning] These are bugs, not backlog
> Everything here is a flagged, real, reproduced problem — not a "nice to have" feature. Kept separate from [[Left To Do]] (which is planned/unbuilt work) because these need root-causing before they can even be scheduled as a fix. Several are promoted into concrete To-Do items once there's enough of a lead to act on.

- [ ] **A-1 Fence Products** — direct scrape returns `fetch failed`. Cause not yet determined: Cloudflare, SSL, slow site, or regional block are all still on the table
- [ ] **Muthoot Finance** — direct scrape returns stub content only (`successfulUrls: []`, `primary_type: unknown`). Separate, pre-existing scraper-reliability gap specific to muthootfinance.com — unrelated to any classifier work, needs its own investigation (same diagnostic discipline as A-1 Fence above)
- [ ] **AS Agri & Aqua** — Tavily search-fallback parser bug flagged (`SearchData has no '.data'`, results actually live under `.web`) but never confirmed fixed — check before assuming Google Sites support is fully working
- [ ] **Ace Pipeline** — resolves to `conglomerate` via the (now-fixed) [[Classifier and Extraction Fixes|cascade bug]], but nothing else fires for its scraped content either — genuinely unknown correct classification, deliberately left unset in `acepipeline.json` rather than guessed
- [ ] **ATE Group website-discovery precision gap** — Serper found the correct domain (ategroup.com) as a candidate, but the plain `fetch()` used for candidate verification failed to retrieve its content (anti-bot/slow-response), so it scored `none` and fell through to `not_found`. Safe failure mode (no wrong guess), but real precision loss — the plain `fetch()` is less robust than Firecrawl (used elsewhere in the pipeline) against protected/slow sites
- [ ] **`benchmarks/companies/*.json` filename/content mismatch** — `bharat-forge.json` actually holds AITG's spec, `hdfc-bank.json` holds A-1 Fence, `zoho.json` holds ATE Group. The original 3-company reference set (Bharat Forge, Muthoot Finance, Chargebee) is **not** in the active `npm run benchmark` (`benchmarks/benchmark-runner.ts`) run at all, so "don't regress the reference set" is currently unenforced by automation — a manual spot-check (via the admin API) confirmed Bharat Forge/Chargebee still classify correctly, but this needs fixing properly before trusting it again

## Promoted to active To-Do
All of the above are tracked as concrete action items in [[Left To Do]] under "Known issues, promoted to root-cause work" once someone picks them up.

## See also
- [[Phase 1 - Pipeline Engineering]] — Item 2's latency work doesn't fix these; they're a separate, pre-existing scraper-reliability class of problem
- [[Classifier and Extraction Fixes]] — Ace Pipeline's classification gap traces back to the cascade-order fix done here

# Current Task

## Status as of 2026-08-31 — stabilization pass on reliability gaps

Picked up the remaining reliability gaps flagged across prior sessions
(research/scrape reproducibility, `published_at`, the never-exercised
batch shared-campaign path, and the flagged deliverability caveat).
Two parallel subagent passes, then a fresh benchmark run against a
restarted dev server (Windows file-watcher gotcha applies to benchmark
verification too, not just live UI checks).

1. **Root-caused the ATE Group / Muthoot Finance benchmark score
   swings** (real, confirmed via `benchmarks/evaluation-history/` —
   ATE ranged 0–89 across runs, Muthoot dropped from a stable 79 to
   70.67). Root cause: `parseContentSegments()` in
   `lib/pipeline/evidence-extractor.ts` had a page-boundary regex that
   only stopped at another `--- PAGE:` marker, so the last own-site
   page's segment greedily swallowed the following enriched-content
   block (filings/news/jobs) and mis-tagged it `own_site` — duplicating
   evidence and polluting the signal counts that feed two existing,
   deliberately-designed threshold gates (the deterministic-opportunity
   pattern-match gate and `normalize.ts`'s insufficient-evidence
   AND-gate). Fixed the regex to stop at either marker. Ruled out (with
   evidence, not assumption): `evidence_id` non-determinism (already
   content-hash-derived via `stableEvidenceId()`, confirmed
   deterministic) and the prior session's own guess that commit
   `6c94f92` caused it (diffed directly — 6 purely additive lines,
   touches nothing relevant). Residual variance from real live-scrape
   content changes and the two thresholds' correct-by-design
   sensitivity to small evidence-count deltas is left alone, per this
   repo's own "no speculative threshold tuning" rule — not fully
   eliminated, just no longer amplified by a real bug.
2. **Threaded real `published_at` dates into evidence.** The field
   existed (Epitaxy vNext Phase 1, commit `6c94f92`) but was always
   `undefined`. Added `nearestFilingDate()` to match a signal to the
   specific SEC EDGAR `filed <date>` bullet it was extracted from —
   never fabricates a date for content without one. Tavily/Serper
   results were checked for a usable publish-date field: none is
   requested or typed today, so nothing was wired for it rather than
   guessing at an unconfirmed response shape (flagged as real future
   work, not implemented).
3. **`assessScrapeQuality()` audited, not changed** — the syndicated-
   ticker/marketplace-mention rejections that might have been missing
   already exist at the correct layer (`scrape-relevance.ts`,
   `service-evidence.ts`) from earlier committed work. No evidenced gap
   found, so no changes made.
4. **Fixed a real cross-campaign duplicate-send gap**, found while
   tracing the previously-flagged "batch-originated shared-campaign
   resume path never exercised" item. The already-sent guard in
   `lib/outbound/sending/campaign-review.ts` and the real send route
   (`app/api/admin/outbound/campaigns/[id]/send/route.ts`) was scoped
   to the *current* campaign only — a contact already emailed under
   campaign A showed as fresh under campaign B, so reviewing/sending
   through a second campaign sharing that contact could re-send to
   them. Fixed at both the UI-classification layer and the real send
   route (this repo's established "enforce hard blocks twice"
   pattern). Also closed the path in `ensureCampaignId()`
   (`app/admin/auto-gtm/useAutoGtmFlow.ts`) that could create a
   duplicate shared campaign in batch mode. No change to Gmail OAuth,
   no autonomous sending, per-batch confirmation unchanged.
5. **Deliverability re-audited, no code bug found.** MIME structure,
   `List-Unsubscribe`, reply/thread headers, and the tracking pixel
   were already correct from an earlier (2026-08-20) audit. The real
   spam-landing cause from the open-tracking verification sends is
   genuinely external — SPF/DKIM/DMARC domain config, sender
   reputation/mailbox warmup status, generic LLM-drafted subject lines
   — documented as such rather than papered over with a speculative
   code change.

Verified: `npx tsc --noEmit` clean, full suite 1137/1137 passing, and
(against a freshly restarted dev server, since these are exactly the
scraper/evidence-extractor files the Windows file-watcher gotcha
warns about) `npm run benchmark`: 7 PASS / 3 WARN / **0 FAIL**, mean
76.83 vs the prior run's 76.74 (+0.09 — flat, not chased upward). Two
commits pushed to `main`: `1aa234e` (reproducibility/evidence-date fix)
and `f82f1ac` (cross-campaign duplicate-send fix).

One process note for future sessions: killing/restarting the stale dev
server required explicit user permission in this session (blocked by
the auto-mode permission classifier by default) — don't assume it's a
free action.

## Status as of 2026-08-10

The full Phase 2 AutoGTM loop (all 9 items) and Phase 3's outbound
execution modules are all COMPLETE — see `ROADMAP.md` for the status list
and `DECISIONS.md` for full history. Gmail sending, Prospeo decision-maker
discovery, open tracking, the automatic follow-up engine, and the DIY
warmup engine are all live and have real, live-verified sends behind them,
not just code.

## This session — three known gaps fixed and verified against real data

Picked up from a standing list of flagged-but-not-fixed items (see
`CLAUDE.md`'s "Not done — still open" notes across several prior sessions):

1. **Automatic follow-up engine auto-send gating** — verified live, not
   just via unit tests. Confirmed both halves against real Gmail sends: a
   real due-and-unopened contact correctly gets a real follow-up sent
   (`isAutoFollowupEligible`), and the same contact, once marked opened,
   correctly gets withheld on the next tick. No code changes needed — the
   gating logic itself was already correct; this closed the "not yet
   verified live" gap.
2. **Warmup engine recipient-side mechanics** — verified live, and this
   surfaced a real bug: `searchGmailMessages()` never passed
   `includeSpamTrash=true` to Gmail's `messages.list`, so a warmup exchange
   that had genuinely landed in Spam was invisible to the recipient-side
   search entirely — exactly the case spam-rescue exists to catch. Fixed
   and re-verified against the same real spam-filed message (confirmed
   `rescued_from_spam: true` on retry).
3. **`detectPageType()`'s substring-collision bug** — `/blog/company-news`
   was misclassified `'about'` (via `/company` matching inside
   `company-news`) and `/products/irrigation-parts` was misclassified
   `'investor'` (via `/ir` matching inside `irrigation`). Fixed with a
   segment-boundary lookahead on every category regex, deliberately
   excluding `-`/`_` as valid boundaries (a trailing hyphen is still the
   same compound slug, not a real separator).
4. **`assessScrapeQuality()`'s content-relevance gap** — page/char count
   alone couldn't tell "the right content" from "the wrong content" scraped
   in equal volume. Added a penalty reusing existing signals (non-English
   locale ratio, low-value/unclassified-page ratio via `classifyUrl()`).
   Live-verified against lechler.com's real cached scrape (this repo's own
   multi-locale reference case): was scored 80/100 despite 5 of 6 pages
   being German, now correctly 55/100 with the reason surfaced in the note.

All four fixes: `tsc --noEmit` clean, full suite passing, committed
individually. No live browser verification needed for any of them — all
four are backend logic changes verified via `tsc` + tests + (where
possible) re-scoring/re-running against real cached or live data, matching
this repo's own established precedent for this class of change.

## Genuinely open items (not started, not blocking)

- **`WARMUP_ENGINE_ENABLED` / `FOLLOWUP_ENGINE_ENABLED`** — both engines
  are now mechanically verified end-to-end against real data, but both
  flags are still unset (off) everywhere, including local dev. Turning
  either on is a deliberate user decision, not an engineering task —
  nothing in this session's verification work changes that.
- ~~Batch-originated shared-campaign resume path never exercised~~ —
  **traced and a real bug fixed 2026-08-31** (cross-campaign
  duplicate-send gap, see above). Still true that no real multi-company
  batch send has happened yet in production — the fix is verified via
  code read + new tests (`tests/campaigns-contact-ids-lookup.test.ts`,
  extended `campaign-review-blocking`/`send-route-concurrency` tests),
  not a live multi-company send, since real sends still require
  explicit per-batch confirmation.
- ~~Real deliverability caveat, not investigated~~ — **re-audited
  2026-08-31, no code-level cause found.** MIME/headers/pixel/
  unsubscribe are already correct (per the earlier 2026-08-20 audit).
  The spam-landing cause is external: domain SPF/DKIM/DMARC config,
  sender reputation/mailbox warmup status, or generic LLM-drafted
  subject lines. Still open as an *operational* item — nothing further
  to fix in code without new evidence pointing at a specific mechanism.

## Do not start

Do not send real outreach emails without explicit, per-batch user
confirmation, even with every capability now live — see `CLAUDE.md`'s
standing safety rule. Building/verifying send capability is never standing
authorization to use it unprompted.

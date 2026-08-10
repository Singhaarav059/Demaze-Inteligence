# Current Task

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
- **Batch-originated shared-campaign resume path** — the `resumeFromRun()`
  fix for batch campaigns (multiple companies sharing one campaign row) has
  never been exercised against a real batch (multi-company) campaign,
  because no real batch campaign exists in the database yet. Deferred at
  the user's own request — pick up whenever a real batch send happens
  naturally.
- **Real deliverability caveat** (not a code bug): test sends during the
  open-tracking verification landed in Gmail spam. Flagged as a real
  signal worth a future look (self-send pattern, mailbox warmup status,
  generic LLM-drafted subject lines are all plausible contributors), not
  investigated further.

## Do not start

Do not send real outreach emails without explicit, per-batch user
confirmation, even with every capability now live — see `CLAUDE.md`'s
standing safety rule. Building/verifying send capability is never standing
authorization to use it unprompted.

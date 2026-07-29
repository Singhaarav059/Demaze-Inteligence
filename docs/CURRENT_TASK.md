# Current Task

## Sending vendor — REVERSED 2026-07-29: Lemlist removed, Gmail (free) is now the path — pick this up first

**What happened, in order, same day:**
1. Auto Flow Review & Send redesign items 1 (inline editing) and 3
   (checkbox multi-select) were built and "live-verified" against a real
   saved run — see `DECISIONS.md`'s "Review & Send redesign" section for
   what was built.
2. That verification pass **believed** it had confirmed no real send
   happened (dialog opened, Cancel clicked, checked afterward). It was
   wrong — a real email was sent via Lemlist to a real contact (Kumar
   Gururaj, kumar.g@mahindra.com) during that same browser-automation
   session, most likely from a misclick during the Cancel-button
   verification steps. See `DECISIONS.md`'s "Incident (2026-07-29)"
   section for full detail and the lesson for future verification passes
   (deactivate any real sending provider before interactive click-testing
   of send-adjacent UI).
3. The user asked, reasonably, why a paid vendor (Lemlist) was even active
   given a free path (Gmail) already existed in this codebase, and asked
   for Lemlist to be **removed completely** — confirming they'd already
   done the Google Cloud OAuth app setup on their end.
4. Lemlist was removed entirely (provider, client, webhook receiver, tests,
   settings UI, and the database row itself — see `DECISIONS.md`'s
   "Outreach send vendor — REVERSED" section for the full file list and
   the new `DELETE /api/admin/outbound/integrations/[capability]` route
   this required).
5. Free, poll-on-demand Gmail reply tracking was scoped, then built, same
   session — see `DECISIONS.md`'s "Free reply tracking (Gmail)" section.

**Current state**:
- Sending is on `mock` right now — safe, nothing sends for real.
- `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are configured and confirmed
  live (the OAuth `/start` route correctly redirects to a real Google
  consent URL).
- **No `gmail` row exists yet in `outbound_integrations`** — the per-account
  OAuth consent has NOT been completed inside this app yet, only the
  app-level client id/secret. The user needs to go to
  `/admin/outbound/integrations`, select Gmail for Email Sending, and click
  "Connect with Google" themselves (a real Google consent screen — not
  something the assistant can click through on their behalf). Once that's
  done, Gmail becomes the active sending provider automatically (the OAuth
  callback route auto-deactivates any other `sending` row and activates
  `gmail`).
- Reply tracking (`POST /api/admin/outbound/campaigns/[id]/check-replies`,
  a "Check for Replies" button on the Campaigns page) is code-complete and
  unit-tested but **not yet live-verified against a real Gmail thread** —
  needs the OAuth consent step above first, since there's no real inbox to
  poll against yet. Also note: the `gmail.metadata` scope was added as
  part of this work — if the user had connected Gmail before this session
  (they hadn't, per the point above), they'd need to click "Reconnect with
  Google" once to pick up read access; moot for a first-time connection.

**Next step, in order**: (1) user completes the Gmail OAuth consent
click-through, (2) confirm Gmail shows up as connected in
`/admin/outbound/integrations` with the right email, (3) a real,
explicitly-confirmed test send + a real reply-check pass against an actual
reply, before trusting either path live.

**Still open, unrelated to the above**: item 2 from the original Review &
Send redesign queue (2026-07-28) — follow-ups are shown on the Review &
Send screen but never actually sent, on any schedule or reply-triggered
cancellation. `scheduleFollowups()` on `lib/outbound/sending/providers/
gmail.ts` still honestly reports `scheduled: false` — this needs its own
architecture session (a real scheduler/cron + reply-triggered cancellation
logic), not a UI tweak, same "one deliverable per session" discipline as
the rest of this repo's history.

## Milestone

**Outreach Intelligence Layer field-naming reconciliation** (Roadmap Phase 2,
item 7) — COMPLETE (2026-07-23). Rename-only pass, no new logic: the
already-built `OutreachIntelligence` fields in `lib/pipeline/
analysis-sections.ts` and `lib/pipeline/normalize.ts` were renamed to match
this roadmap's naming — `trigger` → `why_contact`, `problem` →
`likely_problem`, `service` → `recommended_service`, `opening_angle` →
`conversation_angle` (`why_now` was already correctly named). Updated
consistently across the LLM prompt schema (`lib/prompts/analyze-v2.ts`,
`system-v2.ts`), the normalize merge step, both admin UI render sites
(`page.tsx`, `ResearchCard.tsx`), the downloaded-brief export
(`lib/export/brief-html.ts`), outbound email generation's input assembly
(`lib/outbound/generation/assemble-input.ts`), the benchmark runner, and
the one test fixture that referenced the old names. Full detail in
`CLAUDE.md`'s Phase 2 item 7 entry. Verified: `tsc --noEmit` clean, full
suite 483/483 passing — no benchmark run needed for a pure rename.

Prior milestone — **Market Intelligence Layer** (Roadmap Phase 2, item 6) —
COMPLETE, including
live end-to-end verification (2026-07-15). Given an already-researched
company, surfaces 0-8 industry-level statements (trend/growth_indicator/
challenge/shift) for the sector the company operates in. Deliberately
diverges from the Competitor Discovery / ICP Generator "code extracts a name
→ LLM narrates onto it" pattern — confirmed with the user before
implementation — since each item here is already a full statement extracted
from a real search snippet, not a name needing explanation. Pure
deterministic: search (same company-name-anchored query style as
Competitor/ICP, e.g. `"<name>" industry trends`) → classify each candidate
sentence into one of the 4 categories via most-specific-first keyword regex
→ sanity-filter fragments → dedupe → confidence-tier (same mention_count +
"strong indicator" formula as Competitor/ICP) → cap at 8. No new
`analyze-v2.ts` prompt block, no `normalize.ts` merge-by-name step —
`normalize.ts` passes `market_intelligence` straight through.

New `lib/enrichment/market-intelligence.ts`, wired into `route.ts` at the
same pre-scrape timing slot as `competitorDiscoveryPromise`/
`icpDiscoveryPromise` (no `primary_type` dependency — see `DECISIONS.md` for
why that timing was considered and rejected), new non-critical
`MARKET_INTEL` gate, `normalize.ts`/`analysis-sections.ts` plumbing, new
"Market Intelligence" section in `ResearchCard.tsx`, new
`tests/market-intelligence.test.ts` (18 assertions). Full detail in
`DECISIONS.md`.

**Verified**: `tsc --noEmit` clean, full suite 198/198 (180 pre-existing +
18 new).

**Live end-to-end run — done (2026-07-15).** The dev-server-lock blocker
from the prior session was worked around, not resolved by killing anything:
another chat's `next dev` instance was already running on port 3000 for
this same project, so the live run hit that server's API directly via
`curl` instead of starting a second instance (which the directory-scoped
lock would have refused anyway). Ran `discoverMarketIntelligence()` against
Ador Welding through the real `/api/admin/test-analysis` endpoint with real
Tavily/Serper quota (explicit user confirmation given first), reusing the
existing scrape cache for that company. Result: `MARKET_INTEL:PASS`, `4
item(s) found | 4 of 4 raw candidate(s) survived filtering`,
`market_intelligence_sufficiency: "sufficient"`. All 4 items were real,
source-attributed `growth_indicator` statements at `medium` confidence
(mention_count=1 each — correctly short of `high`, which requires 2+
mentions) — e.g. a welding-materials-market CAGR figure sourced to a real
Yahoo Finance article, and a growth forecast sourced to Ador's own 2021-22
annual-report PDF. No `challenge`/`trend`/`shift` items surfaced this
particular run — plausible given the real search results returned, not
evidence of a category-detection gap. Competitor Discovery and ICP
Generator both stayed regression-free on the same run (`COMPETITOR:PASS` 5
found, `ICP:PASS` 5 found, consistent with their own prior live runs
against this company). `ResearchCard.tsx`'s render path (`marketIntel.length
> 0` gate, `statement`/`category`/`confidence` fields) was confirmed
against the actual returned JSON shape by reading the component rather than
re-spending quota on a second UI-driven run — a full browser-driven render
pass with real data was already done for Competitor Discovery/ICP Generator
earlier this phase and established that `ResearchCard`'s render conventions
work correctly.

Prior milestones (items 1-5 of Phase 2 — Competitor Discovery Engine, ICP
Generator, Company Discovery Engine, Research Quality Framework, Research
Evaluation Framework) are all COMPLETE with live end-to-end verification.
Full history for each is in `DECISIONS.md`, not repeated here.

## Next milestone

Items 1-8 of Phase 2 (Competitor Discovery Engine, ICP Generator, Company
Discovery Engine, Research Quality Framework, Research Evaluation
Framework, Market Intelligence Layer, Outreach Intelligence Layer,
Decision-maker discovery) are all now complete. Item 8's status was
corrected 2026-07-28: the Prospeo vendor decision was already made and the
`search-person`-based provider already built/wired (see `DECISIONS.md`) —
this file and `ROADMAP.md` just hadn't been updated to reflect it until the
user directly confirmed a live test working.

Item 9 (outreach send) is now code-complete too, same day (2026-07-28) —
**Lemlist** provider (`lib/outbound/sending/providers/lemlist.ts`), settings
UI, and a reply/open/click webhook receiver (`app/api/webhooks/lemlist/
route.ts`) are all built and tested (`tsc`+603/603 suite clean), plus
live-verified in the browser (selected the provider, saved real config,
Test Connection reported the expected "no API key" failure, reverted to
mock afterward). See `DECISIONS.md`'s "Outreach send (Phase 2, item 9)"
section for full detail, including a real bug fixed along the way
(`send/route.ts` was mishandling the `'queued'` status Lemlist needs).

**What's left is account-side, not engineering**: the user needs to (1)
create a real Lemlist account and generate an API key, (2) manually build
one campaign with a sequence template using `{{subjectLine}}`/
`{{icebreaker}}` merge tags (no API exists for writing template content),
and (3) apply migration `014_outbound_campaign_events_provider_id.sql` in
the Supabase dashboard. None of that is something the assistant can do.

Both items 8 and 9 — the entire Phase 2 AutoGTM roadmap — are now
code-complete. Nothing in Phase 2 remains to be built; what's left is
vendor-account setup on the user's side plus real live verification once
credentials exist.

## Do not start

Do not send real outreach emails without explicit, per-batch user
confirmation, even once Lemlist is fully configured — see `CLAUDE.md`'s
standing safety rule. Building the send capability was never standing
authorization to use it.

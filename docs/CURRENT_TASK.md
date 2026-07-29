# Current Task

## Auto Flow Review & Send (step 5) redesign — items 1 and 3 DONE (2026-07-29)

Three gaps were queued 2026-07-28 from live Lemlist-integration testing. Items
1 (inline editing) and 3 (checkbox multi-select) are now implemented and
live-verified; item 2 (follow-up scheduling) is still open and needs its own
architecture session — see below.

1. **DONE — last-moment edit control.** `ReviewSendStep.tsx` now lets the
   SDR edit recipient email, subject, and body directly on this screen via
   one combined "Edit" toggle per contact (email + subject + body save
   together). Subject/body reuse the existing `PATCH /api/admin/outbound/
   contacts/[id]/generated-content` route (same one Outreach's own "Edit"
   button calls). Recipient email is a **new** `PATCH /api/admin/outbound/
   contacts/[id]` route (previously DELETE-only) — a manually-typed email
   clears `email_confidence`, stamps `email_finder_provider: 'manual'`, so
   the UI never shows stale "high confidence, found by Prospeo" badges for
   an address the SDR just typed in. New `updateContactEmail()` in
   `useAutoGtmFlow.ts`. "From address"/mailbox selection was NOT built —
   still a separate, bigger decision per the original note below.
2. **NOT DONE — follow-ups still shown but never actually sent.** Unchanged
   from the original note: `scheduleFollowups()` on both
   `lib/outbound/sending/providers/gmail.ts` and `.../lemlist.ts` always
   returns `scheduled: false` — no scheduler/cron, no reply-detection.
   Needs its own architecture session, not a UI tweak.
3. **DONE — checkbox multi-select replaces "Send All".** Each ready-to-send
   contact now has a checkbox (defaults to none selected, per-contact and a
   "Select all (N ready)" toggle), and the button reads "Send Selected (N)"
   instead of "Send All (N)". `useAutoGtmFlow.ts`'s `sendAllContacts()` /
   `sendingAll` renamed to `sendSelectedContacts(contactIds)` /
   `sendingSelected` to take an explicit id list instead of reaching for
   every contact.

**Verified**: `tsc --noEmit` clean, full suite 603/603. Live-verified in the
browser against a real saved run (mahindra.com, resumed via
`?runId=...&step=5`) — confirmed real-provider badge ("Live: lemlist"),
checkbox selection updating the Send Selected count, inline edit for both
subject (persisted via API, confirmed via a direct GET) and recipient email
(persisted, correctly flipped the contact from "no email, skipped" to
checkbox-selectable and updated the "N emails found" summary), and the
confirm dialog's real-vendor warning copy. Did **not** click through an
actual send — Cancel was used to close the confirm dialog without sending,
consistent with the standing rule that real sends need explicit per-batch
confirmation.

**Discrepancy found and worth flagging**: `docs/CURRENT_TASK.md`'s Lemlist
section below still says the user "needs to create a real Lemlist account
and generate an API key" — but the live `/api/admin/outbound/integrations`
data checked during this session shows Lemlist is **already** the active
sending provider with a real credential configured
(`credential_last_four: "e185"`, `last_test_status: "success"`, a real
`campaignId`). Whether an actual end-to-end send has been tried against it
is still unconfirmed — worth a real (explicitly-confirmed) test send in a
future session rather than assuming either the stale "not set up yet" note
or the credential's mere presence.

Do item 2 (follow-up scheduling) as its own architecture session given it
needs new infrastructure, not just UI work — same "one deliverable per
session" discipline as the rest of this repo's history.

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

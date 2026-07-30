# Current Task

## Sending vendor — REVERSED 2026-07-29: Lemlist removed, Gmail (free) is now the path — COMPLETE, fully live-verified

**Full arc, same day, in order** (full detail in `DECISIONS.md`'s "Outreach
send (Phase 2, item 9)" section and its dated subsections):
1. Review & Send redesign items 1+3 built and "verified" — but that
   verification was wrong; a real email went out via Lemlist during the
   browser-automation session (`DECISIONS.md`'s "Incident (2026-07-29)").
2. User asked why a paid vendor was active at all given Gmail (free)
   already existed, and had Lemlist **removed completely** — provider,
   client, webhook receiver, tests, settings UI, and the stored DB row
   itself (new `DELETE /api/admin/outbound/integrations/[capability]`
   route was needed for the last part).
3. Free, poll-on-demand Gmail reply tracking was scoped and built.
4. User completed the Gmail OAuth consent click-through
   (`singhaarav059@gmail.com`) — which immediately surfaced a real,
   pre-existing bug: `getGmailCredential()` had silently double-decrypted
   every real stored credential since 2026-07-19, undetected until a real
   OAuth connection finally existed to trigger it. **Fixed.**
5. A real test send to the user's own address succeeded, confirming the
   full send path (credential → token refresh → Gmail send) works.
6. A real cross-account reply-tracking test (2 separate real email
   addresses, replying from each) found a **second** real bug: the
   `check-replies` route silently swallowed a DB insert error and flipped
   a contact to `replied` with no event ever recorded. Root cause: migration
   `014_outbound_campaign_events_provider_id.sql` (written for the now-
   removed Lemlist webhook work) had **never actually been applied** to the
   live database. **Fixed the silent-failure bug in code, and the user
   applied the missing migration.**
7. Re-ran the full cross-account reply-tracking test after both fixes:
   **fully passing** — real reply detected, real event recorded with the
   correct `provider_event_id` for dedup, contact correctly flipped to
   `replied`, and a repeat `check-replies` call confirmed idempotency (no
   double-processing).

**Status: COMPLETE.** Gmail is the active sending provider with a real,
working, tested credential. Real send confirmed. Real reply detection
confirmed, including the specific cross-account discrimination logic
(`findReplyInThread()`) working correctly on genuine live data, not just
mocked unit tests. Two real bugs found via this verification (not assumed
away) were fixed in the same session.

**One structural limitation found, not a bug**: a self-addressed test
(sending to the same account that's doing the sending) can never be used
to verify the reply/self-send discriminator — Gmail gives no signal
(neither `From` header nor `labelIds`) that distinguishes "the account
replied to itself" from "the account sent itself a follow-up." Real usage
(sending to an actual prospect's different address) doesn't have this
ambiguity — confirmed by the successful cross-account test above.

**Test data left behind, not yet cleaned up**: a real campaign ("Reply
Tracking Verification Test") and 3 test contacts
(`singhaarav059@gmail.com`, `singhaarav0921@gmail.com`,
`singhaarav0599@gmail.com`, all under company "Reply Tracking Test 2")
exist in the database from this verification — worth deleting via the
Contacts/Campaigns pages if the user wants a clean slate, not done
automatically since deletion wasn't asked for.

**RESOLVED 2026-07-29 — item 2 from the original Review & Send redesign
queue (2026-07-28) is now built.** Follow-ups were shown on the Review &
Send screen but never actually sent, on any schedule or reply-triggered
cancellation. `scheduleFollowups()` on `lib/outbound/sending/providers/
gmail.ts` still honestly reports `scheduled: false` (Gmail has no
send-later API) — but real scheduling now exists one layer up: a new
`lib/outbound/sending/followup-schedule.ts` (pure, no new table/migration —
reuses `outbound_campaign_contacts.status`/`updated_at`) computes when a
contact's next follow-up (3/4/7 days apart, per-step not cumulative) is
due, and a new `POST /api/admin/outbound/campaigns/[id]/process-followups`
route sends it — checking the Gmail thread for a reply FIRST and cancelling
the follow-up if one's found (reply-triggered cancellation), same shape as
`check-replies`. Follow-ups now also thread into the original Gmail
conversation (new `threadId`/`inReplyTo`/`References` support in
`gmail-client.ts`) instead of landing as disconnected new emails. Same
on-demand precedent as the rest of this app (no background scheduler
exists) — a new "Process Follow-ups" button on `/admin/outbound/campaigns`,
next to "Check for Replies". Full detail, including a real safety gap found
and fixed (neither this new button nor the pre-existing "Send Queued"
button had a confirm dialog, despite Gmail being live-active with a real
credential when this was built), in `DECISIONS.md`'s "Follow-up scheduler
built (2026-07-29)" section. `tsc --noEmit` clean, full suite 615/615.
**Not done**: an actual send-and-verify-it-threads-correctly pass against a
real Gmail thread — deliberately deferred, see that section for why.

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

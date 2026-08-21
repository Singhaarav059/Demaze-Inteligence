# Pilot Readiness — Verification Report

Produced by Post-Hardening Pilot Readiness Plan, **Phase C**. Verifies the
items the Phase A/B report (`docs/production-hardening/FULL_REPORT.md`,
section 5) listed as "not re-verified live" or otherwise soft: campaign
pause, reply/bounce stopping follow-ups, unsubscribe suppression, Gmail
OAuth token state, tracking-failure behavior, and the global kill switch
against every real-send caller. Scope is deliberately narrow — production
behaviors that affect the pilot, not a full codebase re-audit.

---

## C1 — Campaign pause

**Status:** VERIFIED

**Evidence:** Both real-send-capable routes check `campaign.status ===
'paused'` as an entry gate before touching any queued contact —
`app/api/admin/outbound/campaigns/[id]/send/route.ts:101` and
`app/api/admin/outbound/campaigns/[id]/process-followups/route.ts:65`. Both
return immediately with `sent: 0` / `processed: 0` and never call
`sendEmail()`. Known, documented, deliberate limitation: a pause that
happens *mid-batch*, after the entry gate already passed, does not abort an
in-flight loop — the final status write at the bottom of `send/route.ts`
explicitly does not clobber a pause set during the batch (`.neq('status',
'paused')`), so the campaign stays paused, but already-fetched contacts in
that specific request still finish sending. This is Phase A's own Step A7
outcome, not new.

**Test:** `tests/send-route-concurrency.test.ts` ("pause guard" describe
block — paused-campaign-sends-nothing, and pause-mid-batch-not-clobbered).
`tests/process-followups-route-pause.test.ts` (new this phase — the
identical gate on the follow-up route had no route-level test before).

**Result:** PASS. Both routes verified against the real handler code (not a
reimplementation), via a fake Supabase.

**Remaining action:** None blocking. If Phase F's real pilot finds the
mid-batch-continuation behavior surprising in practice, revisit — it's
documented, not accidental.

---

## C2 — Reply stopping follow-up

**Status:** VERIFIED

**Evidence:** `processFollowupForContact()`
(`lib/outbound/sending/process-followup.ts:107-174`) polls the Gmail thread
for a reply *before* claiming/sending. A genuine reply short-circuits to
`cancelled_reply`, writes a `replied` event, and sets
`outbound_campaign_contacts.status = 'replied'` — never calls `sendEmail()`.
`'replied'` is excluded from both `FOLLOWUP_ELIGIBLE_STATUSES` (bulk/engine
contact selection) and `STATUS_TO_NEXT_SEQUENCE`
(`followup-schedule.ts:23`, `nextFollowupSequence()` returns `null`), so
even a caller that skips the live poll can't advance a replied contact —
two independent layers, not one.

**Test:** `tests/process-followup-reply-bounce.test.ts` (new this
phase — exercises the actual reply-detection branch directly, not just the
downstream status-exclusion, which was already implicitly covered
elsewhere).

**Result:** PASS.

**Remaining action:** None.

---

## C3 — Bounce suppression

**Status:** VERIFIED

**Evidence:** Same code path as C2 — a bounce is a reply where
`looksLikeBounce()` is true. `processFollowupForContact()` sets status to
`'bounced'` AND calls `addToSuppressionList({ reason: 'bounced', ... })`
(`process-followup.ts:161-169`). `checkRepliesForCampaign()`
(`lib/outbound/sending/reply-check.ts:121-137`, the manual "Check for
Replies" path used independent of an active follow-up) does the identical
thing. Once suppressed, `sendEmail()` (`provider-factory.ts:69-76`) — the
single real-send chokepoint every caller funnels through — refuses any
future send to that address, campaign or follow-up, with zero override.

**Test:** `tests/process-followup-reply-bounce.test.ts` (bounce branch —
confirms the suppression-list row is actually written and that a
subsequent `isSuppressed()` check for that exact address returns `true`,
not just that the function was called). `tests/suppression.test.ts` (new
this phase — direct coverage of `isSuppressed`/`addToSuppressionList`/
`removeFromSuppressionList`, which had zero prior unit coverage despite
being the actual hard-block mechanism behind C3 and C4).

**Result:** PASS, with one finding — see below.

**Finding (not fixed this phase, flagged for a decision):**
`isSuppressed()` fails **open** on a DB read error (returns `{ suppressed:
false }` — `suppression.ts:34-48`, documented in its own header comment as
a deliberate choice: "this table being briefly unreachable shouldn't block
every send in the app"). This is a real tension with Plan Rule 6 ("Sending
must fail closed... When safety, identity, suppression, or deduplication is
uncertain, do not send") — the letter of that rule says a suppression
lookup that *can't be resolved* should block, not proceed. In practice this
is a narrow window (the suppression table transiently unreachable while
everything else — the campaign row, the contact row, the generated draft —
resolves fine), and every other DB-dependent check in the send path
(`campaign`, `contact`, `generated content` lookups) already fails toward
"skip, stay queued" on a missing row, so a suppression-check failure is the
one place that currently fails the other direction. Recommend: flip
`isSuppressed()` to fail closed (treat a DB error as `suppressed: true`
with a generic reason, forcing manual review) before Phase F's real pilot.
This is a small, isolated change, but it does change send-path behavior
under a DB outage, so per Rule 6/Rule 7's spirit it's flagged here for an
explicit decision rather than made unilaterally.

**RESOLVED (2026-08-21).** Flipped per the recommendation above —
`isSuppressed()` (`suppression.ts`) now returns `{ suppressed: true,
checkFailed: true, detail: '...treated as suppressed pending manual
review.' }` on a DB read error instead of `{ suppressed: false }`.
`sendEmail()` (`provider-factory.ts`, the one real chokepoint) surfaces
`detail` when `reason` is absent so the blocked-send message reads as
"could not be verified," not "(undefined)." `classifyCampaignContacts()`
(`campaign-review.ts`, the pre-send UI review classification) needed no
code change — it already read `suppression.detail ?? ...` — but its own
test file (`tests/campaign-review-blocking.test.ts`) was unmocking
`isSuppressed()` and relying on its *old* fail-open behavior (no Supabase
env configured in the test environment throws → used to resolve to
`{suppressed: false}`) to keep unrelated B4/B5/B6 tests passing; the flip
broke 4 of those tests by making every contact resolve as `suppressed`.
Fixed by mocking `isSuppressed()` explicitly in that file (each test now
controls its own suppression state) and adding a new dedicated test
confirming a fail-closed check surfaces as `status: 'suppressed'` with a
readable reason, not silently as `ready`. New
`tests/send-suppression-failclosed.test.ts` covers the same behavior at
the `sendEmail()` chokepoint. `tsc --noEmit` clean, full suite 903/903 (901
prior + 2 new). The second flagged item (`OUTBOUND_TRACKING_BASE_URL`
pointing at a dead tunnel URL) is an environment/ops config value, not a
code change — still open, unchanged by this fix.

---

## C4 — Unsubscribe suppression

**Status:** VERIFIED (manual-trigger only — no automatic detection exists)

**Evidence:** Unsubscribe has no automated detection path — no
`List-Unsubscribe` header handling, no reply-body keyword parsing. It is
added exclusively via `POST /api/admin/outbound/suppression-list`
(`reason: 'unsubscribed'`), an admin/operator action from the Suppression
List page. Once added, enforcement is identical to C3 — the same
`isSuppressed()` check in `sendEmail()`'s single chokepoint blocks every
future send, campaign or follow-up, with zero override
(`docs/outbound-safety-policy.md`, B7).

**Test:** `tests/suppression.test.ts` (add-with-reason-`unsubscribed`,
case/whitespace-normalized email matching, then confirms a
`sendEmail()`-equivalent lookup finds it).

**Result:** PASS for the enforcement half. The "no automatic detection"
half is a real, current product characteristic, not a bug — worth stating
plainly rather than silently discovering during the real pilot.

**Remaining action:** Same fail-open finding as C3 applies here too (same
function). Decide before Phase F whether unsubscribe detection should stay
manual-only for the pilot's scale (a human operator can plausibly keep up
with a 20-30 company pilot's reply volume) — no code change proposed here,
flagging for a decision per Rule 10 ("stop expanding the feature surface").

---

## C5 — Gmail OAuth

**Status:** VERIFIED LIVE (real token refresh call made this session, no
email sent)

**Evidence / live check performed:** Queried `outbound_integrations`
directly — the `sending` capability's active row is `gmail`,
`is_active=true`, `credential_encrypted` present, `updated_at` today
(2026-08-17 08:37 UTC) — consistent with CLAUDE.md's own same-day note that
the prior stored token had expired (Testing-mode 7-day refresh-token
lifetime) and needed re-authorization. Ran a throwaway, no-network-side-
effect-beyond-Google's-token-endpoint script calling the real
`getGmailCredential()` → `refreshAccessToken()` path (same function every
real send uses) against the **currently stored** credential — deleted
after use, per this repo's own established throwaway-script precedent.

- **Current token state:** credential present, decrypts cleanly.
- **Refresh behavior:** succeeded — `refreshOk: true, expiresInSeconds:
  3599`. The stored refresh token is currently valid.
- **Expired-token behavior (code path, not reproduced live today since the
  token is currently valid):** `postToken()` (`gmail-client.ts:160-188`)
  surfaces Google's `error`/`error_description` as a plain string;
  `GmailSendingProvider.sendEmail()` maps a refresh failure to `{status:
  'failed', error: refreshed.error}` — no retry-as-if-nothing-happened, no
  credential fields in the error. This exact path fired for real earlier
  today per CLAUDE.md's own log (`"Provider \"gmail\" is not available."`
  from an expired-then-since-reconnected token) — that a real expiry did
  occur and was handled without a bad send is itself evidence the failure
  path works, even though it wasn't re-triggered in this session.
- **Reauthorization behavior:** `buildAuthUrl()` sets `prompt=consent` so a
  reconnect always gets a fresh refresh token; the callback route
  (`app/api/admin/outbound/oauth/gmail/callback/route.ts:183-224`)
  deactivates every other `sending` provider row and upserts the new
  credential — single-active-provider semantics preserved on reconnect.
  Real-world evidence: today's `updated_at` timestamp on the `gmail` row is
  exactly this flow having just run.
- **No credential leakage:** every error path returns only
  `error`/`error_description` strings from Google — `clientSecret`,
  `refreshToken`, and the access token itself are never included in any
  `SendEmailResult`, log line, or redirect URL param checked in this
  session.

**Test:** No new unit test added — this is a live OAuth/token-refresh check
against a real, currently-live credential, not new application logic (same
"verify via a real call, not a new test" precedent CLAUDE.md already uses
for provider-chain verification).

**Result:** PASS. Gmail sending is currently live and connected, not just
code-complete.

**Remaining action:** None for the connection itself. Testing-mode tokens
still expire in 7 days by design (Google OAuth consent screen not yet
verified/published) — expect to repeat this reconnect during Phase F's
pilot if it runs longer than a week; not a defect, a known operating
constraint.

---

## C6 — Tracking failure

**Status:** VERIFIED

**Evidence:** Two independent things had to be checked — does a broken
*pixel endpoint* fail safely, and does the *auto-follow-up gate* fail
closed when tracking is unusable.

- The tracking pixel route (`app/api/track/open/[campaignContactId]/
  route.ts`) wraps its entire body in try/catch and always returns the 200
  GIF regardless of DB outcome — a broken/unreachable DB simply means
  `opened_at` never gets set, it never surfaces an error to the email
  client. This was already live-verified in an earlier session (see
  CLAUDE.md, 2026-08-05) and re-confirmed by reading the current code
  unchanged.
- `isAutoFollowupEligible()` (`lib/outbound/sending/followup-engine/
  tick-logic.ts:27-38`) takes an explicit `trackingConfigured` boolean and
  returns `false` immediately if it's `false` — a contact can never look
  "safely unopened" by omission; "we don't know" and "not configured" both
  resolve to "don't auto-send." `run-tick.ts` computes this as
  `Boolean(process.env.OUTBOUND_TRACKING_BASE_URL)`.

**Live check performed:** `OUTBOUND_TRACKING_BASE_URL` in `.env.local` is
currently set to a `cloudflared` quick-tunnel hostname from an earlier
session's ad hoc verification run. Curled it directly — **unreachable
(connection failure)**. This means `trackingConfigured` currently evaluates
`true` (the var is *set*) even though the URL behind it is dead — a real
open-tracking pixel sent right now would never actually be reachable by an
email client, so `opened_at` would never update for any *new* send, and
every due contact would eventually look "unopened" to the auto-follow-up
gate. The gate's own code-level fail-closed logic is correct (it only
checks "is the var set," which is the right question for "did we forget to
configure this at all") — but a stale-but-present URL is a gap the gate
cannot see, since it has no way to distinguish "configured and working"
from "configured and dead."

**Test:** `lib/outbound/sending/followup-engine/tick-logic.test.ts`
(pre-existing, 13 assertions per CLAUDE.md — covers the boolean gate
itself). No new test added for the dead-URL gap — it's a config/ops issue,
not something to unit-test.

**Result:** PASS for the code-level fail-closed contract. **Operational gap
found**, not a code defect.

**Remaining action:** `OUTBOUND_TRACKING_BASE_URL` needs to point at a real,
currently-live origin before `FOLLOWUP_ENGINE_ENABLED` is ever turned on —
either a fresh tunnel (temporary) or, for anything beyond ad hoc testing,
the real Railway production origin (CLAUDE.md already flags this same need
elsewhere). `FOLLOWUP_ENGINE_ENABLED` remains unset, so nothing auto-sends
today regardless.

---

## C7 — Kill switch

**Status:** VERIFIED

**Evidence:** `isOutboundSendingEnabled()` (`provider-factory.ts:50-52`) is
checked as the literal first line of `sendEmail()`, before the suppression
lookup and before any provider is resolved. Architecturally there is
exactly **one** real-send chokepoint in this codebase — confirmed by
grepping every import of `sendEmail` from `provider-factory`: exactly two
call sites, `app/api/admin/outbound/campaigns/[id]/send/route.ts` (manual
"Send Now," "Send All," batch send) and `lib/outbound/sending/
process-followup.ts` (manual "Send Now" follow-up, bulk "Process
Follow-ups," and the automatic follow-up engine tick — all three funnel
through this one function, confirmed by reading each caller). No other file
imports or calls a provider's `sendEmail()` method directly.

**Test:** `tests/sending-kill-switch.test.ts` (pre-existing — the pure
boolean function). `tests/kill-switch-callers.test.ts` (new this phase) —
proves the switch is checked *before* `isSuppressed()` or
`getActiveProviderName()` by mocking both to throw if reached; with the
switch off, neither mock fires (the function returns before either would be
called) — this is what "test all callers, not just one API endpoint" means
in practice here: since every caller reduces to this one function, proving
the function's own ordering is airtight proves every caller is covered
without needing a separate integration test per route.

**Result:** PASS.

**Remaining action:** None. If a future session adds a new real-send
caller, it must go through `sendEmail()` — anything that calls a
provider's `.sendEmail()` directly instead would bypass both the kill
switch and suppression checking.

---

## Summary

| Item | Status | Blocking issue for pilot? |
|---|---|---|
| C1 Campaign pause | Verified | No |
| C2 Reply stops follow-up | Verified | No |
| C3 Bounce suppression | Verified | No — fail-open finding RESOLVED 2026-08-21 (now fails closed) |
| C4 Unsubscribe suppression | Verified (manual trigger) | No — fail-open finding RESOLVED 2026-08-21; the manual-only detection design is still worth a conscious yes/no before the pilot |
| C5 Gmail OAuth | Verified live | No — currently connected and working |
| C6 Tracking failure | Verified (code); operational gap found | Not blocking C6 itself, but must fix before enabling the automatic follow-up engine |
| C7 Kill switch | Verified | No |

**One item remains open, not a code change to make unilaterally:**
1. ~~Should `isSuppressed()` fail closed instead of open on a DB error?~~
   RESOLVED 2026-08-21 — see the C3 finding above. (C3/C4)
2. Point `OUTBOUND_TRACKING_BASE_URL` at a real live origin before enabling
   `FOLLOWUP_ENGINE_ENABLED`. (C6 — this one has an obvious right answer,
   just needs doing, not deciding — an environment/ops change, not code)

Full suite: 879/879 passing (867 before this phase's 12 new assertions
across `tests/kill-switch-callers.test.ts` (2),
`tests/process-followups-route-pause.test.ts` (1), `tests/suppression.test.ts`
(7), and `tests/process-followup-reply-bounce.test.ts` (2)). `tsc --noEmit`
clean.

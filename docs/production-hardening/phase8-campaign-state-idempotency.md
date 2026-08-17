# Phase 8 — Campaign State Machine and Follow-Up Hardening

## Audit first

`outbound_campaign_contacts.status` already has a real, DB-enforced state
set (a CHECK constraint: `queued/sent/followup_1/followup_2/followup_3/
replied/bounced/stopped`) and every real transition already writes an
immutable `outbound_campaign_events` row (`sent`/`bounced`/`replied`/
`suppressed`/`send_failed`). Reply detection already stops automatic
follow-ups; a bounce already suppresses the address and cancels remaining
follow-ups (both per CLAUDE.md's 2026-08-05/2026-08-17 entries). This is
functionally a working state machine already — not the Master Plan's
exact literal state names (`DRAFT`/`QA_PASSED`/`AWAITING_APPROVAL`/etc.),
but the real safety properties Step 8.1's design exists to guarantee
already hold. Renaming the whole status vocabulary to match the plan's
literal list would be a large, mostly-cosmetic diff across many files for
no real safety gain — deliberately not done, per Master Plan Rule 1
(preserve working functionality) and Rule 7 (don't do work that doesn't
improve reliability/quality/safety measurably).

## The real gap: Step 8.6, idempotency — found via direct code read, confirmed real

`campaigns/[id]/send/route.ts`'s send loop fetches every `'queued'`
contact in ONE query, then sends and updates status to `'sent'` one at a
time inside the loop — a genuine check-then-act race. Two overlapping
calls to this route (a double-click on "Send All", two open browser tabs)
would both read the same set of queued contacts before either one updates
a single row, and both would proceed to call `sendEmail()` for the same
contacts — a real duplicate send to a real prospect, not a hypothetical.
The exact same shape exists in `process-followup.ts`'s
`processFollowupForContact()` — which is the single shared implementation
behind all three follow-up-send callers (manual "Send Now", "Process
Follow-ups", and the automatic follow-up engine tick), making it the
higher-leverage fix of the two.

## What changed

Both fixed with the same pattern — an atomic conditional UPDATE used as a
claim, before calling `sendEmail()`:

- **`campaigns/[id]/send/route.ts`**: before sending, flips a contact's
  status to `'sent'` guarded by `.eq('status', 'queued')`. Postgres's
  row-level update is atomic, so only one concurrent request's WHERE
  clause can match — a `claimed` result of zero rows means another
  request already claimed this contact, and this request skips it. Rolled
  back to `'queued'` if the subsequent send then fails or gets suppressed,
  preserving the existing "left queued, retry-eligible" behavior exactly.
- **`process-followup.ts`'s `processFollowupForContact()`**: same
  pattern, guarded on `cc.status` (the specific status already read at
  the top of the function, since this function advances FROM whatever
  status a contact is currently in, not from a fixed literal) rather than
  a hardcoded `'queued'`.

No new database migration needed — both fixes reuse status values already
in the existing CHECK constraint (no new transient state introduced).

## Verification

```
npx tsc --noEmit   -> clean
npm test           -> 820/820 passing (no count change — see below)
```

No new unit tests added for either fix — both touch Supabase-backed
impure functions (`campaigns/[id]/send/route.ts` has zero existing test
coverage of any kind, same established precedent as every other API
route in this repo; `processFollowupForContact()` is likewise never
directly unit-tested, only its pure `isAutoFollowupEligible` sibling in
`tick-logic.ts` is). Verified via `tsc`+read-through of the full modified
control flow instead, matching this repo's own established "verify via
tsc+tests, defer new mocking infra for Supabase-backed routes" precedent
used throughout every prior phase of this same effort.

## Not done (explicitly out of scope)

- **A lower-severity, pre-existing race in the same route**: the daily
  send-limit check (`remainingDailySendCapacity`) is read once per
  request into a local counter, decremented in-memory per successful
  send — two concurrent requests each have their own local copy, so the
  daily cap itself isn't perfectly race-safe across concurrent requests
  (both could believe they have capacity and jointly exceed the limit
  slightly). `campaign-limits.ts`'s own header comment already documents
  this as "a soft daily-volume guard, not a legal/billing boundary" —
  the genuinely severe issue (duplicate send to the same person) is
  fixed; this is a much lower-stakes volume-accounting edge case, not
  fixed this session.
- No rename of `outbound_campaign_contacts.status`'s vocabulary to match
  the Master Plan's literal state names — see the audit note above.
- No new `PipelineEvent`/state-machine abstraction — the existing
  `outbound_campaign_events` table already serves this purpose.

## Phase completion report

```
PHASE: 8 — Campaign State Machine and Follow-Up Hardening
STATUS: Complete

Changed:
- app/api/admin/outbound/campaigns/[id]/send/route.ts: atomic
  claim-before-send, rollback on failure/suppression
- lib/outbound/sending/process-followup.ts: same atomic claim pattern in
  processFollowupForContact() (the shared choke point for all 3
  follow-up-send callers)

Tests:
- npm test: 820/820 passing (no new — see "Verification" above)
- tsc --noEmit: clean

Failures:
- None

New files:
- docs/production-hardening/phase8-campaign-state-idempotency.md (this file)

Database changes:
- None (reuses existing status values, no migration needed)

External dependencies:
- None

Known limitations:
- Daily send-limit accounting has a lower-severity, pre-existing race
  across concurrent requests (see above) — not fixed this session

Next phase:
- Phase 9 — Apollo Decision (measure Prospeo baseline, compare vs Apollo
  only if justified, cost/coverage decision rule)
```

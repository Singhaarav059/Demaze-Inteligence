# Phase 7 — Email Safety and Deliverability

## Audit first (same discipline as every prior phase)

Most of this phase's asks were already built, confirmed by reading the
actual send-path code before touching anything:

- **Suppression** (Step 7.4): `isSuppressed()` is checked TWICE — once at
  Review & Send time (`campaign-review.ts`, filters bounced/unsubscribed/
  manually-suppressed contacts out of the "ready" set) and again at the
  actual dispatch point (`provider-factory.ts`'s `sendEmail()`, the single
  choke point every real send path funnels through) — genuine
  defense-in-depth against a suppression added between review and send.
- **Duplicate-send prevention**: `campaign-review.ts`'s `already_sent`
  status prevents re-queueing a contact already enqueued in a prior
  partial send of the same campaign.
- **Per-campaign sending controls** (Step 7.3, partial): daily send limit
  + send window (migration 020, `campaign-limits.ts`), reused identically
  across all three real send paths (manual send, "Process Follow-ups",
  the automatic follow-up engine tick) — one implementation, not three.
- **Campaign pause** (Step 7.6): `campaigns/[id]/pause` and
  `followups/[id]/stop` routes already exist.
- **Reply/bounce handling**: per CLAUDE.md's 2026-08-05/2026-08-17
  entries, reply detection already stops automatic follow-ups, and a
  bounce already suppresses the address and cancels remaining follow-ups.
- **Gmail authentication reliability** (Step 7.1): already extensively
  hardened — OAuth refresh, CSRF-safe state comparison
  (`timingSafeEqualStr`), and (per the 2026-08-17 follow-up-engine entry)
  a real, live-observed 7-day Testing-mode token-expiry failure mode that
  the engine already handles gracefully (logs the real error, doesn't
  corrupt state, leaves the contact eligible for retry).

## What was genuinely missing: the kill switch

Confirmed via search — no global override existed anywhere. Every safety
mechanism above is either per-campaign (pause, daily limits) or
per-contact (suppression) — none of them stop sending as a single
"something is wrong, stop everything right now" action, which Step 7.5
explicitly asks for.

**Built**: `OUTBOUND_SEND_ENABLED` env var, checked in
`sendEmail()` (the same single choke point suppression already uses) —
`isOutboundSendingEnabled()` in `lib/outbound/sending/provider-factory.ts`.
Deliberately the opposite default shape from `WARMUP_ENGINE_ENABLED`/
`FOLLOWUP_ENGINE_ENABLED` (which default OFF, opt-in): this one defaults
ON (preserves current behavior, Master Plan Rule 1) — only the literal
string `'false'` disables sending. Set it during an incident to
immediately stop every real send path at once, overriding all
campaign-level settings, exactly as Step 7.5 specifies.

## Verification

```
npx tsc --noEmit   -> clean
npm test           -> 820/820 passing (60 files, +3 from Phase 6's 817)
```

3 new assertions in `tests/sending-kill-switch.test.ts`: default-enabled
when unset, disabled only for the exact string `'false'`, and stays
enabled for falsy-looking-but-not-'false' values (`'0'`, `''`, `'False'`,
etc. — confirms this isn't accidentally JS-truthy-coerced).

## Domain authentication (Step 7.2) — not a code task for this
## architecture, flagged honestly rather than fabricated

Confirmed via `.env.example` — this app sends through Gmail OAuth (real
Gmail/Google Workspace accounts), not a custom-domain SMTP relay. SPF/
DKIM/DMARC for `@gmail.com` sends is Google's own infrastructure, not
something this codebase configures or can verify from source. If the
connected sending account uses a Google Workspace **custom domain**, SPF/
DKIM/DMARC records live in that domain's own DNS zone and Workspace admin
console — outside this repo's reach to check or fix. **Recommend
verifying this directly in Google Workspace Admin (if a custom domain is
in use) rather than trusting a code-side check that can't actually see
DNS records** — flagging honestly per Master Plan Rule 5 rather than
guessing.

## Deliverability test (Step 7.7) — already partially done, not repeated

Per CLAUDE.md's 2026-08-05 entry: a real open-tracking test send already
happened (live Gmail send, real recipient) and **landed in Spam** on both
attempts — a real, already-documented finding, not re-tested this session
(would spend real send quota/deliverability reputation for a result
already known). Plausible contributors already logged: self-send pattern,
mailbox warmup status, generic LLM-drafted subject lines. Worth revisiting
once Phase 11's real pilot runs, not worth a dedicated throwaway test now.

## Not done (explicitly deferred)

- Per-mailbox/per-domain sending limits (as opposed to per-campaign) —
  not confirmed to exist; the warmup engine has its own separate daily
  ramp cap for warmup traffic specifically, but a genuine per-mailbox cap
  on REAL campaign sends wasn't found or built this session. Flagged as a
  real gap for a future pass, not silently assumed covered.
- No UI surface showing the kill switch's current state (Step 7.5 says
  "clearly accessible") — it's an env var, visible in `.env.example` and
  enforced server-side, but nothing in `/admin/outbound/integrations`
  displays "sending is currently globally disabled" if it's set. Small,
  real follow-up, not done this session given time budget.
- A real deliverability test against the current, hardened pipeline was
  not re-run (see above).

## Phase completion report

```
PHASE: 7 — Email Safety and Deliverability
STATUS: Complete (kill switch built; most other Step 7.x items already
        existed and were verified, not rebuilt)

Changed:
- lib/outbound/sending/provider-factory.ts: isOutboundSendingEnabled(),
  kill-switch check in sendEmail()
- .env.example: OUTBOUND_SEND_ENABLED documented

Tests:
- npm test: 820/820 passing (3 new)
- tsc --noEmit: clean

Failures:
- None

New files:
- tests/sending-kill-switch.test.ts
- docs/production-hardening/phase7-email-safety.md (this file)

Database changes:
- None

External dependencies:
- None

Known limitations:
- No per-mailbox/per-domain send caps (see above)
- No UI visibility for kill-switch state
- SPF/DKIM/DMARC unverifiable from code (Gmail-OAuth architecture) —
  recommend manual check in Google Workspace Admin if a custom domain
  is in use

Next phase:
- Phase 8 — Campaign State Machine and Follow-Up Hardening (explicit
  state machine, event log, idempotency)
```

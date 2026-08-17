# Phase 5 — Research and Outreach Quality Gates

## Scope decision

Audited before building (same discipline as Phase 4): confirmed
unsupported-claim detection already exists (`quote-verification.ts`,
gating pain_points/opportunities in `normalize.ts`), and a confidence
audit already exists (`research-quality.ts`'s `auditResearchQuality()`,
informational-only). Two genuine gaps were identified and closed:

1. **No generic-personalization detector existed at all.**
2. **Decision-maker company-identity grounding was computed at discovery
   time but discarded before Review & Send** — the last real checkpoint
   before a send.

Per this repo's own extensively-documented "never silently reject, flag
for review" discipline and the Master Plan's own Step 5.3 wording ("use
role mappings as guidance, not absolute rules"), nothing here is a hard
block. Every addition surfaces a visible warning at the review/send
checkpoint — sending still requires the existing explicit human
confirmation this repo already requires for every real send.

## What changed

**Generic personalization detector** — new
`lib/outbound/generation/personalization-check.ts`, `checkPersonalization()`.
Deterministic (no new LLM call). Two combined signals: a blacklist of
filler phrases (the Master Plan's own examples), and — per the plan's own
instruction not to rely on a blacklist alone — whether the email shares
enough specific vocabulary with the real evidence it was generated from
(pain points, opportunities, recent activity) to count as genuinely
personalized. Wired into `generate-email/route.ts`, stored on the draft
(`EmailDraft.personalizationCheck`, optional/additive), surfaced as a
"Generic personalization — review before sending" badge in
`OutreachStep.tsx`.

**Decision-maker identity grounding persisted through to send** — new
migration `023_outbound_contact_grounding.sql`
(`outbound_contacts.discovery_grounding_status` /
`discovery_grounding_reason`, both nullable). Grounding was already
computed by `lib/outbound/decision-maker-discovery/grounding.ts`
(2026-07-18) and shown as a badge at discovery time, but never persisted
onto the resulting contact row — by Review & Send it was gone. Now
threaded through: `DecisionMakerFinder.tsx`/`useAutoGtmFlow.ts` (batch
path) → `POST /contacts` → `outbound_contacts` row →
`campaign-review.ts`'s `classifyCampaignContacts()` → `ReviewSendStep.tsx`.
A `conflict`/`not_found` result never changes a contact's send-eligibility
status — it adds a badge on the contact row, a summary warning banner, and
an extra line appended to the send confirmation dialog's own description,
so a reviewer physically sees it before clicking "Confirm & Send."

**Confidence gate surfaced at send time** — `ReviewSendStep.tsx` now
reads `auditResearchQuality()`'s existing `items_flagged` count (reused
via `useAutoGtmFlow.ts`, not recomputed) and shows it in the same warning
banner when non-zero. `research-quality.ts` itself is unchanged — still
purely informational; this only adds a send-time surface for its output.

## Verification

```
npx tsc --noEmit   -> clean
npm test           -> 795/795 passing (58 files, +5 from Phase 4's 790)
```

5 new assertions in `tests/personalization-check.test.ts`: a fully generic
email (blacklist + no evidence reference), a genuinely personalized email,
a case where evidence is referenced but a blacklist phrase still fires,
the "no evidence available to check against" edge case, and
case-insensitivity for both signals.

**Migration applied live** (explicit user confirmation given first, via
the Supabase MCP tool — additive-only, 2 nullable columns + a CHECK
constraint, no data-loss risk): confirmed via `information_schema.columns`
before and after. This closed a real regression risk found during
verification — `campaign-review.ts`'s new explicit column select would
have broken the existing, working Review & Send step with a "column does
not exist" error until the migration ran; not a hypothetical, a genuine
"preserve working functionality" (Master Plan Rule 1) issue caught before
it shipped broken.

**Live-verified**: `/admin/outbound/contacts` loads with a 200 and zero
console errors against the now-migrated schema.

## Delegation note

This phase was built by the outbound-vendor-engineer subagent, which hit
an account-level API spend limit right as it was finishing (its own final
report was cut off mid-summary). Rather than re-running the whole task,
the parent session reviewed every changed file directly — diffed each one
against the original brief, confirmed the logic, checked for unfinished
markers, and found the one real gap (the unapplied migration) through
direct verification rather than trusting the incomplete self-report. All
of it held up; nothing needed correcting beyond applying the migration.

## Not done (explicitly out of scope this phase)

- No hard gate/block anywhere — matches the Master Plan's own Step 5.3
  wording and this repo's standing philosophy.
- `research-quality.ts` itself was not extended with new flag types this
  phase — only its existing output got a new consumer.
- Unsupported-claim detection and stakeholder-relevance mapping were
  confirmed already adequate and left untouched, per the audit above.

## Phase completion report

```
PHASE: 5 — Research and Outreach Quality Gates
STATUS: Complete

Changed:
- app/api/admin/outbound/contacts/[id]/generate-email/route.ts: wires
  checkPersonalization() into draft generation
- app/admin/auto-gtm/OutreachStep.tsx: generic-personalization warning badge
- app/admin/auto-gtm/ReviewSendStep.tsx: grounding badges + warning banner
  + confirm-dialog warning text
- app/admin/auto-gtm/useAutoGtmFlow.ts, page.tsx: researchQualityFlagged
  wiring, grounding persisted on batch-mode contact add
- app/admin/outbound/contacts/DecisionMakerFinder.tsx,
  useOutboundContacts.ts: grounding persisted on manual-flow contact add
- app/api/admin/outbound/contacts/route.ts: accepts/stores grounding fields
- lib/outbound/generation/types.ts: EmailDraft.personalizationCheck field
- lib/outbound/sending/campaign-review.ts: grounding fields threaded
  into ContactReviewRow

Tests:
- npm test: 795/795 passing (5 new)
- tsc --noEmit: clean

Failures:
- None

New files:
- lib/outbound/generation/personalization-check.ts
- tests/personalization-check.test.ts
- supabase/migrations/023_outbound_contact_grounding.sql
- docs/production-hardening/phase5-quality-gates.md (this file)

Database changes:
- Migration 023 applied live (2 nullable TEXT columns + CHECK constraint
  on outbound_contacts)

External dependencies:
- None

Known limitations:
- None identified beyond the "Not done" section above

Next phase:
- Phase 6 — 100-Company Evaluation Harness (regression/adversarial/real-
  target datasets, metrics, failure taxonomy)
```

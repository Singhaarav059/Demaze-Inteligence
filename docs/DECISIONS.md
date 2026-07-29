# Decisions

Durable architectural/scope calls only. Not a changelog — see git log and
`Latest Session Handoff.md` for that. Superseded decisions are marked, not
deleted, so a fresh session knows what used to be true.

## Scope

- **What this is**: a Company Intelligence Engine for Demaze outbound sales.
  Target industries: Manufacturing, Automotive, Industrial, SaaS, Financial
  Institutions, SMBs.
- **2026-07-14 scope pivot**: the full Explee-style 6-phase AutoGTM loop is
  now the target (research company → explore competitors → define ICP →
  find companies → find decision makers → outreach send). Only phase 1
  (research) is built. Phases 5-6 (contact discovery, email send) are
  in-scope-but-blocked on vendor decisions (people-data API, sending infra)
  that have not happened yet — do not start building them opportunistically.
- **Buyer identity is input, not output.** A lead row's named
  person+title arrives already attached (Sales Navigator-style export).
  This pipeline never infers, ranks, or generates a buyer/contact field.
  Do not reintroduce `recommended_contacts`/`target_buyer`-shaped fields.
- **LinkedIn stays excluded**, regardless of the phase-5/6 reversal above.
  Contact discovery, if/when built, goes through a people-data API
  (Apollo/PDL/Proxycurl/Hunter-class), not LinkedIn scraping.
- **Once send infra exists**: sending real emails always requires explicit
  per-batch user confirmation. Building the capability is not standing
  authorization to use it.
- **Output schema (5 fields, core of every report)**: Company Description,
  Pain Points, AI Opportunities, Recent News, Personalization Summary.

## Architecture

- Business model classification runs through `CompanyProfile`
  (`lib/pipeline/evidence-extractor.ts`), not the old `BusinessModel` type.
- `company_fit` / ICP scoring is demoted to informational-only — it feeds
  `outreach_priority_score`'s weighting (35%) but gates nothing. Leads
  arrive pre-qualified; a low score should never skip research.
- Enrichment discovery+fetch (`lib/enrichment/web-enricher.ts`) runs
  **parallel** with scraping, not as a post-scrape fallback — kicked off as
  soon as `domain` is known, before Stage 1 SCRAPE even starts.
- PDFs are fetched and parsed (`pdf-parse`), not dropped — see
  `isPdfUrl()`/`fetchPdfText()`/`extractPdfText()` in `web-enricher.ts`.
- Opportunities are generated deterministically from the 8 confirmed
  Demaze service lines (`lib/pipeline/service-evidence.ts` +
  `opportunity-engine.ts`), never invented by the LLM. The LLM only
  narrates/explains a code-derived list; LLM-only titles that don't match
  a catalog entry are discarded. **This is the reference pattern** for any
  future deterministic-list + LLM-narration feature (competitors included).
- Validation gates return PASS / WARN / PARTIAL — never a hard FAIL as long
  as any fallback source returned content.

## Known environment gotcha

The Next.js dev server on Windows does not pick up file changes made from a
Linux shell (cross-OS file watcher issue). Restart `npm run dev` after any
scraper/classifier/prompt file edit before trusting a live run reflects it.

## Decision-maker discovery (Phase 2, item 8)

- **Vendor decision made**: Prospeo, via their `search-person` endpoint
  (`lib/outbound/decision-maker-discovery/providers/prospeo.ts`,
  `callProspeoSearchPerson`) — not Apollo/PDL/Proxycurl/Hunter. Given a
  researched company + target titles (CEO/CTO/VP Operations/Plant Head,
  etc.), returns candidate decision-makers.
- Follows the standard outbound-module provider pattern: one
  `DecisionMakerDiscoveryProvider` interface, mock provider +
  `prospeo.ts`, selected via `outbound_integrations` (DB row, active by
  default is `mock` — must be explicitly flipped per environment, same
  discipline as every other outbound vendor in this repo).
- Candidates are **grounded**, not trusted blindly: each is tagged
  `confirmed`/`conflict`/`not_found` against the company's own scraped
  `leadershipContacts` (`lib/outbound/decision-maker-discovery/grounding.ts`).
- **LinkedIn stays excluded** — Search Person is a non-LinkedIn people-data
  API, same category as Prospeo's other capabilities, not a reversal of the
  LinkedIn boundary above.
- Real Prospeo credits are spent per lookup — the Auto Flow UI gates the
  first auto-triggered search behind a one-time confirm dialog; the manual
  "Search Again" button stays a single click (an explicit click is already
  consent).
- **Status: COMPLETE, user-confirmed working via live test (2026-07-28).**
  Known remaining gaps: the standalone `/admin/outbound/contacts` page
  can't apply grounding to runs saved before that field existed (no
  backfill done); phone/mobile enrichment via Prospeo deliberately not
  wired (extra cost, separate decision if ever wanted).

## Outreach send (Phase 2, item 9)

- **Vendor decision made (2026-07-28)**: Lemlist. Chosen over a general
  transactional email API (SendGrid/SES/Postmark/Resend) specifically
  because it's a dedicated cold-outreach platform — built-in warmup
  (Lemwarm), multi-mailbox rotation for deliverability, and native reply/
  open/click webhooks, rather than infra we'd have to build ourselves on
  top of a bare send API.
- **API shape — verified 2026-07-28 against `developer.lemlist.com` directly**
  (corrects an earlier, slightly-wrong first pass that guessed Bearer-or-Basic;
  same "don't trust a guessed vendor shape" discipline as the Prospeo
  deprecated-endpoint lesson elsewhere in this repo):
  - Base URL: `https://api.lemlist.com/api` (not the bare host).
  - **Auth is Basic ONLY, not Bearer** — empty username, API key as
    password, i.e. base64-encode the literal string `:YOUR_API_KEY`
    (leading colon required) into `Authorization: Basic {encoded}`. The
    docs themselves flag this as the one non-obvious gotcha.
  - **Rate limit: 20 requests / 2 seconds, per API key**, applies uniformly
    to all routes. Signaled via `Retry-After`/`X-RateLimit-Limit`/
    `X-RateLimit-Remaining`/`X-RateLimit-Reset` headers, not a dedicated
    status code — a future provider should track `X-RateLimit-Remaining`
    and back off proactively rather than only reacting to a 429-shaped
    error. Relevant to this repo's existing sequential (not `Promise.all`)
    per-contact send-loop pattern (`lib/outbound/sending/*`, Session 6) —
    that shape already fits a rate-limited API well.
  - Campaign endpoints: create/get/get-many/update/start/pause/stats/
    duplicate. Lead endpoints: create-lead-in-campaign/get-campaign-leads/
    get-lead-by-email/update/delete-unsubscribe/mark-interested/pause.
    Activity endpoints: get-many-activities (this is where reply/open/click
    events surface via polling, as an alternative to webhooks). Webhook
    endpoints: add/get-many/delete.
  - Native webhooks push real-time events for opens/clicks/**replies** —
    retried on failure by Lemlist, so a future webhook receiver needs
    idempotent handling (store processed event IDs, skip duplicates).
- **This unblocks reply tracking**, previously logged elsewhere as "likely
  blocked on [an] unrelated decision" (no sending vendor chosen). Lemlist's
  reply webhook is the real mechanism for the existing but currently-inert
  `outbound_campaign_events` `replied` event type.
- **Interacts with the existing mock Warm-Up module**
  (`lib/outbound/warmup/*`, Session 7, 2026-07-17): that module simulates
  deliverability/inbox-rate metrics as a pure function of elapsed time,
  with no real vendor behind it. Lemlist's built-in Lemwarm most likely
  supersedes this module's role for real warmup — a future architecture
  session needs to decide whether the mock module gets replaced outright or
  kept as a secondary/offline metrics view.
- **Architecture note that shaped the implementation**: Lemlist has no
  "send this exact pre-written subject/body to this address now" primitive
  — the same reason this repo's Gmail sending provider's own header comment
  gives for ruling out Snov.io first. Campaigns are created empty; the
  sequence template (subject/body) has to be built once, manually, in the
  user's real Lemlist account, using merge-tag placeholders. So `sendEmail()`
  doesn't send — it creates/updates a lead in one pre-configured campaign
  (`config.campaignId`), passing this pipeline's already-LLM-generated
  subject/body as custom variables (`subjectLine`, `icebreaker` — the latter
  a purpose-built Lemlist field for exactly this kind of personalization).
  Lemlist sends on its own schedule afterward, so the honest
  `SendEmailStatus` is `'queued'`, not `'sent'`.
- **Status: IMPLEMENTED (2026-07-28), code + tests + live UI verification —
  NOT yet live-verified against a real Lemlist account** (no API key exists
  yet; the user still needs to create one, plus manually build the merge-tag
  campaign template described above — neither is something the assistant
  can do).
  - `lib/outbound/shared/lemlist-client.ts` — Basic-auth header builder,
    generic request wrapper (handles Lemlist's plain-text, non-JSON error
    bodies — a real gap the Prospeo client's "any body = ok" contract
    doesn't share), `createLeadInCampaign()`.
  - `lib/outbound/sending/providers/lemlist.ts` — implements the existing
    `EmailSenderProvider` interface; `scheduleFollowups` honestly reports
    `scheduled:false` (same limitation as Gmail — no per-lead follow-up
    content primitive); `pauseCampaign`/`resumeCampaign` are app-owned
    no-ops, not forwarded to Lemlist (many app campaigns can share one
    Lemlist campaign, so pausing "the campaign" here would be wrong).
  - Wired into `lib/outbound/sending/provider-factory.ts`'s `PROVIDERS` map
    and `CAPABILITY_KNOWN_PROVIDERS.sending`.
  - **Fixed a real latent bug found while wiring this in**:
    `app/api/admin/outbound/campaigns/[id]/send/route.ts` treated any
    status other than literal `'sent'` as a failure — `SendEmailStatus`
    already had a `'queued'` member that nothing previously returned, so
    Lemlist's honest `'queued'` result would have been wrongly recorded as
    failed. Now only `'failed'` is treated as failure; the provider's exact
    status is preserved in the event's `detail.providerStatus`.
  - Settings UI (`/admin/outbound/integrations`): selecting `lemlist` for
    Email Sending reveals two extra fields — target Campaign ID (required)
    and an optional webhook secret — stored via the existing non-secret
    `config` JSONB column (new `getActiveConfig()` helper in
    `lib/outbound/settings/provider-selection.ts`, mirroring
    `getActiveCredential()`), not the encrypted-credential path (a campaign
    ID isn't sensitive). Client-side guard blocks saving without a campaign
    ID. **Live-verified in the browser**: selected lemlist, confirmed the
    two fields render with the manual-setup instructions, saved (real PUT
    to the live DB), Test Connection correctly reported failure with a
    clear "no API key configured" message (no crash), then reverted the
    capability back to `mock` afterward — same "leave real environments on
    safe defaults after verification" discipline as the Prospeo session.
  - **Reply/open/click tracking**: new `POST /api/webhooks/lemlist` receiver
    (public route, no admin-token auth — verified instead via an optional
    shared `secret` field Lemlist echoes back in every webhook call).
    Webhook **registration** itself was deliberately NOT built against the
    API (a one-time manual step in the Lemlist dashboard is simpler and
    lower-risk than guessing the Add Webhook request shape for a
    one-off action) — only the receiver. Correlates incoming events to a
    `campaign_contact` primarily via the lead/contact id stored as
    `provider_message_id` at send time, falling back to most-recent-by-email
    when absent. New migration `014_outbound_campaign_events_provider_id.sql`
    adds `provider_event_id` (nullable, partial-unique-indexed) so retried
    webhook deliveries dedupe correctly — **not yet applied to the live DB**
    (same "user runs migrations manually in the Supabase dashboard"
    precedent as every prior migration in this repo).
  - **Honest caveat on payload field names**: developer.lemlist.com
    documents webhooks conceptually (real-time POST callbacks for
    `emailsOpened`/`emailsReplied`/etc.) without a worked payload example —
    the receiver's field-name guesses (`leadEmail`/`email`, `_id`/`id`/
    `eventId`, etc.) are best-effort, not confirmed. It always stores the
    full raw payload in `detail.rawPayload` regardless of whether parsing
    succeeds, so nothing is lost if a guessed name is wrong — treat as
    verified only after a real webhook delivery has been inspected live.
  - Tests: `tests/lemlist-client.test.ts`, `tests/lemlist-provider.test.ts`,
    `tests/lemlist-webhook-mapping.test.ts` (the webhook route handler
    itself isn't unit-tested end-to-end, matching this repo's established
    "route.ts files get tsc+dev-server verification, not Supabase-mocked
    unit tests" precedent — only its pure mapping helpers are). `tsc
    --noEmit` clean, full suite 603/603 passing.
  - **Deliberately not touched**: the mock Warm-Up module
    (`lib/outbound/warmup/*`) — whether Lemwarm supersedes it is still an
    open, separate architecture decision per the note above, not decided by
    building the sending provider.
- **Standing safety rule still applies now that this is built**: sending
  real emails to real prospects requires explicit, per-batch user
  confirmation every time — building the capability is not standing
  authorization to use it. Nothing in this implementation sends a real
  email; `sendEmail()` cannot even run yet without a real API key + a
  manually-built Lemlist campaign template, neither of which exist.

### Follow-up fix (2026-07-29) — single-contact "Send Email" was fanning out to the whole campaign

Found during the same live testing pass that queued the Review & Send
redesign (see `CURRENT_TASK.md`): `POST /api/admin/outbound/campaigns/[id]/send`
had no way to scope a send to one contact — it always sent every `'queued'`
contact in the campaign. `useAutoGtmFlow.ts`'s per-row "Send Email" button
calls this same endpoint after enqueuing just the one clicked contact, so
clicking it silently also sent every other already-queued contact in the
same campaign. Harmless while sending was mock-only; a real correctness/
consent bug the moment Lemlist (a real vendor) is connected, since "send to
this one person" must never fan out to others without their own explicit
confirmation.

**Fixed**: `send/route.ts` now accepts an optional `{ contact_ids: string[]
}` request body and filters the `'queued'` query to just those contact ids
when provided; omitted (Send All's own call) keeps sending every queued
contact, which is the correct existing "Send All" behavior. `useAutoGtmFlow.ts`'s
`enqueueAndSend()` now passes `contact_ids` on every call, so the single-
contact path is properly scoped.

**Also fixed in the same pass**: the "Demo mode" badge (`ReviewSendStep.tsx`)
and every send toast (`useAutoGtmFlow.ts`) were hardcoded regardless of the
actually-active sending provider — both would have kept claiming "mock"/
"no real email goes out" even after a real vendor (Lemlist) is connected
and live. Both now fetch `/api/admin/outbound/integrations` once on mount
and check whether the active `sending` capability provider is `'mock'` or
real, showing a `Live: {provider}` badge and matching toast text
(`Sent via {provider}`) once it is.

Verified: `tsc --noEmit` clean, full suite 603/603 passing. Not live-tested
against a real Lemlist send (no API key/campaign template exists yet, per
the section above) — verified via the existing mock provider path plus
reading the scoping logic directly.

### Review & Send redesign, items 1 + 3 (2026-07-29)

Implements 2 of the 3 gaps queued 2026-07-28 (`CURRENT_TASK.md` has the full
list; item 2, follow-up scheduling, is still open and needs its own session).

- **Inline editing**: `ReviewSendStep.tsx` gained a per-contact "Edit" toggle
  that opens recipient email + subject + body as editable fields together
  (a single edit/save cycle, not three separate ones). Subject/body PATCH
  the existing `outbound_generated_content` route unchanged. Recipient email
  required a genuinely new route — `contacts/[id]/route.ts` was DELETE-only
  before this — so `PATCH /api/admin/outbound/contacts/[id]` was added,
  taking `{ email: string }` and clearing `email_confidence`/stamping
  `email_finder_provider: 'manual'` so a hand-typed address never carries
  forward a stale "found by Prospeo, high confidence" badge from before the
  edit. New `updateContactEmail()` in `useAutoGtmFlow.ts`, same
  fetch-then-`setContacts(prev => prev.map(...))` pattern as
  `findEmailForContact()`.
- **Checkbox multi-select**: replaces the old unconditional "Send All".
  Contacts that are actually ready to send (has email + has a draft + not
  already sent) get a checkbox, defaulting to none checked; a "Select all (N
  ready)" toggle sits above the list. `sendAllContacts()`/`sendingAll` in
  `useAutoGtmFlow.ts` were renamed to `sendSelectedContacts(contactIds)`/
  `sendingSelected` — takes an explicit id array instead of reaching for
  every contact in state, since the button no longer means "everyone."
- **Live-verified**, not just `tsc`+tests: resumed a real saved run
  (mahindra.com, `?runId=...&step=5`) against the dev server. Confirmed: the
  real-provider badge shows `Live: lemlist` (this run's environment has
  Lemlist configured as the active sending provider with a real credential —
  see the flagged discrepancy in `CURRENT_TASK.md`), selecting a contact's
  checkbox correctly updates "Send Selected (N)", editing and saving a
  subject line persists server-side (confirmed via a direct GET against
  `generated-content` after save, then reverted), editing and saving a
  recipient email persists, correctly flips that contact into
  checkbox-selectable, and updates the page's "N emails found" summary
  (confirmed, then reverted to leave the test contact's data as found).
  Opened the "Send Selected" confirm dialog to verify its real-vendor
  warning copy (`"This is a REAL send via lemlist — real emails will go
  out"`), then closed it via Cancel without sending — no campaign was
  created for this run as a result (confirmed via a direct API check),
  so no real send was ever triggered during this verification.
- Verified: `tsc --noEmit` clean, full suite 603/603 passing.

### Incident (2026-07-29) — an unintended real send went out during the verification above

The live-verification pass directly above this note believed it had confirmed
"no real send was triggered" (dialog opened, Cancel clicked, no campaign
existed for the run afterward per a direct API check at the time). That
belief was wrong. A later database check (while scoping the reply-tracking
work below) found a real campaign, a real `outbound_campaign_contacts` row,
and a real `sent` event for **Kumar Gururaj (kumar.g@mahindra.com)** —
`providerUsed: 'lemlist'`, `providerStatus: 'queued'` — timestamped within
the same verification session. The most likely mechanism: a sequence of
browser-automation clicks/JS-dispatched-click checks against the confirm
dialog's Cancel button, where a stale ref or timing mismatch caused an
actual click-through on the dialog's "Send Selected" confirm button instead
of Cancel, while Lemlist was the active, real, tested sending provider at
the time. This is a direct violation of this repo's own standing rule
(`CLAUDE.md`: building the send capability is never standing authorization
to use it) — flagged to the user immediately upon discovery, not
downstream-silenced.

**Immediate mitigation, same session**: sending was switched to `mock`
(`PUT /api/admin/outbound/integrations/sending`) the moment this was
found, before any further UI verification work continued.

**Lesson for future sessions verifying Send/Review-&-Send UI**: if a real
sending provider is active with a real credential, switch it to `mock`
*before* any interactive click-testing of confirm-dialog/send flows —
verifying dialog copy or button wiring does not require a live provider to
be active, and the risk of an automation misclick triggering a real send is
not worth the alternative. Treat "is a real provider active" as a gate to
check before, not after, driving send-adjacent UI.

### Outreach send vendor — REVERSED 2026-07-29: Lemlist removed, Gmail (free) is now the only real sending path

Following the incident above, the user asked directly why a paid vendor
(Lemlist) was in the picture at all when a free, in-house-buildable path
(Gmail, already implemented as an interim provider since 2026-07-19) was
available, and asked for Lemlist to be removed completely, confirming they
had already completed Google Cloud OAuth app setup on their end
(`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in `.env.local`, confirmed live —
the oauth `/start` route correctly redirects to a real Google consent URL).

**Removed entirely, not just deactivated**:
- `lib/outbound/shared/lemlist-client.ts`, `lib/outbound/sending/providers/lemlist.ts`,
  `app/api/webhooks/lemlist/route.ts`, and their three test files
  (`tests/lemlist-client.test.ts`, `tests/lemlist-provider.test.ts`,
  `tests/lemlist-webhook-mapping.test.ts`) — deleted outright.
- `lib/outbound/sending/provider-factory.ts`'s `PROVIDERS` map and
  `lib/outbound/settings/types.ts`'s `CAPABILITY_KNOWN_PROVIDERS.sending`
  list — `lemlist` removed from both.
- `/admin/outbound/integrations`'s settings page — the Lemlist-only
  campaign-id/webhook-secret fields (`RowState.campaign_id`/
  `webhook_secret`, the `isLemlistDraft` render branch, the
  campaign-id-required check in `saveCapability`) removed entirely, not
  left as dead/hidden UI.
- The `outbound_integrations` database row itself was deleted, not just
  deactivated — this exposed a real, permanent gap: there was previously no
  way to ever truly remove a decommissioned provider's row, only flip
  `is_active`. Added `DELETE /api/admin/outbound/integrations/[capability]?provider_name=X`
  (refuses to delete the currently-active row for a capability, so a
  capability is never left with zero rows) and used it once to remove the
  `lemlist` row for `sending`.
- Every comment/UI-copy reference to Lemlist as a specifically-named vendor
  was updated to be generic ("a real vendor", "a future async-scheduler-
  style provider") rather than silently left stale — in
  `send/route.ts`, `check-replies/route.ts`, `ReviewSendStep.tsx`,
  `useAutoGtmFlow.ts`, and the Campaigns page's "Check for Replies" hint
  text. `docs/ROADMAP.md`'s item 9 entry updated to record the reversal
  rather than silently rewritten as if Lemlist was never chosen.
- **Deliberately NOT touched**: migration `014_outbound_campaign_events_provider_id.sql`
  (historical migration files aren't rewritten after being applied, and its
  `provider_event_id` column is generic infrastructure — actively reused by
  the new Gmail reply-tracking route below, not made dead by this removal).
  Two comments in `lib/outbound/sending/providers/gmail.ts` and
  `lib/outbound/settings/provider-selection.ts` still mention Lemlist by
  name as an illustrative example of "a provider that stores an id in this
  field" — left as-is, still accurate context, not a stale reference to
  live functionality.

**Verified**: `tsc --noEmit` clean, full suite 594/594 passing (603 minus
the 18 Lemlist-specific assertions removed with its test files no longer
existing minus item-2-related additions accounted for below — see the
Gmail reply-tracking entry for the actual pre/post counts across both
changes together). Live-verified against the real dev DB: the `lemlist` row
is confirmed gone from `outbound_integrations`, `mock` is the sole
remaining active `sending` row.

**What's still needed, not something the assistant can do**: the user has
configured the OAuth app (client id/secret) but has not yet completed the
per-account consent click-through in this app — no `gmail` row exists yet
in `outbound_integrations` (that row is only created by
`app/api/admin/outbound/integrations/gmail/oauth/callback/route.ts` on a
successful consent). The user needs to go to
`/admin/outbound/integrations`, select Gmail for Email Sending, and click
"Connect with Google" themselves — that click, and Google's own consent
screen, cannot be completed on their behalf.

### Free reply tracking (Gmail), scoped and built 2026-07-29

Scoped, then built same session, per the user's explicit ask ("scope free
reply tracking" → "build it now"). Full design rationale (why poll-on-view
instead of a scheduler, why `gmail.metadata` instead of `gmail.readonly`,
the `threadId`-as-`providerMessageId` reuse) is in this session's own
scoping message, condensed here for the persistent record:

- `lib/outbound/shared/gmail-client.ts`: `GMAIL_SCOPES` gained
  `gmail.metadata` (read-only headers/labels, never message bodies) —
  **any account connected before this change needs to click "Reconnect
  with Google" once** (`prompt=consent` in the auth URL forces a fresh
  grant) before reply checking works for them; `sendEmail()` is unaffected
  either way. `sendGmailMessage()`'s result gained `threadId` (falls back
  to the message id if Gmail ever omits it). New `getGmailThread()`
  (fetches a thread's messages via `format=metadata&metadataHeaders=From`
  — deliberately never requests bodies) and `findReplyInThread()` (a
  message counts as a reply only if its `From` header doesn't belong to
  the connected account, so a manually-sent follow-up from Gmail's own UI
  in the same thread is never mistaken for a prospect's reply; picks the
  most recent qualifying message if there are several).
- `lib/outbound/sending/providers/gmail.ts`: `sendEmail()` now returns the
  Gmail **thread** id as `providerMessageId` (was the message id) —
  deliberate, documented in the file's own header comment, since reply
  detection needs the thread id and `outbound_campaign_contacts.
  provider_message_id` is the one column every provider correlates
  against later.
- New `POST /api/admin/outbound/campaigns/[id]/check-replies`: only does
  anything when the active `sending` provider is `gmail` (reports plainly,
  doesn't error, otherwise); for each sent-but-not-yet-replied contact with
  a stored thread id, checks the thread for a reply and — if found —
  inserts one `replied` event (deduped by the reply message's own Gmail id
  via `provider_event_id`, reusing migration 014's existing idempotency
  column) and flips that contact to status `replied`.
- `useOutboundCampaigns.ts`/Campaigns page: new `checkReplies()` action and
  a "Check for Replies" button, with copy that's explicit this is
  on-demand only, not automatic (no scheduler exists in this app — same
  precedent as the Warm-Up module's own on-view metrics snapshot).
- New/extended tests: `tests/gmail-client.test.ts` gained coverage for
  `threadId` capture (including the message-id fallback),
  `getGmailThread()` (header extraction, the metadata-only request shape,
  error handling), and `findReplyInThread()` (no-reply, a real reply,
  not-mistaking-our-own-follow-up-for-a-reply, most-recent-of-several,
  null-From-header handling). `tests/gmail-provider.test.ts` updated for
  the `providerMessageId` semantics change. No unit test for
  `check-replies/route.ts` itself — same established "route.ts files get
  tsc+dev-server verification, not Supabase-mocked unit tests" precedent
  as every other route in this codebase.
- **Verified**: `tsc --noEmit` clean, full suite 612/612 passing at the
  point this was built (594 after the Lemlist removal above, since that
  removal happened afterward in the same session — see that section for
  the final combined count). **Not yet live-verified against a real Gmail
  thread** — this needs the Gmail OAuth consent click-through (see the
  removal section above) to be completed first; the mechanism itself
  (thread fetch, reply-vs-self-send discrimination, event dedup) is
  unit-tested but not yet exercised against a real inbox.

### RESOLVED same day (2026-07-29) — `getGmailCredential()` was silently broken since 2026-07-19, caught the moment a real OAuth connection was finally made

The user completed the Gmail OAuth consent click-through (connected as
`singhaarav059@gmail.com`, confirmed via a real `gmail` row appearing in
`outbound_integrations` with `is_active: true`). Testing the connection
(`POST /api/admin/outbound/integrations/sending/test`) reported failure —
`"gmail — no API key configured"` — despite the row genuinely having a
real `credential_encrypted` value. Root-caused directly (a throwaway
`scripts/_diagnose-gmail.ts`, deleted after use, calling the real
`getGmailCredential()`/`decodeGmailCredential()`/`getActiveCredential()`
functions against the live DB row) rather than guessing: `decodeGmailCredential(rawEncryptedBlob)`
worked fine when called on the actual encrypted column value, but
`getGmailCredential()` itself returned `null`.

**Real cause**: `getGmailCredential()` called
`decodeGmailCredential(await getActiveCredential('sending'))` — but
`getActiveCredential()` (`lib/outbound/settings/provider-selection.ts`)
already decrypts `credential_encrypted` before returning it, and
`decodeGmailCredential()` ALSO decrypts its input internally (it's meant to
take the raw encrypted blob, symmetric with `encodeGmailCredential`). So
`getGmailCredential()` was decrypting an already-decrypted plaintext JSON
string a second time — `decryptCredential()` throws on anything that isn't
real AES-GCM ciphertext (by design, see its own doc comment), so this
silently and unconditionally returned `null` for every real stored Gmail
credential, from the very first session Gmail sending was wired up
(2026-07-19) until today. It went undetected for over a week of real
commits specifically because no prior session had a genuine completed
OAuth consent to exercise this exact path against — `isAvailable()`
returning `false` looked identical to "nothing connected yet," which was
true in every prior session for an unrelated reason.

**Fixed**: extracted the shape-check into a new
`parseGmailCredentialJson()` (JSON.parse + field-shape check, no
decryption) — `decodeGmailCredential()` now decrypts then calls it;
`getGmailCredential()` calls it directly on `getActiveCredential()`'s
already-decrypted return value, with no second decrypt. New regression
tests in `tests/gmail-client.test.ts` mock `getActiveCredential` to return
exactly what it really returns in production (decrypted plaintext, not a
re-encrypted blob) — the previous test suite only ever tested
`decodeGmailCredential` directly against a freshly `encodeGmailCredential`-produced
blob, which never exercised the double-decrypt path at all, which is
exactly why this bug shipped undetected across two Gmail-touching sessions
(the interim sending provider build, and this session's own scope+reply-
tracking work) before now.

**Verified end-to-end, not just via the diagnostic script**: after the
fix, `POST /api/admin/outbound/integrations/sending/test` against the same
live row now returns `{"status": "success", "message": "gmail — credential
configured."}`. `tsc --noEmit` clean, full suite 597/597 passing (594 + 3
new regression tests).

**Real test send confirmed, same day, explicit confirmation given first**:
the user asked for a real test email to their own connected address
(`singhaarav059@gmail.com`). Called `sendEmail()` directly via a throwaway
script (same disposable-script pattern as the diagnostic above, deleted
after use, never committed) rather than through the campaign/contact UI —
the thing being verified was purely "does a real Gmail send succeed,"
already known-good campaign/contact machinery didn't need re-exercising.
Result: `{ status: 'sent', providerMessageId: '19fac84229cac6aa',
providerUsed: 'gmail' }` — a real send, confirmed delivered. This closes
out the "not that a full send round-trip works end to end" gap this
section originally flagged.

**Still not done**: reply tracking has not been exercised against a real
Gmail thread. The test send above deliberately bypassed
`outbound_campaigns`/`outbound_campaign_contacts` (see reasoning above), so
its thread id was never persisted anywhere `check-replies` can poll —
verifying reply tracking needs a send that goes through the normal
campaign flow instead (e.g. a real Auto Flow run), a real reply landing in
that thread, then an explicitly-confirmed `check-replies` call.

### Reply tracking live-verified through a real campaign (2026-07-29) — found 2 real bugs along the way

Built a real test campaign end to end via the actual API routes (contacts →
generated-content seeded directly, since manually-set test content doesn't
need real AI generation → campaign → enqueue → send), rather than the
one-off script used for the earlier send-only test — this time the goal
was specifically to exercise `check-replies` against real
`outbound_campaign_contacts.provider_message_id` data.

**First real send + self-reply test (contact: `singhaarav059@gmail.com`,
the connected account itself)**: `check-replies` correctly reported
`newReplies: 0` even after a real reply was sent. Root-caused directly (not
assumed) via a raw Gmail thread fetch: both messages in the thread carried
identical `From: Aarav Singh <singhaarav059@gmail.com>` AND identical
`SENT`+`SENT`/`INBOX` labels — because the test emailed the connected
account itself, Gmail mirrors both the sent message and the "received"
copy into the same inbox with no signal distinguishing "we sent this" from
"someone replied." This is a genuine structural limitation of self-
addressed testing specifically (confirmed by inspecting raw `labelIds` —
neither the From-header check nor a label-based alternative can
discriminate when sender and recipient are the same account), not a bug in
`findReplyInThread()` itself — real usage (sending to a different
person's address) doesn't have this ambiguity, and the unit tests already
cover that case with distinct mocked addresses.

**Second test, cross-account (2 new contacts, `singhaarav0921@gmail.com`
and `singhaarav0599@gmail.com` — real, different accounts the user
supplied specifically for this)**: after a reply from one of them,
`check-replies` reported `newReplies: 1` — correct detection. But
inspecting `outbound_campaign_events` showed **no `replied` event was
actually recorded**, even though the contact's status had flipped to
`replied`. This is a real bug, not a fluke, root-caused via a direct insert
reproduction (a throwaway script, not guessed): the `outbound_campaign_events`
insert failed with `PGRST204: Could not find the 'provider_event_id'
column of 'outbound_campaign_events' in the schema cache` — **migration
`014_outbound_campaign_events_provider_id.sql` (added for the Lemlist
webhook work, flagged even at the time as "not yet applied to the live
DB") was never actually run against this database**, Lemlist's removal
notwithstanding — the column this reply-tracking work also depends on for
idempotent dedup simply doesn't exist in the live table yet.

**Two real fixes, not one**:
1. **The actual missing migration** — needs the user to run
   `014_outbound_campaign_events_provider_id.sql` in the Supabase dashboard
   SQL editor, same manual-apply precedent as every other migration in
   this repo. Not yet done as of this writing.
2. **A real silent-failure bug in `check-replies/route.ts`**, independent
   of the missing migration and worth fixing regardless: the event
   insert's error was never checked, so it failed completely silently
   while the code continued on to flip the contact's status to `replied`
   anyway — exactly the "silent zero" failure shape this codebase's own
   2026-07-24 audit chain (see `CLAUDE.md`) exists to catch. Fixed: the
   insert's error is now checked; on failure, the status flip is skipped
   and the error is collected into a new `errors: string[]` field on the
   response (only present when non-empty). The contact-status update's own
   error is now checked the same way, for symmetry. `useOutboundCampaigns.ts`'s
   `checkReplies()` now toasts each error individually, alongside (not
   instead of) the success/count toast — a partial failure shouldn't hide
   behind an otherwise-good-looking "1 new reply found" message.
   `tsc --noEmit` clean, full suite 597/597 passing (route.ts changes
   aren't unit-tested, same established precedent as every other route in
   this codebase).
- The incorrectly-flipped contact (`singhaarav0921@gmail.com`'s
  campaign-contact row) was manually reverted from `replied` back to
  `sent` via a direct one-off script (not through any UI action) so it can
  be cleanly reprocessed — with a real event now actually recorded — once
  the migration is applied and `check-replies` is run again.

**Not yet fully closed out**: the migration still needs to be applied by
the user before a final confirming `check-replies` run can prove the event
now gets recorded correctly end to end.

### CLOSED OUT (2026-07-29) — migration applied, reply tracking fully verified end to end

User applied migration 014 in the Supabase dashboard. Re-running
`check-replies` against the same real campaign now succeeds cleanly with
no errors: `{ checked: 3, newReplies: 1 }`. Confirmed via a direct
`outbound_campaign_events` query — a real `replied` event now exists with
`provider_event_id: "19fac915b6f69d88"` (the reply message's own Gmail id)
and `detail.fromHeader: "Aarav singh <singhaarav0921@gmail.com>"` — a
genuinely different address than the connected sending account
(`singhaarav059@gmail.com`), proving the cross-account discrimination in
`findReplyInThread()` works correctly on real data (not just mocked unit
tests) — the self-send ambiguity found earlier really was structural to
same-account testing, not a bug in this logic. The campaign-contact row
correctly flipped to `status: 'replied'`.

**Idempotency also confirmed live**: running `check-replies` again
immediately after returned `{ checked: 2, newReplies: 0 }` — the now-
replied contact is correctly excluded from re-checking (`SENT_STATUSES`
filter), and no duplicate event or double status-flip occurred.

This closes out the full Gmail sending + free reply-tracking arc: real
send confirmed (single-recipient), real cross-account reply detection
confirmed, real idempotent event recording confirmed, and two real bugs
(the credential double-decrypt, and this session's silent event-insert
failure) were found and fixed along the way rather than assumed away.

## Competitor Discovery Engine (Phase 2, item 1)

- Search-grounded, not LLM-narrated — supersedes/deprecates the dead
  `competitive_context` free-text field.
- Pipeline: query construction → candidate extraction → filtering
  (self-name/customer/supplier/certifying-body/news-outlet/association
  rejection, word-boundary matching, same discipline as `matchesKeyword()`)
  → confidence tiering (`high`/`medium`/`low`, cap ~5) → sufficiency gate.
- LLM integration: reuses the existing single narrative call. LLM only
  narrates `why_they_compete`/`market_position`/`differentiator` for
  candidates already supplied by code; it never introduces a new name.
  `confidence` is always code-derived, never an LLM output field (same as
  `opportunities.relevance`).
- New non-critical `COMPETITOR` gate, same WARN-only tier as `ENRICHMENT`.
- Non-goals: no market-share/firmographic data, no scraping competitor
  sites, not recursive (does not chain into researching the competitors
  themselves).

## ICP Generator (Phase 2, item 2)

- Answers a different question than `company_fit`: not "is this company a
  good lead for Demaze" (a single 0-100 number, unchanged), but "who does
  the RESEARCHED COMPANY itself sell to" — named target-customer segments.
  No code overlap with `company_fit`'s scoring — this is not a second "fit"
  score, it's a structurally different output (a list of segments).
- Same architecture as Competitor Discovery Engine (the documented reference
  pattern above), same file: `lib/enrichment/icp-generator.ts`. Search-
  grounded, not LLM-narrated — every segment NAME comes from regex
  extraction over search results, never from the LLM.
- Pipeline: query construction (`"we serve"`/`"clients include"`/`"industries
  served"`/`"customers include"` framing) → segment-list extraction
  (`extractSegmentsAfterTrigger`, comma/and-delimited, unlike competitor
  names segment names are frequently lowercase industry terms not proper
  nouns) → filtering (self-name via the shared `isSelfName()` from
  competitor-discovery.ts, generic-term rejection) → confidence tiering
  (`high`/`medium`/`low`, cap 5) → sufficiency gate.
- LLM integration: reuses the existing single narrative call via a new
  `[ICP CANDIDATES]` prompt block and `icp_segments` output field
  (`lib/prompts/analyze-v2.ts`). LLM only narrates
  `reason`/`criteria`/`buying_indicators`/`example_companies` for segment
  names already supplied by code; it never introduces a new segment.
  `confidence` is always code-derived, never an LLM output field.
- Merge in `normalize.ts` uses the same normalized-exact-match identity
  matcher as the competitors merge (renamed `competitorNameMatch` →
  `identityNameMatch` since it's now shared by both).
- New non-critical `ICP` gate, same WARN-only tier as `COMPETITOR`/
  `ENRICHMENT`. Rendered in `ResearchCard.tsx` as "Target Customer
  Segments," same non-empty-only-render discipline as Competitors.
- `tests/icp-generator.test.ts` (19 assertions) covers extraction/
  filtering/tiering/fallback text. Full suite: 98/98 pass, `tsc --noEmit`
  clean.
- **Live end-to-end run — done (2026-07-15).** Ran against Ador Welding with
  real Tavily/Serper/LLM quota: 5 segments surfaced (shipbuilding, oil and
  gas, infrastructure, power, railways), all `high` confidence,
  `icp_sufficiency: sufficient`. Found and fixed one real bug in the same
  session: `splitSegmentList()` split on every `\band\b`, breaking idiomatic
  two-word terms like "oil and gas" into two segments — fixed via a
  `COMPOUND_SEGMENT_IDIOMS` swap-before-split/restore-after approach (a
  placeholder-character approach didn't work, since `\band\b`'s `\b` is a
  `\w`/`\W` transition and still matched around a non-word placeholder).
- Non-goals: no company-matching (that's Company Discovery Engine, Roadmap
  item 3, a separate later milestone that will consume these segments as
  input); no scoring/ranking of segments beyond confidence tier; not
  recursive.

## Company Discovery Engine (Phase 2, item 3)

- Answers the reverse question from Competitor Discovery Engine / ICP
  Generator: those two enrich a report for a company ALREADY being
  researched; this one finds NEW companies to research, given an ICP
  segment (free text — typed by a user, or copied from a prior run's
  `icp_segments`). No LLM narration step at all — a discovered company
  doesn't get "narrated," it either gets sent into the existing 4-step
  pipeline or it doesn't. Every candidate name still comes only from
  search-result regex extraction, same anti-hallucination discipline as
  every other discovery module.
- File: `lib/enrichment/company-discovery.ts`. Pipeline: query construction
  (`top companies in X` / `leading X companies` / `list of X companies`
  framing) → candidate extraction (trigger-phrase list via
  `extractCompaniesAfterTrigger`, PLUS a second numbered-list extractor
  `extractNumberedListCompanies` — "Top 10 X Companies" search snippets
  frequently flatten to "1. Zoho 2. Freshworks…" with no single trigger
  sentence to anchor on, a shape the sibling modules didn't need) →
  filtering (`classifyCompanyRejection`, reuses `isSelfName()` from
  `competitor-discovery.ts` directly plus a local directory/aggregator
  list) → confidence tiering (`high`/`medium`/`low` by mention count only —
  no "vs"/"serve"-framing signal exists for a company-list result, so
  tiering is simpler than the sibling modules') → cap at 6.
- Domain resolution is the one genuinely new, expensive step: reuses
  `discoverCompanyWebsite()` from `website-discovery.ts` directly (Item 1's
  content-based, word-boundary-verified resolver — not reinvented), run
  sequentially and only against the capped survivor set (2 search queries +
  up to 4 homepage fetches per candidate). `domain`/`domain_confidence` are
  only set on a `'confirmed'` result; an unconfirmed candidate still
  surfaces with just name+reason and gets researched by name instead of URL
  downstream.
- New route `POST /api/admin/company-discovery`
  (`{ icpSegment, excludeCompanyName? }`), thin wrapper matching
  `batch-parse/route.ts`'s shape.
- New standalone page `/admin/company-discovery` (added to `nav-config.ts`)
  rather than embedding into `ResearchCard` — deliberate: the ICP
  Generator session already flagged company-matching as a separate later
  milestone, not something to fold into "research this company." The
  page's "Research Selected" loop is copied verbatim in shape from
  `batch-upload/page.tsx` (`DedupedCompany` handoff type, `quota-pause.ts`
  detection, as-you-go `persistResult` to run-history) — same reasoning as
  `ResearchCard` being extracted into its own file for exactly this kind of
  reuse (CLAUDE.md Item 7).
- `tests/company-discovery.test.ts` (20 assertions) covers both extraction
  strategies, filtering, and tiering. Full suite: 120/120 pass, `tsc
  --noEmit` clean.
- **Live end-to-end run — done (2026-07-15).** Ran against segment "oil and
  gas" (excluding Ador Welding) with real Tavily/Serper quota: 2 of 2 raw
  candidates survived filtering (Anadarko Petroleum, Hess Corp, both `high`
  confidence), `sufficiency: sufficient`. One real, non-blocking false
  positive found: `discoverCompanyWebsite()` (reused from
  `website-discovery.ts`) resolved Anadarko Petroleum to `petroleum.gov.gy`
  (a Guyana government site) at `medium` confidence — the same loose
  body-text-match limitation already documented for that function elsewhere
  (e.g. the AITG/miraheze false positive), now confirmed manifesting via
  this module's reuse of it too. Hess Corp correctly returned with no domain
  rather than guessing. Not fixed this session — logged as a precision gap
  in the shared resolver, not new code.
- Non-goals: no scoring/ranking beyond confidence tier + domain-resolution
  status; not recursive (does not chain into discovering ICP segments FOR
  the discovered companies); no LLM involvement anywhere in this module.

## Research Evaluation Framework (Phase 2, item 5) — 2026-07-15

- **Boundary vs item 4** (already recorded above, restated here for
  locality): item 4 (`lib/pipeline/research-quality.ts`) runs LIVE inside
  every real pipeline call, per-run, for a human reviewer. Item 5 is a
  separate, OFFLINE, `benchmarks/`-only aggregator that produces one 0-100
  score per company run (plus a mean across a whole benchmark run) for
  comparing pipeline versions over time. It consumes item 4's
  `items_flagged/items_audited` ratio as one of seven input signals — it
  does not recompute anything item 4 already computes, and it does not gate,
  suppress, or downgrade any pipeline output. No new LLM calls, no new
  vendor calls, no live-pipeline wiring at all.
- New `benchmarks/research-evaluation.ts`: pure, sync `evaluateResearch(input:
  EvaluationInput): ResearchEvaluationScore` plus `aggregateEvaluations()`.
  Zero I/O — reads only fields already present in a benchmark run's API
  response (`analysisResult`, which IS the full `NormalizedAnalysis`) plus
  the `CheckResult[]` `benchmark-runner.ts` already computes via its
  existing `runChecks()`.
- **Rubric — 7 dimensions summing to 100**, each operationalizing a
  documented quality goal from `CLAUDE.md` rather than an arbitrary metric:
  1. Pipeline reliability (20) — success required or the whole score is 0
     (not just this dimension — a failed run has no trustworthy
     `analysisResult`, so letting other dimensions read "empty" as "honest
     nothing" would hand out undeserved credit); otherwise scored by the
     validation gate tier (PASS 20 / WARN 14 / PARTIAL 8 / FAIL 0).
  2. Evidence-backed opportunities (20) — ratio of opportunities carrying a
     real `evidence_id`, operationalizing the "evidence → problem →
     capability, not invented titles" target pattern. Zero opportunities
     scores full credit when `evidence_sufficiency: 'insufficient'` (the
     documented "9th outcome," CLAUDE.md rule 2) — an honest "nothing found"
     is not a defect — but only half credit when evidence was `'sufficient'`
     and still produced nothing.
  3. Evidence sufficiency & signal depth (15) — half for
     `evidence_sufficiency === 'sufficient'`, half scaled by
     `min(1, signals/minSignals)` against the benchmark spec's own threshold.
  4. Pain-point quality (10) — same evidence-backed-ratio logic as dimension
     2, applied to `pain_points_structured`, additionally excluding
     `confidence: 'low'` entries from the "backed" count.
  5. Competitor / ICP discovery yield (10) — 5 pts each for
     `competitor_sufficiency`/`icp_sufficiency` === `'sufficient'`, rewarding
     Phase 2 items 1-2 actually surfacing something on a real run, not just
     being wired with safe empty defaults.
  6. Research quality flag ratio (15) — `(1 - items_flagged/items_audited) *
     15`, full credit when nothing was auditable. This is the dimension that
     consumes item 4's output, per the boundary above.
  7. Narrative safety (10) — binary, reuses `benchmark-runner.ts`'s existing
     `no_forbidden:"..."` checks rather than re-scanning narrative text; a
     single cross-industry contamination is a real defect, not partial
     credit.
- **Wired into `benchmarks/benchmark-runner.ts`**, not a separate script:
  `buildEvaluationInput()` assembles the narrow `EvaluationInput` from the
  same `spec`/`apiResponse`/`checks` the existing per-company loop already
  has; `evaluateResearch()` runs after `runChecks()`; the score is attached
  to `BenchmarkResult.evaluation` and printed under each company's existing
  check output. After the loop: `aggregateEvaluations()` computes the
  mean/min/max across companies, printed in a new "RESEARCH EVALUATION
  FRAMEWORK" summary block, then written to
  `benchmarks/evaluation-history/eval-<timestamp>.json` (a new directory,
  separate from `benchmarks/debug/`'s per-run raw dumps, since this is
  specifically the "scores over time" record item 5 exists for).
  `readPreviousEvaluation()` loads the most recent prior history file
  (sorted by filename timestamp) BEFORE the new one is written, and prints a
  delta against it — flags a `⚠ Regression` when the mean drops by more than
  5 points, informational only, does not fail the run or change its exit
  code (`npm run benchmark`'s exit code stays governed solely by
  `checks`-derived FAILs, unchanged).
- `ApiResponse.analysisResult`'s type in `benchmark-runner.ts` was widened
  (not the API itself — it already returns the full `NormalizedAnalysis`
  under this field) to include the fields dimensions 2-6 read:
  `pain_points_structured`, `evidence_id`/`confidence`/
  `opportunity_confidence`/`relevance` on `opportunities`,
  `evidence_sufficiency`, `competitor_sufficiency`, `icp_sufficiency`,
  `research_quality`.
- New `tests/research-evaluation.test.ts` (18 assertions) covers all 7
  dimensions plus `aggregateEvaluations()`, including the "failed pipeline
  zeros the whole score" case (caught by a first draft of the aggregate test
  that assumed only the reliability dimension would be zero — the fix
  short-circuits `evaluateResearch()` to an all-zero result when
  `!input.success`, before dimensions 2-7 ever run).
- **Verified**: `tsc --noEmit` clean, full suite 180/180 pass (162
  pre-existing + 18 new). Dry-run of `benchmarks/benchmark-runner.ts`
  against an unreachable host (`BASE_URL=http://127.0.0.1:9`, zero real API
  quota spent) confirmed the full wiring executes end-to-end with no
  crash — all 6 companies correctly scored 0/100 via the
  `pipeline_success: false` path, the evaluation summary printed, and
  `benchmarks/evaluation-history/eval-<ts>.json` was written successfully.
  Dry-run artifacts deleted afterward (both the debug dump and the
  evaluation-history file/directory) rather than left as noise. A live
  benchmark run against a real dev server (real Tavily/Serper/LLM quota)
  was deliberately NOT done in this session — same "verify offline harness
  wiring via a dry run, defer live-quota runs" judgment call as this
  module's own zero-network design intends; nothing about this feature
  needs live pipeline output to prove correct, since it's a pure function
  over the same API response shape the pre-existing benchmark checks
  already consume.
- Non-goals: no gating of any pipeline run, no new pipeline stage, no
  per-item scoring UI (this is a `benchmarks/`-only CLI tool, not rendered
  in `ResearchCard.tsx`), no regression-blocking (the `⚠ Regression` line is
  informational, doesn't change the process exit code).

## Research Quality Framework (Phase 2, item 4) — architecture only, 2026-07-15

- **Problem**: every item type already computes its own confidence
  independently — signals via `evidence_strength`/`SignalStrength`
  (`evidence-extractor.ts`), opportunities via `ServiceThreshold`
  (`service-evidence.ts`), competitors/ICP segments via `tierConfidence()`
  (`competitor-discovery.ts`/`icp-generator.ts`), pain points via an
  LLM-assigned `confidence` field. Nothing cross-checks whether an item's
  stated confidence is actually justified by its evidence, and nothing rolls
  these up into one reviewable audit trail.
- **Scope decision**: a per-item confidence AUDIT, not a new scoring engine
  and not a replacement for any existing confidence field. Purely
  informational — never gates, suppresses, or downgrades an item, same
  discipline as `evidence_sufficiency`.
- **Design**: a pure, sync, rule-based function,
  `auditResearchQuality(normalized: NormalizedAnalysis)`, run at the end of
  `normalize.ts` after everything else is assembled. No new LLM calls, no
  new vendor calls, no new pipeline stage/timing concerns (unlike
  Competitor/ICP discovery, needs zero network I/O). Checks reuse signals
  that already exist rather than recomputing confidence — e.g. flag an item
  whose confidence is "high" but whose evidence is tagged
  `product_capability` (the documented customer-facing-evidence-misread-as-
  internal-pain false positive from `classifySubject()`); flag single-mention
  items marked "high" where that type's own tiering logic normally requires
  2+ mentions; flag cross-item name collisions that slipped past a module's
  own self-name filter.
- **Output shape**: additive-only `research_quality: { flags: QualityFlag[],
  items_audited, items_flagged }` on `NormalizedAnalysis`. `QualityFlag` =
  `{ item_type, item_ref, flag, reason, severity: 'info'|'warn' }` — no
  `'error'` severity, since this never gates.
- **Item 4 vs item 5 boundary (resolved this session)**: item 4 runs LIVE
  inside every real pipeline call, for a human reviewer (rendered in the
  admin UI next to Signals/Opportunities/Competitors). Item 5 (Research
  Evaluation Framework) stays a separate, OFFLINE, benchmark-harness-only
  aggregator producing one 0-100 score across many reports for comparing
  pipeline versions over time — it may consume item 4's
  `items_flagged/items_audited` ratio as one input signal, but lives in
  `benchmark/`, not in the live pipeline. Do not conflate the two.
- **Non-goals**: no new confidence computation, no gating, no new vendor/API
  calls, no LLM narration.

## Research Quality Framework (Phase 2, item 4) — implementation done, 2026-07-15

- New `lib/pipeline/research-quality.ts`: `QualityFlag`/`QualityFlagType`
  (`evidence_subject_mismatch` | `single_mention_high_confidence` |
  `self_name_collision`) / `ResearchQualityAudit` types, plus
  `auditResearchQuality(normalized: NormalizedAnalysis)`. Pure/sync, zero
  network I/O, per the architecture session's design.
- Three checks implemented, all reusing existing signals rather than
  recomputing confidence: (1) evidence-subject mismatch — a high-confidence
  opportunity (`opportunity_confidence`/`confidence` = 'high' or
  `relevance` = 'High') or structured pain point whose `evidence_id`
  resolves to an evidence item tagged `subject: 'product_capability'`; (2)
  single-mention high confidence — a competitor/ICP segment with
  `confidence: 'high'` but fewer than 2 `source_urls` (a close proxy for
  `mention_count`, since the final merged shape on `NormalizedAnalysis`
  doesn't carry `mention_count` directly — only the pre-merge `candidates`
  array in `CompetitorDiscoveryResult`/`ICPDiscoveryResult` does, and that
  isn't threaded through to `NormalizedAnalysis`); (3) self-name collision —
  re-runs `isSelfName()` (imported from `competitor-discovery.ts`, not
  duplicated) against `company_name` for every competitor/ICP segment name,
  as a safety net over the final merged output in case one slipped past a
  module's own discovery-time self-name filter.
- Wired into `normalize.ts`: the fully-assembled object (minus
  `research_quality`) is built first as `withoutQuality`, then
  `auditResearchQuality(withoutQuality as NormalizedAnalysis)` runs against
  it, then the final return spreads `withoutQuality` plus the computed
  `research_quality` field — necessary because the audit cross-checks
  fields (evidence vs. opportunity confidence, competitor/ICP confidence vs.
  source count) that only exist once everything else is assembled.
- `items_flagged` counts distinct flagged items, not flag count — an item
  can receive multiple flags (e.g. a competitor that's both a single-mention
  high-confidence match AND a self-name collision) and is still one flagged
  item, tracked via a `Set<"item_type:item_ref">` key.
- **Not done this session, deliberately deferred**: no UI rendering yet
  (`ResearchCard.tsx` doesn't have a "Research Quality" section) — same
  "schema/logic session, UI session separately" split Competitor Discovery
  Engine and ICP Generator each used before their own UI passes. No
  `getResearchQuality()` getter added to `analysis-sections.ts` yet either,
  for the same reason — add both together when the UI section is built, not
  before.
- **Verified**: `tsc --noEmit` clean. New `tests/research-quality.test.ts`,
  15 assertions covering all three check types plus
  `items_audited`/`items_flagged` accounting (including the
  one-item-two-flags case). Full suite 135/135 pass (120 pre-existing + 15
  new). No live dev-server pass — this session added no new UI-observable
  surface (see "not done" above), consistent with this repo's own
  `<when_to_verify>` guidance to skip browser verification when a change
  isn't observable in the preview.

## Research Quality Framework (Phase 2, item 4) — UI pass, 2026-07-15

- Closes the "deferred to a future session" note above. Added
  `getResearchQuality(data): ResearchQualityAudit | undefined` to
  `lib/pipeline/analysis-sections.ts` — same loosened-optional-field
  convention as `getCompetitors()`/`getICPSegments()` (a local
  `QualityFlag`/`ResearchQualityAudit` pair, not imported directly from
  `research-quality.ts`, since this file reads off raw
  `Record<string, unknown>` data, not the strict `NormalizedAnalysis`
  type).
- Added a "Research Quality" section to `ResearchCard.tsx`, placed after
  Target Customer Segments and before Personalization Summary — matches
  DECISIONS.md's original architecture note ("rendered in the admin UI next
  to Signals/Opportunities/Competitors"). Same "only render when there's
  something real" discipline as Competitors/ICP segments: gated on
  `items_flagged > 0`, so a clean audit (the common case) shows no section
  at all rather than a "0 flags" empty state. Each flag renders item name,
  reason text, item type, and a severity badge (only `warn` exists today,
  styled with the same signal-medium tokens Competitors/ICP segments use
  for their own medium-confidence badge — no new color introduced).
- **No new test file** — this is presentation-only over an already-tested
  pure function (`auditResearchQuality()`'s own 15 assertions in
  `tests/research-quality.test.ts` already cover the logic this section
  renders).
- **Verified**: `tsc --noEmit` clean, full suite still 135/135 (unchanged —
  no new logic to test). Live dev-server pass over `/admin/intelligence-lab`
  and `/admin/run-history` — both compile and render with zero console/
  server errors.
- **Live end-to-end run — done (2026-07-15), same session.** Real Full-mode
  analysis via `/admin/intelligence-lab` with real Tavily/Serper/LLM quota
  (explicit user confirmation given first). The section rendered 4 real
  flags exactly as designed: 2 `self_name_collision` competitors ("Bharat
  Forge", "Compare Bharat Forge Quotes" — both slipped past
  `competitor-discovery.ts`'s own discovery-time self-name filter) and 2
  `single_mention_high_confidence` ICP segments ("power", "oil and gas" —
  both marked `confidence: high` with only 1 source URL, violating
  `icp-generator.ts`'s own 2+-mention rule for high confidence). Each flag
  rendered the correct item name, reason text, item-type badge
  (`COMPETITOR`/`ICP_SEGMENT`), and `Warn` severity badge; the summary line
  correctly read "4 of 10 audited items flagged for review". This is exactly
  the failure mode item 4 was built to catch — real safety-net value, not
  just a UI smoke test, and closes the "not verified against a real flagged
  item" gap this entry originally left open.
  - **Incidental input note, not part of this change**: the run that
    produced this data was against a URL field that hadn't been cleared
    before typing, so the request actually went out as domain
    `bharatforge.comhttps` (a `bharatforge.com` value with `https://
    adorwelding.com` appended rather than replacing it) — a pre-existing
    text-input behavior in `intelligence-lab/page.tsx`, unrelated to
    Research Quality, not something this session's diff touches. The scrape
    itself failed (DNS resolution failure on the malformed hostname), which
    is exactly the scenario this repo's stub-injection/enrichment-primary
    path is built for — enrichment, competitor discovery, and ICP discovery
    all still ran successfully off the LLM's own name guess ("Bharat Forge
    Limited"), and produced a real, useful report despite the malformed
    input. Flagged separately via `spawn_task` rather than fixed here, since
    it's out of scope for this UI pass.

## Market Intelligence Layer (Phase 2, item 6) — 2026-07-15

- **Deliberate divergence from the Competitor Discovery / ICP Generator
  pattern, confirmed with the user before implementation.** Both of those
  are "code extracts a NAME → LLM narrates an explanation, merged back by
  identity match." A trend/growth-indicator/challenge/shift item is already
  a full statement pulled verbatim from a real search snippet — there is no
  name to explain and no LLM narration layer would add. So
  `lib/enrichment/market-intelligence.ts` is pure deterministic: search →
  classify each candidate sentence into one of 4 categories via keyword
  regex → dedupe → confidence-tier → cap. No new `analyze-v2.ts` prompt
  block, no `normalize.ts` merge-by-name step — `normalize.ts` passes
  `items` straight through from `_market_intelligence`.
- **Timing differs from Competitor/ICP for a real reason, not an
  oversight**: unlike those two, this module was considered for a
  post-classification timing slot (since "industry" could have been sourced
  from `primary_type`), but `primary_type`'s buckets (`manufacturer`,
  `industrial_vendor`, etc.) are too generic to search well on their own
  ("manufacturer industry trends" is too vague). Queries are anchored on
  the company name instead (`"<name>" industry trends`, etc.) — same
  anchor Competitor/ICP already use — so this module has no
  `primary_type`/classification dependency and is kicked off at the exact
  same pre-scrape point as `competitorDiscoveryPromise`/`icpDiscoveryPromise`
  in `route.ts`, with the same bounded (12s) await pattern and a new
  non-critical `MARKET_INTEL` gate (WARN-only, same tier as
  `COMPETITOR`/`ICP`/`ENRICHMENT`).
- **Category classification, most-specific-first**: `growth_indicator`
  (CAGR/market-size/numeric growth claims) → `challenge` (shortage/
  pressure/disruption language) → `shift` ("shifting toward"/"transitioning
  to" language) → `trend` (generic explicit "trend"/"emerging" language, the
  catch-all). A sentence containing both a numeric growth claim and the
  word "trend" classifies as `growth_indicator` — the more specific, more
  useful signal wins. Confidence tiering reuses the same
  `mention_count` + "strong indicator" (a concrete %/$/CAGR figure) formula
  Competitor/ICP already use for their `explicit_vs_framing`/
  `explicit_serve_framing` signals.
- **Sanity filter, not a second classification pass**: `classifyStatementRejection()`
  only runs on sentences that already matched a category pattern — it
  rejects fragments (too short/long, too few words, ALL-CAPS
  navigation-style headings), it does not decide topical relevance a second
  time.
- New "Market Intelligence" section in `ResearchCard.tsx`, same "only
  render when there's something real" discipline as Competitors/Target
  Customer Segments — statements render as-extracted, grouped by category
  label, with the code-derived confidence badge.
- New `tests/market-intelligence.test.ts` (18 assertions): category
  classification incl. the most-specific-first priority, the strong-
  indicator check, confidence tiering, and the statement sanity filter.
- **Verified**: `tsc --noEmit` clean, full suite 198/198 (180 pre-existing +
  18 new).
- **Live end-to-end run — done (2026-07-15).** The dev-server lock blocker
  from the implementation session (a second `next dev` instance refusing to
  start while another chat's server held the directory-scoped lock) was
  worked around rather than resolved by killing anything: that other
  server was already running on port 3000 for this same project, so this
  run hit its API directly via `curl` instead of starting a competing
  instance. Ran `discoverMarketIntelligence()` against Ador Welding through
  the real `/api/admin/test-analysis` endpoint with real Tavily/Serper
  quota (explicit user confirmation given first), reusing the existing
  scrape cache. Result: `MARKET_INTEL:PASS`, 4 items found, all 4 of 4 raw
  candidates survived filtering, `market_intelligence_sufficiency:
  "sufficient"`. All 4 were real, source-attributed `growth_indicator`
  statements at `medium` confidence (mention_count=1 each — correctly short
  of `high`, which needs 2+ mentions per `tierConfidence`): a welding-
  materials-market CAGR figure sourced to a real Yahoo Finance article, and
  a growth forecast sourced to Ador's own 2021-22 annual-report PDF. No
  `challenge`/`trend`/`shift` items surfaced this run — plausible given the
  real search results, not evidence of a category-detection gap (no
  regression test exercises "must find all 4 categories in one real run,"
  since that was never the module's contract). Competitor Discovery and ICP
  Generator both stayed regression-free on the same run (`COMPETITOR:PASS`
  5 found, `ICP:PASS` 5 found — consistent with their own earlier live runs
  against this company). `ResearchCard.tsx`'s render path (the
  `marketIntel.length > 0` gate, `statement`/`category`/`confidence`
  fields) was confirmed against the actual returned JSON shape by reading
  the component rather than re-spending quota on a second UI-driven run —
  the Competitor Discovery/ICP Generator sessions already did a full
  browser-driven render pass with real data and established that
  `ResearchCard`'s render conventions work correctly for this same
  "list of confidence-badged items" shape.

**Market Intelligence Layer (Phase 2 item 6) is now COMPLETE, including live
verification.**

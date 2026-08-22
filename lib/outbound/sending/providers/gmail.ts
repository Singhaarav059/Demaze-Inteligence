// ============================================================
// Gmail Email Sender Provider
// ============================================================
// Interim real sending provider (2026-07-19) — see lib/outbound/shared/
// gmail-client.ts's header for the OAuth/credential-storage design and why
// Snov.io was ruled out first. Every send: decode the stored credential ->
// refresh a fresh access token (never cached across calls, same per-call-
// fresh discipline as lib/ai/provider-factory.ts) -> build + send one MIME
// message via Gmail's users.messages.send.
//
// Known gaps, deliberate, not oversights:
// - scheduleFollowups: Gmail's API has no "send later" primitive (that's a
//   Gmail *client* UI feature, not exposed via users.messages.send) — this
//   always reports scheduled:false rather than faking success. Real
//   follow-up scheduling (2026-07-29) lives one layer up instead, at the app
//   level, not inside this provider: lib/outbound/sending/followup-schedule.ts
//   computes when a contact's next follow-up is due from
//   outbound_campaign_contacts.status/updated_at, and
//   app/api/admin/outbound/campaigns/[id]/process-followups/route.ts
//   re-invokes sendEmail() (this same function, just called again later,
//   on-demand — see that route's header for why this app has no real
//   background scheduler) with SendEmailRequest.threadId/inReplyTo set so
//   the follow-up lands in the original thread. This method itself stays an
//   honest stub — nothing calls it.
// - pauseCampaign/resumeCampaign: Gmail has no concept of a campaign; these
//   are app-owned state (outbound_campaigns.status, written by the API
//   route, same as the mock provider) — trivially report success here.
// - fromAddress on SendEmailRequest is ignored: Gmail's API sends as the
//   OAuth-authenticated account itself; a different "Send As" alias needs
//   separate verification in Gmail settings, not handled here.
//
// providerMessageId is deliberately the Gmail THREAD id, not the message id
// (2026-07-29, free reply-tracking work) — outbound_campaign_contacts.
// provider_message_id is the one column every provider correlates against
// later (Lemlist stores its lead id there), and reply detection needs the
// thread id specifically (see gmail-client.ts's getGmailThread/
// findReplyInThread and app/api/admin/outbound/campaigns/[id]/check-replies).
// A freshly-sent message's threadId equals its own messageId in Gmail, so
// nothing here loses information — it's just named for what it's used for.
// ============================================================

import {
  getGmailCredential,
  refreshAccessToken,
  sendGmailMessage,
} from '@/lib/outbound/shared/gmail-client'
import { plainTextToHtml } from '@/lib/outbound/shared/email-html'
import type {
  EmailSenderProvider,
  SendEmailRequest,
  SendEmailResult,
  ScheduleFollowupsRequest,
  ScheduleFollowupsResult,
} from '../types'

// Open tracking (2026-08-05) — app-specific policy, deliberately kept here
// rather than in gmail-client.ts (which stays "dumb MIME/API mechanics").
// Only activates when BOTH a campaignContactId is known AND
// OUTBOUND_TRACKING_BASE_URL is configured — no incoming request context
// exists here (this can be called from a background scheduler tick, not
// just a browser-originated route), so the base URL can't be derived from
// request.nextUrl.origin the way this app's other redirect URIs are; it
// must be an explicit env var, set in both .env.local and Railway's
// production config (see .env.example).
function buildTrackingPixelHtml(bodyText: string, campaignContactId?: string): string | undefined {
  const baseUrl = process.env.OUTBOUND_TRACKING_BASE_URL
  if (!campaignContactId || !baseUrl) return undefined
  const pixelUrl = `${baseUrl.replace(/\/+$/, '')}/api/track/open/${campaignContactId}`
  const unsubscribeUrl = buildUnsubscribeUrl(campaignContactId)
  const footer = unsubscribeUrl
    ? `\n<p style="font-size:11px;color:#999;margin-top:24px;"><a href="${unsubscribeUrl}" style="color:#999;">Unsubscribe</a></p>`
    : ''
  return `${plainTextToHtml(bodyText)}${footer}\n<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;border:0;">`
}

// Real unsubscribe mechanism (production-hardening deliverability fix,
// 2026-08-20) — reuses the same OUTBOUND_TRACKING_BASE_URL env var the
// tracking pixel already requires (this app's one configured public origin
// for background-tick-safe absolute URLs, see that var's own doc comment
// in .env.example) rather than adding a second one for the same purpose.
// See app/api/unsubscribe/[campaignContactId]/route.ts for what happens
// when this URL is hit.
function buildUnsubscribeUrl(campaignContactId?: string): string | undefined {
  const baseUrl = process.env.OUTBOUND_TRACKING_BASE_URL
  if (!campaignContactId || !baseUrl) return undefined
  return `${baseUrl.replace(/\/+$/, '')}/api/unsubscribe/${campaignContactId}`
}

// List-Unsubscribe header value — RFC 8058 recommends an https: link (for
// one-click POST support) alongside a mailto: fallback for clients that only
// understand the older mailto-based form. No dedicated unsubscribe mailbox
// exists in this app, so the mailto fallback points at the connected
// sending account itself — a reply-based opt-out still reaches someone,
// same as it would without this header at all.
function buildListUnsubscribeHeader(campaignContactId: string | undefined, fromEmail: string | undefined): string | undefined {
  const httpsUrl = buildUnsubscribeUrl(campaignContactId)
  const parts: string[] = []
  if (fromEmail) parts.push(`<mailto:${fromEmail}?subject=unsubscribe>`)
  if (httpsUrl) parts.push(`<${httpsUrl}>`)
  return parts.length > 0 ? parts.join(', ') : undefined
}

export const GmailSendingProvider: EmailSenderProvider = {
  name: 'gmail',
  displayName: 'Gmail',

  async sendEmail(request: SendEmailRequest): Promise<SendEmailResult> {
    const cred = await getGmailCredential()
    if (!cred) {
      return {
        status: 'failed',
        providerUsed: 'gmail',
        error: 'No Gmail account connected. Connect one in Outbound Integrations first.',
      }
    }

    const refreshed = await refreshAccessToken({
      clientId: cred.clientId,
      clientSecret: cred.clientSecret,
      refreshToken: cred.refreshToken,
    })
    if (!refreshed.ok) {
      return { status: 'failed', providerUsed: 'gmail', error: refreshed.error }
    }

    const sent = await sendGmailMessage({
      accessToken: refreshed.accessToken,
      to: request.contactEmail,
      subject: request.subject,
      bodyText: request.body,
      bodyHtml: buildTrackingPixelHtml(request.body, request.campaignContactId),
      threadId: request.threadId,
      inReplyTo: request.inReplyTo,
      references: request.inReplyTo,
      // Reply-To the connected account itself — without this, nothing sets
      // Reply-To at all (found in the deliverability audit); replies still
      // worked before via Gmail's own default-to-From behavior, this just
      // makes it explicit rather than implicit.
      replyTo: cred.email,
      listUnsubscribe: buildListUnsubscribeHeader(request.campaignContactId, cred.email),
    })

    if (!sent.ok) {
      return { status: 'failed', providerUsed: 'gmail', error: sent.error, ambiguous: sent.ambiguous }
    }

    return { status: 'sent', providerMessageId: sent.threadId, providerUsed: 'gmail' }
  },

  // See header comment — Gmail's API has no scheduled-send primitive.
  async scheduleFollowups(_request: ScheduleFollowupsRequest): Promise<ScheduleFollowupsResult> {
    return { scheduled: false, providerUsed: 'gmail' }
  },

  async pauseCampaign(_campaignId: string): Promise<{ paused: boolean }> {
    return { paused: true }
  },

  async resumeCampaign(_campaignId: string): Promise<{ resumed: boolean }> {
    return { resumed: true }
  },

  async isAvailable(): Promise<boolean> {
    return (await getGmailCredential()) !== null
  },
}

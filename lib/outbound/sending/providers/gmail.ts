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
//   follow-up scheduling needs a background job/queue that re-invokes
//   sendEmail() at the right time, which doesn't exist yet — out of scope
//   for "wire up Gmail for now."
// - pauseCampaign/resumeCampaign: Gmail has no concept of a campaign; these
//   are app-owned state (outbound_campaigns.status, written by the API
//   route, same as the mock provider) — trivially report success here.
// - fromAddress on SendEmailRequest is ignored: Gmail's API sends as the
//   OAuth-authenticated account itself; a different "Send As" alias needs
//   separate verification in Gmail settings, not handled here.
// ============================================================

import {
  getGmailCredential,
  refreshAccessToken,
  sendGmailMessage,
} from '@/lib/outbound/shared/gmail-client'
import type {
  EmailSenderProvider,
  SendEmailRequest,
  SendEmailResult,
  ScheduleFollowupsRequest,
  ScheduleFollowupsResult,
} from '../types'

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
    })

    if (!sent.ok) {
      return { status: 'failed', providerUsed: 'gmail', error: sent.error }
    }

    return { status: 'sent', providerMessageId: sent.messageId, providerUsed: 'gmail' }
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

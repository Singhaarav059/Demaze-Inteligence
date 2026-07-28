// ============================================================
// Lemlist Email Sender Provider
// ============================================================
// See lib/outbound/shared/lemlist-client.ts's header for the full
// architecture note. Short version: Lemlist has no "send this literal
// subject/body now" primitive, so sendEmail() here does NOT send — it
// creates/updates a lead in one pre-configured Lemlist campaign (config.
// campaignId, set in /admin/outbound/integrations), passing this pipeline's
// already-generated subject/body as custom variables (subjectLine,
// icebreaker) for that campaign's own sequence template to merge-tag in.
// Lemlist sends on its own schedule afterward — this is an enqueue, so the
// honest SendEmailStatus is 'queued', not 'sent'. Requires a one-time
// manual setup in the user's real Lemlist account: a campaign with one
// sequence step whose subject/body are just {{subjectLine}} / {{icebreaker}}
// placeholders — this provider cannot create that template itself (no
// documented API for writing sequence-step content).
//
// pauseCampaign/resumeCampaign are app-owned state, not forwarded to
// Lemlist — same reasoning as gmail.ts: our app's campaignId is NOT
// Lemlist's campaign id (many app campaigns can share one Lemlist
// campaign), so pausing "the campaign" here would incorrectly pause every
// app campaign funneling through it.
//
// scheduleFollowups always reports scheduled:false, same honest-limitation
// pattern as gmail.ts: injecting different content into a later sequence
// step per-lead, per-contact, over time isn't a primitive this API exposes
// without fragile timed Update Lead calls — not built.
// ============================================================

import {
  getLemlistCredential,
  createLeadInCampaign,
} from '@/lib/outbound/shared/lemlist-client'
import type {
  EmailSenderProvider,
  SendEmailRequest,
  SendEmailResult,
  ScheduleFollowupsRequest,
  ScheduleFollowupsResult,
} from '../types'

export const LemlistSendingProvider: EmailSenderProvider = {
  name: 'lemlist',
  displayName: 'Lemlist',

  async sendEmail(request: SendEmailRequest): Promise<SendEmailResult> {
    const cred = await getLemlistCredential('sending')
    if (!cred) {
      return {
        status: 'failed',
        providerUsed: 'lemlist',
        error:
          'Lemlist is not configured. Set an API key and target campaign ID in Outbound Integrations first.',
      }
    }

    const result = await createLeadInCampaign(cred.apiKey, cred.campaignId, {
      email: request.contactEmail,
      // Merge-tag variables for the campaign's pre-built sequence template
      // — see header comment. subjectLine/icebreaker are the two names this
      // provider's setup instructions ask the user to place in their
      // Lemlist template; not a Lemlist-defined field name beyond
      // "icebreaker" itself (a purpose-built Lemlist field for exactly this
      // kind of per-lead personalization).
      subjectLine: request.subject,
      icebreaker: request.body,
    })

    if (!result.ok) {
      return {
        status: 'failed',
        providerUsed: 'lemlist',
        error: result.error ?? `Lemlist returned HTTP ${result.status}`,
      }
    }

    return {
      status: 'queued',
      providerMessageId: result.data?._id ?? result.data?.contactId,
      providerUsed: 'lemlist',
    }
  },

  // See header comment — no per-lead follow-up content injection primitive.
  async scheduleFollowups(_request: ScheduleFollowupsRequest): Promise<ScheduleFollowupsResult> {
    return { scheduled: false, providerUsed: 'lemlist' }
  },

  async pauseCampaign(_campaignId: string): Promise<{ paused: boolean }> {
    return { paused: true }
  },

  async resumeCampaign(_campaignId: string): Promise<{ resumed: boolean }> {
    return { resumed: true }
  },

  async isAvailable(): Promise<boolean> {
    return (await getLemlistCredential('sending')) !== null
  },
}

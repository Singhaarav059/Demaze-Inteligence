// ============================================================
// Email Sending — Provider Factory
// ============================================================
// Same selection discipline as the other outbound factories: active
// provider via outbound_integrations -> OUTBOUND_SENDING_PROVIDER -> 'mock'.
// ============================================================

import { getActiveProviderName } from '@/lib/outbound/settings/provider-selection'
import { isSuppressed } from './suppression'
import { MockEmailSenderProvider } from './providers/mock'
import { GmailSendingProvider } from './providers/gmail'
import type {
  EmailSenderProvider,
  SendEmailRequest,
  SendEmailResult,
  ScheduleFollowupsRequest,
  ScheduleFollowupsResult,
} from './types'

const PROVIDERS: Record<string, EmailSenderProvider> = {
  mock: MockEmailSenderProvider,
  gmail: GmailSendingProvider,
}

async function resolveProvider(): Promise<EmailSenderProvider> {
  const providerName = await getActiveProviderName('sending')
  return PROVIDERS[providerName] ?? MockEmailSenderProvider
}

// Used by the Integrations settings page's Test Connection action.
export async function checkAvailability(): Promise<{ available: boolean; providerUsed: string }> {
  const provider = await resolveProvider()
  return { available: await provider.isAvailable(), providerUsed: provider.name }
}

// Checked before resolving/calling any provider — every real send path
// (initial "Send Queued", manual "Send Now", scheduled follow-ups) funnels
// through this one function, so this is the single place a suppression
// needs to be enforced. See lib/outbound/sending/suppression.ts's header
// for why this fails open (treats a DB read error as "not suppressed")
// rather than blocking every send in the app on that table being reachable.
export async function sendEmail(request: SendEmailRequest): Promise<SendEmailResult> {
  const suppression = await isSuppressed(request.contactEmail)
  if (suppression.suppressed) {
    return {
      status: 'suppressed',
      providerUsed: 'suppression-list',
      error: `${request.contactEmail} is on the suppression list (${suppression.reason}) — not sent.`,
    }
  }

  const provider = await resolveProvider()
  if (!(await provider.isAvailable())) {
    return { status: 'failed', providerUsed: provider.name, error: `Provider "${provider.name}" is not available.` }
  }
  try {
    return await provider.sendEmail(request)
  } catch (e) {
    return { status: 'failed', providerUsed: provider.name, error: e instanceof Error ? e.message : 'Unknown send error' }
  }
}

export async function scheduleFollowups(request: ScheduleFollowupsRequest): Promise<ScheduleFollowupsResult> {
  const provider = await resolveProvider()
  if (!(await provider.isAvailable())) {
    return { scheduled: false, providerUsed: provider.name }
  }
  try {
    return await provider.scheduleFollowups(request)
  } catch {
    return { scheduled: false, providerUsed: provider.name }
  }
}

export async function pauseCampaign(campaignId: string): Promise<{ paused: boolean; providerUsed: string }> {
  const provider = await resolveProvider()
  try {
    const result = await provider.pauseCampaign(campaignId)
    return { ...result, providerUsed: provider.name }
  } catch {
    return { paused: false, providerUsed: provider.name }
  }
}

export async function resumeCampaign(campaignId: string): Promise<{ resumed: boolean; providerUsed: string }> {
  const provider = await resolveProvider()
  try {
    const result = await provider.resumeCampaign(campaignId)
    return { ...result, providerUsed: provider.name }
  } catch {
    return { resumed: false, providerUsed: provider.name }
  }
}

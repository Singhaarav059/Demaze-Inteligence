// ============================================================
// Mock Email Sender Provider
// ============================================================
// Simulates a sending provider (Smartlead/Instantly later): sendEmail
// always succeeds with a fake providerMessageId, no real network call, no
// real email delivered anywhere. pauseCampaign/resumeCampaign just report
// success — the API route owns the actual outbound_campaigns.status write.
// ============================================================

import { randomUUID } from 'crypto'
import type {
  EmailSenderProvider,
  SendEmailRequest,
  SendEmailResult,
  ScheduleFollowupsRequest,
  ScheduleFollowupsResult,
} from '../types'

export const MockEmailSenderProvider: EmailSenderProvider = {
  name: 'mock',
  displayName: 'Mock Email Sender',

  async sendEmail(_request: SendEmailRequest): Promise<SendEmailResult> {
    return {
      status: 'sent',
      providerMessageId: `mock-${randomUUID()}`,
      providerUsed: 'mock',
    }
  },

  async scheduleFollowups(_request: ScheduleFollowupsRequest): Promise<ScheduleFollowupsResult> {
    return { scheduled: true, providerUsed: 'mock' }
  },

  async pauseCampaign(_campaignId: string): Promise<{ paused: boolean }> {
    return { paused: true }
  },

  async resumeCampaign(_campaignId: string): Promise<{ resumed: boolean }> {
    return { resumed: true }
  },

  async isAvailable(): Promise<boolean> {
    return true
  },
}

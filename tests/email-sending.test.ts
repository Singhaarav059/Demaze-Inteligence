// ============================================================
// Email Sending — mock provider tests
// ============================================================

import { describe, it, expect } from 'vitest'
import { MockEmailSenderProvider } from '../lib/outbound/sending/providers/mock'

describe('MockEmailSenderProvider', () => {
  it('sendEmail always succeeds with a unique providerMessageId, no real network call', async () => {
    const a = await MockEmailSenderProvider.sendEmail({
      campaignId: 'c1',
      contactEmail: 'jane@acme.com',
      subject: 'Hi',
      body: 'Hello',
    })
    const b = await MockEmailSenderProvider.sendEmail({
      campaignId: 'c1',
      contactEmail: 'jane@acme.com',
      subject: 'Hi',
      body: 'Hello',
    })
    expect(a.status).toBe('sent')
    expect(a.providerMessageId).toBeDefined()
    expect(a.providerMessageId).not.toBe(b.providerMessageId) // each send gets a fresh id, unlike the deterministic-mock modules
  })

  it('scheduleFollowups reports scheduled: true', async () => {
    const result = await MockEmailSenderProvider.scheduleFollowups({
      campaignId: 'c1',
      contactEmail: 'jane@acme.com',
      followups: [{ subject: 'Following up', body: 'Body', sendAfterHours: 48 }],
    })
    expect(result.scheduled).toBe(true)
  })

  it('pauseCampaign / resumeCampaign report success', async () => {
    expect(await MockEmailSenderProvider.pauseCampaign('c1')).toEqual({ paused: true })
    expect(await MockEmailSenderProvider.resumeCampaign('c1')).toEqual({ resumed: true })
  })

  it('isAvailable always resolves true', async () => {
    expect(await MockEmailSenderProvider.isAvailable()).toBe(true)
  })
})

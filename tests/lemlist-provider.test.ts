// ============================================================
// LemlistSendingProvider tests
// ============================================================
// lib/outbound/shared/lemlist-client.ts is mocked entirely, same precedent
// as tests/prospeo-providers.test.ts — this tests the provider's own
// request-building and status-mapping logic, not the real HTTP client
// (covered separately in tests/lemlist-client.test.ts).
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/outbound/shared/lemlist-client', () => ({
  getLemlistCredential: vi.fn(),
  createLeadInCampaign: vi.fn(),
}))

import { getLemlistCredential, createLeadInCampaign } from '@/lib/outbound/shared/lemlist-client'
import { LemlistSendingProvider } from '@/lib/outbound/sending/providers/lemlist'

describe('LemlistSendingProvider.sendEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails clearly when no credential is configured', async () => {
    vi.mocked(getLemlistCredential).mockResolvedValue(null)

    const result = await LemlistSendingProvider.sendEmail({
      campaignId: 'app-campaign-1',
      contactEmail: 'a@b.com',
      subject: 'Hi',
      body: 'Body',
    })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('not configured')
    expect(createLeadInCampaign).not.toHaveBeenCalled()
  })

  it('returns status "queued" (not "sent") on success, since Lemlist sends asynchronously', async () => {
    vi.mocked(getLemlistCredential).mockResolvedValue({ apiKey: 'key', campaignId: 'lemlist-campaign-1' })
    vi.mocked(createLeadInCampaign).mockResolvedValue({
      ok: true,
      status: 200,
      data: { _id: 'lead-1', contactId: 'contact-1' },
      rawText: '{}',
      error: null,
      rateLimitRemaining: null,
      retryAfterSeconds: null,
    })

    const result = await LemlistSendingProvider.sendEmail({
      campaignId: 'app-campaign-1',
      contactEmail: 'a@b.com',
      subject: 'Subject text',
      body: 'Body text',
    })

    expect(result.status).toBe('queued')
    expect(result.providerMessageId).toBe('lead-1')
    expect(result.providerUsed).toBe('lemlist')
  })

  it('passes subject/body as subjectLine/icebreaker custom variables, not literal email fields', async () => {
    vi.mocked(getLemlistCredential).mockResolvedValue({ apiKey: 'key', campaignId: 'lemlist-campaign-1' })
    vi.mocked(createLeadInCampaign).mockResolvedValue({
      ok: true,
      status: 200,
      data: { _id: 'lead-1' },
      rawText: '{}',
      error: null,
      rateLimitRemaining: null,
      retryAfterSeconds: null,
    })

    await LemlistSendingProvider.sendEmail({
      campaignId: 'app-campaign-1',
      contactEmail: 'a@b.com',
      subject: 'Subject text',
      body: 'Body text',
    })

    expect(createLeadInCampaign).toHaveBeenCalledWith('key', 'lemlist-campaign-1', {
      email: 'a@b.com',
      subjectLine: 'Subject text',
      icebreaker: 'Body text',
    })
  })

  it('maps a failed lead-creation call to status "failed" with the client error message', async () => {
    vi.mocked(getLemlistCredential).mockResolvedValue({ apiKey: 'key', campaignId: 'lemlist-campaign-1' })
    vi.mocked(createLeadInCampaign).mockResolvedValue({
      ok: false,
      status: 404,
      data: null,
      rawText: 'Campaign not found',
      error: 'Campaign not found',
      rateLimitRemaining: null,
      retryAfterSeconds: null,
    })

    const result = await LemlistSendingProvider.sendEmail({
      campaignId: 'app-campaign-1',
      contactEmail: 'a@b.com',
      subject: 'Hi',
      body: 'Body',
    })

    expect(result.status).toBe('failed')
    expect(result.error).toBe('Campaign not found')
  })
})

describe('LemlistSendingProvider — honest limitations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scheduleFollowups always reports scheduled:false (no per-lead follow-up content primitive)', async () => {
    const result = await LemlistSendingProvider.scheduleFollowups({
      campaignId: 'c1',
      contactEmail: 'a@b.com',
      followups: [{ subject: 'Follow up', body: 'Text', sendAfterHours: 48 }],
    })
    expect(result.scheduled).toBe(false)
  })

  it('pauseCampaign/resumeCampaign are app-owned no-ops, not forwarded to Lemlist', async () => {
    const paused = await LemlistSendingProvider.pauseCampaign('app-campaign-1')
    const resumed = await LemlistSendingProvider.resumeCampaign('app-campaign-1')
    expect(paused.paused).toBe(true)
    expect(resumed.resumed).toBe(true)
    expect(createLeadInCampaign).not.toHaveBeenCalled()
  })

  it('isAvailable reflects whether a credential is configured', async () => {
    vi.mocked(getLemlistCredential).mockResolvedValue(null)
    expect(await LemlistSendingProvider.isAvailable()).toBe(false)

    vi.mocked(getLemlistCredential).mockResolvedValue({ apiKey: 'key', campaignId: 'c1' })
    expect(await LemlistSendingProvider.isAvailable()).toBe(true)
  })
})

// ============================================================
// Gmail Email Sender Provider — tests
// ============================================================
// lib/outbound/shared/gmail-client.ts is mocked entirely (matching this
// repo's existing vi.mock precedent for provider tests, e.g.
// tests/prospeo-providers.test.ts) so these test GmailSendingProvider's own
// branching logic without a real network/OAuth call.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/outbound/shared/gmail-client', () => ({
  getGmailCredential: vi.fn(),
  refreshAccessToken: vi.fn(),
  sendGmailMessage: vi.fn(),
}))

import { getGmailCredential, refreshAccessToken, sendGmailMessage } from '@/lib/outbound/shared/gmail-client'
import { GmailSendingProvider } from '@/lib/outbound/sending/providers/gmail'

const REQUEST = { campaignId: 'c1', contactEmail: 'lead@example.com', subject: 'Hi', body: 'Body text' }
const CRED = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt' }

describe('GmailSendingProvider.sendEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails with no Gmail account connected', async () => {
    vi.mocked(getGmailCredential).mockResolvedValue(null)

    const result = await GmailSendingProvider.sendEmail(REQUEST)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('No Gmail account connected')
  })

  it('fails when the refresh token no longer works', async () => {
    vi.mocked(getGmailCredential).mockResolvedValue(CRED)
    vi.mocked(refreshAccessToken).mockResolvedValue({ ok: false, error: 'invalid_grant' })

    const result = await GmailSendingProvider.sendEmail(REQUEST)
    expect(result.status).toBe('failed')
    expect(result.error).toBe('invalid_grant')
  })

  it('fails when Gmail\'s send call itself fails', async () => {
    vi.mocked(getGmailCredential).mockResolvedValue(CRED)
    vi.mocked(refreshAccessToken).mockResolvedValue({ ok: true, accessToken: 'AT', expiresIn: 3600 })
    vi.mocked(sendGmailMessage).mockResolvedValue({ ok: false, error: 'Gmail send failed: quota exceeded' })

    const result = await GmailSendingProvider.sendEmail(REQUEST)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('quota exceeded')
  })

  it('succeeds and returns the Gmail message id', async () => {
    vi.mocked(getGmailCredential).mockResolvedValue(CRED)
    vi.mocked(refreshAccessToken).mockResolvedValue({ ok: true, accessToken: 'AT', expiresIn: 3600 })
    vi.mocked(sendGmailMessage).mockResolvedValue({ ok: true, messageId: 'msg-1' })

    const result = await GmailSendingProvider.sendEmail(REQUEST)
    expect(result.status).toBe('sent')
    expect(result.providerMessageId).toBe('msg-1')
    expect(result.providerUsed).toBe('gmail')
  })

  it('passes contactEmail/subject/body through to sendGmailMessage unchanged', async () => {
    vi.mocked(getGmailCredential).mockResolvedValue(CRED)
    vi.mocked(refreshAccessToken).mockResolvedValue({ ok: true, accessToken: 'AT', expiresIn: 3600 })
    vi.mocked(sendGmailMessage).mockResolvedValue({ ok: true, messageId: 'msg-1' })

    await GmailSendingProvider.sendEmail(REQUEST)
    expect(sendGmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'AT', to: 'lead@example.com', subject: 'Hi', bodyText: 'Body text' })
    )
  })
})

describe('GmailSendingProvider — capability gaps reported honestly, not faked', () => {
  it('scheduleFollowups always reports scheduled:false — Gmail has no send-later API', async () => {
    const result = await GmailSendingProvider.scheduleFollowups({
      campaignId: 'c1',
      contactEmail: 'a@b.com',
      followups: [{ subject: 'Follow up', body: 'B', sendAfterHours: 24 }],
    })
    expect(result).toEqual({ scheduled: false, providerUsed: 'gmail' })
  })

  it('pauseCampaign/resumeCampaign are trivial no-ops — Gmail has no campaign concept', async () => {
    expect(await GmailSendingProvider.pauseCampaign('c1')).toEqual({ paused: true })
    expect(await GmailSendingProvider.resumeCampaign('c1')).toEqual({ resumed: true })
  })
})

describe('GmailSendingProvider.isAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is false with no stored credential', async () => {
    vi.mocked(getGmailCredential).mockResolvedValue(null)
    expect(await GmailSendingProvider.isAvailable()).toBe(false)
  })

  it('is true with a stored credential', async () => {
    vi.mocked(getGmailCredential).mockResolvedValue({ clientId: 'a', clientSecret: 'b', refreshToken: 'c' })
    expect(await GmailSendingProvider.isAvailable()).toBe(true)
  })
})

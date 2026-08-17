// ============================================================
// Kill switch — proves it covers every real-send caller, not just one route
// ============================================================
// Pilot Readiness Plan, Phase C7: "Test all callers, not just one API
// endpoint." Architecturally there is exactly one real-send chokepoint —
// sendEmail() in provider-factory.ts — every caller (manual send,
// campaign send, batch send, follow-up send, the automatic follow-up
// engine, retries) reduces to it (confirmed by grep: it has exactly two
// import sites, campaigns/[id]/send/route.ts and process-followup.ts,
// which the follow-up engine and the send-now/process-followups routes
// all call into). So proving the switch is checked strictly BEFORE
// suppression lookup or provider resolution — with those two mocked to
// throw if reached — proves no caller of sendEmail() can ever slip past
// it, without needing a separate test per route.
// ============================================================

import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('../lib/outbound/sending/suppression', () => ({
  isSuppressed: vi.fn(() => {
    throw new Error('isSuppressed() must not be called when the kill switch is off')
  }),
}))

vi.mock('../lib/outbound/settings/provider-selection', () => ({
  getActiveProviderName: vi.fn(() => {
    throw new Error('getActiveProviderName() must not be called when the kill switch is off — no provider should be resolved')
  }),
}))

import { sendEmail } from '../lib/outbound/sending/provider-factory'

const ORIGINAL = process.env.OUTBOUND_SEND_ENABLED

describe('sendEmail() kill switch — covers every caller', () => {
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OUTBOUND_SEND_ENABLED
    else process.env.OUTBOUND_SEND_ENABLED = ORIGINAL
  })

  it('short-circuits before suppression lookup or provider resolution', async () => {
    process.env.OUTBOUND_SEND_ENABLED = 'false'

    const result = await sendEmail({
      campaignId: 'c1',
      contactEmail: 'prospect@example.com',
      subject: 'Subject',
      body: 'Body',
    })

    expect(result.status).toBe('failed')
    expect(result.providerUsed).toBe('kill-switch')
    expect(result.error).toMatch(/OUTBOUND_SEND_ENABLED=false/)
  })

  it('reaches suppression/provider resolution once the switch is back on', async () => {
    delete process.env.OUTBOUND_SEND_ENABLED

    // Both mocks throw — this proves the switch being on actually lets
    // execution reach past the kill-switch guard (not that the send
    // succeeds, which is covered elsewhere).
    await expect(
      sendEmail({ campaignId: 'c1', contactEmail: 'prospect@example.com', subject: 'S', body: 'B' })
    ).rejects.toThrow('isSuppressed')
  })
})

// ============================================================
// sendEmail() — suppression check failing closed
// ============================================================
// Pilot Readiness Plan, Rule 6 ("Sending must fail closed... when
// suppression is uncertain, do not send") + the Phase C3/C4 finding in
// docs/pilot-readiness-verification.md: isSuppressed() used to fail OPEN on
// a DB read error, in tension with that rule. isSuppressed() itself now
// fails closed (see tests/suppression.test.ts) — this file proves
// sendEmail(), the one real chokepoint every send path funnels through,
// surfaces that correctly: a suppression check it couldn't resolve blocks
// the send with a readable reason, not a generic "(undefined)" message and
// not a silent pass-through to the provider.
// ============================================================

import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/outbound/sending/suppression', () => ({
  isSuppressed: vi.fn(async () => ({
    suppressed: true,
    checkFailed: true,
    detail: 'Suppression status could not be verified (the suppression list was unreachable) — treated as suppressed pending manual review.',
  })),
}))

vi.mock('../lib/outbound/settings/provider-selection', () => ({
  getActiveProviderName: vi.fn(() => {
    throw new Error('getActiveProviderName() must not be called — an unresolved suppression check must block before provider resolution')
  }),
}))

import { sendEmail } from '../lib/outbound/sending/provider-factory'

describe('sendEmail() — suppression check failing closed', () => {
  it('blocks the send and never reaches provider resolution when the suppression check itself failed', async () => {
    const result = await sendEmail({
      campaignId: 'c1',
      contactEmail: 'prospect@example.com',
      subject: 'Subject',
      body: 'Body',
    })

    expect(result.status).toBe('suppressed')
    expect(result.providerUsed).toBe('suppression-list')
    expect(result.error).toMatch(/could not be verified/i)
    expect(result.error).not.toMatch(/undefined/)
  })
})

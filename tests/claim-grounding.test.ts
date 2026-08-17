// ============================================================
// claim-grounding.ts — Phase B (B5) unsupported-numeric-claim tests
// ============================================================

import { describe, it, expect } from 'vitest'
import { checkUnsupportedClaims } from '../lib/outbound/generation/claim-grounding'
import type { EmailGenerationInput } from '../lib/outbound/generation/types'

function baseInput(overrides: Partial<EmailGenerationInput> = {}): EmailGenerationInput {
  return {
    personName: 'Jane Doe',
    companyName: 'Acme Corp',
    painPoints: [],
    opportunities: [],
    recentActivity: [],
    ...overrides,
  }
}

describe('checkUnsupportedClaims', () => {
  it('flags a number about the company that never appears anywhere in the research input', () => {
    const input = baseInput({ painPoints: ['Manual reporting across plants'] })
    const email = 'Hi Jane, I noticed Acme Corp runs 12 manufacturing plants nationwide.'
    const result = checkUnsupportedClaims(email, input)
    expect(result.hasUnsupportedClaim).toBe(true)
    expect(result.flaggedClaims.some(c => c.includes('12'))).toBe(true)
  })

  it('does not flag a number that DOES appear in the research input', () => {
    const input = baseInput({ painPoints: ['Manual reporting across 6 plants'] })
    const email = 'Hi Jane, coordinating reporting across Acme Corp\'s 6 plants sounds like a real headache.'
    const result = checkUnsupportedClaims(email, input)
    expect(result.hasUnsupportedClaim).toBe(false)
  })

  it('never flags the standard "worth 15 minutes?" CTA time offer', () => {
    const input = baseInput()
    const email = 'Would Acme Corp be worth 15 minutes to chat about this?'
    const result = checkUnsupportedClaims(email, input)
    expect(result.hasUnsupportedClaim).toBe(false)
  })

  it('does not flag a number in a sentence that never names the company', () => {
    const input = baseInput()
    const email = 'We\'ve helped 50+ companies streamline operations. Hi Jane, thought this might resonate.'
    const result = checkUnsupportedClaims(email, input)
    expect(result.hasUnsupportedClaim).toBe(false)
  })

  it('handles a multi-word company name as a phrase, not just its first word', () => {
    const input = baseInput({ companyName: 'Bharat Forge Limited', painPoints: ['Operates 12 forging units'] })
    const emailSupported = 'Bharat Forge Limited runs 12 forging units across the country.'
    expect(checkUnsupportedClaims(emailSupported, input).hasUnsupportedClaim).toBe(false)

    const emailUnsupported = 'Bharat Forge Limited runs 40 forging units across the country.'
    expect(checkUnsupportedClaims(emailUnsupported, input).hasUnsupportedClaim).toBe(true)
  })

  it('is a no-op when the company name is empty', () => {
    const input = baseInput({ companyName: '' })
    const result = checkUnsupportedClaims('Some email with a 99 in it.', input)
    expect(result.hasUnsupportedClaim).toBe(false)
  })

  it('checks percentage claims the same way as plain numbers', () => {
    const input = baseInput()
    const email = 'Acme Corp could cut costs by 40% with this approach.'
    expect(checkUnsupportedClaims(email, input).hasUnsupportedClaim).toBe(true)

    const grounded = baseInput({ opportunities: [{ title: 'Cost reduction', description: 'up to 40% savings potential' }] })
    expect(checkUnsupportedClaims(email, grounded).hasUnsupportedClaim).toBe(false)
  })
})

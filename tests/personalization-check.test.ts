import { describe, it, expect } from 'vitest'
import { checkPersonalization } from '../lib/outbound/generation/personalization-check'
import type { EmailGenerationInput } from '../lib/outbound/generation/types'

function baseInput(overrides: Partial<EmailGenerationInput> = {}): EmailGenerationInput {
  return {
    personName: 'Jane Doe',
    companyName: 'Acme Manufacturing',
    painPoints: [],
    opportunities: [],
    recentActivity: [],
    ...overrides,
  }
}

describe('checkPersonalization', () => {
  it('flags a fully generic email with a blacklisted phrase and no evidence reference', () => {
    const input = baseInput({
      painPoints: ['Cross-location production visibility gaps across 6 manufacturing facilities'],
    })
    const body = "Hi Jane, I was impressed by your commitment to innovation. Given today's competitive environment, I'd love to connect."
    const result = checkPersonalization(body, input)
    expect(result.isGeneric).toBe(true)
    expect(result.genericPhrasesFound.length).toBeGreaterThan(0)
    expect(result.referencesRealEvidence).toBe(false)
  })

  it('passes an email that references real researched evidence with no filler phrases', () => {
    const input = baseInput({
      painPoints: ['Cross-location production visibility gaps across 6 manufacturing facilities'],
    })
    const body = 'Hi Jane, coordinating production visibility across 6 manufacturing facilities usually means someone is stitching spreadsheets together weekly.'
    const result = checkPersonalization(body, input)
    expect(result.isGeneric).toBe(false)
    expect(result.genericPhrasesFound).toHaveLength(0)
    expect(result.referencesRealEvidence).toBe(true)
  })

  it('flags generic even when evidence is referenced, if a blacklisted phrase is also present', () => {
    const input = baseInput({
      painPoints: ['Cross-location production visibility gaps across 6 manufacturing facilities'],
    })
    const body = "I noticed that your company is growing across manufacturing facilities and production visibility efforts."
    const result = checkPersonalization(body, input)
    expect(result.isGeneric).toBe(true)
    expect(result.genericPhrasesFound.length).toBeGreaterThan(0)
    expect(result.referencesRealEvidence).toBe(true)
  })

  it('reports no evidence was available when the input has nothing to check against', () => {
    const input = baseInput()
    const body = 'Hi Jane, would love to connect sometime about your operations.'
    const result = checkPersonalization(body, input)
    expect(result.isGeneric).toBe(true)
    expect(result.referencesRealEvidence).toBe(false)
    expect(result.reason).toMatch(/no research evidence/i)
  })

  it('is case-insensitive when matching both blacklist phrases and evidence words', () => {
    const input = baseInput({ opportunities: [{ title: 'Predictive Maintenance Automation' }] })
    const body = 'YOUR DIGITAL TRANSFORMATION JOURNEY starts with predictive maintenance automation improvements.'
    const result = checkPersonalization(body, input)
    expect(result.genericPhrasesFound.length).toBeGreaterThan(0)
    expect(result.referencesRealEvidence).toBe(true)
  })
})

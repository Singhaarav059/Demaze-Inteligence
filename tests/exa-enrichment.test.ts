// ============================================================
// Exa Contact Enrichment Provider — tests
// ============================================================
// lib/enrichment/sources/exa-client.ts and the credential helper are both
// mocked entirely — no live network call, no dependency on EXA_API_KEY
// being set.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/enrichment/sources/exa-client', () => ({
  exaAnswer: vi.fn(),
}))

vi.mock('@/lib/outbound/shared/exa-outbound-client', () => ({
  getExaCredential: vi.fn(),
}))

import { exaAnswer } from '@/lib/enrichment/sources/exa-client'
import { getExaCredential } from '@/lib/outbound/shared/exa-outbound-client'
import { ExaEnrichmentProvider } from '@/lib/outbound/enrichment/providers/exa'

describe('ExaEnrichmentProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns not_found with no personName or linkedinUrl', async () => {
    const result = await ExaEnrichmentProvider.enrichContact({ personName: '', companyName: 'Acme' })
    expect(result.status).toBe('not_found')
  })

  it('returns not_found with no API key configured (never throws)', async () => {
    vi.mocked(getExaCredential).mockResolvedValue(null)
    const result = await ExaEnrichmentProvider.enrichContact({ personName: 'Jane Doe', companyName: 'Acme' })
    expect(result.status).toBe('not_found')
  })

  it('populates fields present in a structured answer, at medium confidence when citations exist', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaAnswer).mockResolvedValue({
      requestId: 'r1',
      answer: {
        department: 'Engineering',
        seniority: 'VP',
        location: 'San Francisco, CA',
        roleCategory: 'Technical',
      },
      citations: [{ id: 'c1', title: 'Jane Doe - LinkedIn', url: 'https://linkedin.com/in/janedoe' }],
    })

    const result = await ExaEnrichmentProvider.enrichContact({ personName: 'Jane Doe', companyName: 'Acme Corp' })

    expect(result).toMatchObject({
      department: 'Engineering',
      seniority: 'VP',
      location: 'San Francisco, CA',
      roleCategory: 'Technical',
      confidence: 'medium',
      status: 'enriched',
      providerUsed: 'exa',
    })
    expect(result.industry).toBeUndefined()
    expect(result.companySize).toBeUndefined()
  })

  it('never fabricates confidence "high" — an ungrounded (no-citation) answer is "low"', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaAnswer).mockResolvedValue({
      requestId: 'r1',
      answer: { department: 'Sales' },
      citations: [],
    })

    const result = await ExaEnrichmentProvider.enrichContact({ personName: 'Jane Doe', companyName: 'Acme Corp' })

    expect(result.confidence).toBe('low')
    expect(result.status).toBe('enriched')
  })

  it('leaves fields genuinely unset rather than fabricating them when the answer is a plain string', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaAnswer).mockResolvedValue({
      requestId: 'r1',
      answer: 'Jane Doe is a VP of Engineering at Acme Corp.',
      citations: [{ id: 'c1', title: 'Jane Doe', url: 'https://example.com' }],
    })

    const result = await ExaEnrichmentProvider.enrichContact({ personName: 'Jane Doe', companyName: 'Acme Corp' })

    expect(result.status).toBe('not_found')
    expect(result.department).toBeUndefined()
    expect(result.seniority).toBeUndefined()
  })

  it('falls back to knownCompanySize/knownIndustry hints only when Exa left them thin', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaAnswer).mockResolvedValue({
      requestId: 'r1',
      answer: { department: 'Engineering' },
      citations: [{ id: 'c1', title: 'x', url: 'https://example.com' }],
    })

    const result = await ExaEnrichmentProvider.enrichContact({
      personName: 'Jane Doe',
      companyName: 'Acme Corp',
      knownCompanySize: '201-1000',
      knownIndustry: 'Manufacturing',
    })

    expect(result.companySize).toBe('201-1000')
    expect(result.industry).toBe('Manufacturing')
  })

  it('prefers Exa-supplied industry/companySize over the hints when Exa provides them', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaAnswer).mockResolvedValue({
      requestId: 'r1',
      answer: { department: 'Engineering', industry: 'SaaS', companySize: '51-200' },
      citations: [{ id: 'c1', title: 'x', url: 'https://example.com' }],
    })

    const result = await ExaEnrichmentProvider.enrichContact({
      personName: 'Jane Doe',
      companyName: 'Acme Corp',
      knownCompanySize: '201-1000',
      knownIndustry: 'Manufacturing',
    })

    expect(result.companySize).toBe('51-200')
    expect(result.industry).toBe('SaaS')
  })

  it('returns not_found rather than throwing when exaAnswer rejects', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaAnswer).mockRejectedValue(new Error('exa down'))

    const result = await ExaEnrichmentProvider.enrichContact({ personName: 'Jane Doe', companyName: 'Acme Corp' })

    expect(result.status).toBe('not_found')
  })

  it('isAvailable reflects whether a credential is configured', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    expect(await ExaEnrichmentProvider.isAvailable()).toBe(true)

    vi.mocked(getExaCredential).mockResolvedValue(null)
    expect(await ExaEnrichmentProvider.isAvailable()).toBe(false)
  })
})

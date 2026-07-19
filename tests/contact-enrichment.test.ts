// ============================================================
// Contact Enrichment — mock provider tests
// ============================================================

import { describe, it, expect } from 'vitest'
import { MockEnrichmentProvider } from '../lib/outbound/enrichment/providers/mock'

describe('MockEnrichmentProvider', () => {
  it('is deterministic — same input always produces the same result', async () => {
    const request = { personName: 'Jane Doe', companyName: 'Acme Corp' }
    const a = await MockEnrichmentProvider.enrichContact(request)
    const b = await MockEnrichmentProvider.enrichContact(request)
    expect(a).toEqual(b)
  })

  it('prefers known company size / industry over invented fixtures', async () => {
    const result = await MockEnrichmentProvider.enrichContact({
      personName: 'Jane Doe',
      companyName: 'Acme Corp',
      knownCompanySize: '5000+',
      knownIndustry: 'Aerospace',
    })
    expect(result.companySize).toBe('5000+')
    expect(result.industry).toBe('Aerospace')
    expect(result.confidence).toBe('high')
  })

  it('falls back to fixture data when no known values are provided', async () => {
    const result = await MockEnrichmentProvider.enrichContact({
      personName: 'John Smith',
      companyName: 'Widgets Inc',
    })
    expect(result.companySize).toBeDefined()
    expect(result.industry).toBeDefined()
  })

  it('only produces a linkedinSummary when a linkedinUrl is provided', async () => {
    const withUrl = await MockEnrichmentProvider.enrichContact({
      personName: 'Jane Doe',
      companyName: 'Acme Corp',
      linkedinUrl: 'https://linkedin.com/in/janedoe',
    })
    const withoutUrl = await MockEnrichmentProvider.enrichContact({
      personName: 'Jane Doe 2',
      companyName: 'Acme Corp',
    })
    if (withUrl.status !== 'not_found') expect(withUrl.linkedinSummary).toBeDefined()
    if (withoutUrl.status !== 'not_found') expect(withoutUrl.linkedinSummary).toBeUndefined()
  })

  it('never throws, always resolves', async () => {
    await expect(
      MockEnrichmentProvider.enrichContact({ personName: '', companyName: '' })
    ).resolves.toBeDefined()
  })

  it('isAvailable always resolves true', async () => {
    expect(await MockEnrichmentProvider.isAvailable()).toBe(true)
  })
})

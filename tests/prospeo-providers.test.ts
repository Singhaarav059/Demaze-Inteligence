// ============================================================
// Prospeo — Email Finder / Contact Enrichment provider tests
// ============================================================
// lib/outbound/shared/prospeo-client.ts is mocked entirely (matching this
// repo's existing vi.mock precedent, tests/business-profile.test.ts) so
// these test each provider's request-building and response-interpretation
// logic without a real network call. See tests/prospeo-provider.test.ts
// for the low-level client's own tests against a mocked global.fetch.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/outbound/shared/prospeo-client', () => ({
  getProspeoApiKey: vi.fn(),
  callProspeoEnrichPerson: vi.fn(),
}))

import { getProspeoApiKey, callProspeoEnrichPerson } from '@/lib/outbound/shared/prospeo-client'
import { ProspeoEmailFinderProvider } from '@/lib/outbound/email-finder/providers/prospeo'
import { ProspeoEnrichmentProvider } from '@/lib/outbound/enrichment/providers/prospeo'

describe('ProspeoEmailFinderProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('errors without a personName', async () => {
    const result = await ProspeoEmailFinderProvider.findEmail({ personName: '', companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('error')
  })

  it('errors without a domain or company name', async () => {
    const result = await ProspeoEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: '', domain: '' })
    expect(result.status).toBe('error')
  })

  it('errors with no API key configured', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue(null)

    const result = await ProspeoEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('error')
    expect(result.reason).toContain('API key')
  })

  it('maps NO_MATCH to status not_found', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoEnrichPerson).mockResolvedValue({ ok: true, data: { error: true, error_code: 'NO_MATCH' } })

    const result = await ProspeoEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('not_found')
  })

  it('maps other error codes (e.g. INSUFFICIENT_CREDITS) to status error', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoEnrichPerson).mockResolvedValue({ ok: true, data: { error: true, error_code: 'INSUFFICIENT_CREDITS' } })

    const result = await ProspeoEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('error')
    expect(result.reason).toBe('INSUFFICIENT_CREDITS')
  })

  it('maps a verified email to status found, confidence high', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoEnrichPerson).mockResolvedValue({
      ok: true,
      data: { error: false, person: { email: { email: 'jane@acme.com', status: 'VERIFIED', revealed: true } } },
    })

    const result = await ProspeoEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('found')
    expect(result.email).toBe('jane@acme.com')
    expect(result.confidence).toBe('high')
  })

  it('maps a non-verified email status to confidence medium', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoEnrichPerson).mockResolvedValue({
      ok: true,
      data: { error: false, person: { email: { email: 'jane@acme.com', status: 'GUESSED', revealed: true } } },
    })

    const result = await ProspeoEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme', domain: 'acme.com' })
    expect(result.confidence).toBe('medium')
  })

  it('treats revealed:false as not_found even if an email string is present', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoEnrichPerson).mockResolvedValue({
      ok: true,
      data: { error: false, person: { email: { email: 'jane@acme.com', revealed: false } } },
    })

    const result = await ProspeoEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('not_found')
  })

  it('never throws on a client-level failure', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoEnrichPerson).mockResolvedValue({ ok: false, error: 'timeout' })

    const result = await ProspeoEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('error')
    expect(result.reason).toBe('timeout')
  })

  it('isAvailable reflects whether a credential is configured', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    expect(await ProspeoEmailFinderProvider.isAvailable()).toBe(true)

    vi.mocked(getProspeoApiKey).mockResolvedValue(null)
    expect(await ProspeoEmailFinderProvider.isAvailable()).toBe(false)
  })
})

describe('ProspeoEnrichmentProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns not_found without a personName or linkedinUrl', async () => {
    const result = await ProspeoEnrichmentProvider.enrichContact({ personName: '', companyName: 'Acme' })
    expect(result.status).toBe('not_found')
  })

  it('returns not_found with no API key configured', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue(null)

    const result = await ProspeoEnrichmentProvider.enrichContact({ personName: 'Jane Doe', companyName: 'Acme' })
    expect(result.status).toBe('not_found')
  })

  it('uses linkedin_url as the match key when a linkedinUrl is provided', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoEnrichPerson).mockResolvedValue({ ok: true, data: { error: false, person: { headline: 'VP' } } })

    await ProspeoEnrichmentProvider.enrichContact({
      personName: 'Jane Doe',
      companyName: 'Acme',
      linkedinUrl: 'https://linkedin.com/in/janedoe',
    })

    const [, body] = vi.mocked(callProspeoEnrichPerson).mock.calls[0]
    expect(body.data).toEqual({ linkedin_url: 'https://linkedin.com/in/janedoe' })
  })

  it('maps job_history + company data into department/seniority/companySize/industry', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoEnrichPerson).mockResolvedValue({
      ok: true,
      data: {
        error: false,
        person: {
          headline: 'VP Manufacturing at Acme',
          current_job_title: 'VP Manufacturing',
          job_history: [{ current: true, departments: ['Operations'], seniority: 'VP' }],
          location: { city: 'Pune', country: 'India' },
        },
        company: { industry: 'Manufacturing', employee_range: '1000-5000' },
      },
    })

    const result = await ProspeoEnrichmentProvider.enrichContact({ personName: 'Jane Doe', companyName: 'Acme' })

    expect(result.department).toBe('Operations')
    expect(result.seniority).toBe('VP')
    expect(result.industry).toBe('Manufacturing')
    expect(result.companySize).toBe('1000-5000')
    expect(result.location).toBe('Pune, India')
    expect(result.status).toBe('enriched')
    expect(result.confidence).toBe('high')
  })

  it('falls back to knownCompanySize/knownIndustry when Prospeo has no company data', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoEnrichPerson).mockResolvedValue({
      ok: true,
      data: { error: false, person: { headline: 'VP Manufacturing' } },
    })

    const result = await ProspeoEnrichmentProvider.enrichContact({
      personName: 'Jane Doe',
      companyName: 'Acme',
      knownCompanySize: '201-1000',
      knownIndustry: 'Industrial Services',
    })

    expect(result.companySize).toBe('201-1000')
    expect(result.industry).toBe('Industrial Services')
  })

  it('returns not_found when Prospeo errors or has no person', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoEnrichPerson).mockResolvedValue({ ok: true, data: { error: true, error_code: 'NO_MATCH' } })

    const result = await ProspeoEnrichmentProvider.enrichContact({ personName: 'Jane Doe', companyName: 'Acme' })
    expect(result.status).toBe('not_found')
  })

  it('never throws on a client-level failure', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoEnrichPerson).mockResolvedValue({ ok: false, error: 'timeout' })

    const result = await ProspeoEnrichmentProvider.enrichContact({ personName: 'Jane Doe', companyName: 'Acme' })
    expect(result.status).toBe('not_found')
  })
})

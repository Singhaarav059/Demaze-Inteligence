// ============================================================
// Explee — Decision-Maker Discovery / Email Finder provider tests
// ============================================================
// lib/outbound/shared/explee-client.ts and lib/enrichment/sources/
// explee-client.ts (the company-search POC, used only for company_linkedin_id
// resolution) are both mocked entirely — matching this repo's existing
// tests/prospeo-providers.test.ts precedent — so these test each
// provider's request-building and response-interpretation logic without a
// real network call.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/outbound/shared/explee-client', () => ({
  getExpleeApiKey: vi.fn(),
  callExpleeSearchPeople: vi.fn(),
  callExpleeEnrichEmail: vi.fn(),
}))

vi.mock('@/lib/enrichment/sources/explee-client', () => ({
  searchExpleeCompanies: vi.fn(),
}))

import { getExpleeApiKey, callExpleeSearchPeople, callExpleeEnrichEmail } from '@/lib/outbound/shared/explee-client'
import { searchExpleeCompanies } from '@/lib/enrichment/sources/explee-client'
import { ExpleeDecisionMakerDiscoveryProvider } from '@/lib/outbound/decision-maker-discovery/providers/explee'
import { ExpleeEmailFinderProvider } from '@/lib/outbound/email-finder/providers/explee'

describe('ExpleeDecisionMakerDiscoveryProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(searchExpleeCompanies).mockResolvedValue({ companies: [], meta: { total: 0, results_count: 0, credits_charged: 0, remaining_balance: 0 } })
  })

  it('errors without companyName or domain', async () => {
    const result = await ExpleeDecisionMakerDiscoveryProvider.discoverDecisionMakers({ companyName: '', domain: '' })
    expect(result.status).toBe('error')
  })

  it('errors with no API key configured', async () => {
    vi.mocked(getExpleeApiKey).mockResolvedValue(null)

    const result = await ExpleeDecisionMakerDiscoveryProvider.discoverDecisionMakers({ companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('error')
    expect(result.reason).toContain('API key')
  })

  it('scopes the search via company_linkedin_ids when a domain-matched Explee company is resolved', async () => {
    vi.mocked(getExpleeApiKey).mockResolvedValue('key')
    vi.mocked(searchExpleeCompanies).mockResolvedValue({
      companies: [{ name: 'Acme', domain: 'acme.com', url: null, description: null, industry: null, geo: null, geo_city: null, size: null, founded: null, revenue_annual: null, funding_stage: null, linkedin_id: 12345 }],
      meta: { total: 1, results_count: 1, credits_charged: 0, remaining_balance: 0 },
    })
    vi.mocked(callExpleeSearchPeople).mockResolvedValue({ ok: true, data: { people: [] } })

    await ExpleeDecisionMakerDiscoveryProvider.discoverDecisionMakers({ companyName: 'Acme', domain: 'acme.com', targetTitles: ['CEO'] })

    const [, body] = vi.mocked(callExpleeSearchPeople).mock.calls[0]
    expect(body.company_linkedin_ids).toEqual([12345])
    expect(body.company_filters).toBeUndefined()
  })

  it('falls back to company_filters.definition when no confident company match is resolved', async () => {
    vi.mocked(getExpleeApiKey).mockResolvedValue('key')
    vi.mocked(callExpleeSearchPeople).mockResolvedValue({ ok: true, data: { people: [] } })

    await ExpleeDecisionMakerDiscoveryProvider.discoverDecisionMakers({ companyName: 'Acme', domain: 'acme.com', targetTitles: ['CEO'] })

    const [, body] = vi.mocked(callExpleeSearchPeople).mock.calls[0]
    expect(body.company_filters).toEqual({ definition: 'Acme' })
    expect(body.company_linkedin_ids).toBeUndefined()
  })

  it('drops candidates whose job_title shares no word with any requested title', async () => {
    vi.mocked(getExpleeApiKey).mockResolvedValue('key')
    vi.mocked(callExpleeSearchPeople).mockResolvedValue({
      ok: true,
      data: { people: [{ first_name: 'Jane', last_name: 'Doe', job_title: 'Receptionist' }] },
    })

    const result = await ExpleeDecisionMakerDiscoveryProvider.discoverDecisionMakers({ companyName: 'Acme', domain: 'acme.com', targetTitles: ['CEO'] })
    expect(result.status).toBe('not_found')
    expect(result.candidates).toHaveLength(0)
  })

  it('maps a full-overlap title match (via acronym expansion) to confidence high', async () => {
    vi.mocked(getExpleeApiKey).mockResolvedValue('key')
    vi.mocked(callExpleeSearchPeople).mockResolvedValue({
      ok: true,
      data: { people: [{ first_name: 'Jane', last_name: 'Doe', job_title: 'Chief Executive Officer', linkedin_url: 'https://linkedin.com/in/jane' }] },
    })

    const result = await ExpleeDecisionMakerDiscoveryProvider.discoverDecisionMakers({ companyName: 'Acme', domain: 'acme.com', targetTitles: ['CEO'] })
    expect(result.status).toBe('found')
    expect(result.candidates[0].confidence).toBe('high')
    expect(result.candidates[0].title).toBe('CEO')
    expect(result.candidates[0].personName).toBe('Jane Doe')
  })

  it('dedupes by linkedin_url', async () => {
    vi.mocked(getExpleeApiKey).mockResolvedValue('key')
    vi.mocked(callExpleeSearchPeople).mockResolvedValue({
      ok: true,
      data: {
        people: [
          { first_name: 'Jane', last_name: 'Doe', job_title: 'CEO', linkedin_url: 'https://linkedin.com/in/jane' },
          { first_name: 'Jane', last_name: 'Doe', job_title: 'CEO', linkedin_url: 'https://linkedin.com/in/jane' },
        ],
      },
    })

    const result = await ExpleeDecisionMakerDiscoveryProvider.discoverDecisionMakers({ companyName: 'Acme', domain: 'acme.com', targetTitles: ['CEO'] })
    expect(result.candidates).toHaveLength(1)
  })

  it('never throws on a client-level failure', async () => {
    vi.mocked(getExpleeApiKey).mockResolvedValue('key')
    vi.mocked(callExpleeSearchPeople).mockResolvedValue({ ok: false, error: 'timeout' })

    const result = await ExpleeDecisionMakerDiscoveryProvider.discoverDecisionMakers({ companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('error')
    expect(result.reason).toBe('timeout')
  })

  it('isAvailable reflects whether a credential is configured', async () => {
    vi.mocked(getExpleeApiKey).mockResolvedValue('key')
    expect(await ExpleeDecisionMakerDiscoveryProvider.isAvailable()).toBe(true)

    vi.mocked(getExpleeApiKey).mockResolvedValue(null)
    expect(await ExpleeDecisionMakerDiscoveryProvider.isAvailable()).toBe(false)
  })
})

describe('ExpleeEmailFinderProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('errors without a personName', async () => {
    const result = await ExpleeEmailFinderProvider.findEmail({ personName: '', companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('error')
  })

  it('errors without a domain (Explee has no company-name-only lookup)', async () => {
    const result = await ExpleeEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme', domain: '' })
    expect(result.status).toBe('error')
    expect(result.reason).toContain('domain')
  })

  it('errors when personName has no last name to split out', async () => {
    const result = await ExpleeEmailFinderProvider.findEmail({ personName: 'Cher', companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('error')
  })

  it('errors with no API key configured', async () => {
    vi.mocked(getExpleeApiKey).mockResolvedValue(null)

    const result = await ExpleeEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('error')
    expect(result.reason).toContain('API key')
  })

  it('maps a high confidence_score to status found, confidence high', async () => {
    vi.mocked(getExpleeApiKey).mockResolvedValue('key')
    vi.mocked(callExpleeEnrichEmail).mockResolvedValue({ ok: true, data: { email: 'jane@acme.com', confidence_score: 0.92 } })

    const result = await ExpleeEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('found')
    expect(result.email).toBe('jane@acme.com')
    expect(result.confidence).toBe('high')

    const [, body] = vi.mocked(callExpleeEnrichEmail).mock.calls[0]
    expect(body).toEqual({ first_name: 'Jane', last_name: 'Doe', company_domain: 'acme.com', preset: 'basic' })
  })

  it('maps a mid confidence_score to confidence medium', async () => {
    vi.mocked(getExpleeApiKey).mockResolvedValue('key')
    vi.mocked(callExpleeEnrichEmail).mockResolvedValue({ ok: true, data: { email: 'jane@acme.com', confidence_score: 0.6 } })

    const result = await ExpleeEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme', domain: 'acme.com' })
    expect(result.confidence).toBe('medium')
  })

  it('maps a low confidence_score to confidence low', async () => {
    vi.mocked(getExpleeApiKey).mockResolvedValue('key')
    vi.mocked(callExpleeEnrichEmail).mockResolvedValue({ ok: true, data: { email: 'jane@acme.com', confidence_score: 0.2 } })

    const result = await ExpleeEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme', domain: 'acme.com' })
    expect(result.confidence).toBe('low')
  })

  it('treats a null email as not_found', async () => {
    vi.mocked(getExpleeApiKey).mockResolvedValue('key')
    vi.mocked(callExpleeEnrichEmail).mockResolvedValue({ ok: true, data: { email: null } })

    const result = await ExpleeEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('not_found')
  })

  it('never throws on a client-level failure', async () => {
    vi.mocked(getExpleeApiKey).mockResolvedValue('key')
    vi.mocked(callExpleeEnrichEmail).mockResolvedValue({ ok: false, error: 'timeout' })

    const result = await ExpleeEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('error')
    expect(result.reason).toBe('timeout')
  })

  it('isAvailable reflects whether a credential is configured', async () => {
    vi.mocked(getExpleeApiKey).mockResolvedValue('key')
    expect(await ExpleeEmailFinderProvider.isAvailable()).toBe(true)

    vi.mocked(getExpleeApiKey).mockResolvedValue(null)
    expect(await ExpleeEmailFinderProvider.isAvailable()).toBe(false)
  })
})

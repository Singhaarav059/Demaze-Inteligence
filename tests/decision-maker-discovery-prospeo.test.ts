// ============================================================
// Prospeo Decision-Maker Discovery Provider — tests
// ============================================================
// lib/outbound/shared/prospeo-client.ts is mocked entirely (matching this
// repo's existing vi.mock precedent, tests/prospeo-providers.test.ts) so
// these test request-building, title word-overlap matching, and response
// interpretation without a real network call.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/outbound/shared/prospeo-client', () => ({
  getProspeoApiKey: vi.fn(),
  callProspeoSearchPerson: vi.fn(),
}))

import { getProspeoApiKey, callProspeoSearchPerson } from '@/lib/outbound/shared/prospeo-client'
import { ProspeoDecisionMakerDiscoveryProvider } from '@/lib/outbound/decision-maker-discovery/providers/prospeo'

describe('ProspeoDecisionMakerDiscoveryProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('errors without a companyName or domain', async () => {
    const result = await ProspeoDecisionMakerDiscoveryProvider.discoverDecisionMakers({ companyName: '', domain: '' })
    expect(result.status).toBe('error')
  })

  it('errors with no API key configured', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue(null)
    const result = await ProspeoDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
    })
    expect(result.status).toBe('error')
    expect(result.reason).toContain('API key')
  })

  it('filters on the stripped hostname, not the raw domain', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoSearchPerson).mockResolvedValue({ ok: true, data: { error: false, results: [] } })

    await ProspeoDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'https://www.acme.com/about',
    })

    const [, body] = vi.mocked(callProspeoSearchPerson).mock.calls[0]
    expect(body.filters.company).toEqual({ websites: { include: ['acme.com'] } })
  })

  it('falls back to a company-name filter when no domain is given', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoSearchPerson).mockResolvedValue({ ok: true, data: { error: false, results: [] } })

    await ProspeoDecisionMakerDiscoveryProvider.discoverDecisionMakers({ companyName: 'Acme', domain: '' })

    const [, body] = vi.mocked(callProspeoSearchPerson).mock.calls[0]
    expect(body.filters.company).toEqual({ names: { include: ['Acme'] } })
  })

  it('maps NO_MATCH to status not_found', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoSearchPerson).mockResolvedValue({ ok: true, data: { error: true, error_code: 'NO_MATCH' } })

    const result = await ProspeoDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
    })
    expect(result.status).toBe('not_found')
  })

  it('maps other error codes to status error', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoSearchPerson).mockResolvedValue({
      ok: true,
      data: { error: true, error_code: 'INSUFFICIENT_CREDITS' },
    })

    const result = await ProspeoDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
    })
    expect(result.status).toBe('error')
    expect(result.reason).toBe('INSUFFICIENT_CREDITS')
  })

  it('never throws on a client-level failure', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoSearchPerson).mockResolvedValue({ ok: false, error: 'timeout' })

    const result = await ProspeoDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
    })
    expect(result.status).toBe('error')
    expect(result.reason).toBe('timeout')
  })

  it('maps a matching current title to high confidence, tagged with the target title', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoSearchPerson).mockResolvedValue({
      ok: true,
      data: {
        error: false,
        results: [
          {
            person: {
              full_name: 'Jane Doe',
              current_job_title: 'Chief Technology Officer',
              linkedin_url: 'https://linkedin.com/in/janedoe',
              job_history: [{ current: true, title: 'Chief Technology Officer', seniority: 'C-Suite', departments: ['Engineering'] }],
            },
          },
        ],
      },
    })

    const result = await ProspeoDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
      targetTitles: ['CTO'],
    })

    expect(result.status).toBe('found')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      personName: 'Jane Doe',
      title: 'CTO',
      seniority: 'C-Suite',
      department: 'Engineering',
      linkedinUrl: 'https://linkedin.com/in/janedoe',
      confidence: 'high',
    })
  })

  it('drops a candidate whose title shares no word with any requested title', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoSearchPerson).mockResolvedValue({
      ok: true,
      data: {
        error: false,
        results: [{ person: { full_name: 'Irrelevant Person', current_job_title: 'Receptionist' } }],
      },
    })

    const result = await ProspeoDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
      targetTitles: ['CEO'],
    })

    expect(result.status).toBe('not_found')
    expect(result.candidates).toEqual([])
  })

  it('tiers a partial title overlap (2 of 3 target words) as medium confidence', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoSearchPerson).mockResolvedValue({
      ok: true,
      data: {
        error: false,
        results: [{ person: { full_name: 'Sam Lee', current_job_title: 'VP Manufacturing' } }],
      },
    })

    const result = await ProspeoDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
      targetTitles: ['VP Operations'],
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].confidence).toBe('medium')
  })

  it('dedupes candidates that match more than one requested title', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    vi.mocked(callProspeoSearchPerson).mockResolvedValue({
      ok: true,
      data: {
        error: false,
        results: [
          { person: { full_name: 'Same Person', current_job_title: 'Chief Executive Officer', linkedin_url: 'https://linkedin.com/in/samep' } },
          { person: { full_name: 'Same Person', current_job_title: 'Chief Executive Officer', linkedin_url: 'https://linkedin.com/in/samep' } },
        ],
      },
    })

    const result = await ProspeoDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
      targetTitles: ['CEO'],
    })

    expect(result.candidates).toHaveLength(1)
  })

  it('isAvailable reflects whether a credential is configured', async () => {
    vi.mocked(getProspeoApiKey).mockResolvedValue('key')
    expect(await ProspeoDecisionMakerDiscoveryProvider.isAvailable()).toBe(true)

    vi.mocked(getProspeoApiKey).mockResolvedValue(null)
    expect(await ProspeoDecisionMakerDiscoveryProvider.isAvailable()).toBe(false)
  })
})

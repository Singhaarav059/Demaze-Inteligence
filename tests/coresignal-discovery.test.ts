// ============================================================
// Coresignal discovery/normalization tests
// ============================================================
// Mocks lib/enrichment/sources/coresignal-client directly (same pattern as
// tests/competitor-discovery-synthesis.test.ts mocking discovery-engine's
// search functions) so these tests exercise the real normalization/
// filtering/dedup logic in coresignal-discovery.ts without any network
// call, real or fake.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/enrichment/sources/coresignal-client', async () => {
  const actual = await vi.importActual<typeof import('../lib/enrichment/sources/coresignal-client')>(
    '../lib/enrichment/sources/coresignal-client',
  )
  return {
    ...actual,
    getCoresignalApiKey: vi.fn(() => 'test-key'),
    searchCoresignalCompanyIds: vi.fn(),
    collectCoresignalCompany: vi.fn(),
  }
})

import { discoverCompaniesFromCoresignal } from '../lib/enrichment/coresignal-discovery'
import {
  getCoresignalApiKey,
  searchCoresignalCompanyIds,
  collectCoresignalCompany,
  CoresignalApiError,
} from '../lib/enrichment/sources/coresignal-client'

const mockedGetKey = vi.mocked(getCoresignalApiKey)
const mockedSearch = vi.mocked(searchCoresignalCompanyIds)
const mockedCollect = vi.mocked(collectCoresignalCompany)

describe('discoverCompaniesFromCoresignal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetKey.mockReturnValue('test-key')
  })

  it('returns insufficient when no API key is configured', async () => {
    mockedGetKey.mockReturnValue(null)
    const result = await discoverCompaniesFromCoresignal({ industry: 'Manufacturing' })
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/CORESIGNAL_API_KEY/)
    expect(mockedSearch).not.toHaveBeenCalled()
  })

  it('returns insufficient when no meaningful filter is given', async () => {
    const result = await discoverCompaniesFromCoresignal({})
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/at least one filter/)
    expect(mockedSearch).not.toHaveBeenCalled()
  })

  it('normalizes a real match with a website into a high-confidence CompanyMatch', async () => {
    mockedSearch.mockResolvedValue({ ids: [1], nextAfter: null })
    mockedCollect.mockResolvedValue({
      id: 1, name: 'Acme Manufacturing Pvt Ltd', website: 'www.acme-mfg.example.com',
      industry: 'Manufacturing', headquarters_country_parsed: 'India', employees_count: 250, founded: 2005,
    })

    const result = await discoverCompaniesFromCoresignal({ industry: 'Manufacturing', country: 'India' })

    expect(result.sufficiency).toBe('sufficient')
    expect(result.companies).toHaveLength(1)
    const c = result.companies[0]
    expect(c.name).toBe('Acme Manufacturing Pvt Ltd')
    expect(c.domain).toBe('acme-mfg.example.com')
    expect(c.confidence).toBe('high')
    expect(c.domain_confidence).toBe('high')
    expect(c.source).toBe('coresignal')
    expect(c.reason).toContain('Manufacturing')
    expect(c.reason).toContain('India')
    expect(c.reason).toContain('250 employees')
  })

  it('gives medium confidence and no domain when the record has no website', async () => {
    mockedSearch.mockResolvedValue({ ids: [1], nextAfter: null })
    mockedCollect.mockResolvedValue({ id: 1, name: 'No Website Co', industry: 'Manufacturing' })

    const result = await discoverCompaniesFromCoresignal({ industry: 'Manufacturing' })
    expect(result.companies[0].domain).toBeUndefined()
    expect(result.companies[0].confidence).toBe('medium')
  })

  it('rejects a record with no company name', async () => {
    mockedSearch.mockResolvedValue({ ids: [1, 2], nextAfter: null })
    mockedCollect
      .mockResolvedValueOnce({ id: 1 } as never)
      .mockResolvedValueOnce({ id: 2, name: 'Real Co', website: 'real.example.com' })

    const result = await discoverCompaniesFromCoresignal({ industry: 'x' })
    expect(result.companies).toHaveLength(1)
    expect(result.companies[0].name).toBe('Real Co')
    expect(result.rejected_candidates?.some(r => r.reason.includes('no company name'))).toBe(true)
  })

  it('rejects a record Coresignal marks deleted/stale', async () => {
    mockedSearch.mockResolvedValue({ ids: [1], nextAfter: null })
    mockedCollect.mockResolvedValue({ id: 1, name: 'Stale Co', website: 'stale.example.com', deleted: true })

    const result = await discoverCompaniesFromCoresignal({ industry: 'x' })
    expect(result.sufficiency).toBe('insufficient')
    expect(result.rejected_candidates?.[0].reason).toMatch(/deleted\/stale/)
  })

  it('excludes a self-name match via the reused classifyCompanyRejection', async () => {
    mockedSearch.mockResolvedValue({ ids: [1], nextAfter: null })
    mockedCollect.mockResolvedValue({ id: 1, name: 'Demaze Technologies', website: 'demazetech.com' })

    const result = await discoverCompaniesFromCoresignal({ industry: 'x' }, ['Demaze Technologies'])
    expect(result.sufficiency).toBe('insufficient')
    expect(result.rejected_candidates?.[0].reason).toMatch(/self-name/)
  })

  it('dedupes two records that resolve to the same domain', async () => {
    mockedSearch.mockResolvedValue({ ids: [1, 2], nextAfter: null })
    mockedCollect
      .mockResolvedValueOnce({ id: 1, name: 'Acme Co', website: 'https://acme.example.com' })
      .mockResolvedValueOnce({ id: 2, name: 'Acme Corporation', website: 'www.acme.example.com' })

    const result = await discoverCompaniesFromCoresignal({ industry: 'x' })
    expect(result.companies).toHaveLength(1)
    expect(result.rejected_candidates?.some(r => r.reason.includes('duplicate'))).toBe(true)
  })

  it('paginates search results until maxResults is reached', async () => {
    mockedSearch
      .mockResolvedValueOnce({ ids: [1], nextAfter: 'cursor-1' })
      .mockResolvedValueOnce({ ids: [2], nextAfter: null })
    mockedCollect
      .mockResolvedValueOnce({ id: 1, name: 'Company One', website: 'one.example.com' })
      .mockResolvedValueOnce({ id: 2, name: 'Company Two', website: 'two.example.com' })

    const result = await discoverCompaniesFromCoresignal({ industry: 'x' }, undefined, { maxResults: 5 })
    expect(mockedSearch).toHaveBeenCalledTimes(2)
    expect(result.companies).toHaveLength(2)
  })

  it('returns insufficient with the real error when search fails', async () => {
    mockedSearch.mockRejectedValue(new CoresignalApiError(500, 'Coresignal API 500: outage'))
    const result = await discoverCompaniesFromCoresignal({ industry: 'x' })
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toContain('outage')
  })

  it('returns insufficient with a partial-progress message when collect fails mid-batch', async () => {
    mockedSearch.mockResolvedValue({ ids: [1, 2, 3, 4, 5, 6], nextAfter: null })
    mockedCollect.mockRejectedValue(new CoresignalApiError(500, 'Coresignal API 500: collect down'))

    const result = await discoverCompaniesFromCoresignal({ industry: 'x' })
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toContain('collect down')
  })

  it('returns insufficient when the search finds no matching IDs at all', async () => {
    mockedSearch.mockResolvedValue({ ids: [], nextAfter: null })
    const result = await discoverCompaniesFromCoresignal({ industry: 'a very specific niche' })
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/no matching companies/)
    expect(mockedCollect).not.toHaveBeenCalled()
  })
})

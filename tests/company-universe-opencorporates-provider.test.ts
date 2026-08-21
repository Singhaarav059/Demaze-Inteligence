// ============================================================
// Company Universe — OpenCorporates provider tests
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenCorporatesProvider, mapStatus, jurisdictionToCountryCode, companyToFields, getOpenCorporatesApiToken } from '../lib/company-universe/providers/opencorporates'
import type { OcCompany } from '../lib/company-universe/providers/opencorporates'

const originalFetch = global.fetch
const originalEnv = process.env.OPENCORPORATES_API_TOKEN
function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body } as unknown as Response
}

function company(overrides: Partial<OcCompany> = {}): OcCompany {
  return { name: 'Test Co', company_number: '123', jurisdiction_code: 'us_de', ...overrides }
}

describe('mapStatus', () => {
  it('treats a dissolution_date or inactive:true as dissolved regardless of current_status text', () => {
    expect(mapStatus(company({ dissolution_date: '2020-01-01' }))).toBe('dissolved')
    expect(mapStatus(company({ inactive: true }))).toBe('dissolved')
  })
  it('maps current_status text', () => {
    expect(mapStatus(company({ current_status: 'Good standing' }))).toBe('active')
    expect(mapStatus(company({ current_status: 'Struck off' }))).toBe('dissolved')
    expect(mapStatus(company({ current_status: 'Something unrecognized' }))).toBe('unknown')
  })
})

describe('jurisdictionToCountryCode', () => {
  it('takes the leading segment of a compound jurisdiction code', () => {
    expect(jurisdictionToCountryCode('us_de')).toBe('US')
    expect(jurisdictionToCountryCode('gb')).toBe('GB')
    expect(jurisdictionToCountryCode('in')).toBe('IN')
  })
})

describe('companyToFields', () => {
  it('maps a real-shaped OpenCorporates company', () => {
    const fields = companyToFields(company({
      name: 'Test Co LLC', jurisdiction_code: 'us_de', incorporation_date: '2015-06-01',
      industry_codes: [{ industry_code: { code: '5112', code_scheme_name: 'US SIC' } }, { industry_code: { code: '511210', code_scheme_name: 'US NAICS' } }],
    }))
    expect(fields.companyNumber).toBe('123')
    expect(fields.registrationAuthority).toBe('us_de')
    expect(fields.countryCode).toBe('US')
    expect(fields.foundedYear).toBe(2015)
    expect(fields.sicCodes).toEqual(['5112'])
    expect(fields.naicsCodes).toEqual(['511210'])
  })
})

describe('OpenCorporatesProvider — unconfigured (no API token), degrades gracefully', () => {
  beforeEach(() => { delete process.env.OPENCORPORATES_API_TOKEN; global.fetch = vi.fn() })
  afterEach(() => { process.env.OPENCORPORATES_API_TOKEN = originalEnv; global.fetch = originalFetch })

  it('getOpenCorporatesApiToken returns null when unset', () => {
    expect(getOpenCorporatesApiToken()).toBeNull()
  })

  it('healthCheck reports configured: false without calling fetch', async () => {
    const health = await OpenCorporatesProvider.healthCheck()
    expect(health.configured).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('search() and getCompany() both return a graceful not-configured result', async () => {
    const searchResult = await OpenCorporatesProvider.search({ name: 'test' })
    expect(searchResult.records).toEqual([])
    expect(searchResult.error).toMatch(/OPENCORPORATES_API_TOKEN/)

    const record = await OpenCorporatesProvider.getCompany({ companyNumber: '123', registrationAuthority: 'us_de' })
    expect(record).toBeNull()
  })
})

describe('OpenCorporatesProvider — configured', () => {
  beforeEach(() => { process.env.OPENCORPORATES_API_TOKEN = 'test-token'; global.fetch = vi.fn() })
  afterEach(() => { process.env.OPENCORPORATES_API_TOKEN = originalEnv; global.fetch = originalFetch })

  it('search() applies name + countryCode as jurisdiction_code, reports industry as unsupported', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({ results: { companies: [], total_count: 0 } }))
    const result = await OpenCorporatesProvider.search({ name: 'Acme', countryCode: 'GB', industry: 'manufacturing' })
    expect(result.appliedFilters).toEqual(expect.arrayContaining(['name', 'countryCode']))
    expect(result.unsupportedFilters).toContain('industry')
    const url = (global.fetch as any).mock.calls[0][0] as string
    expect(url).toContain('jurisdiction_code=gb')
  })

  it('search() returns mapped records on success', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({
      results: { companies: [{ company: company({ name: 'Found Co' }) }], total_count: 1 },
    }))
    const result = await OpenCorporatesProvider.search({ name: 'Found' })
    expect(result.records).toHaveLength(1)
    expect(result.records[0].fields.canonicalName).toBe('Found Co')
    expect(result.records[0].provenance.sourceRecordId).toBe('us_de/123')
  })

  it('getCompany() requires BOTH companyNumber and registrationAuthority', async () => {
    const missingAuthority = await OpenCorporatesProvider.getCompany({ companyNumber: '123' })
    expect(missingAuthority).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('getCompany() fetches the direct company endpoint', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({ results: { company: company({ name: 'Direct Lookup' }) } }))
    const record = await OpenCorporatesProvider.getCompany({ companyNumber: '123', registrationAuthority: 'us_de' })
    expect(record?.fields.canonicalName).toBe('Direct Lookup')
  })

  it('a real 403/quota error from OpenCorporates surfaces as a typed error, not a crash', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({ error: 'quota exceeded' }, 403))
    const result = await OpenCorporatesProvider.search({ name: 'test' })
    expect(result.error).toBeDefined()
    expect(result.records).toEqual([])
  })
})

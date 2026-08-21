// ============================================================
// Company Universe — UK Companies House provider tests
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CompaniesHouseProvider, mapStatus, itemToFields, csvRowToRecord, getCompaniesHouseApiKey } from '../lib/company-universe/providers/companies-house'

const originalFetch = global.fetch
const originalEnv = process.env.COMPANIES_HOUSE_API_KEY
function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body } as unknown as Response
}

describe('mapStatus', () => {
  it('maps active/dissolved/administration, defaults to unknown', () => {
    expect(mapStatus('active')).toBe('active')
    expect(mapStatus('dissolved')).toBe('dissolved')
    expect(mapStatus('administration')).toBe('inactive')
    expect(mapStatus('some-unrecognized-status')).toBe('unknown')
  })
})

describe('itemToFields', () => {
  it('maps a search-result item, always GB/United Kingdom', () => {
    const fields = itemToFields({
      title: 'ACME LIMITED', company_number: '01234567', company_status: 'active',
      company_type: 'ltd', date_of_creation: '2010-05-01', sic_codes: ['62012'],
      address: { locality: 'London', country: 'United Kingdom' },
    })
    expect(fields.canonicalName).toBe('ACME LIMITED')
    expect(fields.companyNumber).toBe('01234567')
    expect(fields.countryCode).toBe('GB')
    expect(fields.registrationAuthority).toBe('gb')
    expect(fields.foundedYear).toBe(2010)
    expect(fields.status).toBe('active')
    expect(fields.sicCodes).toEqual(['62012'])
  })
})

describe('csvRowToRecord (Basic Company Data bulk CSV)', () => {
  it('maps a real-shaped bulk-data row', () => {
    const record = csvRowToRecord({
      CompanyName: 'ACME LIMITED', CompanyNumber: '01234567', CompanyStatus: 'Active',
      IncorporationDate: '01/05/2010', 'RegAddress.PostTown': 'London', 'RegAddress.Country': 'United Kingdom',
      'SICCode.SicText_1': '62012 - Business and domestic software development',
    })
    expect(record?.fields.companyNumber).toBe('01234567')
    expect(record?.fields.sicCodes).toEqual(['62012'])
    expect(record?.provenance.sourceType).toBe('bulk')
  })

  it('rejects a row missing CompanyName or CompanyNumber', () => {
    expect(csvRowToRecord({ CompanyNumber: '01234567' })).toBeNull()
    expect(csvRowToRecord({ CompanyName: 'No Number Ltd' })).toBeNull()
  })
})

describe('CompaniesHouseProvider — unconfigured (no API key), degrades gracefully', () => {
  beforeEach(() => { delete process.env.COMPANIES_HOUSE_API_KEY; global.fetch = vi.fn() })
  afterEach(() => { process.env.COMPANIES_HOUSE_API_KEY = originalEnv; global.fetch = originalFetch })

  it('getCompaniesHouseApiKey returns null when unset', () => {
    expect(getCompaniesHouseApiKey()).toBeNull()
  })

  it('healthCheck reports configured: false, does not call fetch', async () => {
    const health = await CompaniesHouseProvider.healthCheck()
    expect(health.configured).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('search() returns an error result, never throws', async () => {
    const result = await CompaniesHouseProvider.search({ name: 'test' })
    expect(result.records).toEqual([])
    expect(result.error).toMatch(/COMPANIES_HOUSE_API_KEY/)
  })

  it('getCompany() returns null', async () => {
    const record = await CompaniesHouseProvider.getCompany({ companyNumber: '01234567' })
    expect(record).toBeNull()
  })
})

describe('CompaniesHouseProvider — configured', () => {
  beforeEach(() => { process.env.COMPANIES_HOUSE_API_KEY = 'test-key'; global.fetch = vi.fn() })
  afterEach(() => { process.env.COMPANIES_HOUSE_API_KEY = originalEnv; global.fetch = originalFetch })

  it('search() sends Basic Auth with the key as username, blank password', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({ items: [], total_results: 0 }))
    await CompaniesHouseProvider.search({ name: 'test' })
    const opts = (global.fetch as any).mock.calls[0][1]
    expect(opts.headers.Authorization).toBe(`Basic ${Buffer.from('test-key:').toString('base64')}`)
  })

  it('search() with a non-GB countryCode returns empty without spending a real API call', async () => {
    const result = await CompaniesHouseProvider.search({ countryCode: 'US' })
    expect(result.records).toEqual([])
    expect(result.unsupportedFilters).toContain('countryCode')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('search() filters by status client-side after fetching', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({
      items: [
        { title: 'Active Co', company_number: '1', company_status: 'active' },
        { title: 'Dissolved Co', company_number: '2', company_status: 'dissolved' },
      ],
      total_results: 2,
    }))
    const result = await CompaniesHouseProvider.search({ status: 'active' })
    expect(result.records).toHaveLength(1)
    expect(result.records[0].fields.canonicalName).toBe('Active Co')
    expect(result.unsupportedFilters).toContain('status') // server-side unsupported even though client-filtered after
  })

  it('getCompany() requires a companyNumber', async () => {
    const record = await CompaniesHouseProvider.getCompany({ name: 'no number given' })
    expect(record).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('getCompany() fetches the profile endpoint and maps it', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({
      company_name: 'ACME LIMITED', company_number: '01234567', company_status: 'active',
      registered_office_address: { locality: 'London', country: 'United Kingdom' },
    }))
    const record = await CompaniesHouseProvider.getCompany({ companyNumber: '01234567' })
    expect(record?.fields.canonicalName).toBe('ACME LIMITED')
    expect(record?.provenance.sourceProvider).toBe('companies_house')
  })
})

describe('CompaniesHouseProvider.bulkIngest — real file stream, no network', () => {
  let dir: string
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('streams a small CSV and reports accurate counts', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ch-test-'))
    const filePath = join(dir, 'sample.csv')
    writeFileSync(filePath, [
      'CompanyName,CompanyNumber,CompanyStatus,IncorporationDate',
      'ALPHA LTD,00000001,Active,01/01/2015',
      'BETA LTD,00000002,Dissolved,01/01/2010',
      ',,,', // rejected — no name/number
    ].join('\n'))

    const summary = await CompaniesHouseProvider.bulkIngest!({ filePath }, async (records) => ({
      fetched: records.length, parsed: records.length, rejected: 0,
    }))
    expect(summary.totalFetched).toBe(3)
    expect(summary.totalParsed).toBe(2)
    expect(summary.totalRejected).toBe(1)
  })
})

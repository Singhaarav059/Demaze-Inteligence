// ============================================================
// Company Universe — India MCA provider tests
// ============================================================
// This is the lowest-confidence adapter (see its own file header) — these
// tests verify the CODE behaves correctly against the assumed shape, not
// that the assumed shape itself is correct (that needs a real response
// this session's blocked network could not obtain). Multi-alias column
// lookup is specifically covered so a future session correcting a wrong
// column-name guess only has to add an alias, not rewrite logic.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { IndiaMcaProvider, col, mapStatus, rowToFields, getMcaResourceId, getMcaApiKey } from '../lib/company-universe/providers/india-mca'

const originalFetch = global.fetch
const originalResourceId = process.env.MCA_DATA_GOV_RESOURCE_ID
const originalApiKey = process.env.MCA_DATA_GOV_API_KEY
function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body } as unknown as Response
}

describe('col — multi-alias, case/whitespace/underscore-insensitive lookup', () => {
  it('matches regardless of case, spaces, or underscores in the header', () => {
    expect(col({ 'Company Name': 'Acme' }, 'CompanyName')).toBe('Acme')
    expect(col({ company_name: 'Acme' }, 'CompanyName')).toBe('Acme')
    expect(col({ COMPANYNAME: 'Acme' }, 'CompanyName')).toBe('Acme')
  })
  it('tries aliases in order, returns undefined when none match', () => {
    expect(col({ CIN: 'U12345' }, 'CorporateIdentificationNumber', 'CIN')).toBe('U12345')
    expect(col({}, 'CIN')).toBeUndefined()
  })
})

describe('mapStatus', () => {
  it('maps common MCA status text', () => {
    expect(mapStatus('Active')).toBe('active')
    expect(mapStatus('Strike Off')).toBe('dissolved')
    expect(mapStatus('Dormant')).toBe('inactive')
    expect(mapStatus('something unrecognized')).toBe('unknown')
    expect(mapStatus(undefined)).toBe('unknown')
  })
})

describe('rowToFields', () => {
  it('maps a row using the primary assumed column names, always India/IN', () => {
    const fields = rowToFields({
      CIN: 'U12345MH2000PLC000001', CompanyName: 'Acme Industries Private Limited',
      CompanyStatus: 'Active', RegisteredState: 'Maharashtra', DateOfRegistration: '15/03/2000',
    })
    expect(fields?.cin).toBe('U12345MH2000PLC000001')
    expect(fields?.canonicalName).toBe('Acme Industries Private Limited')
    expect(fields?.country).toBe('India')
    expect(fields?.countryCode).toBe('IN')
    expect(fields?.registrationAuthority).toBe('mca_in')
    expect(fields?.status).toBe('active')
    expect(fields?.foundedYear).toBe(2000)
  })

  it('still maps via alias column names if the primary guess is wrong', () => {
    const fields = rowToFields({ CorporateIdentificationNumber: 'U99999', 'Company Master_Name': 'Alias Co' })
    expect(fields?.cin).toBe('U99999')
    expect(fields?.canonicalName).toBe('Alias Co')
  })

  it('returns null when neither CIN nor company name can be found — never manufactures a record', () => {
    expect(rowToFields({ SomeUnrelatedColumn: 'x' })).toBeNull()
  })

  it('never fabricates a revenue value — MCA master data has capital, not revenue', () => {
    const fields = rowToFields({ CIN: 'U1', CompanyName: 'X', AuthorizedCapital: '10000000' })
    expect(fields?.revenue).toBeUndefined()
  })
})

describe('IndiaMcaProvider — unconfigured (missing resource id and/or api key), degrades gracefully', () => {
  beforeEach(() => {
    delete process.env.MCA_DATA_GOV_RESOURCE_ID
    delete process.env.MCA_DATA_GOV_API_KEY
    global.fetch = vi.fn()
  })
  afterEach(() => {
    process.env.MCA_DATA_GOV_RESOURCE_ID = originalResourceId
    process.env.MCA_DATA_GOV_API_KEY = originalApiKey
    global.fetch = originalFetch
  })

  it('getMcaResourceId / getMcaApiKey return null when unset', () => {
    expect(getMcaResourceId()).toBeNull()
    expect(getMcaApiKey()).toBeNull()
  })

  it('healthCheck names the SPECIFIC missing config (resource id vs api key), not a vague error', async () => {
    const health = await IndiaMcaProvider.healthCheck()
    expect(health.configured).toBe(false)
    expect(health.reason).toMatch(/MCA_DATA_GOV_RESOURCE_ID/)
  })

  it('search() and getCompany() both degrade gracefully without calling fetch', async () => {
    const searchResult = await IndiaMcaProvider.search({ countryCode: 'IN' })
    expect(searchResult.records).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()

    const record = await IndiaMcaProvider.getCompany({ cin: 'U12345' })
    expect(record).toBeNull()
  })
})

describe('IndiaMcaProvider — configured', () => {
  beforeEach(() => {
    process.env.MCA_DATA_GOV_RESOURCE_ID = 'test-resource-id'
    process.env.MCA_DATA_GOV_API_KEY = 'test-key'
    global.fetch = vi.fn()
  })
  afterEach(() => {
    process.env.MCA_DATA_GOV_RESOURCE_ID = originalResourceId
    process.env.MCA_DATA_GOV_API_KEY = originalApiKey
    global.fetch = originalFetch
  })

  it('search() with a non-IN countryCode returns empty without spending a real API call', async () => {
    const result = await IndiaMcaProvider.search({ countryCode: 'US' })
    expect(result.records).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('search() reports free-text name as unsupported (the generic resource endpoint has no reliable fuzzy search)', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({ records: [], total: 0 }))
    const result = await IndiaMcaProvider.search({ name: 'Acme', countryCode: 'IN' })
    expect(result.unsupportedFilters).toContain('name')
  })

  it('search() maps returned records and filters by status client-side', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({
      records: [
        { CIN: 'U1', CompanyName: 'Active Co', CompanyStatus: 'Active' },
        { CIN: 'U2', CompanyName: 'Dissolved Co', CompanyStatus: 'Strike Off' },
      ],
      total: 2,
    }))
    const result = await IndiaMcaProvider.search({ countryCode: 'IN', status: 'active' })
    expect(result.records).toHaveLength(1)
    expect(result.records[0].fields.canonicalName).toBe('Active Co')
  })

  it('getCompany() requires a CIN and queries by exact filter', async () => {
    const withoutCin = await IndiaMcaProvider.getCompany({ name: 'no cin given' })
    expect(withoutCin).toBeNull()

    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({ records: [{ CIN: 'U12345', CompanyName: 'Direct Lookup Co' }] }))
    const record = await IndiaMcaProvider.getCompany({ cin: 'U12345' })
    expect(record?.fields.canonicalName).toBe('Direct Lookup Co')
    const url = (global.fetch as any).mock.calls[0][0] as string
    expect(url).toContain('filters%5BCIN%5D=U12345')
  })

  it('has no bulkIngest — the OGD resource API is paginated JSON, not a downloadable bulk file', () => {
    expect(IndiaMcaProvider.capabilities.bulkIngest).toBe(false)
    expect(IndiaMcaProvider.bulkIngest).toBeUndefined()
  })
})

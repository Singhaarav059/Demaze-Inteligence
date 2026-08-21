// ============================================================
// Company Universe — SEC EDGAR provider tests
// ============================================================
// Mocks lib/enrichment/sources/edgar-client.ts's exported ticker-map/
// matcher functions (reused directly by this adapter) and global.fetch for
// the submissions/XBRL companyfacts calls this adapter makes on top of
// that. No live network — SEC's own domains are blocked by this session's
// egress policy anyway (see this file's provider header comment).
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const tickerFixture = [
  { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  { cik_str: 1018724, ticker: 'AMZN', title: 'Amazon.com, Inc.' },
]

vi.mock('@/lib/enrichment/sources/edgar-client', () => ({
  loadTickerMap: vi.fn(async () => tickerFixture),
  userAgent: () => 'Test Agent (test@example.com)',
  matchTicker: vi.fn((name: string, tickers: typeof tickerFixture) => tickers.find(t => t.title.toLowerCase().includes(name.toLowerCase())) ?? null),
  SUBMISSIONS_URL: (cik10: string) => `https://data.sec.gov/submissions/CIK${cik10}.json`,
  FETCH_TIMEOUT_MS: 8000,
}))

import { SecEdgarProvider, tickerToFields } from '../lib/company-universe/providers/sec-edgar'

const originalFetch = global.fetch
function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body } as unknown as Response
}

describe('tickerToFields', () => {
  it('maps a bare ticker entry to canonical fields with cik and unknown status', () => {
    const fields = tickerToFields({ cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' })
    expect(fields.canonicalName).toBe('Apple Inc.')
    expect(fields.cik).toBe('320193')
    expect(fields.status).toBe('unknown')
  })
})

describe('SecEdgarProvider', () => {
  beforeEach(() => { global.fetch = vi.fn() })
  afterEach(() => { global.fetch = originalFetch })

  it('is always configured (no API key required)', async () => {
    const health = await SecEdgarProvider.healthCheck()
    expect(health.configured).toBe(true)
    expect(health.healthy).toBe(true)
  })

  it('search() filters the ticker map by name and reports unsupported filters honestly', async () => {
    const result = await SecEdgarProvider.search({ name: 'apple', industry: 'Manufacturing', employeeCountMin: 100 })
    expect(result.records).toHaveLength(1)
    expect(result.records[0].fields.canonicalName).toBe('Apple Inc.')
    expect(result.appliedFilters).toEqual(['name'])
    expect(result.unsupportedFilters).toContain('industry')
    expect(result.unsupportedFilters).toContain('employeeCount')
  })

  it('search() with no name filter returns everything up to the limit', async () => {
    const result = await SecEdgarProvider.search({ limit: 1 })
    expect(result.records).toHaveLength(1)
    expect(result.totalAvailable).toBe(2)
  })

  it('getCompany() by name fetches submissions and maps industry/location, tolerating a missing XBRL companyfacts response', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce(jsonResponse({
        name: 'Apple Inc.',
        sicDescription: 'Electronic Computers',
        sic: '3571',
        addresses: { business: { city: 'Cupertino', stateOrCountry: 'CA' } },
      }))
      .mockResolvedValueOnce(jsonResponse({}, 404)) // companyfacts miss — must degrade gracefully, not throw

    const record = await SecEdgarProvider.getCompany({ name: 'apple' })
    expect(record).not.toBeNull()
    expect(record?.fields.canonicalName).toBe('Apple Inc.')
    expect(record?.fields.industry).toBe('Electronic Computers')
    expect(record?.fields.sicCodes).toEqual(['3571'])
    expect(record?.fields.city).toBe('Cupertino')
    expect(record?.fields.revenue).toBeUndefined() // companyfacts failed — never manufactured
    expect(record?.provenance.sourceProvider).toBe('sec_edgar')
  })

  it('getCompany() extracts the most recent annual (10-K, FY) revenue from XBRL companyfacts', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce(jsonResponse({ name: 'Apple Inc.' }))
      .mockResolvedValueOnce(jsonResponse({
        facts: {
          'us-gaap': {
            Revenues: {
              units: {
                USD: [
                  { val: 100, form: '10-Q', fp: 'Q1', end: '2025-03-31' }, // quarterly — must be excluded
                  { val: 383000000000, form: '10-K', fp: 'FY', end: '2024-09-30', fy: 2024 },
                  { val: 394000000000, form: '10-K', fp: 'FY', end: '2023-09-30', fy: 2023 },
                ],
              },
            },
          },
        },
      }))
    const record = await SecEdgarProvider.getCompany({ name: 'apple' })
    expect(record?.fields.revenue).toBe(383000000000)
    expect(record?.fields.revenueYear).toBe(2024)
    expect(record?.fields.revenueCurrency).toBe('USD')
  })

  it('getCompany() returns null when nothing matches', async () => {
    const record = await SecEdgarProvider.getCompany({ name: 'totally unknown company xyz' })
    expect(record).toBeNull()
  })

  it('bulkIngest() batches the already-cached ticker map without re-fetching', async () => {
    const batches: number[] = []
    const summary = await SecEdgarProvider.bulkIngest!({}, async (records) => {
      batches.push(records.length)
      return { fetched: records.length, parsed: records.length, rejected: 0 }
    })
    expect(summary.totalFetched).toBe(2)
    expect(summary.totalParsed).toBe(2)
    expect(batches).toEqual([2]) // both fixture tickers fit in one batch (BULK_BATCH_SIZE=500)
  })
})

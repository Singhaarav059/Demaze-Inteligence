// ============================================================
// Company Universe — GLEIF provider tests
// ============================================================
// Mocked global.fetch throughout (api.gleif.org is blocked by this
// session's egress policy anyway). bulkIngest() is tested against a real
// temp CSV file (no network) — this is the one place in the whole
// company-universe suite that exercises an actual file stream, since
// that's real, non-trivial logic (Papa.parse in Node-stream mode,
// batching, backpressure) worth testing directly rather than only via its
// extracted-out pure csvRowToRecord() mapping function.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { GleifProvider, mapStatus, recordToFields, col, csvRowToRecord } from '../lib/company-universe/providers/gleif'
import type { GleifRecord } from '../lib/company-universe/providers/gleif'

const originalFetch = global.fetch
function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body } as unknown as Response
}

describe('mapStatus', () => {
  it('maps GLEIF ACTIVE/INACTIVE, defaults to unknown', () => {
    expect(mapStatus('ACTIVE')).toBe('active')
    expect(mapStatus('INACTIVE')).toBe('inactive')
    expect(mapStatus('MERGED')).toBe('unknown')
    expect(mapStatus(undefined)).toBe('unknown')
  })
})

describe('recordToFields', () => {
  it('maps a real-shaped GLEIF record to canonical fields', () => {
    const record: GleifRecord = {
      type: 'lei-records',
      id: '529900W18LQJJN6SJ336',
      attributes: {
        lei: '529900W18LQJJN6SJ336',
        entity: {
          legalName: { name: 'Example Corp AG' },
          legalAddress: { country: 'DE', city: 'Munich' },
          status: 'ACTIVE',
          legalForm: { other: 'Aktiengesellschaft' },
        },
      },
    }
    const fields = recordToFields(record)
    expect(fields.canonicalName).toBe('Example Corp AG')
    expect(fields.lei).toBe('529900W18LQJJN6SJ336')
    expect(fields.countryCode).toBe('DE')
    expect(fields.status).toBe('active')
  })

  it('falls back to the LEI itself as canonicalName when legalName is missing', () => {
    const fields = recordToFields({ type: 'lei-records', id: 'X', attributes: { lei: 'LEI999' } })
    expect(fields.canonicalName).toBe('LEI999')
  })
})

describe('col (bulk CSV column lookup)', () => {
  it('is case-insensitive and tries aliases in order', () => {
    expect(col({ LEI: 'ABC', 'Entity.LegalName': 'Acme' }, 'lei')).toBe('ABC')
    expect(col({ SomeOtherName: 'val' }, 'Missing', 'SomeOtherName')).toBe('val')
    expect(col({}, 'nope')).toBeUndefined()
  })
})

describe('csvRowToRecord', () => {
  it('maps a real-shaped Golden Copy CSV row', () => {
    const record = csvRowToRecord({ LEI: 'LEI001', 'Entity.LegalName': 'Test Co Ltd', 'Entity.LegalAddress.Country': 'GB', 'Entity.EntityStatus': 'ACTIVE' })
    expect(record?.fields.lei).toBe('LEI001')
    expect(record?.fields.canonicalName).toBe('Test Co Ltd')
    expect(record?.fields.status).toBe('active')
    expect(record?.provenance.sourceType).toBe('bulk')
  })

  it('rejects a row with no LEI or no legal name', () => {
    expect(csvRowToRecord({ LEI: 'LEI001' })).toBeNull()
    expect(csvRowToRecord({ 'Entity.LegalName': 'No LEI Co' })).toBeNull()
  })
})

describe('GleifProvider.search/getCompany/healthCheck', () => {
  beforeEach(() => { global.fetch = vi.fn() })
  afterEach(() => { global.fetch = originalFetch })

  it('healthCheck reports configured: true (no API key required) and healthy on a clean response', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({ data: [] }))
    const health = await GleifProvider.healthCheck()
    expect(health.configured).toBe(true)
    expect(health.healthy).toBe(true)
  })

  it('search() maps countryCode to the ISO filter and reports free-text country as unsupported', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({ data: [], meta: { pagination: { total: 0 } } }))
    const result = await GleifProvider.search({ country: 'Germany' })
    expect(result.unsupportedFilters).toContain('country')
    const calledUrl = (global.fetch as any).mock.calls[0][0] as string
    expect(calledUrl).not.toContain('legalAddress.country')
  })

  it('search() returns mapped records on success', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({
      data: [{ type: 'lei-records', id: 'L1', attributes: { lei: 'L1', entity: { legalName: { name: 'Found Co' }, status: 'ACTIVE' } } }],
      meta: { pagination: { total: 1 } },
    }))
    const result = await GleifProvider.search({ name: 'Found' })
    expect(result.records).toHaveLength(1)
    expect(result.records[0].fields.canonicalName).toBe('Found Co')
    expect(result.appliedFilters).toContain('name')
  })

  it('getCompany() requires a LEI — returns null without one', async () => {
    const record = await GleifProvider.getCompany({ name: 'no lei given' })
    expect(record).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('getCompany() fetches the single-record endpoint by LEI', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({
      data: { type: 'lei-records', id: 'L1', attributes: { lei: 'L1', entity: { legalName: { name: 'Direct Lookup Co' } } } },
    }))
    const record = await GleifProvider.getCompany({ lei: 'L1' })
    expect(record?.fields.canonicalName).toBe('Direct Lookup Co')
  })
})

describe('GleifProvider.bulkIngest — real file stream, no network', () => {
  let dir: string
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('requires a filePath — does not attempt to fetch the multi-hundred-MB Golden Copy itself', async () => {
    const summary = await GleifProvider.bulkIngest!({}, async () => undefined)
    expect(summary.error).toMatch(/filePath/)
  })

  it('streams a small CSV, batches records, and reports accurate counts including rejects', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gleif-test-'))
    const filePath = join(dir, 'sample.csv')
    const rows = [
      'LEI,Entity.LegalName,Entity.LegalAddress.Country,Entity.EntityStatus',
      'LEI001,Alpha Corp,US,ACTIVE',
      'LEI002,Beta Ltd,GB,ACTIVE',
      ',Missing LEI Row,US,ACTIVE', // rejected — no LEI
    ]
    writeFileSync(filePath, rows.join('\n'))

    const batches: number[] = []
    const summary = await GleifProvider.bulkIngest!({ filePath }, async (records) => {
      batches.push(records.length)
      return { fetched: records.length, parsed: records.length, rejected: 0 }
    })

    expect(summary.totalFetched).toBe(3)
    expect(summary.totalParsed).toBe(2)
    expect(summary.totalRejected).toBe(1)
    expect(batches).toEqual([2]) // both valid rows fit under BULK_BATCH_SIZE, flushed once at `complete`
  })
})

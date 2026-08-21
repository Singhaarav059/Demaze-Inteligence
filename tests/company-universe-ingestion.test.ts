// ============================================================
// Company Universe — ingestion pipeline tests
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md Section 10: "Re-run
// safety — running the same ingestion twice must NOT create duplicates."
// This is the single most important property this file verifies, alongside
// the conflict-handling behavior identity.ts's own tests already prove in
// isolation (this file proves the ORCHESTRATION around that decision is
// correct — insert vs. update vs. standalone-on-conflict, source-record
// upsert, provider list accumulation).
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest'
import { FakeUniverseSupabase } from './helpers/fake-supabase-universe'
import { ingestOneRecord, ingestBatch, queryLocalCompanyUniverse, startIngestionRun, finishIngestionRun } from '../lib/company-universe/ingestion'
import type { NormalizedCompanyRecord, CanonicalCompanyFields } from '../lib/company-universe/types'

function record(fields: Partial<CanonicalCompanyFields>, provider: 'gleif' | 'sec_edgar' | 'india_mca' = 'gleif', sourceRecordId = 'rec-1'): NormalizedCompanyRecord {
  return {
    fields: { canonicalName: 'Test Co', status: 'unknown', industryCodes: [], sicCodes: [], naicsCodes: [], ...fields },
    provenance: { sourceProvider: provider, sourceRecordId, sourceType: 'api', retrievedAt: new Date().toISOString(), rawData: { raw: true } },
  }
}

describe('ingestOneRecord — no existing match', () => {
  let supabase: FakeUniverseSupabase
  beforeEach(() => { supabase = new FakeUniverseSupabase() })

  it('inserts a new canonical company with single_source confidence', async () => {
    const result = await ingestOneRecord(supabase as any, record({ lei: 'LEI001', canonicalName: 'Alpha Corp' }))
    expect(result.outcome).toBe('inserted')
    const rows = supabase.table('company_universe')
    expect(rows).toHaveLength(1)
    expect(rows[0].canonical_name).toBe('Alpha Corp')
    expect(rows[0].source_providers).toEqual(['gleif'])
    expect(rows[0].data_confidence).toBe('single_source')
  })

  it('also writes a company_source_records provenance row', async () => {
    await ingestOneRecord(supabase as any, record({ lei: 'LEI001' }, 'gleif', 'gleif-rec-1'))
    const sourceRows = supabase.table('company_source_records')
    expect(sourceRows).toHaveLength(1)
    expect(sourceRows[0].source_provider).toBe('gleif')
    expect(sourceRows[0].source_record_id).toBe('gleif-rec-1')
    expect(sourceRows[0].company_universe_id).toBeDefined()
  })

  it('rejects a record with no canonical name — never manufactures one', async () => {
    const result = await ingestOneRecord(supabase as any, record({ canonicalName: '' }))
    expect(result.outcome).toBe('rejected')
    expect(supabase.table('company_universe')).toHaveLength(0)
  })
})

describe('ingestOneRecord — deterministic match against an existing company', () => {
  let supabase: FakeUniverseSupabase
  beforeEach(() => {
    supabase = new FakeUniverseSupabase()
    supabase.seed('company_universe', [{
      id: 'existing-1', canonical_name: 'Alpha Corp', legal_name: 'Alpha Corporation',
      lei: 'LEI001', cik: null, cin: null, company_number: null, registration_authority: null,
      domain: null, country: null, country_code: null, industry: null,
      industry_codes: [], sic_codes: [], naics_codes: [],
      employee_count: null, employee_count_min: null, employee_count_max: null,
      revenue: 1000, revenue_currency: 'USD', revenue_year: 2023,
      status: 'active', source_providers: ['sec_edgar'], data_confidence: 'single_source',
    }])
  })

  it('updates the existing row instead of inserting a new one', async () => {
    await ingestOneRecord(supabase as any, record({ lei: 'LEI001', canonicalName: 'Alpha Corp' }, 'gleif', 'gleif-1'))
    expect(supabase.table('company_universe')).toHaveLength(1)
  })

  it('appends the new provider to source_providers without duplicating an existing one', async () => {
    await ingestOneRecord(supabase as any, record({ lei: 'LEI001' }, 'gleif', 'gleif-1'))
    const row = supabase.table('company_universe')[0]
    expect(row.source_providers.sort()).toEqual(['gleif', 'sec_edgar'])
  })

  it('upgrades data_confidence to deterministic_id (a real registration-ID match)', async () => {
    await ingestOneRecord(supabase as any, record({ lei: 'LEI001' }, 'gleif', 'gleif-1'))
    expect(supabase.table('company_universe')[0].data_confidence).toBe('deterministic_id')
  })

  it('respects field precedence — SEC EDGAR revenue is not overwritten by a GLEIF record with no revenue field', async () => {
    await ingestOneRecord(supabase as any, record({ lei: 'LEI001' }, 'gleif', 'gleif-1'))
    const row = supabase.table('company_universe')[0]
    expect(row.revenue).toBe(1000) // GLEIF records never carry revenue at all — must survive untouched
  })
})

describe('ingestOneRecord — re-run safety (Section 10)', () => {
  it('ingesting the SAME provider record twice does not create a duplicate canonical company or source record', async () => {
    const supabase = new FakeUniverseSupabase()
    const rec = record({ lei: 'LEI-RERUN', canonicalName: 'Rerun Co' }, 'gleif', 'gleif-rerun-1')

    const first = await ingestOneRecord(supabase as any, rec)
    const second = await ingestOneRecord(supabase as any, rec)

    expect(first.outcome).toBe('inserted')
    expect(second.outcome).toBe('updated') // resolves back to the same canonical company via its own LEI
    expect(first.companyUniverseId).toBe(second.companyUniverseId)
    expect(supabase.table('company_universe')).toHaveLength(1)
    expect(supabase.table('company_source_records')).toHaveLength(1) // upserted, not duplicated
  })
})

describe('ingestOneRecord — identity conflict (Section 12: never guess)', () => {
  it('creates a standalone new company rather than merging into either disputed candidate', async () => {
    const supabase = new FakeUniverseSupabase()
    supabase.seed('company_universe', [
      { id: 'company-a', canonical_name: 'Company A', lei: 'LEI-A', cin: null, cik: null, company_number: null, registration_authority: null, domain: null, status: 'unknown', source_providers: ['gleif'], data_confidence: 'single_source', industry_codes: [], sic_codes: [], naics_codes: [] },
      { id: 'company-b', canonical_name: 'Company B', cin: 'CIN-B', lei: null, cik: null, company_number: null, registration_authority: null, domain: null, status: 'unknown', source_providers: ['india_mca'], data_confidence: 'single_source', industry_codes: [], sic_codes: [], naics_codes: [] },
    ])

    const conflicting = record({ lei: 'LEI-A', cin: 'CIN-B', canonicalName: 'Conflicting Record' }, 'sec_edgar', 'sec-1')
    const result = await ingestOneRecord(supabase as any, conflicting)

    expect(result.outcome).toBe('conflict')
    expect(result.companyUniverseId).not.toBe('company-a')
    expect(result.companyUniverseId).not.toBe('company-b')
    expect(supabase.table('company_universe')).toHaveLength(3) // A, B, and the new standalone record — neither disputed row was touched
  })
})

describe('ingestBatch', () => {
  it('aggregates inserted/updated/rejected counts across a mixed batch', async () => {
    const supabase = new FakeUniverseSupabase()
    const records = [
      record({ lei: 'LEI-1', canonicalName: 'Co One' }, 'gleif', 'g1'),
      record({ lei: 'LEI-2', canonicalName: 'Co Two' }, 'gleif', 'g2'),
      record({ canonicalName: '' }, 'gleif', 'g3'), // invalid — rejected
    ]
    const summary = await ingestBatch(supabase as any, records)
    expect(summary.fetched).toBe(3)
    expect(summary.inserted).toBe(2)
    expect(summary.rejected).toBe(1)
  })
})

describe('queryLocalCompanyUniverse', () => {
  let supabase: FakeUniverseSupabase
  beforeEach(() => {
    supabase = new FakeUniverseSupabase()
    supabase.seed('company_universe', [
      { id: '1', canonical_name: 'India Manufacturer', country_code: 'IN', status: 'active', employee_count: 200, industry: 'Manufacturing', industry_codes: [], sic_codes: ['3711'], naics_codes: [], source_providers: ['india_mca'], data_confidence: 'single_source' },
      { id: '2', canonical_name: 'US Megacorp', country_code: 'US', status: 'active', employee_count: 500_000, industry: 'Technology', industry_codes: [], sic_codes: [], naics_codes: [], source_providers: ['sec_edgar'], data_confidence: 'single_source' },
      { id: '3', canonical_name: 'Dissolved UK Co', country_code: 'GB', status: 'dissolved', employee_count: null, industry: null, industry_codes: [], sic_codes: [], naics_codes: [], source_providers: ['companies_house'], data_confidence: 'single_source' },
    ])
  })

  it('filters by countryCode', async () => {
    const result = await queryLocalCompanyUniverse(supabase as any, { countryCode: 'IN' })
    expect(result).toHaveLength(1)
    expect(result[0].fields.canonicalName).toBe('India Manufacturer')
  })

  it('filters by employee count range', async () => {
    const result = await queryLocalCompanyUniverse(supabase as any, { employeeCountMax: 1000 })
    expect(result.map(r => r.fields.canonicalName)).toEqual(['India Manufacturer'])
  })

  it('filters by status', async () => {
    const result = await queryLocalCompanyUniverse(supabase as any, { status: 'dissolved' })
    expect(result).toHaveLength(1)
    expect(result[0].fields.canonicalName).toBe('Dissolved UK Co')
  })

  it('filters by sic code overlap', async () => {
    const result = await queryLocalCompanyUniverse(supabase as any, { sicCodes: ['3711'] })
    expect(result).toHaveLength(1)
    expect(result[0].fields.canonicalName).toBe('India Manufacturer')
  })
})

describe('startIngestionRun / finishIngestionRun', () => {
  it('creates a run row and finalizes it with accurate counts', async () => {
    const supabase = new FakeUniverseSupabase()
    const runId = await startIngestionRun(supabase as any, 'gleif', 'search')
    expect(runId).not.toBeNull()
    expect(supabase.table('company_universe_ingestion_runs')[0].status).toBe('running')

    await finishIngestionRun(supabase as any, runId, {
      status: 'succeeded', recordsFetched: 10, recordsParsed: 9, recordsRejected: 1,
      recordsInserted: 5, recordsUpdated: 4, recordsDeduplicated: 0,
    })
    const row = supabase.table('company_universe_ingestion_runs')[0]
    expect(row.status).toBe('succeeded')
    expect(row.records_inserted).toBe(5)
    expect(row.completed_at).toBeDefined()
  })
})

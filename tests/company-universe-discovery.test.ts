// ============================================================
// Company Universe — structured discovery orchestration tests
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md Section 17/18:
// "uncertain = unknown, never convert uncertainty into too_large" and
// "prefer deterministic evidence, reject deterministically only when a
// structured source clearly establishes over-scale."
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { qualifyBySizeStructured } from '../lib/company-universe/discovery'
import type { CanonicalCompanyFields } from '../lib/company-universe/types'

function fields(overrides: Partial<CanonicalCompanyFields> = {}): CanonicalCompanyFields {
  return { canonicalName: 'Test Co', status: 'unknown', industryCodes: [], sicCodes: [], naicsCodes: [], ...overrides }
}

describe('qualifyBySizeStructured', () => {
  it('rejects deterministically when employee count clearly exceeds the ICP ceiling', () => {
    const result = qualifyBySizeStructured(fields({ employeeCount: 900_000 }), { employeeCountMax: 5000 })
    expect(result.verdict).toBe('reject')
  })

  it('accepts (insufficient_data, i.e. "continue") when employee count is within range', () => {
    const result = qualifyBySizeStructured(fields({ employeeCount: 200 }), { employeeCountMax: 5000 })
    expect(result.verdict).toBe('insufficient_data')
  })

  it('falls back to employeeCountMin when employeeCount itself is absent', () => {
    const result = qualifyBySizeStructured(fields({ employeeCountMin: 100_000 }), { employeeCountMax: 5000 })
    expect(result.verdict).toBe('reject')
  })

  it('never rejects on missing data — uncertain stays unknown, never "too_large" (Section 17)', () => {
    const result = qualifyBySizeStructured(fields(), { employeeCountMax: 5000, revenueMaxUsd: 1_000_000 })
    expect(result.verdict).toBe('insufficient_data')
  })

  it('rejects deterministically on revenue clearly over the ceiling, USD only', () => {
    const result = qualifyBySizeStructured(fields({ revenue: 50_000_000_000, revenueCurrency: 'USD' }), { revenueMaxUsd: 100_000_000 })
    expect(result.verdict).toBe('reject')
  })

  it('does NOT attempt currency conversion — a non-USD revenue value is left as insufficient_data rather than guessed', () => {
    const result = qualifyBySizeStructured(fields({ revenue: 50_000_000_000, revenueCurrency: 'INR' }), { revenueMaxUsd: 100_000_000 })
    expect(result.verdict).toBe('insufficient_data')
  })

  it('accepts revenue with no explicit currency as USD (canonical schema default)', () => {
    const result = qualifyBySizeStructured(fields({ revenue: 50_000_000_000 }), { revenueMaxUsd: 100_000_000 })
    expect(result.verdict).toBe('reject')
  })

  it('returns insufficient_data when no range is given at all', () => {
    const result = qualifyBySizeStructured(fields({ employeeCount: 900_000 }), {})
    expect(result.verdict).toBe('insufficient_data')
  })
})

// discoverCompaniesStructuredFirst orchestration — mocking its own
// dependencies (ingestion.ts, providers/index.ts) rather than a full
// Supabase fake, since the orchestration LOGIC (when to skip local-
// sufficient queries, when to skip an unconfigured/unhealthy provider) is
// what this suite verifies; the actual DB query behavior is covered by
// ingestion.ts's own test file.
vi.mock('../lib/company-universe/ingestion', () => ({
  queryLocalCompanyUniverse: vi.fn(),
  runProviderSearch: vi.fn(),
}))
vi.mock('../lib/company-universe/providers', () => ({
  ALL_PROVIDERS: [],
}))

import { queryLocalCompanyUniverse, runProviderSearch } from '../lib/company-universe/ingestion'
import { discoverCompaniesStructuredFirst } from '../lib/company-universe/discovery'
import { ALL_PROVIDERS } from '../lib/company-universe/providers'
import type { CompanyDataProvider } from '../lib/company-universe/types'

function mockProvider(overrides: Partial<CompanyDataProvider> = {}): CompanyDataProvider {
  return {
    name: 'gleif',
    displayName: 'Mock',
    capabilities: { search: true, getCompany: true, bulkIngest: false, refresh: true },
    healthCheck: vi.fn(async () => ({ provider: 'gleif' as const, configured: true, healthy: true })),
    search: vi.fn(async () => ({ records: [], appliedFilters: [], unsupportedFilters: [] })),
    getCompany: vi.fn(async () => null),
    ...overrides,
  }
}

describe('discoverCompaniesStructuredFirst', () => {
  const fakeSupabase = {} as any

  beforeEach(() => {
    vi.mocked(queryLocalCompanyUniverse).mockReset()
    vi.mocked(runProviderSearch).mockReset()
    ;(ALL_PROVIDERS as CompanyDataProvider[]).length = 0
  })

  it('short-circuits to local results when the local table already has enough matches', async () => {
    const localRows = Array.from({ length: 5 }, (_, i) => ({
      id: `local-${i}`, fields: fields({ canonicalName: `Co ${i}` }), sourceProviders: ['gleif' as const], dataConfidence: 'single_source',
    }))
    vi.mocked(queryLocalCompanyUniverse).mockResolvedValue(localRows)

    const result = await discoverCompaniesStructuredFirst(fakeSupabase, { name: 'test' })
    expect(result.candidates).toHaveLength(5)
    expect(result.providersQueriedLive).toEqual([])
    expect(queryLocalCompanyUniverse).toHaveBeenCalledTimes(1)
  })

  it('queries live providers when local results are sparse, and skips an unconfigured one with a reason', async () => {
    vi.mocked(queryLocalCompanyUniverse)
      .mockResolvedValueOnce([]) // first call: sparse
      .mockResolvedValueOnce([{ id: 'new-1', fields: fields({ canonicalName: 'New Co' }), sourceProviders: ['gleif' as const], dataConfidence: 'single_source' }]) // refreshed after live search

    const unconfigured = mockProvider({ name: 'opencorporates', healthCheck: vi.fn(async () => ({ provider: 'opencorporates' as const, configured: false, healthy: false, reason: 'OPENCORPORATES_API_TOKEN is not set' })) })
    const healthy = mockProvider({ name: 'gleif' })
    ;(ALL_PROVIDERS as CompanyDataProvider[]).push(unconfigured, healthy)
    vi.mocked(runProviderSearch).mockResolvedValue({ result: { records: [], appliedFilters: [], unsupportedFilters: [] }, summary: { fetched: 0, parsed: 0, inserted: 0, updated: 0, conflicts: 0, rejected: 0 } })

    const result = await discoverCompaniesStructuredFirst(fakeSupabase, { name: 'test' })
    expect(result.providersQueriedLive).toEqual(['gleif'])
    expect(result.providersSkipped).toEqual([{ provider: 'opencorporates', reason: 'OPENCORPORATES_API_TOKEN is not set' }])
    expect(result.candidates).toHaveLength(1)
  })

  it('skips a configured-but-currently-unhealthy provider with its own distinct reason', async () => {
    vi.mocked(queryLocalCompanyUniverse).mockResolvedValue([])
    const unhealthy = mockProvider({ healthCheck: vi.fn(async () => ({ provider: 'gleif' as const, configured: true, healthy: false, reason: 'timeout' })) })
    ;(ALL_PROVIDERS as CompanyDataProvider[]).push(unhealthy)

    const result = await discoverCompaniesStructuredFirst(fakeSupabase, { name: 'test' })
    expect(result.providersSkipped).toEqual([{ provider: 'gleif', reason: 'timeout' }])
    expect(runProviderSearch).not.toHaveBeenCalled()
  })
})

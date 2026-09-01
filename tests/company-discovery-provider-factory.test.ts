// ============================================================
// Company Discovery — Provider Factory + Exa provider tests
// ============================================================
// Covers: provider selection via COMPANY_DISCOVERY_PROVIDER (default
// flipped 'explee' -> 'exa' 2026-09-01, see benchmarks/exa/REPORT.md;
// 'explee' remains fully selectable for rollback), Explee's adapter
// behavior is provably unchanged (same searchExpleeCompanies() call + same
// company fields for a fixed mocked response), Exa's request construction
// (query/category/outputSchema) and response normalization (structured-
// output path + post-filtering + enforced/hinted filter bookkeeping),
// null-honesty (missing industry stays null on both providers, never
// backfilled), and Exa's conservative data-quality post-processing
// (exact-domain dedup, exact-name dedup, generic-name flag, no-own-domain
// flag — annotate-only, never a silent drop for anything ambiguous).
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const searchExpleeCompanies = vi.fn()
vi.mock('@/lib/enrichment/sources/explee-client', async () => {
  const actual = await vi.importActual('@/lib/enrichment/sources/explee-client')
  return {
    ...actual,
    searchExpleeCompanies: (...args: unknown[]) => searchExpleeCompanies(...args),
    getExpleeApiKey: () => 'test-explee-key',
  }
})

const exaSearch = vi.fn()
vi.mock('@/lib/enrichment/sources/exa-client', async () => {
  const actual = await vi.importActual('@/lib/enrichment/sources/exa-client')
  return {
    ...actual,
    exaSearch: (...args: unknown[]) => exaSearch(...args),
    getExaApiKey: () => process.env.EXA_API_KEY || null,
  }
})

import { discoverCompanies, ExpleeCompanyDiscoveryProvider } from '../lib/enrichment/company-discovery-provider-factory'
import { ExaCompanyDiscoveryProvider } from '../lib/enrichment/sources/exa-company-discovery'

describe('company-discovery-provider-factory', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.EXA_API_KEY = 'test-exa-key'
  })
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('defaults to Exa when COMPANY_DISCOVERY_PROVIDER is unset', async () => {
    delete process.env.COMPANY_DISCOVERY_PROVIDER
    exaSearch.mockResolvedValue({
      requestId: 'r1',
      results: [{ id: '1', url: 'https://acme.com', title: 'Acme', publishedDate: null, author: null, image: null, favicon: null }],
      output: { content: { companies: [{ name: 'Acme' }] } },
    })

    const result = await discoverCompanies({ definition: 'manufacturing company' })

    expect(result.providerUsed).toBe('exa')
    expect(exaSearch).toHaveBeenCalled()
    expect(searchExpleeCompanies).not.toHaveBeenCalled()
  })

  it('routes to Exa when COMPANY_DISCOVERY_PROVIDER=exa (explicit, same as default)', async () => {
    process.env.COMPANY_DISCOVERY_PROVIDER = 'exa'
    exaSearch.mockResolvedValue({
      requestId: 'r1',
      results: [{ id: '1', url: 'https://acme.com', title: 'Acme', publishedDate: null, author: null, image: null, favicon: null }],
      output: { content: { companies: [{ name: 'Acme' }] } },
    })

    const result = await discoverCompanies({ definition: 'manufacturing company' })

    expect(result.providerUsed).toBe('exa')
    expect(exaSearch).toHaveBeenCalled()
    expect(searchExpleeCompanies).not.toHaveBeenCalled()
  })

  it('still routes to Explee when COMPANY_DISCOVERY_PROVIDER=explee (rollback path, unchanged)', async () => {
    process.env.COMPANY_DISCOVERY_PROVIDER = 'explee'
    searchExpleeCompanies.mockResolvedValue({
      companies: [{ name: 'Acme', domain: 'acme.com' }],
      meta: { total: 1, results_count: 1, credits_charged: 1, remaining_balance: 99 },
    })

    const result = await discoverCompanies({ definition: 'manufacturing company' })

    expect(result.providerUsed).toBe('explee')
    expect(searchExpleeCompanies).toHaveBeenCalled()
    expect(exaSearch).not.toHaveBeenCalled()
  })

  it('falls back to Explee for an unknown provider name', async () => {
    process.env.COMPANY_DISCOVERY_PROVIDER = 'not-a-real-provider'
    searchExpleeCompanies.mockResolvedValue({ companies: [], meta: { total: 0, results_count: 0, credits_charged: 0, remaining_balance: 100 } })

    const result = await discoverCompanies({ definition: 'automotive company' })
    expect(result.providerUsed).toBe('explee')
  })

  it('throws a clear error when the selected provider has no API key', async () => {
    process.env.COMPANY_DISCOVERY_PROVIDER = 'exa'
    delete process.env.EXA_API_KEY

    await expect(discoverCompanies({ definition: 'automotive company' })).rejects.toThrow(/Exa is not available/)
  })

  describe('ExpleeCompanyDiscoveryProvider (adapter) — unchanged behavior', () => {
    it('passes filters through to searchExpleeCompanies() untouched, page/pageSize stripped out', async () => {
      searchExpleeCompanies.mockResolvedValue({
        companies: [{ name: 'Acme', domain: 'acme.com', url: 'https://acme.com', description: 'desc', industry: 'Manufacturing', geo: 'IN', geo_city: 'Pune', size: 100, founded: 2001, revenue_annual: 5_000_000, funding_stage: null, linkedin_id: 12345 }],
        meta: { total: 1, results_count: 1, credits_charged: 1, remaining_balance: 99 },
      })

      const result = await ExpleeCompanyDiscoveryProvider.discoverCompanies({
        definition: 'manufacturing company',
        geo_include: ['IN'],
        size: { min: 50, max: 200 },
        page: 2,
        pageSize: 10,
      })

      expect(searchExpleeCompanies).toHaveBeenCalledWith(
        { definition: 'manufacturing company', geo_include: ['IN'], size: { min: 50, max: 200 } },
        10,
        2,
      )
      // Same company fields Explee returned, plus only a `provider` tag —
      // nothing renamed, dropped, or fabricated.
      expect(result.companies).toEqual([
        { name: 'Acme', domain: 'acme.com', url: 'https://acme.com', description: 'desc', industry: 'Manufacturing', geo: 'IN', geo_city: 'Pune', size: 100, founded: 2001, revenue_annual: 5_000_000, funding_stage: null, linkedin_id: 12345, provider: 'explee' },
      ])
      expect(result.meta).toEqual({ total: 1, results_count: 1, credits_charged: 1, remaining_balance: 99 })
      expect(result.enforcedFilters.sort()).toEqual(['definition', 'geo_include', 'size'])
      expect(result.hintedFilters).toEqual([])
    })

    it('preserves a null industry from Explee rather than inventing one', async () => {
      searchExpleeCompanies.mockResolvedValue({
        companies: [{ name: 'NoIndustry Co', domain: 'noindustry.com', url: null, description: null, industry: null, geo: null, geo_city: null, size: null, founded: null, revenue_annual: null, funding_stage: null, linkedin_id: null }],
        meta: { total: 1, results_count: 1, credits_charged: 1, remaining_balance: 99 },
      })

      const result = await ExpleeCompanyDiscoveryProvider.discoverCompanies({ definition: 'manufacturing company' })
      expect(result.companies[0].industry).toBeNull()
    })
  })

  describe('ExaCompanyDiscoveryProvider', () => {
    it('builds a natural-language query with category:company and an outputSchema', async () => {
      exaSearch.mockResolvedValue({ requestId: 'r1', results: [], output: { content: { companies: [] } } })

      await ExaCompanyDiscoveryProvider.discoverCompanies({
        definition: 'manufacturing company',
        geo_include: ['IN'],
        is_saas: true,
      })

      expect(exaSearch).toHaveBeenCalledTimes(1)
      const [params] = exaSearch.mock.calls[0]
      expect(params.category).toBe('company')
      expect(params.query).toContain('manufacturing company')
      expect(params.query).toContain('IN')
      expect(params.query).toContain('SaaS')
      expect(params.outputSchema).toBeDefined()
    })

    // Company records come primarily from Exa's native results[].entities
    // (directly extracted, confirmed live 2026-09-01), not outputSchema
    // synthesis alone — synthesis is only merged in for the handful of
    // fields the entity doesn't carry (industry/funding_stage/linkedin_url).
    function companyResult(url: string, props: Record<string, unknown>) {
      return {
        id: url,
        url,
        title: (props.name as string) ?? null,
        publishedDate: null,
        author: null,
        image: null,
        favicon: null,
        entities: [{ id: url, type: 'company', properties: props }],
      }
    }

    it('normalizes native entity data into company records, nulling out anything not returned', async () => {
      exaSearch.mockResolvedValue({
        requestId: 'r1',
        results: [companyResult('https://acmerobotics.com', { name: 'Acme Robotics', workforce: { total: 120 } })],
        output: { content: { companies: [] } },
      })

      const result = await ExaCompanyDiscoveryProvider.discoverCompanies({ definition: 'robotics company' })

      expect(result.companies).toHaveLength(1)
      const c = result.companies[0]
      expect(c.name).toBe('Acme Robotics')
      expect(c.domain).toBe('acmerobotics.com')
      expect(c.size).toBe(120)
      // Never fabricated — Exa didn't return these, so they stay null.
      expect(c.industry).toBeNull()
      expect(c.revenue_annual).toBeNull()
      expect(c.founded).toBeNull()
      expect(c.provider).toBe('exa')
      expect(c.source_urls).toEqual(['https://acmerobotics.com'])
    })

    it('merges outputSchema-synthesized industry into an entity-derived company by domain match', async () => {
      exaSearch.mockResolvedValue({
        requestId: 'r1',
        results: [companyResult('https://acmerobotics.com', { name: 'Acme Robotics' })],
        output: { content: { companies: [{ name: 'Acme Robotics', domain: 'acmerobotics.com', industry: 'Robotics' }] } },
      })

      const result = await ExaCompanyDiscoveryProvider.discoverCompanies({ definition: 'robotics company' })
      expect(result.companies[0].industry).toBe('Robotics')
    })

    it('resolves a requested ISO geo code against Exa\'s full-name headquarters.country', async () => {
      // Regression test for a live bug: comparing 'IN' directly against
      // Exa's native "India" silently dropped every real match.
      exaSearch.mockResolvedValue({
        requestId: 'r1',
        results: [companyResult('https://indianco.com', { name: 'Indian Co', headquarters: { country: 'India' } })],
        output: { content: { companies: [] } },
      })

      const result = await ExaCompanyDiscoveryProvider.discoverCompanies({
        definition: 'manufacturing company',
        geo_include: ['IN'],
      })

      expect(result.companies.map(c => c.name)).toEqual(['Indian Co'])
      expect(result.enforcedFilters).toContain('geo_include')
    })

    it('a result with no company entity is dropped, not guessed from title/url', async () => {
      exaSearch.mockResolvedValue({
        requestId: 'r1',
        results: [{ id: '1', url: 'https://no-entity.example.com', title: 'Some Page', publishedDate: null, author: null, image: null, favicon: null }],
        output: { content: { companies: [] } },
      })

      const result = await ExaCompanyDiscoveryProvider.discoverCompanies({ definition: 'manufacturing company' })
      expect(result.companies).toEqual([])
    })

    it('post-filters on a structured field Exa actually returned and marks it enforced', async () => {
      exaSearch.mockResolvedValue({
        requestId: 'r1',
        results: [
          companyResult('https://toosmall.example.com', { name: 'TooSmall Co', workforce: { total: 5 } }),
          companyResult('https://inrange.example.com', { name: 'InRange Co', workforce: { total: 150 } }),
          companyResult('https://nosizereported.example.com', { name: 'NoSizeReported Co' }),
        ],
        output: { content: { companies: [] } },
      })

      const result = await ExaCompanyDiscoveryProvider.discoverCompanies({
        definition: 'manufacturing company',
        size: { min: 50, max: 500 },
      })

      const names = result.companies.map(c => c.name)
      // TooSmall Co is excluded (structured value present, out of range);
      // NoSizeReported Co is kept (nothing to enforce against, not a
      // confirmed match, just not excluded).
      expect(names).toEqual(['InRange Co', 'NoSizeReported Co'])
      expect(result.enforcedFilters).toContain('size')
    })

    it('folds boolean flags into hintedFilters only, never enforcedFilters', async () => {
      exaSearch.mockResolvedValue({ requestId: 'r1', results: [], output: { content: { companies: [] } } })

      const result = await ExaCompanyDiscoveryProvider.discoverCompanies({
        definition: 'manufacturing company',
        is_b2b: true,
        is_saas: true,
      })

      expect(result.hintedFilters).toEqual(expect.arrayContaining(['definition', 'is_b2b', 'is_saas']))
      expect(result.enforcedFilters).not.toContain('is_b2b')
      expect(result.enforcedFilters).not.toContain('is_saas')
    })

    it('isAvailable reflects whether EXA_API_KEY is set', async () => {
      process.env.EXA_API_KEY = 'key'
      expect(await ExaCompanyDiscoveryProvider.isAvailable()).toBe(true)
      delete process.env.EXA_API_KEY
      expect(await ExaCompanyDiscoveryProvider.isAvailable()).toBe(false)
    })

    // Conservative, deterministic post-processing (benchmarks/exa/REPORT.md
    // sections 1-3) — no relevance threshold, no scoring, no blacklist.
    describe('data-quality post-processing', () => {
      it('drops an exact-domain duplicate, keeping the first', async () => {
        exaSearch.mockResolvedValue({
          requestId: 'r1',
          results: [
            companyResult('https://acme.com', { name: 'Acme Robotics' }),
            companyResult('https://www.acme.com/about', { name: 'Acme Robotics Inc.' }),
          ],
          output: { content: { companies: [] } },
        })

        const result = await ExaCompanyDiscoveryProvider.discoverCompanies({ definition: 'robotics company' })
        expect(result.companies).toHaveLength(1)
        expect(result.companies[0].name).toBe('Acme Robotics')
      })

      it('drops an exact-normalized-name duplicate even with different (or missing) domains', async () => {
        exaSearch.mockResolvedValue({
          requestId: 'r1',
          results: [
            companyResult('https://acme-robotics.com', { name: 'Acme Robotics Pvt. Ltd.' }),
            companyResult('https://acme-robotics.io', { name: 'Acme Robotics' }),
          ],
          output: { content: { companies: [] } },
        })

        const result = await ExaCompanyDiscoveryProvider.discoverCompanies({ definition: 'robotics company' })
        expect(result.companies).toHaveLength(1)
        expect(result.companies[0].domain).toBe('acme-robotics.com')
      })

      it('flags a generic name echoed in the query definition, but keeps it in the results', async () => {
        exaSearch.mockResolvedValue({
          requestId: 'r1',
          results: [companyResult('https://linkedin.com/company/e-commerce', { name: 'e-Commerce' })],
          output: { content: { companies: [] } },
        })

        const result = await ExaCompanyDiscoveryProvider.discoverCompanies({ definition: 'e-commerce companies' })
        expect(result.companies).toHaveLength(1)
        expect(result.companies[0].dataQualityFlags).toContain('generic_name')
      })

      it('flags a platform-only URL (no own domain), but keeps it in the results', async () => {
        exaSearch.mockResolvedValue({
          requestId: 'r1',
          results: [companyResult('https://www.linkedin.com/company/some-real-company', { name: 'Some Real Company' })],
          output: { content: { companies: [] } },
        })

        const result = await ExaCompanyDiscoveryProvider.discoverCompanies({ definition: 'manufacturing company' })
        expect(result.companies).toHaveLength(1)
        expect(result.companies[0].dataQualityFlags).toContain('no_own_domain')
      })

      it('preserves an ambiguous-but-not-exactly-duplicate company untouched, with no flags — "when in doubt, keep it"', async () => {
        exaSearch.mockResolvedValue({
          requestId: 'r1',
          results: [
            companyResult('https://neogenchemicals.com', { name: 'Neogen Chemicals' }),
            companyResult('https://neogen.com', { name: 'Neogen Corporation' }),
          ],
          output: { content: { companies: [] } },
        })

        const result = await ExaCompanyDiscoveryProvider.discoverCompanies({ definition: 'chemicals company' })
        expect(result.companies).toHaveLength(2)
        expect(result.companies.every(c => !c.dataQualityFlags)).toBe(true)
      })
    })
  })
})

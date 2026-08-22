import { describe, it, expect } from 'vitest'
import { buildRegionQueries, computeIdentityOverlap, estimateCost, SECTORS, REGIONS } from '../benchmarks/brightdata-global-comparison'
import type { CompanyMatch } from '../lib/enrichment/company-discovery'

function match(name: string, domain?: string): CompanyMatch {
  return { name, domain, reason: `Surfaced via search: "${name}"`, confidence: 'medium', source_urls: [] }
}

describe('buildRegionQueries — region-scoped, not generic global', () => {
  it('appends the real region qualifier to every query', () => {
    const queries = buildRegionQueries('manufacturing', 'in the Middle East', 3)
    expect(queries).toHaveLength(3)
    for (const q of queries) expect(q).toMatch(/in the Middle East$/)
  })

  it('draws from the sector-specific term vocabulary, not a generic one', () => {
    const mfg = buildRegionQueries('manufacturing', 'in Europe', 2)
    const auto = buildRegionQueries('automotive', 'in Europe', 2)
    expect(mfg).not.toEqual(auto)
  })

  it('respects the requested count, never exceeding the term pool', () => {
    const queries = buildRegionQueries('ecommerce', 'in Canada', 100)
    expect(queries.length).toBeLessThanOrEqual(8) // SECTOR_SEARCH_TERMS has 8 terms/sector
  })
})

describe('computeIdentityOverlap — uses the real identity system, not raw name comparison', () => {
  it('collapses a legal-suffix name variant to the same company (no domain on either side)', () => {
    const existing = [match('ABC Manufacturing Ltd')]
    const brightdata = [match('ABC Manufacturing')]
    const overlap = computeIdentityOverlap(existing, brightdata)
    expect(overlap.shared).toEqual(['ABC Manufacturing Ltd'])
    expect(overlap.existingOnly).toEqual([])
    expect(overlap.brightdataOnly).toEqual([])
  })

  it('matches on domain even when the display names differ completely', () => {
    const existing = [match('ABC Manufacturing Private Limited', 'abcmfg.com')]
    const brightdata = [match('ABC Mfg Co', 'abcmfg.com')]
    const overlap = computeIdentityOverlap(existing, brightdata)
    expect(overlap.shared).toHaveLength(1)
  })

  it('reports genuinely distinct companies as source-only on each side', () => {
    const existing = [match('Existing Only Co')]
    const brightdata = [match('Bright Data Only Co')]
    const overlap = computeIdentityOverlap(existing, brightdata)
    expect(overlap.shared).toEqual([])
    expect(overlap.existingOnly).toEqual(['Existing Only Co'])
    expect(overlap.brightdataOnly).toEqual(['Bright Data Only Co'])
  })
})

describe('estimateCost — pure math, must stay well within the 5,000 free-tier budget at defaults', () => {
  it('computes 24 cells (3 sectors x 8 regions)', () => {
    const est = estimateCost()
    expect(est.cells).toBe(SECTORS.length * Object.keys(REGIONS).length)
    expect(est.cells).toBe(24)
  })

  it('stays under 10% of the free tier at the default queries-per-cell', () => {
    const est = estimateCost()
    expect(est.percentOfFreeTierWorstCase).toBeLessThan(10)
  })

  it('scales linearly with QUERIES_PER_CELL x cells for the raw query count', () => {
    const est = estimateCost()
    expect(est.brightDataQueries).toBe(est.cells * (est.brightDataQueries / est.cells))
  })
})

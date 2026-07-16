// ============================================================
// Demaze Leads — aggregateLeadsAcrossSegments()
// ============================================================
// Covers the pure aggregation logic in lib/enrichment/demaze-leads.ts: one
// company surfaced under multiple ICP segments collapses to one row keeping
// every segment name, the higher-confidence variant wins on conflict, and
// identity uses domain when present, name otherwise (mirrors
// filterAlreadyResearched()'s own identity discipline in company-discovery.ts).

import { describe, it, expect } from 'vitest'
import { aggregateLeadsAcrossSegments } from '../lib/enrichment/demaze-leads'
import type { CompanyMatch } from '../lib/enrichment/company-discovery'

function match(overrides: Partial<CompanyMatch>): CompanyMatch {
  return {
    name: 'Acme Corp',
    reason: 'test reason',
    confidence: 'medium',
    source_urls: ['https://example.com'],
    ...overrides,
  }
}

describe('aggregateLeadsAcrossSegments', () => {
  it('keeps one entry per unique company', () => {
    const result = aggregateLeadsAcrossSegments([
      { segmentName: 'oil and gas', companies: [match({ name: 'Acme Corp' })] },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].segments).toEqual(['oil and gas'])
  })

  it('merges the same company (by domain) across multiple segments into one row with all segment names', () => {
    const result = aggregateLeadsAcrossSegments([
      { segmentName: 'oil and gas', companies: [match({ name: 'Acme Corp', domain: 'acme.com' })] },
      { segmentName: 'manufacturing', companies: [match({ name: 'Acme Corp', domain: 'acme.com' })] },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].segments).toEqual(['oil and gas', 'manufacturing'])
  })

  it('merges the same company (by normalized name) across segments when no domain is present', () => {
    const result = aggregateLeadsAcrossSegments([
      { segmentName: 'oil and gas', companies: [match({ name: 'Acme Corp' })] },
      { segmentName: 'manufacturing', companies: [match({ name: 'ACME CORP' })] },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].segments).toEqual(['oil and gas', 'manufacturing'])
  })

  it('does not merge two different companies', () => {
    const result = aggregateLeadsAcrossSegments([
      { segmentName: 'oil and gas', companies: [match({ name: 'Acme Corp' })] },
      { segmentName: 'manufacturing', companies: [match({ name: 'Widget Inc' })] },
    ])
    expect(result).toHaveLength(2)
  })

  it('keeps the higher-confidence variant on conflict', () => {
    const result = aggregateLeadsAcrossSegments([
      { segmentName: 'oil and gas', companies: [match({ name: 'Acme Corp', domain: 'acme.com', confidence: 'medium', domain_confidence: 'medium' })] },
      { segmentName: 'manufacturing', companies: [match({ name: 'Acme Corp', domain: 'acme.com', confidence: 'high', domain_confidence: 'high' })] },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].confidence).toBe('high')
  })

  it('does not downgrade from a higher-confidence variant seen first', () => {
    const result = aggregateLeadsAcrossSegments([
      { segmentName: 'oil and gas', companies: [match({ name: 'Acme Corp', domain: 'acme.com', confidence: 'high' })] },
      { segmentName: 'manufacturing', companies: [match({ name: 'Acme Corp', domain: 'acme.com', confidence: 'low' })] },
    ])
    expect(result[0].confidence).toBe('high')
  })

  it('sorts by confidence, then by segment count', () => {
    const result = aggregateLeadsAcrossSegments([
      { segmentName: 'a', companies: [match({ name: 'Low Co', confidence: 'low' })] },
      { segmentName: 'a', companies: [match({ name: 'High Once', confidence: 'high' })] },
      { segmentName: 'b', companies: [match({ name: 'High Twice', confidence: 'high' })] },
      { segmentName: 'a', companies: [match({ name: 'High Twice', confidence: 'high' })] },
    ])
    expect(result.map(r => r.name)).toEqual(['High Twice', 'High Once', 'Low Co'])
  })

  it('returns an empty array when nothing was found in any segment', () => {
    expect(aggregateLeadsAcrossSegments([{ segmentName: 'oil and gas', companies: [] }])).toEqual([])
  })
})

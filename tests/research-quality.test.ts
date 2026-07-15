// ============================================================
// Research Quality Framework — auditResearchQuality()
// ============================================================
// Covers the three checks documented in lib/pipeline/research-quality.ts:
// evidence_subject_mismatch, single_mention_high_confidence, and
// self_name_collision. Purely informational/pure-function — no network, no
// LLM, so this is a full unit-test surface, unlike the discovery modules'
// extraction-only coverage.

import { describe, it, expect } from 'vitest'
import { auditResearchQuality } from '../lib/pipeline/research-quality'
import type { NormalizedAnalysis, EvidenceItem } from '../lib/pipeline/normalize'

// Minimal stub covering only the fields auditResearchQuality actually reads.
// Cast through unknown since a full NormalizedAnalysis literal would need
// every field on the interface — the audit function itself only touches
// company_name/evidence/opportunities/pain_points_structured/competitors/
// icp_segments.
function stub(overrides: Partial<NormalizedAnalysis>): NormalizedAnalysis {
  return {
    company_name: 'Ador Welding',
    evidence: [],
    opportunities: [],
    pain_points_structured: [],
    competitors: [],
    icp_segments: [],
    ...overrides,
  } as unknown as NormalizedAnalysis
}

function ev(id: string, subject: EvidenceItem['subject']): EvidenceItem {
  return { id, subject, category: 'test', quote: 'test quote', source_page: 'https://example.com' }
}

describe('auditResearchQuality — evidence_subject_mismatch', () => {
  it('flags a high-confidence opportunity whose evidence is product_capability', () => {
    const normalized = stub({
      evidence: [ev('ev1', 'product_capability')],
      opportunities: [{
        title: 'Predictive Maintenance AI',
        description: '', relevance: 'High', evidence_id: 'ev1',
        opportunity_confidence: 'high',
      }] as unknown as NormalizedAnalysis['opportunities'],
    })
    const result = auditResearchQuality(normalized)
    expect(result.flags).toHaveLength(1)
    expect(result.flags[0]).toMatchObject({
      item_type: 'opportunity',
      item_ref: 'Predictive Maintenance AI',
      flag: 'evidence_subject_mismatch',
      severity: 'warn',
    })
    expect(result.items_audited).toBe(1)
    expect(result.items_flagged).toBe(1)
  })

  it('does not flag a low/medium-confidence opportunity with product_capability evidence', () => {
    const normalized = stub({
      evidence: [ev('ev1', 'product_capability')],
      opportunities: [{
        title: 'Some Opportunity', description: '', relevance: 'Medium',
        evidence_id: 'ev1', opportunity_confidence: 'medium',
      }] as unknown as NormalizedAnalysis['opportunities'],
    })
    expect(auditResearchQuality(normalized).flags).toHaveLength(0)
  })

  it('does not flag a high-confidence opportunity whose evidence is company_operations', () => {
    const normalized = stub({
      evidence: [ev('ev1', 'company_operations')],
      opportunities: [{
        title: 'Real Opportunity', description: '', relevance: 'High',
        evidence_id: 'ev1', opportunity_confidence: 'high',
      }] as unknown as NormalizedAnalysis['opportunities'],
    })
    expect(auditResearchQuality(normalized).flags).toHaveLength(0)
  })

  it('flags a high-confidence structured pain point whose evidence is product_capability', () => {
    const normalized = stub({
      evidence: [ev('ev2', 'product_capability')],
      pain_points_structured: [{
        title: 'Fake Pain', confidence: 'high', evidence_id: 'ev2',
        evidence: '', reasoning: '',
      }],
    })
    const result = auditResearchQuality(normalized)
    expect(result.flags).toHaveLength(1)
    expect(result.flags[0].item_type).toBe('pain_point')
    expect(result.flags[0].flag).toBe('evidence_subject_mismatch')
  })

  it('skips opportunities/pain points with no evidence_id', () => {
    const normalized = stub({
      opportunities: [{ title: 'No Evidence', description: '', relevance: 'High' }] as unknown as NormalizedAnalysis['opportunities'],
      pain_points_structured: [{ title: 'No Evidence Pain', confidence: 'high', evidence_id: '', evidence: '', reasoning: '' }],
    })
    const result = auditResearchQuality(normalized)
    expect(result.flags).toHaveLength(0)
    expect(result.items_audited).toBe(0)
  })
})

describe('auditResearchQuality — single_mention_high_confidence', () => {
  it('flags a high-confidence competitor with only 1 source URL', () => {
    const normalized = stub({
      competitors: [{
        name: 'ESAB', why_they_compete: 'x', confidence: 'high', source_urls: ['https://a.com'],
      }],
    })
    const result = auditResearchQuality(normalized)
    expect(result.flags).toHaveLength(1)
    expect(result.flags[0]).toMatchObject({
      item_type: 'competitor',
      item_ref: 'ESAB',
      flag: 'single_mention_high_confidence',
    })
  })

  it('does not flag a high-confidence competitor with 2+ source URLs', () => {
    const normalized = stub({
      competitors: [{
        name: 'ESAB', why_they_compete: 'x', confidence: 'high',
        source_urls: ['https://a.com', 'https://b.com'],
      }],
    })
    expect(auditResearchQuality(normalized).flags).toHaveLength(0)
  })

  it('does not flag a medium-confidence competitor with only 1 source URL', () => {
    const normalized = stub({
      competitors: [{
        name: 'ESAB', why_they_compete: 'x', confidence: 'medium', source_urls: ['https://a.com'],
      }],
    })
    expect(auditResearchQuality(normalized).flags).toHaveLength(0)
  })

  it('flags a high-confidence ICP segment with only 1 source URL', () => {
    const normalized = stub({
      icp_segments: [{
        name: 'oil and gas', reason: 'x', signals: [], confidence: 'high', source_urls: ['https://a.com'],
      }],
    })
    const result = auditResearchQuality(normalized)
    expect(result.flags).toHaveLength(1)
    expect(result.flags[0]).toMatchObject({
      item_type: 'icp_segment',
      item_ref: 'oil and gas',
      flag: 'single_mention_high_confidence',
    })
  })
})

describe('auditResearchQuality — self_name_collision', () => {
  it('flags a competitor whose name matches the researched company', () => {
    const normalized = stub({
      company_name: 'Ace Pipeline',
      competitors: [{
        name: 'Ace Pipeline', why_they_compete: 'x', confidence: 'medium',
        source_urls: ['https://a.com', 'https://b.com'],
      }],
    })
    const result = auditResearchQuality(normalized)
    expect(result.flags).toHaveLength(1)
    expect(result.flags[0]).toMatchObject({
      item_type: 'competitor',
      item_ref: 'Ace Pipeline',
      flag: 'self_name_collision',
    })
  })

  it('flags an ICP segment whose name matches the researched company (domain-derived collision)', () => {
    const normalized = stub({
      company_name: 'Acepipeline',
      icp_segments: [{
        name: 'Ace Pipeline', reason: 'x', signals: [], confidence: 'medium',
        source_urls: ['https://a.com', 'https://b.com'],
      }],
    })
    const result = auditResearchQuality(normalized)
    expect(result.flags).toHaveLength(1)
    expect(result.flags[0].flag).toBe('self_name_collision')
  })

  it('does not flag a genuinely different competitor name', () => {
    const normalized = stub({
      company_name: 'Ace Pipeline',
      competitors: [{
        name: 'Bechtel', why_they_compete: 'x', confidence: 'medium',
        source_urls: ['https://a.com', 'https://b.com'],
      }],
    })
    expect(auditResearchQuality(normalized).flags).toHaveLength(0)
  })

  it('a competitor can be flagged for both single-mention and self-name at once', () => {
    const normalized = stub({
      company_name: 'Ace Pipeline',
      competitors: [{
        name: 'Ace Pipeline', why_they_compete: 'x', confidence: 'high', source_urls: ['https://a.com'],
      }],
    })
    const result = auditResearchQuality(normalized)
    expect(result.flags).toHaveLength(2)
    expect(result.items_audited).toBe(1)
    expect(result.items_flagged).toBe(1)  // one item, two flags — items_flagged counts distinct items
  })
})

describe('auditResearchQuality — items_audited/items_flagged accounting', () => {
  it('audits every eligible item across all categories, flags only real hits', () => {
    const normalized = stub({
      company_name: 'Ador Welding',
      evidence: [ev('ev1', 'product_capability'), ev('ev2', 'company_operations')],
      opportunities: [
        { title: 'Bad', description: '', relevance: 'High', evidence_id: 'ev1', opportunity_confidence: 'high' },
        { title: 'Good', description: '', relevance: 'High', evidence_id: 'ev2', opportunity_confidence: 'high' },
      ] as unknown as NormalizedAnalysis['opportunities'],
      competitors: [
        { name: 'ESAB', why_they_compete: 'x', confidence: 'high', source_urls: ['https://a.com', 'https://b.com'] },
        { name: 'CenterLine', why_they_compete: 'x', confidence: 'high', source_urls: ['https://a.com'] },
      ],
      icp_segments: [
        { name: 'shipbuilding', reason: 'x', signals: [], confidence: 'medium', source_urls: ['https://a.com'] },
      ],
    })
    const result = auditResearchQuality(normalized)
    expect(result.items_audited).toBe(5)  // 2 opportunities + 2 competitors + 1 icp segment
    expect(result.items_flagged).toBe(2)  // 'Bad' opportunity + 'CenterLine'
    expect(result.flags.map(f => f.item_ref).sort()).toEqual(['Bad', 'CenterLine'])
  })

  it('returns zero flags/audits for an empty analysis', () => {
    const result = auditResearchQuality(stub({}))
    expect(result).toEqual({ flags: [], items_audited: 0, items_flagged: 0 })
  })
})

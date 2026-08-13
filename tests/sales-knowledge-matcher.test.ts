import { describe, it, expect } from 'vitest'
import { matchSalesIntelligence } from '@/lib/sales-knowledge/matcher'
import type { SalesKnowledgeBundle, SalesKnowledgeIndustry, SalesKnowledgeProblem, SalesKnowledgeCapability, SalesKnowledgeCaseStudy } from '@/lib/sales-knowledge/types'

function industry(overrides: Partial<SalesKnowledgeIndustry> = {}): SalesKnowledgeIndustry {
  return {
    id: 'ind-1', slug: 'manufacturing', label: 'Manufacturing', description: null,
    keywords: ['manufacturer', 'factory'], is_active: true,
    created_at: '', updated_at: '', ...overrides,
  }
}

function problem(overrides: Partial<SalesKnowledgeProblem> = {}): SalesKnowledgeProblem {
  return {
    id: 'prob-1', slug: 'no-hq-visibility', label: 'HQ lacks visibility into distributed operations', description: null,
    industry_tags: ['manufacturing'], evidence_keywords: ['multiple facilities', 'monthly reports'],
    capability_tags: ['internal-operational-software'], is_active: true,
    created_at: '', updated_at: '', ...overrides,
  }
}

function capability(overrides: Partial<SalesKnowledgeCapability> = {}): SalesKnowledgeCapability {
  return {
    id: 'cap-1', slug: 'internal-operational-software', label: 'Internal operational software', description: null,
    positioning_template: 'A custom internal operations platform for {{company}}.',
    recommended_roles: ['COO', 'VP Operations'], recommended_cta: 'Worth a quick look?',
    is_active: true, created_at: '', updated_at: '', ...overrides,
  }
}

function caseStudy(overrides: Partial<SalesKnowledgeCaseStudy> = {}): SalesKnowledgeCaseStudy {
  return {
    id: 'cs-1', title: 'Factory AI Command Center', client: 'Composite: a manufacturer', provenance: 'composite_illustrative',
    industry_tags: ['manufacturing'], capability_tags: ['internal-operational-software'],
    challenge: 'No cross-plant visibility.', outcomes: [{ metric: 'OEE', value: '+9%' }], source_doc: null,
    is_active: true, created_at: '', updated_at: '', ...overrides,
  }
}

function bundle(overrides: Partial<SalesKnowledgeBundle> = {}): SalesKnowledgeBundle {
  return {
    industries: [industry()],
    problems: [problem()],
    capabilities: [capability()],
    caseStudies: [caseStudy()],
    ...overrides,
  }
}

describe('matchSalesIntelligence', () => {
  it('returns an empty match when the knowledge bundle has no problems/capabilities', () => {
    const result = matchSalesIntelligence({}, { industries: [], problems: [], capabilities: [], caseStudies: [] })
    expect(result.problem).toBeNull()
    expect(result.capability).toBeNull()
    expect(result.caseStudies).toEqual([])
  })

  it('returns an empty match gracefully when analysisResult is null', () => {
    const result = matchSalesIntelligence(null, bundle())
    expect(result.problem).toBeNull()
  })

  it('tier 1: confirmed_fact from a medium/strong surfaced service-evidence entry', () => {
    const data = {
      _service_evidence_debug: {
        services: [
          {
            service: 'Internal operational software',
            threshold: 'strong',
            surfaced: true,
            disqualified: false,
            evidence: [{ pattern: 'facility count', matched: '5', snippet: '5 facilities nationwide' }],
          },
        ],
      },
    }
    const result = matchSalesIntelligence(data, bundle())
    expect(result.confidenceTier).toBe('confirmed_fact')
    expect(result.problem?.slug).toBe('no-hq-visibility')
    expect(result.capability?.slug).toBe('internal-operational-software')
    expect(result.caseStudies).toHaveLength(1)
    expect(result.reasoning.problem).toContain('5 facilities nationwide')
  })

  it('tier 1: confirmed_fact from an observed pain point containing an evidence keyword', () => {
    const data = {
      pain_points_structured: [
        { title: 'Manual reporting', evidence: 'We rely on monthly reports from each plant.', reasoning: 'r', claim_type: 'observed' },
      ],
    }
    const result = matchSalesIntelligence(data, bundle())
    expect(result.confidenceTier).toBe('confirmed_fact')
  })

  it('tier 2: research_supported_signal from an inferred pain point', () => {
    const data = {
      pain_points_structured: [
        { title: 'Reporting gap', evidence: 'Operates across multiple facilities.', reasoning: 'inferred from scale', claim_type: 'inferred' },
      ],
    }
    const result = matchSalesIntelligence(data, bundle())
    expect(result.confidenceTier).toBe('research_supported_signal')
  })

  it('tier 2: research_supported_signal from a weak service-evidence entry', () => {
    const data = {
      _service_evidence_debug: {
        services: [{ service: 'Internal operational software', threshold: 'weak', surfaced: false, disqualified: false, evidence: [] }],
      },
    }
    const result = matchSalesIntelligence(data, bundle())
    expect(result.confidenceTier).toBe('research_supported_signal')
  })

  it('tier 3: industry_pattern when only industry overlap exists, no company-specific evidence', () => {
    const data = {
      business_profile: { industries_served: ['manufacturing'] },
    }
    const result = matchSalesIntelligence(data, bundle())
    expect(result.confidenceTier).toBe('industry_pattern')
    expect(result.reasoning.problem).toContain('commonly face')
  })

  it('tier 4: hypothesis from outreach_intelligence narrative only', () => {
    const data = {
      outreach_intelligence: { likely_problem: 'HQ lacks visibility into what is happening at each location' },
    }
    const result = matchSalesIntelligence(data, bundle())
    expect(result.confidenceTier).toBe('hypothesis')
  })

  it('never claims a stronger tier than what was actually found (no evidence at all -> empty match)', () => {
    const result = matchSalesIntelligence({}, bundle())
    expect(result.problem).toBeNull()
    expect(result.confidenceTier).toBe('hypothesis')
  })

  it('caps case studies at 2 and only includes ones matching the capability', () => {
    const kb = bundle({
      caseStudies: [
        caseStudy({ id: 'cs-1' }),
        caseStudy({ id: 'cs-2', title: 'Second' }),
        caseStudy({ id: 'cs-3', title: 'Third' }),
        caseStudy({ id: 'cs-4', title: 'Unrelated', capability_tags: ['ecommerce-ecosystems'] }),
      ],
    })
    const data = {
      _service_evidence_debug: {
        services: [{ service: 'Internal operational software', threshold: 'strong', surfaced: true, disqualified: false, evidence: [] }],
      },
    }
    const result = matchSalesIntelligence(data, kb)
    expect(result.caseStudies.length).toBe(2)
    expect(result.caseStudies.every(cs => cs.capability_tags.includes('internal-operational-software'))).toBe(true)
  })

  it('picks the strongest-tier problem when multiple problems match', () => {
    const kb = bundle({
      problems: [
        problem({ id: 'weak-prob', slug: 'weak-one', label: 'Weak fallback signal', evidence_keywords: ['nonexistent phrase'] }),
        problem({ id: 'strong-prob', slug: 'strong-one', label: 'Strong problem' }),
      ],
    })
    const data = {
      // Only weak-prob can reach hypothesis tier via this narrative hint —
      // strong-prob's evidence_keywords match a real observed pain point,
      // so it should win despite being listed second.
      outreach_intelligence: { likely_problem: 'a weak fallback signal only' },
      pain_points_structured: [
        { title: 'Strong problem evidence', evidence: 'multiple facilities reporting issues', reasoning: 'r', claim_type: 'observed' },
      ],
    }
    const result = matchSalesIntelligence(data, kb)
    expect(result.confidenceTier).toBe('confirmed_fact')
    expect(result.problem?.slug).toBe('strong-one')
  })
})

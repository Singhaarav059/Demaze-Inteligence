import { describe, it, expect } from 'vitest'
import { classifySector } from '../lib/sector-playbook/classify'
import { qualifyCompany } from '../lib/sector-playbook/qualify'
import { getSectorPlaybook, getAllSectorPlaybooks } from '../lib/sector-playbook/playbooks'

describe('classifySector', () => {
  it('classifies a manufacturing company with high confidence when industry field and body agree', () => {
    const result = classifySector({
      industry: 'Manufacturing',
      company_summary: 'Operates 6 manufacturing facilities producing industrial components.',
    })
    expect(result.sector).toBe('manufacturing')
    expect(result.confidence).toBe('high')
  })

  it('classifies an automotive dealership network', () => {
    const result = classifySector({
      company_summary: 'A multi-location automotive dealership network with after-sales service.',
    })
    expect(result.sector).toBe('automotive')
  })

  it('classifies an e-commerce D2C brand', () => {
    const result = classifySector({
      company_summary: 'A direct to consumer online store selling across multiple marketplaces.',
    })
    expect(result.sector).toBe('ecommerce')
  })

  it('returns null sector with no signal', () => {
    const result = classifySector({ company_summary: 'A regional law firm offering legal consulting services.' })
    expect(result.sector).toBeNull()
    expect(result.confidence).toBe('none')
  })

  it('returns null sector for empty/missing research', () => {
    const result = classifySector(null)
    expect(result.sector).toBeNull()
  })

  it('does not false-positive match short signals as substrings', () => {
    // "oem" is a signal but must not match inside an unrelated word like "poem"
    const result = classifySector({ company_summary: 'A publishing house that prints poem anthologies.' })
    expect(result.sector).toBeNull()
  })
})

describe('getSectorPlaybook / getAllSectorPlaybooks', () => {
  it('returns all 3 target sectors, each DRAFT, each using only confirmed Demaze services', () => {
    const CONFIRMED_SERVICES = new Set([
      'AI-powered business applications',
      'Custom SaaS platforms',
      'Ecommerce ecosystems',
      'Marketplace platforms',
      'Workflow automation systems',
      'Internal operational software',
      'Analytics and reporting systems',
      'AI integrations and intelligent automation',
    ])
    const playbooks = getAllSectorPlaybooks()
    expect(playbooks).toHaveLength(3)
    for (const pb of playbooks) {
      expect(pb.status).toBe('DRAFT')
      expect(pb.examples.length).toBeGreaterThanOrEqual(3)
      for (const svc of pb.relevantServices) expect(CONFIRMED_SERVICES.has(svc)).toBe(true)
      for (const pattern of pb.opportunityPatterns) expect(CONFIRMED_SERVICES.has(pattern.capability)).toBe(true)
      for (const ex of pb.examples) expect(CONFIRMED_SERVICES.has(ex.demazeCapability)).toBe(true)
    }
  })

  it('getSectorPlaybook returns the matching playbook', () => {
    expect(getSectorPlaybook('ecommerce').label).toBe('E-commerce')
  })
})

describe('qualifyCompany', () => {
  it('returns a full scorecard for an in-sector company', () => {
    const result = qualifyCompany({
      industry: 'Manufacturing',
      company_summary: 'Operates multiple manufacturing facilities.',
      company_fit: { value: 70, rationale: 'Strong operational complexity signal.' },
    })
    expect(result.classification.sector).toBe('manufacturing')
    expect(result.playbook?.label).toBe('Manufacturing')
    expect(result.sectorFit.score).toBeGreaterThan(0)
    expect(result.companyFit.score).toBe(70)
    expect(result.contactability.score).toBeNull()
    expect(result.overall.score).toBeGreaterThan(0)
  })

  it('scores 0 sector fit and no matched opportunities for an out-of-sector company', () => {
    const result = qualifyCompany({ company_summary: 'A regional law firm.' })
    expect(result.classification.sector).toBeNull()
    expect(result.sectorFit.score).toBe(0)
    expect(result.matchedOpportunities).toHaveLength(0)
  })

  it('factors in contactability once decision-maker data is supplied', () => {
    const result = qualifyCompany(
      { industry: 'Manufacturing', company_summary: 'Operates multiple manufacturing facilities.' },
      { decisionMakerCount: 3, verifiedEmailCount: 1 }
    )
    expect(result.contactability.score).not.toBeNull()
    expect(result.contactability.score).toBeGreaterThan(0)
  })

  it('marks a service-evidence match as confirmed, not inferred', () => {
    const result = qualifyCompany({
      industry: 'Manufacturing',
      company_summary: 'Operates multiple manufacturing facilities.',
      _service_evidence_debug: {
        services: [
          {
            service: 'Internal operational software',
            threshold: 'strong',
            surfaced: true,
            disqualified: false,
            evidence: [{ snippet: 'Six manufacturing facilities report independently.' }],
          },
        ],
      },
    })
    const match = result.matchedOpportunities.find(m => m.capability === 'Internal operational software')
    expect(match?.tier).toBe('confirmed')
  })
})

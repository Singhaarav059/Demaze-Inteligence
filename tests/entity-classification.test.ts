import { describe, it, expect } from 'vitest'
import { classifyEntityType } from '../lib/enrichment/entity-classification'

// Test matrix from the production-hardening task: entity classification
// must distinguish real companies (which get accepted here — mega-cap/
// wrong-sector rejection is a separate, qualification-layer concern, see
// company-discovery.ts's classifyCompanyRejection) from the entity types
// that should never be treated as a prospect at all.
describe('classifyEntityType — real companies classify as COMPANY', () => {
  it.each(['Ford', 'Honda', 'Bosch'])('%s is COMPANY (rejected later for size/sector-fit, not entity type)', (name) => {
    expect(classifyEntityType(name).type).toBe('COMPANY')
  })

  it('a real mid-market-shaped multi-word name is COMPANY', () => {
    expect(classifyEntityType('Bharat Forge Limited').type).toBe('COMPANY')
    expect(classifyEntityType('Acme Manufacturing Co').type).toBe('COMPANY')
  })
})

describe('classifyEntityType — trade associations and government programs', () => {
  it.each(['CLEPA', 'Manufacturing USA'])('%s is not COMPANY', (name) => {
    const result = classifyEntityType(name)
    expect(result.type).not.toBe('COMPANY')
  })

  it('CLEPA classifies as ASSOCIATION', () => {
    expect(classifyEntityType('CLEPA').type).toBe('ASSOCIATION')
  })

  it('Manufacturing USA classifies as GOVERNMENT', () => {
    expect(classifyEntityType('Manufacturing USA').type).toBe('GOVERNMENT')
  })

  it('recognizes a spelled-out association name via keyword, not just the exact listed acronym', () => {
    expect(classifyEntityType('National Widget Manufacturers Federation').type).toBe('ASSOCIATION')
    expect(classifyEntityType('Chamber of Commerce of Greater Springfield').type).toBe('ASSOCIATION')
  })

  it('recognizes a spelled-out government program via keyword', () => {
    expect(classifyEntityType('Ministry of Heavy Industries').type).toBe('GOVERNMENT')
  })

  // Live 2026-08-20 fresh discovery benchmark: "VSIP Industrial System",
  // "Karawang Industrial Cluster", "Jurong Industrial Estate" all qualified
  // as if they were companies — all are state-designated economic zones.
  it('classifies industrial parks/estates/clusters as GOVERNMENT, not COMPANY', () => {
    expect(classifyEntityType('VSIP Industrial System').type).toBe('GOVERNMENT')
    expect(classifyEntityType('Karawang Industrial Cluster').type).toBe('GOVERNMENT')
    expect(classifyEntityType('Jurong Industrial Estate').type).toBe('GOVERNMENT')
    expect(classifyEntityType('Shenzhen Special Economic Zone').type).toBe('GOVERNMENT')
  })

  it('does not misclassify a real company whose name happens to contain "industrial" for an unrelated reason', () => {
    expect(classifyEntityType('Acme Industrial Supply Co').type).toBe('COMPANY')
  })

  it('recognizes a nonprofit via keyword', () => {
    expect(classifyEntityType('Community Manufacturing Foundation').type).toBe('NONPROFIT')
  })
})

describe('classifyEntityType — generic terms (bare category/geography words)', () => {
  it.each(['Electronics', 'Mexico', 'General'])('%s classifies as GENERIC_TERM', (name) => {
    expect(classifyEntityType(name).type).toBe('GENERIC_TERM')
  })

  it('does not misclassify a real multi-word company name containing a generic word', () => {
    expect(classifyEntityType('Mexico Manufacturing Co').type).toBe('COMPANY')
    expect(classifyEntityType('Nova Chemicals').type).toBe('COMPANY')
  })

  it('classifies a listicle section-header phrase as GENERIC_TERM', () => {
    expect(classifyEntityType('The Regional Market Leaders').type).toBe('GENERIC_TERM')
  })
})

describe('classifyEntityType — directories and media', () => {
  it('known directories/aggregators classify as DIRECTORY', () => {
    expect(classifyEntityType('Crunchbase').type).toBe('DIRECTORY')
    expect(classifyEntityType('G2').type).toBe('DIRECTORY')
  })

  it('known social networks/news outlets classify as MEDIA', () => {
    expect(classifyEntityType('LinkedIn').type).toBe('MEDIA')
    expect(classifyEntityType('Reuters').type).toBe('MEDIA')
  })
})

describe('classifyEntityType — UNKNOWN for genuinely unclassifiable input', () => {
  it('very short/empty input is UNKNOWN, not silently accepted as COMPANY', () => {
    expect(classifyEntityType('X').type).toBe('UNKNOWN')
    expect(classifyEntityType('').type).toBe('UNKNOWN')
  })
})

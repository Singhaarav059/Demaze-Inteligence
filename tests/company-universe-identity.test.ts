// ============================================================
// Company Universe — identity resolution tests
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md Section 12 is the
// most safety-critical part of this build ("never merge two companies
// purely because their names are similar") — this file is the most
// thorough test coverage in the whole company-universe module set.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  resolveIdentity,
  mergeCanonicalFields,
  normalizeCompanyName,
  significantWords,
  normalizeDomain,
  type ExistingCompanyIdentitySlice,
} from '../lib/company-universe/identity'
import type { CanonicalCompanyFields } from '../lib/company-universe/types'

function fields(overrides: Partial<CanonicalCompanyFields> = {}): CanonicalCompanyFields {
  return { canonicalName: 'Acme Corp', status: 'unknown', industryCodes: [], sicCodes: [], naicsCodes: [], ...overrides }
}

function slice(overrides: Partial<ExistingCompanyIdentitySlice> = {}): ExistingCompanyIdentitySlice {
  return { id: 'existing-1', canonicalName: 'Acme Corp', ...overrides }
}

describe('normalizeCompanyName / significantWords / normalizeDomain', () => {
  it('strips legal suffixes and normalizes case/punctuation', () => {
    expect(normalizeCompanyName('Acme Corp., Inc.')).toBe('acme')
  })
  it('preserves Unicode letters (accented names)', () => {
    expect(normalizeCompanyName('Möller Group')).toBe('möller group')
  })
  it('filters stopwords from significant words', () => {
    expect(significantWords('the acme and sons')).toEqual(['acme', 'sons'])
  })
  it('normalizes a domain regardless of scheme/www/path', () => {
    expect(normalizeDomain('https://www.Acme.com/about')).toBe('acme.com')
  })
})

describe('resolveIdentity — deterministic identifiers win first', () => {
  it('matches on LEI', () => {
    const result = resolveIdentity(fields({ lei: 'LEI123' }), [slice({ lei: 'LEI123' })])
    expect(result).toMatchObject({ outcome: 'matched', existingId: 'existing-1', confidence: 'deterministic_id' })
  })

  it('matches on CIK', () => {
    const result = resolveIdentity(fields({ cik: '0000320193' }), [slice({ cik: '0000320193' })])
    expect(result).toMatchObject({ outcome: 'matched', confidence: 'deterministic_id' })
  })

  it('matches on CIN', () => {
    const result = resolveIdentity(fields({ cin: 'U12345MH2000PLC000001' }), [slice({ cin: 'U12345MH2000PLC000001' })])
    expect(result).toMatchObject({ outcome: 'matched', confidence: 'deterministic_id' })
  })

  it('matches on company number ONLY when the registration authority also agrees', () => {
    const noAuthorityMatch = resolveIdentity(
      fields({ companyNumber: '01234567', registrationAuthority: 'gb' }),
      [slice({ companyNumber: '01234567', registrationAuthority: 'us_de' })]
    )
    expect(noAuthorityMatch.outcome).toBe('no_match')

    const withAuthorityMatch = resolveIdentity(
      fields({ companyNumber: '01234567', registrationAuthority: 'gb' }),
      [slice({ companyNumber: '01234567', registrationAuthority: 'gb' })]
    )
    expect(withAuthorityMatch).toMatchObject({ outcome: 'matched', confidence: 'deterministic_id' })
  })

  it('does not match when identifiers are simply both absent', () => {
    const result = resolveIdentity(fields({ canonicalName: 'Some Company That Matches Nothing' }), [slice({ lei: 'LEI999' })])
    expect(result.outcome).toBe('no_match')
  })

  it('reports a conflict when deterministic identifiers disagree across two different existing records', () => {
    // Simulates: incoming record's LEI matches company A, but its CIN
    // (perhaps stale/wrong source data) matches company B.
    const result = resolveIdentity(
      fields({ lei: 'LEI-A', cin: 'CIN-B' }),
      [slice({ id: 'company-a', lei: 'LEI-A' }), slice({ id: 'company-b', cin: 'CIN-B' })]
    )
    expect(result.outcome).toBe('conflict')
    if (result.outcome === 'conflict') {
      expect(result.candidateIds.sort()).toEqual(['company-a', 'company-b'])
    }
  })
})

describe('resolveIdentity — conservative fuzzy fallback, only when no deterministic identifier fired', () => {
  it('matches on same domain + high name-word overlap', () => {
    const result = resolveIdentity(
      fields({ canonicalName: 'Acme Industrial Group', domain: 'acmeindustrial.com' }),
      [slice({ canonicalName: 'Acme Industrial Group Ltd', domain: 'acmeindustrial.com' })]
    )
    expect(result).toMatchObject({ outcome: 'matched', confidence: 'fuzzy_name_domain' })
  })

  it('does NOT match on domain alone when names diverge (holding company / subsidiary risk)', () => {
    const result = resolveIdentity(
      fields({ canonicalName: 'Totally Unrelated Name', domain: 'shared-domain.com' }),
      [slice({ canonicalName: 'Acme Industrial Group', domain: 'shared-domain.com' })]
    )
    expect(result.outcome).toBe('no_match')
  })

  it('matches on exact normalized name + same country when no domain exists on either side', () => {
    const result = resolveIdentity(
      fields({ canonicalName: 'Bharat Forge Limited', countryCode: 'IN' }),
      [slice({ canonicalName: 'Bharat Forge Ltd', countryCode: 'IN' })]
    )
    expect(result).toMatchObject({ outcome: 'matched', confidence: 'fuzzy_name_country' })
  })

  it('never merges two different companies purely because their names are similar across DIFFERENT countries', () => {
    // The exact real-world case CLAUDE.md documents this repo already
    // guarding against elsewhere (a generic name colliding across two
    // genuinely unrelated companies, e.g. "A-1 Fence Company" in the US vs
    // "A-1 Fence Products" in India).
    const result = resolveIdentity(
      fields({ canonicalName: 'A-1 Fence Company', countryCode: 'US' }),
      [slice({ canonicalName: 'A-1 Fence Company', countryCode: 'GB' })]
    )
    expect(result.outcome).toBe('no_match')
  })

  it('refuses to fuzzy-match a single-word name even with a domain present (guard against generic short names)', () => {
    const result = resolveIdentity(
      fields({ canonicalName: 'Acme', domain: 'acme.com' }),
      [slice({ canonicalName: 'Global', domain: 'acme.com' })]
    )
    // "Acme" alone is below MIN_FUZZY_WORDS for the overlap tier, and the
    // normalized names don't match exactly either — correctly refuses.
    expect(result.outcome).toBe('no_match')
  })

  it('deterministic identifier match wins even when a fuzzy candidate also exists elsewhere', () => {
    const result = resolveIdentity(
      fields({ lei: 'LEI-REAL', canonicalName: 'Acme Corp', domain: 'acme.com' }),
      [
        slice({ id: 'lei-match', lei: 'LEI-REAL', canonicalName: 'Something Else Entirely' }),
        slice({ id: 'fuzzy-match', canonicalName: 'Acme Corp', domain: 'acme.com' }),
      ]
    )
    expect(result).toMatchObject({ outcome: 'matched', existingId: 'lei-match', confidence: 'deterministic_id' })
  })
})

describe('mergeCanonicalFields — source precedence (Section 13)', () => {
  it('never overwrites a real value with an incoming empty/unknown value', () => {
    const existing = fields({ employeeCount: 500 })
    const incoming = fields({ employeeCount: undefined })
    const merged = mergeCanonicalFields(existing, incoming, 'opencorporates', ['sec_edgar'])
    expect(merged.employeeCount).toBe(500)
  })

  it('fills a genuinely-empty existing field from any provider', () => {
    const existing = fields({ industry: undefined })
    const incoming = fields({ industry: 'Manufacturing' })
    const merged = mergeCanonicalFields(existing, incoming, 'opencorporates', [])
    expect(merged.industry).toBe('Manufacturing')
  })

  it('prefers SEC EDGAR over OpenCorporates for financial fields (Section 13)', () => {
    const existing = fields({ revenue: 1000, revenueCurrency: 'USD' })
    const incoming = fields({ revenue: 999999, revenueCurrency: 'USD' })
    // existing came from sec_edgar (highest financial precedence); incoming
    // from opencorporates (lowest) — must NOT overwrite.
    const merged = mergeCanonicalFields(existing, incoming, 'opencorporates', ['sec_edgar'])
    expect(merged.revenue).toBe(1000)
  })

  it('DOES let SEC EDGAR override an OpenCorporates-sourced financial value', () => {
    const existing = fields({ revenue: 999999, revenueCurrency: 'USD' })
    const incoming = fields({ revenue: 1000, revenueCurrency: 'USD' })
    const merged = mergeCanonicalFields(existing, incoming, 'sec_edgar', ['opencorporates'])
    expect(merged.revenue).toBe(1000)
  })

  it('prefers a national registry (india_mca) over GLEIF for legal-identity fields', () => {
    const existing = fields({ registeredAddress: 'MCA official address' })
    const incoming = fields({ registeredAddress: 'GLEIF address' })
    const merged = mergeCanonicalFields(existing, incoming, 'gleif', ['india_mca'])
    expect(merged.registeredAddress).toBe('MCA official address')
  })

  it('leaves a field with no precedence rule (e.g. domain) untouched when already set', () => {
    const existing = fields({ domain: 'first-seen.com' })
    const incoming = fields({ domain: 'second-provider.com' })
    const merged = mergeCanonicalFields(existing, incoming, 'opencorporates', ['gleif'])
    expect(merged.domain).toBe('first-seen.com')
  })
})

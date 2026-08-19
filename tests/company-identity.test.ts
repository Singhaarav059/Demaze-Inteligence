// ============================================================
// Company Registry — identity resolution + lifecycle helpers
// ============================================================
// Normalization functions are pure. findExistingCompany/upsertDiscovered/
// mark*() hit a fake in-memory Supabase (tests/helpers/fake-supabase.ts) —
// same precedent as tests/send-route-concurrency.test.ts.
// ============================================================

import { describe, it, expect } from 'vitest'
import { FakeSupabase } from './helpers/fake-supabase'
import {
  normalizeDomain,
  normalizeCompanyName,
  normalizeLinkedInUrl,
  buildIdentityKeys,
  findExistingCompany,
  upsertDiscovered,
  markQualified,
  markDisqualified,
  markResearched,
  markOutreached,
  markOutreachedByIdentity,
  markResearchedByIdentity,
  lookupExistingStatus,
} from '../lib/companies/identity'

describe('normalizeDomain', () => {
  it('strips protocol, www, and path', () => {
    expect(normalizeDomain('https://www.AbcIndustries.com/about')).toBe('abcindustries.com')
    expect(normalizeDomain('abcindustries.com')).toBe('abcindustries.com')
    expect(normalizeDomain('http://abcindustries.com')).toBe('abcindustries.com')
  })
})

describe('normalizeCompanyName', () => {
  it('strips legal suffixes and normalizes case/punctuation', () => {
    expect(normalizeCompanyName('ABC Industries')).toBe('abc industries')
    expect(normalizeCompanyName('ABC Industries Pvt Ltd')).toBe('abc industries')
    expect(normalizeCompanyName('ABC Industries Limited')).toBe('abc industries')
  })

  it('is Unicode-aware, not ASCII-only', () => {
    expect(normalizeCompanyName('Möller Group')).toBe('möller group')
  })
})

describe('normalizeLinkedInUrl', () => {
  it('normalizes a real company URL regardless of protocol/www/trailing slash', () => {
    expect(normalizeLinkedInUrl('https://www.linkedin.com/company/acme-corp/')).toBe('linkedin.com/company/acme-corp')
    expect(normalizeLinkedInUrl('linkedin.com/company/acme-corp')).toBe('linkedin.com/company/acme-corp')
  })

  it('returns null for a personal profile URL', () => {
    expect(normalizeLinkedInUrl('https://www.linkedin.com/in/jane-doe')).toBeNull()
  })

  it('returns null for malformed/empty input', () => {
    expect(normalizeLinkedInUrl('')).toBeNull()
    expect(normalizeLinkedInUrl(null)).toBeNull()
    expect(normalizeLinkedInUrl('not a url')).toBeNull()
  })
})

describe('buildIdentityKeys — "same company, different spellings" resolves to one identity', () => {
  it('produces the same normalizedName for name variants', () => {
    const a = buildIdentityKeys({ name: 'ABC Industries' })
    const b = buildIdentityKeys({ name: 'ABC Industries Pvt Ltd' })
    const c = buildIdentityKeys({ name: 'ABC Industries Limited' })
    expect(a.normalizedName).toBe(b.normalizedName)
    expect(b.normalizedName).toBe(c.normalizedName)
  })

  it('produces the same domain for URL variants', () => {
    const a = buildIdentityKeys({ name: 'x', domain: 'abcindustries.com' })
    const b = buildIdentityKeys({ name: 'x', domain: 'https://www.abcindustries.com/' })
    expect(a.domain).toBe(b.domain)
  })
})

describe('findExistingCompany — confidence order: domain > LinkedIn > name', () => {
  it('matches by domain first', async () => {
    const supa = new FakeSupabase()
    supa.seed('company_registry', [
      { id: 'c1', canonical_domain: 'acme.com', normalized_name: 'acme corp', linkedin_url_normalized: null, status: 'discovered' },
    ])
    const found = await findExistingCompany(supa as any, buildIdentityKeys({ name: 'Acme Corp', domain: 'acme.com' }))
    expect(found?.id).toBe('c1')
  })

  it('falls back to LinkedIn URL when no domain match', async () => {
    const supa = new FakeSupabase()
    supa.seed('company_registry', [
      { id: 'c1', canonical_domain: null, normalized_name: 'acme corp', linkedin_url_normalized: 'linkedin.com/company/acme', status: 'discovered' },
    ])
    const found = await findExistingCompany(supa as any, buildIdentityKeys({ name: 'Different Name Entirely', linkedinUrl: 'https://linkedin.com/company/acme' }))
    expect(found?.id).toBe('c1')
  })

  it('falls back to normalized name when nothing stronger is available', async () => {
    const supa = new FakeSupabase()
    supa.seed('company_registry', [
      { id: 'c1', canonical_domain: null, normalized_name: 'abc industries', linkedin_url_normalized: null, status: 'discovered', updated_at: '2026-01-01' },
    ])
    const found = await findExistingCompany(supa as any, buildIdentityKeys({ name: 'ABC Industries Ltd' }))
    expect(found?.id).toBe('c1')
  })

  it('returns null for a genuinely new company', async () => {
    const supa = new FakeSupabase()
    supa.seed('company_registry', [
      { id: 'c1', canonical_domain: 'other.com', normalized_name: 'other co', linkedin_url_normalized: null, status: 'discovered' },
    ])
    const found = await findExistingCompany(supa as any, buildIdentityKeys({ name: 'Brand New Co', domain: 'newco.com' }))
    expect(found).toBeNull()
  })
})

describe('upsertDiscovered — insert-or-fill-gaps, never downgrades', () => {
  it('creates a new row when none exists', async () => {
    const supa = new FakeSupabase()
    const row = await upsertDiscovered(supa as any, { name: 'Fresh Co', domain: 'freshco.com', sector: 'manufacturing' })
    expect(row.status).toBe('discovered')
    expect(row.canonical_domain).toBe('freshco.com')
    expect(supa.table('company_registry')).toHaveLength(1)
  })

  it('fills in a missing domain on an existing name-only row without creating a duplicate', async () => {
    const supa = new FakeSupabase()
    await upsertDiscovered(supa as any, { name: 'Gap Co' })
    const filled = await upsertDiscovered(supa as any, { name: 'Gap Co', domain: 'gapco.com' })
    expect(supa.table('company_registry')).toHaveLength(1)
    expect(filled.canonical_domain).toBe('gapco.com')
  })

  it('never overwrites an already-set domain with a different one', async () => {
    const supa = new FakeSupabase()
    await upsertDiscovered(supa as any, { name: 'Stable Co', domain: 'original.com' })
    const second = await upsertDiscovered(supa as any, { name: 'Stable Co', domain: 'different.com' })
    // Matched by name (since a differing domain won't match the domain
    // lookup) — the existing row's domain must not be silently replaced.
    expect(second.canonical_domain).toBe('original.com')
  })
})

describe('mark* — status transitions set the right timestamp', () => {
  it('markQualified sets status + qualified_at, clears rejection_reason', async () => {
    const supa = new FakeSupabase()
    const row = await upsertDiscovered(supa as any, { name: 'Q Co' })
    await markDisqualified(supa as any, row.id, 'wrong_sector')
    await markQualified(supa as any, row.id)
    const stored = supa.table('company_registry').find(r => r.id === row.id)
    expect(stored?.status).toBe('qualified')
    expect(stored?.qualified_at).toBeTruthy()
    expect(stored?.rejection_reason).toBeNull()
  })

  it('markDisqualified sets status + rejection_reason', async () => {
    const supa = new FakeSupabase()
    const row = await upsertDiscovered(supa as any, { name: 'D Co' })
    await markDisqualified(supa as any, row.id, 'outside_size_range')
    const stored = supa.table('company_registry').find(r => r.id === row.id)
    expect(stored?.status).toBe('disqualified')
    expect(stored?.rejection_reason).toBe('outside_size_range')
  })

  it('markResearched sets status + researched_at + source_run_id', async () => {
    const supa = new FakeSupabase()
    const row = await upsertDiscovered(supa as any, { name: 'R Co' })
    await markResearched(supa as any, row.id, 'run-123')
    const stored = supa.table('company_registry').find(r => r.id === row.id)
    expect(stored?.status).toBe('researched')
    expect(stored?.researched_at).toBeTruthy()
    expect(stored?.source_run_id).toBe('run-123')
  })

  it('markOutreached sets status + outreached_at + campaign id', async () => {
    const supa = new FakeSupabase()
    const row = await upsertDiscovered(supa as any, { name: 'O Co' })
    await markOutreached(supa as any, row.id, 'camp-1')
    const stored = supa.table('company_registry').find(r => r.id === row.id)
    expect(stored?.status).toBe('outreached')
    expect(stored?.outreached_at).toBeTruthy()
    expect(stored?.outreach_campaign_id).toBe('camp-1')
  })
})

describe('lookupExistingStatus — the read-only path Excel/CSV upload uses (same identity system, no separate dedup mechanism)', () => {
  it('flags an uploaded row matching an already-researched company', async () => {
    const supa = new FakeSupabase()
    const row = await upsertDiscovered(supa as any, { name: 'Uploaded Co', domain: 'uploadedco.com' })
    await markResearched(supa as any, row.id, 'run-1')

    const statuses = await lookupExistingStatus(supa as any, [
      { name: 'Uploaded Co Pvt Ltd', domain: 'uploadedco.com' },
      { name: 'Genuinely New Upload Co', domain: 'genuinelynew.com' },
    ])
    expect(statuses[0]).toBe('researched')
    expect(statuses[1]).toBeUndefined()
  })

  it('never writes — a read-only lookup does not create a company_registry row', async () => {
    const supa = new FakeSupabase()
    await lookupExistingStatus(supa as any, [{ name: 'Never Persisted Co' }])
    expect(supa.table('company_registry')).toHaveLength(0)
  })
})

describe('markResearchedByIdentity / markOutreachedByIdentity — create-if-missing', () => {
  it('creates a new identity and marks it researched when nothing existed yet', async () => {
    const supa = new FakeSupabase()
    await markResearchedByIdentity(supa as any, { name: 'Manual URL Co', domain: 'manualco.com' }, 'run-1')
    expect(supa.table('company_registry')).toHaveLength(1)
    expect(supa.table('company_registry')[0].status).toBe('researched')
  })

  it('resolves an existing identity rather than creating a duplicate', async () => {
    const supa = new FakeSupabase()
    await upsertDiscovered(supa as any, { name: 'Existing Co', domain: 'existing.com' })
    await markOutreachedByIdentity(supa as any, { name: 'Existing Co', domain: 'existing.com' }, 'camp-9')
    expect(supa.table('company_registry')).toHaveLength(1)
    expect(supa.table('company_registry')[0].status).toBe('outreached')
  })
})

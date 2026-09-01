// ============================================================
// Contact Update Overwrite Guard — tests
// ============================================================
// Covers both the pure guard functions (lib/outbound/shared/
// contact-update-guard.ts) and the real find-email/enrich route handlers,
// driven against a FakeSupabase seeded with an already-good contact — the
// exact bug shape: a re-run's weaker/not_found result must never clobber
// what's already stored. Same route-testing pattern as
// tests/process-followups-route-pause.test.ts (ADMIN_SECRET is unset in
// tests, so verifyAdminRequest() passes through with no auth mocking).
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeSupabase } from './helpers/fake-supabase'
import { shouldOverwriteEmail, shouldOverwriteEnrichment } from '@/lib/outbound/shared/contact-update-guard'

describe('shouldOverwriteEmail', () => {
  it('a high-confidence existing email is not overwritten by a not_found (none) result', () => {
    expect(shouldOverwriteEmail('high', 'none')).toBe(false)
  })

  it('a high-confidence existing email is not overwritten by a weaker (low) result', () => {
    expect(shouldOverwriteEmail('high', 'low')).toBe(false)
  })

  it('an equal-confidence result still writes (allows a fresh re-verify)', () => {
    expect(shouldOverwriteEmail('medium', 'medium')).toBe(true)
  })

  it('a stronger result overwrites a weaker existing one', () => {
    expect(shouldOverwriteEmail('low', 'high')).toBe(true)
  })

  it('a missing/unset existing confidence always writes (first-ever result)', () => {
    expect(shouldOverwriteEmail(null, 'low')).toBe(true)
    expect(shouldOverwriteEmail(undefined, 'medium')).toBe(true)
  })

  it('a verified existing email is never overwritten by any non-verified result, at any confidence', () => {
    expect(shouldOverwriteEmail('verified', 'high')).toBe(false)
    expect(shouldOverwriteEmail('verified', 'medium')).toBe(false)
    expect(shouldOverwriteEmail('verified', 'low')).toBe(false)
    expect(shouldOverwriteEmail('verified', 'none')).toBe(false)
  })

  it('a high-confidence existing email IS overwritten by a fresh verified result', () => {
    expect(shouldOverwriteEmail('high', 'verified')).toBe(true)
  })

  it('a verified result overwrites an existing verified one (allows a fresh re-verify)', () => {
    expect(shouldOverwriteEmail('verified', 'verified')).toBe(true)
  })
})

describe('shouldOverwriteEnrichment', () => {
  it('an existing "enriched" result is not overwritten by a fresh not_found', () => {
    expect(shouldOverwriteEnrichment('enriched', 'high', 'not_found', 'low')).toBe(false)
  })

  it('an existing "partial" result is not overwritten by a fresh not_found', () => {
    expect(shouldOverwriteEnrichment('partial', 'low', 'not_found', 'low')).toBe(false)
  })

  it('a fresh not_found writes when nothing existed before', () => {
    expect(shouldOverwriteEnrichment(null, null, 'not_found', 'low')).toBe(true)
  })

  it('a weaker confidence at the same status does not overwrite a stronger one', () => {
    expect(shouldOverwriteEnrichment('enriched', 'high', 'enriched', 'medium')).toBe(false)
  })

  it('a stronger confidence overwrites a weaker existing one', () => {
    expect(shouldOverwriteEnrichment('partial', 'low', 'enriched', 'high')).toBe(true)
  })
})

// ── Route-level: find-email ────────────────────────────────────────────

const state = vi.hoisted(() => ({ supabase: null as FakeSupabase | null, enrichmentProviderName: 'mock' }))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => state.supabase,
}))

vi.mock('@/lib/outbound/email-finder/provider-factory', () => ({
  findEmail: vi.fn(),
}))

vi.mock('@/lib/outbound/enrichment/provider-factory', () => ({
  enrichContact: vi.fn(),
}))

vi.mock('@/lib/outbound/settings/provider-selection', () => ({
  getActiveProviderName: vi.fn(async (capability: string) =>
    capability === 'enrichment' ? state.enrichmentProviderName : 'mock'
  ),
}))

// Mocked here (not in tests/exa-enrichment.test.ts, which unit-tests the
// REAL ExaEnrichmentProvider directly) — mocking the same module path in
// both files would collide since vi.mock is file-scoped, not scoped to one
// import site.
vi.mock('@/lib/outbound/enrichment/providers/exa', () => ({
  ExaEnrichmentProvider: { name: 'exa', displayName: 'Exa', enrichContact: vi.fn(), isAvailable: vi.fn() },
}))

import { findEmail } from '@/lib/outbound/email-finder/provider-factory'
import { enrichContact } from '@/lib/outbound/enrichment/provider-factory'
import { ExaEnrichmentProvider } from '@/lib/outbound/enrichment/providers/exa'
import { POST as findEmailPOST } from '../app/api/admin/outbound/contacts/[id]/find-email/route'
import { POST as enrichPOST } from '../app/api/admin/outbound/contacts/[id]/enrich/route'

function makeReq(path: string) {
  return new NextRequest(`https://example.com${path}`, { method: 'POST' })
}

beforeEach(() => {
  vi.mocked(findEmail).mockReset()
  vi.mocked(enrichContact).mockReset()
  vi.mocked(ExaEnrichmentProvider.enrichContact).mockReset()
  vi.mocked(ExaEnrichmentProvider.isAvailable).mockReset().mockResolvedValue(false)
  state.enrichmentProviderName = 'mock'
})

describe('POST contacts/[id]/find-email — overwrite guard', () => {
  it('does not overwrite an existing high-confidence email with a not_found result', async () => {
    const supa = new FakeSupabase()
    supa.seed('outbound_contacts', [
      {
        id: 'c1',
        person_name: 'Jane Doe',
        company_name: 'Acme',
        company_domain: 'acme.com',
        linkedin_url: null,
        email: 'jane@acme.com',
        email_confidence: 'high',
        enrichment_status: 'enriched',
        prospeo_raw: null,
      },
    ])
    state.supabase = supa

    vi.mocked(findEmail).mockResolvedValue({
      email: null,
      confidence: 'none',
      providerUsed: 'exa',
      status: 'not_found',
      reason: 'Exa found no matching person.',
    })

    const res = await findEmailPOST(makeReq('/api/admin/outbound/contacts/c1/find-email'), { params: Promise.resolve({ id: 'c1' }) })
    const json = await res.json()

    expect(json.overwriteBlocked).toBe(true)
    expect(json.contact.email).toBe('jane@acme.com')
    expect(json.contact.email_confidence).toBe('high')
  })

  it('does overwrite when the fresh result is at least as strong', async () => {
    const supa = new FakeSupabase()
    supa.seed('outbound_contacts', [
      {
        id: 'c1',
        person_name: 'Jane Doe',
        company_name: 'Acme',
        company_domain: 'acme.com',
        linkedin_url: null,
        email: null,
        email_confidence: null,
        enrichment_status: 'pending',
        prospeo_raw: null,
      },
    ])
    state.supabase = supa

    vi.mocked(findEmail).mockResolvedValue({
      email: 'jane@acme.com',
      confidence: 'medium',
      providerUsed: 'exa',
      status: 'found',
    })

    const res = await findEmailPOST(makeReq('/api/admin/outbound/contacts/c1/find-email'), { params: Promise.resolve({ id: 'c1' }) })
    const json = await res.json()

    expect(json.overwriteBlocked).toBe(false)
    expect(json.contact.email).toBe('jane@acme.com')
    expect(json.contact.email_confidence).toBe('medium')
  })
})

describe('POST contacts/[id]/enrich — overwrite guard', () => {
  it('does not overwrite an existing enriched result with a fresh not_found', async () => {
    const supa = new FakeSupabase()
    supa.seed('outbound_contacts', [
      {
        id: 'c1',
        person_name: 'Jane Doe',
        company_name: 'Acme',
        company_domain: 'acme.com',
        linkedin_url: null,
        source_run_id: null,
        email_finder_status: 'found',
        enrichment_status: 'enriched',
        enrichment: { department: 'Engineering', confidence: 'high', providerUsed: 'prospeo', status: 'enriched' },
        prospeo_raw: null,
      },
    ])
    state.supabase = supa

    vi.mocked(enrichContact).mockResolvedValue({
      confidence: 'low',
      providerUsed: 'exa',
      status: 'not_found',
    })

    const res = await enrichPOST(makeReq('/api/admin/outbound/contacts/c1/enrich'), { params: Promise.resolve({ id: 'c1' }) })
    const json = await res.json()

    expect(json.overwriteBlocked).toBe(true)
    expect(json.contact.enrichment_status).toBe('enriched')
    expect(json.contact.enrichment.department).toBe('Engineering')
  })

  it('does overwrite when nothing existed before', async () => {
    const supa = new FakeSupabase()
    supa.seed('outbound_contacts', [
      {
        id: 'c1',
        person_name: 'Jane Doe',
        company_name: 'Acme',
        company_domain: 'acme.com',
        linkedin_url: null,
        source_run_id: null,
        email_finder_status: 'pending',
        enrichment_status: 'pending',
        enrichment: null,
        prospeo_raw: null,
      },
    ])
    state.supabase = supa

    vi.mocked(enrichContact).mockResolvedValue({
      department: 'Sales',
      confidence: 'medium',
      providerUsed: 'exa',
      status: 'partial',
    })

    const res = await enrichPOST(makeReq('/api/admin/outbound/contacts/c1/enrich'), { params: Promise.resolve({ id: 'c1' }) })
    const json = await res.json()

    expect(json.overwriteBlocked).toBe(false)
    expect(json.contact.enrichment_status).toBe('partial')
    expect(json.contact.enrichment.department).toBe('Sales')
  })
})

// ── Route-level: enrich — selective Exa supplement (Piece 3) ────────────

function seedThinContact(supa: FakeSupabase) {
  supa.seed('outbound_contacts', [
    {
      id: 'c1',
      person_name: 'Jane Doe',
      company_name: 'Acme',
      company_domain: 'acme.com',
      linkedin_url: null,
      source_run_id: null,
      email_finder_status: 'pending',
      enrichment_status: 'pending',
      enrichment: null,
      prospeo_raw: null,
    },
  ])
}

describe('POST contacts/[id]/enrich — selective Exa supplement', () => {
  it('does NOT call Exa when the primary result already has department/seniority/location', async () => {
    const supa = new FakeSupabase()
    seedThinContact(supa)
    state.supabase = supa

    vi.mocked(enrichContact).mockResolvedValue({
      department: 'Engineering',
      seniority: 'VP',
      location: 'San Francisco',
      confidence: 'high',
      providerUsed: 'prospeo',
      status: 'enriched',
    })

    const res = await enrichPOST(makeReq('/api/admin/outbound/contacts/c1/enrich'), { params: Promise.resolve({ id: 'c1' }) })
    const json = await res.json()

    expect(ExaEnrichmentProvider.enrichContact).not.toHaveBeenCalled()
    expect(json.enrichmentSources).toEqual(['prospeo'])
    expect(json.contact.enrichment.department).toBe('Engineering')
  })

  it('calls Exa and merges only into genuinely empty gaps when the primary result is thin', async () => {
    const supa = new FakeSupabase()
    seedThinContact(supa)
    state.supabase = supa

    vi.mocked(enrichContact).mockResolvedValue({
      // Thin: no department/seniority/location, but DOES have a secondary
      // field — that secondary field must survive the merge unchanged.
      industry: 'Manufacturing',
      confidence: 'low',
      providerUsed: 'prospeo',
      status: 'partial',
    })
    vi.mocked(ExaEnrichmentProvider.isAvailable).mockResolvedValue(true)
    vi.mocked(ExaEnrichmentProvider.enrichContact).mockResolvedValue({
      department: 'Sales',
      seniority: 'Manager',
      location: 'NYC',
      industry: 'Should never appear — primary already had industry',
      confidence: 'medium',
      providerUsed: 'exa',
      status: 'enriched',
    })

    const res = await enrichPOST(makeReq('/api/admin/outbound/contacts/c1/enrich'), { params: Promise.resolve({ id: 'c1' }) })
    const json = await res.json()

    expect(ExaEnrichmentProvider.enrichContact).toHaveBeenCalledTimes(1)
    expect(json.result.department).toBe('Sales')
    expect(json.result.seniority).toBe('Manager')
    expect(json.result.location).toBe('NYC')
    // Primary's own industry field must win — never overwritten by Exa's.
    expect(json.result.industry).toBe('Manufacturing')
    expect(json.result.status).toBe('enriched')
    expect(json.enrichmentSources.sort()).toEqual(['exa', 'prospeo'])
  })

  it('never calls Exa when it is the active primary provider already, even with a thin result', async () => {
    const supa = new FakeSupabase()
    seedThinContact(supa)
    state.supabase = supa
    state.enrichmentProviderName = 'exa'

    vi.mocked(enrichContact).mockResolvedValue({
      confidence: 'low',
      providerUsed: 'exa',
      status: 'not_found',
    })

    const res = await enrichPOST(makeReq('/api/admin/outbound/contacts/c1/enrich'), { params: Promise.resolve({ id: 'c1' }) })
    await res.json()

    // Would otherwise qualify as thin (no department/seniority/location) —
    // the "Exa is already the primary" guard must still block the
    // supplement call, never calling the same provider twice.
    expect(ExaEnrichmentProvider.isAvailable).not.toHaveBeenCalled()
    expect(ExaEnrichmentProvider.enrichContact).not.toHaveBeenCalled()
  })
})

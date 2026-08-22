// ============================================================
// POST /api/admin/explee-discovery — filter mapping + already-researched
// annotation
// ============================================================
// Verifies every UI-facing filter field on the request body actually
// reaches searchExpleeCompanies() with the right Explee field name/shape
// (not just that the UI changes), and that results get annotated against
// real pipeline_test_runs history rather than silently dropped.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeSupabase } from './helpers/fake-supabase'

process.env.ADMIN_SECRET = ''
process.env.EXPLEE_API_KEY = 'test-key'

const state = { supabase: null as FakeSupabase | null }
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => state.supabase,
}))

const searchExpleeCompanies = vi.fn()
vi.mock('@/lib/enrichment/sources/explee-client', async () => {
  const actual = await vi.importActual('@/lib/enrichment/sources/explee-client')
  return {
    ...actual,
    searchExpleeCompanies: (...args: unknown[]) => searchExpleeCompanies(...args),
  }
})

import { POST } from '../app/api/admin/explee-discovery/route'

function makeReq(body: Record<string, unknown>) {
  return new NextRequest('https://example.com/api/admin/explee-discovery', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/explee-discovery', () => {
  beforeEach(() => {
    searchExpleeCompanies.mockReset()
    state.supabase = new FakeSupabase()
  })

  it('maps every advanced filter field to its real Explee filter name', async () => {
    searchExpleeCompanies.mockResolvedValue({
      companies: [{ name: 'Acme Corp', domain: 'acme.com' }],
      meta: { total: 1, results_count: 1, credits_charged: 0, remaining_balance: 100 },
    })

    await POST(makeReq({
      definition: 'manufacturing company',
      geoInclude: ['IN'],
      sizeMin: 50, sizeMax: 200,
      revenueMin: 1_000_000, revenueMax: 9_999_999,
      foundedMin: 2010, foundedMax: 2023,
      isB2b: true, isTech: true, isSaas: true, isStartup: true, isDigital: true, isAi: true, isMerchant: true,
      hasPublicEmails: true, hasCompanyPhone: true, hasLinkedinPage: true, hasEmployeesOnLinkedin: true,
      page: 2, pageSize: 20,
    }))

    expect(searchExpleeCompanies).toHaveBeenCalledWith(
      {
        definition: 'manufacturing company',
        geo_include: ['IN'],
        size: { min: 50, max: 200 },
        revenue_annual: { min: 1_000_000, max: 9_999_999 },
        founded: { min: 2010, max: 2023 },
        is_b2b: true, is_tech: true, is_saas: true, is_startup: true, is_digital: true, is_ai: true, is_merchant: true,
        has_public_emails: true, has_company_phone: true, has_linkedin_page: true, has_employees_on_linkedin: true,
      },
      20,
      2,
    )
  })

  it('omits unset boolean/range filters entirely rather than sending false/empty ranges', async () => {
    searchExpleeCompanies.mockResolvedValue({ companies: [], meta: { total: 0, results_count: 0, credits_charged: 0, remaining_balance: 100 } })

    await POST(makeReq({ definition: 'automotive company' }))

    expect(searchExpleeCompanies).toHaveBeenCalledWith(
      { definition: 'automotive company', geo_include: undefined, size: undefined, revenue_annual: undefined, founded: undefined,
        is_b2b: undefined, is_saas: undefined, is_startup: undefined, is_tech: undefined, is_digital: undefined, is_ai: undefined, is_merchant: undefined,
        has_public_emails: undefined, has_company_phone: undefined, has_linkedin_page: undefined, has_employees_on_linkedin: undefined },
      20,
      1,
    )
  })

  it('annotates a result already present in pipeline_test_runs as already researched, without dropping it', async () => {
    searchExpleeCompanies.mockResolvedValue({
      companies: [
        { name: 'Acme Corp', domain: 'acme.com' },
        { name: 'New Co', domain: 'newco.com' },
      ],
      meta: { total: 2, results_count: 2, credits_charged: 0, remaining_balance: 100 },
    })
    state.supabase!.seed('pipeline_test_runs', [
      { company_url: 'https://acme.com', domain: 'acme.com', created_at: '2026-08-01T00:00:00Z' },
    ])

    const res = await POST(makeReq({ definition: 'manufacturing company' }))
    const json = await res.json()

    expect(json.companies).toHaveLength(2)
    const acme = json.companies.find((c: { name: string }) => c.name === 'Acme Corp')
    const newco = json.companies.find((c: { name: string }) => c.name === 'New Co')
    expect(acme.alreadyResearched).toBe(true)
    expect(acme.lastResearchedAt).toBe('2026-08-01T00:00:00Z')
    expect(newco.alreadyResearched).toBe(false)
  })
})

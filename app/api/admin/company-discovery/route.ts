// ============================================================
// Admin: Company Discovery — POST /api/admin/company-discovery
// ============================================================
// Given an ICP segment (free text — either typed by the user or copied from
// a prior research run's icp_segments), returns real, named candidate
// companies for the SDR to send into the existing 4-step research pipeline.
// See lib/enrichment/company-discovery.ts for the discovery logic itself —
// this route is a thin wrapper, same shape as batch-parse/route.ts.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { discoverCompanies, filterAlreadyResearched, normalizeDomain } from '@/lib/enrichment/company-discovery'
import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { qualifyBySizeStructured } from '@/lib/company-universe/discovery'

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json().catch(() => null)
  const icpSegment = typeof body?.icpSegment === 'string' ? body.icpSegment.trim() : ''
  // Comma-separated so the existing single-field UI can pass more than one
  // exclude name without a UI rework (see app/admin/company-discovery/page.tsx).
  const excludeCompanyNames = typeof body?.excludeCompanyName === 'string'
    ? body.excludeCompanyName.split(',').map((s: string) => s.trim()).filter(Boolean)
    : []

  if (!icpSegment) {
    return NextResponse.json({ success: false, error: 'icpSegment is required' }, { status: 400 })
  }

  const result = await discoverCompanies(icpSegment, excludeCompanyNames.length > 0 ? excludeCompanyNames : undefined)

  // Cross-search dedup: drop candidates already sent through the research
  // pipeline in a prior run (same or different ICP segment), using
  // pipeline_test_runs as the source of truth. Non-fatal on DB error — an
  // already-researched company resurfacing once is far cheaper than the
  // whole discovery request failing.
  if (result.companies.length > 0) {
    try {
      const supabase = createServerClient()
      const { data: history } = await supabase
        .from('pipeline_test_runs')
        .select('company_url, domain')

      const { survivors, filteredOut } = filterAlreadyResearched(
        result.companies,
        (history ?? []).map(h => ({ companyUrl: h.company_url, domain: h.domain })),
      )

      if (filteredOut.length > 0) {
        result.companies = survivors
        result.reason = `${result.reason} | ${filteredOut.length} already-researched duplicate(s) filtered`
        if (result.companies.length === 0) {
          result.sufficiency = 'insufficient'
        }
      }
    } catch (e) {
      logger.warn('CompanyDiscovery', 'already-researched dedup skipped', e instanceof Error ? e.message : String(e))
    }
  }

  // Section 18 of Demaze_Multi_Source_Company_Universe_Claude_Prompt.md:
  // "Integrate structured source evidence into size qualification...
  // prefer deterministic evidence over LLM inference... if a structured
  // source clearly establishes a company is far above the ICP ceiling,
  // reject deterministically, do not spend an LLM call." This checks
  // company_universe (built by the new lib/company-universe/ ingestion
  // layer) for any surviving candidate whose domain is already known
  // there — additive only: a candidate with no company_universe match
  // (the common case until that table has real ingested data) is
  // completely unaffected, same graceful-degradation contract as the
  // already-researched dedup block above. Deliberately kept at the route
  // layer, not inside discoverCompanies() itself, which stays Supabase-free
  // per its own established "pure lib, I/O at the route layer" convention.
  const employeeCountMax = typeof body?.employeeCountMax === 'number' ? body.employeeCountMax : undefined
  const revenueMaxUsd = typeof body?.revenueMaxUsd === 'number' ? body.revenueMaxUsd : undefined
  if (result.companies.length > 0 && (employeeCountMax !== undefined || revenueMaxUsd !== undefined)) {
    try {
      const supabase = createServerClient()
      const domains = result.companies.map(c => c.domain).filter((d): d is string => !!d).map(normalizeDomain)
      if (domains.length > 0) {
        const { data: universeMatches } = await supabase
          .from('company_universe')
          .select('domain, employee_count, employee_count_min, revenue, revenue_currency')
          .in('domain', domains)

        const byDomain = new Map((universeMatches ?? []).map(row => [row.domain as string, row]))
        const survivors: typeof result.companies = []
        for (const c of result.companies) {
          const universeRow = c.domain ? byDomain.get(normalizeDomain(c.domain)) : undefined
          if (!universeRow) { survivors.push(c); continue }
          const q = qualifyBySizeStructured(
            {
              canonicalName: c.name,
              status: 'unknown',
              industryCodes: [], sicCodes: [], naicsCodes: [],
              employeeCount: universeRow.employee_count ?? undefined,
              employeeCountMin: universeRow.employee_count_min ?? undefined,
              revenue: universeRow.revenue ?? undefined,
              revenueCurrency: universeRow.revenue_currency ?? undefined,
            },
            { employeeCountMax, revenueMaxUsd }
          )
          if (q.verdict === 'reject') {
            result.rejected_candidates = [...(result.rejected_candidates ?? []), { name: c.name, reason: q.reason }]
          } else {
            survivors.push(c)
          }
        }
        const rejectedCount = result.companies.length - survivors.length
        if (rejectedCount > 0) {
          result.companies = survivors
          result.reason = `${result.reason} | ${rejectedCount} rejected via structured-source size qualification`
          if (result.companies.length === 0) result.sufficiency = 'insufficient'
        }
      }
    } catch (e) {
      logger.warn('CompanyDiscovery', 'structured size qualification skipped', e instanceof Error ? e.message : String(e))
    }
  }

  return NextResponse.json({ success: true, ...result })
}

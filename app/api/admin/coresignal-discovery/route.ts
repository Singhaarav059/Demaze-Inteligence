// ============================================================
// Admin: Coresignal Discovery — POST /api/admin/coresignal-discovery
// ============================================================
// Given firmographic filters (industry, country, employee-count range,
// founding-year range), returns real, named candidate companies sourced
// from Coresignal for the SDR to send into the existing 4-step research
// pipeline. See lib/enrichment/coresignal-discovery.ts for the discovery
// logic itself — this route is a thin wrapper, same shape as
// company-discovery/route.ts (including the identical already-researched
// dedup block, duplicated rather than shared per this codebase's own
// precedent of small route-layer I/O glue staying local to each route).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { discoverCompaniesFromCoresignal } from '@/lib/enrichment/coresignal-discovery'
import { filterAlreadyResearched } from '@/lib/enrichment/company-discovery'
import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json().catch(() => null)
  const industry = typeof body?.industry === 'string' ? body.industry.trim() : undefined
  const country = typeof body?.country === 'string' ? body.country.trim() : undefined
  const name = typeof body?.name === 'string' ? body.name.trim() : undefined
  const employeesCountGte = Number.isFinite(body?.employeesCountGte) ? Number(body.employeesCountGte) : undefined
  const employeesCountLte = Number.isFinite(body?.employeesCountLte) ? Number(body.employeesCountLte) : undefined
  const foundedYearGte = Number.isFinite(body?.foundedYearGte) ? Number(body.foundedYearGte) : undefined
  const foundedYearLte = Number.isFinite(body?.foundedYearLte) ? Number(body.foundedYearLte) : undefined
  const excludeCompanyNames = typeof body?.excludeCompanyName === 'string'
    ? body.excludeCompanyName.split(',').map((s: string) => s.trim()).filter(Boolean)
    : []
  const maxResults = Number.isFinite(body?.maxResults) ? Number(body.maxResults) : undefined

  const result = await discoverCompaniesFromCoresignal(
    { industry, country, name, employeesCountGte, employeesCountLte, foundedYearGte, foundedYearLte },
    excludeCompanyNames.length > 0 ? excludeCompanyNames : undefined,
    { maxResults },
  )

  // Cross-search dedup: drop candidates already sent through the research
  // pipeline in a prior run, same as company-discovery/route.ts. Non-fatal
  // on DB error — an already-researched company resurfacing once is far
  // cheaper than the whole discovery request failing.
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
      logger.warn('CoresignalDiscovery', 'already-researched dedup skipped', e instanceof Error ? e.message : String(e))
    }
  }

  return NextResponse.json({ success: true, ...result })
}

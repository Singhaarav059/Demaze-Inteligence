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
import { discoverCompanies, filterAlreadyResearched } from '@/lib/enrichment/company-discovery'
import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

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

  return NextResponse.json({ success: true, ...result })
}

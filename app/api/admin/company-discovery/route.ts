// ============================================================
// Admin: Company Discovery — POST /api/admin/company-discovery
// ============================================================
// Given one of Demaze's 3 active target sectors (manufacturing/automotive/
// ecommerce — see lib/sector-playbook/types.ts's TargetSector), returns
// real, named candidate companies for the SDR to send into the existing
// 4-step research pipeline. See lib/enrichment/company-discovery.ts for the
// discovery logic itself — this route is a thin wrapper, same shape as
// batch-parse/route.ts.
//
// 2026-08-18 REWORK: `icpSegment` free-text search is gone — `sector` is
// now required and restricted to the 3 active sectors (enforces "only
// discover these 3 sectors" at the code level, not just by UI convention).
// An optional `refinement` string composes WITH the sector (never
// standalone). An optional `targetCount` switches to the "keep discovering
// until N genuinely new companies are found" loop
// (discoverCompaniesUntil()) instead of a single search pass. Every
// returned company (in either mode) has already been run through
// company-qualification.ts's qualifyCandidate() against the persistent
// company_registry table — dedup/already-researched/already-outreached/
// wrong-sector/size-band are all enforced here, not left to the UI.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { discoverCompaniesForSector, discoverCompaniesUntil } from '@/lib/enrichment/company-discovery'
import { qualifyAndAnnotate } from '@/lib/enrichment/company-qualification'
import { emptyFunnel, recordDiscovered } from '@/lib/enrichment/discovery-funnel'
import { createServerClient } from '@/lib/supabase/server'
import type { TargetSector } from '@/lib/sector-playbook/types'

const VALID_SECTORS: TargetSector[] = ['manufacturing', 'automotive', 'ecommerce']

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json().catch(() => null)
  const sectorRaw = typeof body?.sector === 'string' ? body.sector.trim().toLowerCase() : ''
  if (!VALID_SECTORS.includes(sectorRaw as TargetSector)) {
    return NextResponse.json(
      { success: false, error: `"sector" is required and must be one of: ${VALID_SECTORS.join(', ')}` },
      { status: 400 },
    )
  }
  const sector = sectorRaw as TargetSector

  const refinement = typeof body?.refinement === 'string' && body.refinement.trim() ? body.refinement.trim() : undefined
  const excludeCompanyNames = typeof body?.excludeCompanyName === 'string'
    ? body.excludeCompanyName.split(',').map((s: string) => s.trim()).filter(Boolean)
    : undefined
  const targetCount = typeof body?.targetCount === 'number' && body.targetCount > 0
    ? Math.floor(body.targetCount)
    : undefined

  const supabase = createServerClient()

  // ── Target-count mode — loop until N genuinely new qualified companies
  // are found (or sources run out). Only the qualified survivors are
  // returned — the funnel counts show what was filtered along the way.
  if (targetCount) {
    const result = await discoverCompaniesUntil(supabase, sector, targetCount, { refinement, excludeCompanyNames })
    return NextResponse.json({
      success: true,
      sector,
      companies: result.companies,
      sufficiency: result.companies.length > 0 ? 'sufficient' : 'insufficient',
      reason: `${result.companies.length} of ${targetCount} requested new companies found (${result.stoppedReason}) across ${result.iterationsUsed} iteration(s)`,
      funnel: result.funnel,
      iterationsUsed: result.iterationsUsed,
      stoppedReason: result.stoppedReason,
    })
  }

  // ── Single-pass mode — one search, every candidate qualified and
  // annotated (including locked ones, which the UI shows but
  // default-deselects rather than silently dropping).
  const result = await discoverCompaniesForSector(sector, { refinement, excludeCompanyNames })
  const funnel = emptyFunnel()
  recordDiscovered(funnel, result.companies.length)
  const companies = await qualifyAndAnnotate(supabase, result.companies, sector, funnel)

  return NextResponse.json({
    success: true,
    sector,
    companies,
    sufficiency: result.sufficiency,
    reason: result.reason,
    candidates_considered: result.candidates_considered,
    rejected_candidates: result.rejected_candidates,
    funnel,
  })
}

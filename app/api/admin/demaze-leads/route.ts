// ============================================================
// Admin: Demaze Leads — POST /api/admin/demaze-leads
// ============================================================
// Given demazetech.com's most recent CACHED full-pipeline research run
// (never re-runs research here — that's a separate, explicit, quota-spending
// action the client triggers via the existing /api/admin/test-analysis +
// /api/admin/test-runs endpoints), runs company discovery across Demaze's 3
// active target sectors and aggregates the results into one deduped lead
// list via aggregateLeadsAcrossSegments().
// See lib/enrichment/demaze-leads.ts for the aggregation logic and the
// product-reframing note this endpoint exists to serve.
//
// 2026-08-18 REWORK: 'discover' mode used to loop over Demaze's own
// research-derived ICP segments (arbitrary strings like "oil and gas",
// "shipbuilding") — that's gone. It now loops over the 3 active target
// sectors (lib/sector-playbook's TargetSector: manufacturing/automotive/
// ecommerce) via discoverCompaniesForSector(), enforcing "only these 3
// sectors" the same way /api/admin/company-discovery does. Demaze's own
// research-derived ICP segments are still surfaced in 'profile' mode for
// display/context, but no longer drive what gets discovered.
//
// Two-phase body shape (2026-07-16, 5-step Discover workflow) — both
// optional, fully backward compatible with the original no-body call:
//   { mode: 'profile' }              -> cached icp_segments (context only)
//                                        + the 3 active sectors, NO
//                                        discovery calls at all (zero
//                                        Tavily/Serper spend).
//   { mode: 'discover', sectors }    -> runs discoverCompaniesForSector()
//                                        for the given sector label(s)
//                                        (case-insensitive match against
//                                        the 3 active sector labels)
//                                        instead of all 3.
//   (no body / mode omitted)         -> discovery across all 3 sectors.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { discoverCompaniesForSector, type CompanyMatch } from '@/lib/enrichment/company-discovery'
import { qualifyAndAnnotate } from '@/lib/enrichment/company-qualification'
import { emptyFunnel, recordDiscovered, type DiscoveryFunnel } from '@/lib/enrichment/discovery-funnel'
import { aggregateLeadsAcrossSegments, withConfirmedSectors, DEMAZE_DOMAIN, DEMAZE_EXCLUDE_NAMES } from '@/lib/enrichment/demaze-leads'
import { getAllSectorPlaybooks } from '@/lib/sector-playbook/playbooks'

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json().catch(() => null)
  const mode = body?.mode === 'profile' ? 'profile' : body?.mode === 'discover' ? 'discover' : null
  const requestedSectorLabels: string[] = Array.isArray(body?.sectors)
    ? body.sectors.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
    // Backward compatible with the older `segments` field name.
    : Array.isArray(body?.segments)
    ? body.segments.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
    : []

  const supabase = createServerClient()

  const { data: rows, error } = await supabase
    .from('pipeline_test_runs')
    .select('id, final_result, created_at')
    .eq('domain', DEMAZE_DOMAIN)
    .eq('operation', 'full_pipeline')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const cached = rows?.[0]
  if (!cached?.final_result) {
    // No cached research yet — client should offer to run
    // /api/admin/test-analysis against DEMAZE_URL first, persist it via
    // /api/admin/test-runs (same pattern every other page already uses),
    // then retry this endpoint.
    return NextResponse.json({ success: true, needsResearch: true })
  }

  // Restricted to exactly the 3 active target sectors — NOT merged with
  // Demaze's own research-derived ICP segments anymore. Showing an extra,
  // non-restricted segment as a selectable chip (e.g. a stray "Healthcare"
  // segment demazetech.com's own homepage copy might mention) would be a
  // dead end once selected, since 'discover' mode below only ever searches
  // the 3 active sectors regardless of what's requested. withConfirmedSectors([])
  // reduces to exactly the 3 confirmed-sector entries with no research-
  // derived merge, reusing the existing function rather than duplicating
  // its ICPSegment-shaping logic.
  const icpSegments = withConfirmedSectors([])
  const playbooks = getAllSectorPlaybooks()

  // Profile-only phase (Step 1/2): return the cached sectors so the client
  // can render them for selection — no discovery call, no quota spent.
  if (mode === 'profile') {
    return NextResponse.json({
      success: true,
      needsResearch: false,
      icpSegments,
      activeSectors: playbooks.map(p => ({ sector: p.sector, label: p.label })),
      leads: [],
      researchedAt: cached.created_at,
      reason: `${playbooks.length} active target sector(s) available for discovery`,
    })
  }

  // Discover phase — restricted to the 3 active target sectors, optionally
  // narrowed by the requested sector label(s). Falls back to ALL 3 when no
  // explicit selection is given.
  const sectorsToSearch = requestedSectorLabels.length > 0
    ? playbooks.filter(p => requestedSectorLabels.some(name => name.toLowerCase() === p.label.toLowerCase() || name.toLowerCase() === p.sector))
    : playbooks

  if (sectorsToSearch.length === 0) {
    return NextResponse.json({
      success: true,
      needsResearch: false,
      icpSegments,
      leads: [],
      researchedAt: cached.created_at,
      reason: 'none of the requested sector name(s) matched an active target sector',
    })
  }

  // Sequential per-sector discovery — same "respect real Firecrawl/Tavily
  // quota limits" discipline as researchSelected()/batch-upload's loops.
  const funnel: DiscoveryFunnel = emptyFunnel()
  const perSegment: Array<{ segmentName: string; companies: CompanyMatch[] }> = []
  for (const playbook of sectorsToSearch) {
    const result = await discoverCompaniesForSector(playbook.sector, { excludeCompanyNames: DEMAZE_EXCLUDE_NAMES })
    recordDiscovered(funnel, result.companies.length)
    const annotated = await qualifyAndAnnotate(supabase, result.companies, playbook.sector, funnel)
    const qualifiedOnly = annotated.filter(c => c.existingStatus === 'qualified')
    perSegment.push({ segmentName: playbook.label, companies: qualifiedOnly })
  }

  const leads = aggregateLeadsAcrossSegments(perSegment)

  return NextResponse.json({
    success: true,
    needsResearch: false,
    icpSegments,
    leads,
    researchedAt: cached.created_at,
    reason: `${leads.length} genuinely new lead(s) aggregated across ${sectorsToSearch.length} active sector(s)`,
    funnel,
  })
}

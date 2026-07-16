// ============================================================
// Admin: Demaze Leads — POST /api/admin/demaze-leads
// ============================================================
// Given demazetech.com's most recent CACHED full-pipeline research run
// (never re-runs research here — that's a separate, explicit, quota-spending
// action the client triggers via the existing /api/admin/test-analysis +
// /api/admin/test-runs endpoints), reads its icp_segments and runs
// discoverCompanies() once per segment (sequential — same quota discipline
// as every other batch loop in this repo), then aggregates the results into
// one deduped lead list via aggregateLeadsAcrossSegments().
// See lib/enrichment/demaze-leads.ts for the aggregation logic and the
// product-reframing note this endpoint exists to serve.
//
// Two-phase body shape (2026-07-16, 5-step Discover workflow) — both
// optional, fully backward compatible with the original no-body call:
//   { mode: 'profile' }              -> cached icp_segments only, NO
//                                        discoverCompanies() calls at all
//                                        (zero Tavily/Serper spend). Used by
//                                        Discover's Step 1/2 to show Demaze's
//                                        own target sectors before the user
//                                        picks any.
//   { mode: 'discover', segments }   -> runs discoverCompanies() only for the
//                                        given segment name(s) (case-
//                                        insensitive match against the
//                                        cached icp_segments) instead of all
//                                        of them. Used by Step 3's sector
//                                        selection -> Step 4 lead discovery.
//   (no body / mode omitted)         -> original behavior: discovery across
//                                        every cached segment in one shot.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { discoverCompanies, filterAlreadyResearched, type CompanyMatch } from '@/lib/enrichment/company-discovery'
import { aggregateLeadsAcrossSegments, DEMAZE_DOMAIN, DEMAZE_EXCLUDE_NAMES } from '@/lib/enrichment/demaze-leads'
import type { ICPSegment } from '@/lib/enrichment/icp-generator'

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json().catch(() => null)
  const mode = body?.mode === 'profile' ? 'profile' : body?.mode === 'discover' ? 'discover' : null
  const requestedSegments: string[] = Array.isArray(body?.segments)
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

  const finalResult = cached.final_result as { icp_segments?: ICPSegment[] }
  const icpSegments = finalResult.icp_segments ?? []

  if (icpSegments.length === 0) {
    return NextResponse.json({
      success: true,
      needsResearch: false,
      icpSegments: [],
      leads: [],
      researchedAt: cached.created_at,
      reason: 'Cached Demaze research has no ICP segments (insufficient evidence on that run) — re-run research, or search a segment manually below.',
    })
  }

  // Profile-only phase (Step 1/2): return the cached sectors so the client
  // can render them for selection — no discoverCompanies() call, no quota
  // spent, since discovery only makes sense once the user has picked which
  // sector(s) to search (Step 3/4).
  if (mode === 'profile') {
    return NextResponse.json({
      success: true,
      needsResearch: false,
      icpSegments,
      leads: [],
      researchedAt: cached.created_at,
      reason: `${icpSegments.length} target sector(s) available from cached Demaze research`,
    })
  }

  // Discover phase, scoped to selected segments only (mode === 'discover').
  // Falls back to ALL cached segments when no explicit selection is given —
  // preserves the original one-shot "Find Leads for Demaze" behavior for any
  // caller that doesn't pass `segments`.
  const segmentsToSearch = requestedSegments.length > 0
    ? icpSegments.filter(seg => requestedSegments.some(name => name.toLowerCase() === seg.name.toLowerCase()))
    : icpSegments

  if (segmentsToSearch.length === 0) {
    return NextResponse.json({
      success: true,
      needsResearch: false,
      icpSegments,
      leads: [],
      researchedAt: cached.created_at,
      reason: 'none of the requested sector name(s) matched a cached ICP segment',
    })
  }

  // Sequential per-segment discovery — same "respect real Firecrawl/Tavily
  // quota limits" discipline as researchSelected()/batch-upload's loops.
  const perSegment: Array<{ segmentName: string; companies: CompanyMatch[] }> = []
  for (const seg of segmentsToSearch) {
    const result = await discoverCompanies(seg.name, DEMAZE_EXCLUDE_NAMES)
    perSegment.push({ segmentName: seg.name, companies: result.companies })
  }

  let leads = aggregateLeadsAcrossSegments(perSegment)

  // Cross-search dedup against already-researched companies — same as
  // /api/admin/company-discovery.
  try {
    const { data: history } = await supabase.from('pipeline_test_runs').select('company_url, domain')
    const { survivors } = filterAlreadyResearched(
      leads,
      (history ?? []).map(h => ({ companyUrl: h.company_url, domain: h.domain })),
    )
    leads = survivors as typeof leads
  } catch (e) {
    console.warn('[DemazeLeads] already-researched dedup skipped:', e instanceof Error ? e.message : String(e))
  }

  return NextResponse.json({
    success: true,
    needsResearch: false,
    icpSegments,
    leads,
    researchedAt: cached.created_at,
    reason: `${leads.length} lead(s) aggregated across ${segmentsToSearch.length} selected ICP segment(s)`,
  })
}

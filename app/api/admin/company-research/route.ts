// ============================================================
// Admin: Company Signals Research — POST + GET /api/admin/company-research
// ============================================================
// POST: thin wrapper around researchCompanySignals() (lib/research/company-
// signals.ts) — the Demaze intelligence layer's single grounded-search call.
// Non-fatal persistence to run history, same pattern as
// useCompanyDiscoverySearch.ts's own persistResult().
//
// GET: fetches back the most recent already-persisted result for a company
// (?domain= or ?name=) — added so Company Discovery's "already researched"
// rows (companies researched on a PRIOR visit to that page, flagged by
// explee-discovery/route.ts's annotateAlreadyResearched) can show their
// real result on demand instead of the "View report" action silently never
// appearing, which was the previous behavior (result was only ever kept in
// in-memory React state from the POST response, never fetched back).
// Deliberately scoped to operation='company_signals_research' rows only —
// a company may also have been researched via the separate deep pipeline
// (Auto Flow/Wizard/Research), whose final_result is a completely different
// shape (CompanyResearchResult here vs. the full analysisResult there);
// CompanyResearchCard.tsx can only render the former, so a deep-pipeline
// row is correctly left unmatched here rather than force-fit into the
// wrong shape.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { researchCompanySignals, type CompanyResearchInput, type CompanyResearchResult } from '@/lib/research/company-signals'
import { normalizeDomain, normalizeName } from '@/lib/enrichment/company-discovery'
import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const domain = req.nextUrl.searchParams.get('domain')?.trim() || null
  const name = req.nextUrl.searchParams.get('name')?.trim() || null
  if (!domain && !name) {
    return NextResponse.json({ success: false, error: 'domain or name is required' }, { status: 400 })
  }

  // No .limit() here, matching annotateAlreadyResearched's own full-scan
  // pattern (explee-discovery/route.ts) — the operation filter already
  // narrows this to just this page's own research rows, and normalized
  // domain/name matching (below) can't be pushed into the SQL query since
  // stored values aren't guaranteed to already be normalized.
  const supabase = createServerClient()
  const { data: rows, error } = await supabase
    .from('pipeline_test_runs')
    .select('domain, company_url, final_result')
    .eq('operation', 'company_signals_research')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const wantDomain = domain ? normalizeDomain(domain) : null
  const wantName = name ? normalizeName(name) : null
  const match = (rows ?? []).find(r => {
    if (wantDomain && r.domain && normalizeDomain(r.domain) === wantDomain) return true
    if (wantName && r.company_url && normalizeName(r.company_url) === wantName) return true
    return false
  })

  return NextResponse.json({ success: true, result: (match?.final_result as CompanyResearchResult | undefined) ?? null })
}

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 })
  }

  const input: CompanyResearchInput = {
    name,
    domain: typeof body?.domain === 'string' ? body.domain : undefined,
    industry: typeof body?.industry === 'string' ? body.industry : undefined,
    hqLocation: typeof body?.hqLocation === 'string' ? body.hqLocation : undefined,
    employeeCount: Number.isFinite(body?.employeeCount) ? Number(body.employeeCount) : undefined,
    founded: Number.isFinite(body?.founded) ? Number(body.founded) : undefined,
    revenueAnnual: Number.isFinite(body?.revenueAnnual) ? Number(body.revenueAnnual) : undefined,
  }

  const result = await researchCompanySignals(input)
  await persistResult(input, result)

  return NextResponse.json({ success: true, result })
}

async function persistResult(input: CompanyResearchInput, result: Awaited<ReturnType<typeof researchCompanySignals>>) {
  try {
    const supabase = createServerClient()
    // supabase-js resolves {error} rather than throwing on a DB-level
    // rejection (e.g. a CHECK constraint violation) — must check it
    // explicitly, or a persistently-failing insert silently never persists
    // anything while every caller believes it succeeded. Confirmed this
    // exact failure mode live before this check existed (see migration
    // 028's header comment).
    const { error } = await supabase.from('pipeline_test_runs').insert({
      company_url: input.domain ?? input.name,
      domain: input.domain ?? null,
      operation: 'company_signals_research',
      status: result.error ? 'error' : 'completed',
      final_result: result,
      error_message: result.error ?? null,
    })
    if (error) {
      logger.warn('CompanyResearch', 'failed to persist run', error.message)
    }
  } catch (e) {
    logger.warn('CompanyResearch', 'failed to persist run', e instanceof Error ? e.message : String(e))
  }
}

// ============================================================
// Admin: Company Signals Research — POST /api/admin/company-research
// ============================================================
// Thin wrapper around researchCompanySignals() (lib/research/company-
// signals.ts) — the Demaze intelligence layer's single grounded-search call.
// Non-fatal persistence to run history, same pattern as
// useCompanyDiscoverySearch.ts's own persistResult().
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { researchCompanySignals, type CompanyResearchInput } from '@/lib/research/company-signals'
import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

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
    await supabase.from('pipeline_test_runs').insert({
      company_url: input.domain ?? input.name,
      domain: input.domain ?? null,
      operation: 'company_signals_research',
      status: result.error ? 'error' : 'completed',
      final_result: result,
      error_message: result.error ?? null,
    })
  } catch (e) {
    logger.warn('CompanyResearch', 'failed to persist run', e instanceof Error ? e.message : String(e))
  }
}

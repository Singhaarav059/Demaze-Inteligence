// ============================================================
// Admin: Test Runs — GET + POST /api/admin/test-runs
// ============================================================
// GET  — fetch run history from pipeline_test_runs
// POST — save a completed run to pipeline_test_runs
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

// ── GET: fetch run history ────────────────────────────────────

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100)
  const operation = searchParams.get('operation') // optional filter
  // List views (Home, Contacts company picker) only ever read
  // final_result.company_name/company_fit — shipping the full JSONB blob
  // (evidence, opportunities, competitors, ICP data, ...) for 50-100 rows
  // is what makes this endpoint slow. Only run-history needs the full object.
  const summary = searchParams.get('summary') === 'true'

  const supabase = createServerClient()

  let query = summary
    ? supabase
        .from('pipeline_test_runs')
        .select(
          'id, company_url, domain, operation, status, scraped_pages, failed_pages, quality_score, quality_note, token_usage, provider_used, model_used, execution_time_ms, scrape_time_ms, analysis_time_ms, discovery_method, website_discovery, error_message, created_at, company_name:final_result->>company_name, company_fit_label:final_result->company_fit->>label'
        )
    : supabase
        .from('pipeline_test_runs')
        .select(
          'id, company_url, domain, operation, status, scraped_pages, failed_pages, quality_score, quality_note, token_usage, provider_used, model_used, execution_time_ms, scrape_time_ms, analysis_time_ms, discovery_method, website_discovery, error_message, created_at, final_result'
        )

  query = query.order('created_at', { ascending: false }).limit(limit)

  if (operation) {
    query = query.eq('operation', operation)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const runs = summary
    ? (data ?? []).map((row: Record<string, unknown>) => {
        const { company_name, company_fit_label, ...rest } = row
        return { ...rest, final_result: { company_name, company_fit: { label: company_fit_label } } }
      })
    : data ?? []

  return NextResponse.json({ success: true, runs })
}

// ── POST: save a run ──────────────────────────────────────────

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json()

  const {
    company_url,
    domain,
    operation,
    status,
    scraped_pages,
    failed_pages,
    quality_score,
    quality_note,
    token_usage,
    provider_used,
    model_used,
    ai_latency_ms,
    execution_time_ms,
    scrape_time_ms,
    analysis_time_ms,
    discovery_method,
    website_discovery,
    scrape_result,
    final_result,
    prompts,
    error_message,
  } = body

  if (!company_url || !operation) {
    return NextResponse.json(
      { success: false, error: 'company_url and operation are required' },
      { status: 400 }
    )
  }

  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('pipeline_test_runs')
    .insert({
      company_url,
      domain,
      operation,
      status: status ?? 'completed',
      scraped_pages: scraped_pages ?? 0,
      failed_pages: failed_pages ?? 0,
      quality_score: quality_score ?? 0,
      quality_note,
      token_usage: token_usage ?? 0,
      provider_used,
      model_used,
      ai_latency_ms,
      execution_time_ms,
      scrape_time_ms,
      analysis_time_ms,
      discovery_method,
      website_discovery,
      scrape_result,
      final_result,
      prompts,
      error_message,
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, id: data.id })
}

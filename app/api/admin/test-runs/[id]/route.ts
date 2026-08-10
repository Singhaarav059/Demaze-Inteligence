// ============================================================
// Admin: Test Run Detail — GET / PATCH / DELETE /api/admin/test-runs/[id]
// ============================================================
// GET   — returns a single run with full JSONB fields (scrape_result,
//         final_result, prompts) which are omitted from the list query.
// PATCH — re-saves a fresh research pass over an EXISTING row instead of
//         POST /api/admin/test-runs inserting a new one. Added 2026-08-10
//         for Auto Flow's runResearch(): re-researching a domain that
//         already has a tracked pipeline entry (contacts/a campaign
//         attached — see /api/admin/outbound/pipeline's ?domain= filter)
//         now updates that same run in place, so the company doesn't get a
//         second, disconnected row in the pipeline list. A domain with no
//         existing pipeline entry still goes through the normal POST
//         insert — this route is additive, not a replacement for it.
//         Accepts the same field shape as POST's insert body; `created_at`
//         is deliberately left untouched (this table has no updated_at
//         column, and Run History's own "when was this first researched"
//         framing is preserved on purpose).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('pipeline_test_runs')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 404 })
  }

  return NextResponse.json({ success: true, run: data })
}

// ── PATCH: re-save a fresh research pass over an existing run ──

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const body = await req.json()

  const {
    company_url,
    domain,
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

  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('pipeline_test_runs')
    .update({
      company_url,
      domain,
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
    .eq('id', id)
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, id: data.id })
}

// ── DELETE: remove a saved run ─────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const supabase = createServerClient()

  const { error } = await supabase
    .from('pipeline_test_runs')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

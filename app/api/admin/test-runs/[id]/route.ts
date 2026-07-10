// ============================================================
// Admin: Test Run Detail — GET /api/admin/test-runs/[id]
// ============================================================
// Returns a single run with full JSONB fields (scrape_result,
// final_result, prompts) which are omitted from the list query.
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

// ============================================================
// Admin: single Company Discovery Segment — GET + PATCH /api/admin/company-discovery/segments/[id]
// ============================================================
// GET: fetches one segment's stored filters, used by company-discovery/
// page.tsx's ?resumeSegmentId= handling to prefill and re-run a saved search.
// PATCH: bumps last_viewed_at to now — called when a "Continue" card is
// clicked, so segments naturally resurface in recency order on the Home
// dashboard.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('company_discovery_segments')
    .select('id, name, sector, filters, companies, total_found, created_at, last_viewed_at')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'Segment not found' }, { status: 404 })
  }

  return NextResponse.json({
    success: true,
    segment: {
      id: data.id,
      name: data.name,
      sector: data.sector,
      filters: data.filters,
      totalFound: data.total_found,
      createdAt: data.created_at,
      lastViewedAt: data.last_viewed_at,
    },
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const supabase = createServerClient()
  const { error } = await supabase
    .from('company_discovery_segments')
    .update({ last_viewed_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

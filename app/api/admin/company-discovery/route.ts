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
import { discoverCompanies } from '@/lib/enrichment/company-discovery'

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json().catch(() => null)
  const icpSegment = typeof body?.icpSegment === 'string' ? body.icpSegment.trim() : ''
  const excludeCompanyName = typeof body?.excludeCompanyName === 'string' ? body.excludeCompanyName.trim() : undefined

  if (!icpSegment) {
    return NextResponse.json({ success: false, error: 'icpSegment is required' }, { status: 400 })
  }

  const result = await discoverCompanies(icpSegment, excludeCompanyName || undefined)

  return NextResponse.json({ success: true, ...result })
}

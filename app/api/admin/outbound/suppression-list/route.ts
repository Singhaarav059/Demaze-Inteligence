// ============================================================
// Admin: Suppression List — GET / POST /api/admin/outbound/suppression-list
// ============================================================
// GET  — every suppressed address, newest first.
// POST — manual add (reason 'unsubscribed' or 'manual' — 'bounced' entries
//        are only ever added automatically, by check-replies/route.ts and
//        lib/outbound/sending/process-followup.ts detecting a real Gmail
//        bounce, never by hand here).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { listSuppressions, addToSuppressionList, type SuppressionReason } from '@/lib/outbound/sending/suppression'

const MANUAL_REASONS: SuppressionReason[] = ['unsubscribed', 'manual']

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const entries = await listSuppressions()
  return NextResponse.json({ success: true, entries })
}

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json().catch(() => ({}))
  const { email, reason, detail } = body

  if (!MANUAL_REASONS.includes(reason)) {
    return NextResponse.json(
      { success: false, error: `reason must be one of: ${MANUAL_REASONS.join(', ')}` },
      { status: 400 }
    )
  }

  const result = await addToSuppressionList({ email, reason, detail: detail || undefined })
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true, entry: result.entry })
}

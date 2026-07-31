// ============================================================
// Admin: Follow-Up Cadence Settings — GET / PUT /api/admin/outbound/followup-settings
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { getFollowupIntervals, updateFollowupIntervals } from '@/lib/outbound/sending/followup-settings'

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const intervals = await getFollowupIntervals()
  return NextResponse.json({ success: true, intervals })
}

export async function PUT(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json()
  const intervals = body.intervals
  if (!Array.isArray(intervals) || intervals.length !== 3) {
    return NextResponse.json({ success: false, error: 'intervals must be an array of exactly 3 numbers.' }, { status: 400 })
  }

  const result = await updateFollowupIntervals(intervals as [number, number, number])
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true, intervals })
}

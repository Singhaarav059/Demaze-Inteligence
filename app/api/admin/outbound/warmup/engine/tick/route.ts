// ============================================================
// Admin: Warmup Engine Tick — POST /api/admin/outbound/warmup/engine/tick
// ============================================================
// Manual, on-demand trigger for lib/outbound/warmup/engine/run-tick.ts —
// works independently of whether the autonomous scheduler
// (instrumentation.ts, gated behind WARMUP_ENGINE_ENABLED) is on, so the
// engine can be tested/run from the UI without waiting for or enabling the
// interval. Deliberately does NOT check WARMUP_ENGINE_ENABLED — an admin's
// explicit click here IS the confirmation, same reasoning this app already
// applies to every other real-send action (e.g. Auto Flow's Send Now).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { runAndLogWarmupEngineTick } from '@/lib/outbound/warmup/engine/run-tick'

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const summary = await runAndLogWarmupEngineTick()
  return NextResponse.json({ success: true, summary })
}

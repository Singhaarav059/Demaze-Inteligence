// ============================================================
// Admin: Follow-Up Engine Tick — POST /api/admin/outbound/followups/engine/tick
// ============================================================
// Manual, on-demand trigger for lib/outbound/sending/followup-engine/
// run-tick.ts — works independently of whether the autonomous scheduler
// (instrumentation.ts, gated behind FOLLOWUP_ENGINE_ENABLED) is on, so the
// engine can be verified from the UI before ever trusting the interval.
// Deliberately does NOT check FOLLOWUP_ENGINE_ENABLED — an admin's explicit
// click here IS the confirmation, same reasoning as the warmup engine's
// identical manual tick route.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { runAndLogFollowupEngineTick } from '@/lib/outbound/sending/followup-engine/run-tick'

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const summary = await runAndLogFollowupEngineTick()
  return NextResponse.json({ success: true, summary })
}

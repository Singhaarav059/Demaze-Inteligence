// ============================================================
// Admin: Sales Intelligence — POST /api/admin/sales-intelligence/generate
// ============================================================
// Body: { sourceRunId }. Runs the deterministic matcher (+ one small,
// bounded reasoning LLM call for the two stronger evidence tiers only —
// see lib/sales-knowledge/reasoning.ts) and upserts the result. Called
// only when a user reaches Auto Flow's "Sales Strategy" step — never from
// the always-running research pipeline.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { generateSalesIntelligence } from '@/lib/sales-knowledge/generate'

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json()
  const { sourceRunId } = body

  if (!sourceRunId || typeof sourceRunId !== 'string') {
    return NextResponse.json({ success: false, error: 'sourceRunId is required' }, { status: 400 })
  }

  try {
    const { row, knowledgeConfigured } = await generateSalesIntelligence(sourceRunId)
    return NextResponse.json({ success: true, salesIntelligence: row, knowledgeConfigured })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Failed to generate Sales Intelligence' },
      { status: 500 }
    )
  }
}

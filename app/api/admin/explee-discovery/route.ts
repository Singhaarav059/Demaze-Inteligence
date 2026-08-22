// ============================================================
// Admin: Explee Discovery POC — POST /api/admin/explee-discovery
// ============================================================
// Thin wrapper around searchExpleeCompanies(). POC only: no DB dedup, no
// research-pipeline hookup, no persistence — just a pass-through so the
// UI can show raw Explee results for a data-quality check before any
// production pipeline gets built on top of this.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { searchExpleeCompanies, ExpleeApiError, getExpleeApiKey } from '@/lib/enrichment/sources/explee-client'

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  if (!getExpleeApiKey()) {
    return NextResponse.json({ success: false, error: 'EXPLEE_API_KEY is not set' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const definition = typeof body?.definition === 'string' ? body.definition.trim() : ''
  if (!definition) {
    return NextResponse.json({ success: false, error: 'definition is required' }, { status: 400 })
  }

  const geoInclude = Array.isArray(body?.geoInclude)
    ? body.geoInclude.filter((s: unknown) => typeof s === 'string' && s.trim())
    : undefined
  const sizeMin = Number.isFinite(body?.sizeMin) ? Number(body.sizeMin) : undefined
  const sizeMax = Number.isFinite(body?.sizeMax) ? Number(body.sizeMax) : undefined
  const pageSize = Number.isFinite(body?.pageSize) ? Math.min(Math.max(Number(body.pageSize), 1), 20) : 20

  try {
    const result = await searchExpleeCompanies(
      {
        definition,
        geo_include: geoInclude && geoInclude.length > 0 ? geoInclude : undefined,
        size: (sizeMin !== undefined || sizeMax !== undefined) ? { min: sizeMin, max: sizeMax } : undefined,
      },
      pageSize,
    )
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    const message = e instanceof ExpleeApiError ? e.message : (e instanceof Error ? e.message : 'Explee search failed')
    return NextResponse.json({ success: false, error: message }, { status: 502 })
  }
}

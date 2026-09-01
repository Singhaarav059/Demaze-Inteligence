// ============================================================
// Admin: Company Discovery Segments — POST + GET /api/admin/company-discovery/segments
// ============================================================
// Persists a "target market" search (see company-discovery/page.tsx) so the
// Home dashboard's "Continue where you left off" section can show real
// research progress against it. Replaces the client-only localStorage
// recent-searches list — a row is created automatically after every
// successful search, no explicit "Save" action.
//
// Progress (`researchedCount`) is computed by matching each segment's
// snapshotted `companies` against pipeline_test_runs rows with
// operation='company_signals_research', using the exact same
// normalizeDomain()/normalizeName() matching explee-discovery/route.ts's
// annotateAlreadyResearched() already uses — reused directly, not
// reimplemented, so "already researched" means the same thing everywhere.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeDomain, normalizeName } from '@/lib/enrichment/company-discovery'
import { logger } from '@/lib/logger'

// jsonb does not preserve object key order (Postgres docs: "does not
// preserve the order of object keys"), so a value fetched back from the
// `filters` jsonb column can have keys in a different order than the
// client-built object even when semantically identical - a plain
// JSON.stringify comparison would treat every re-run as a new search. Sort
// keys recursively before stringifying so the comparison is order-blind.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

interface SegmentCompany {
  name: string
  domain?: string | null
  industry?: string | null
  employeeCount?: number | null
  hqLocation?: string | null
  founded?: number | null
  revenueAnnual?: number | null
}

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const sector = typeof body?.sector === 'string' ? body.sector.trim() : ''
  const companies = Array.isArray(body?.companies) ? (body.companies as SegmentCompany[]) : []
  if (!name || !sector || companies.length === 0) {
    return NextResponse.json({ success: false, error: 'name, sector, and at least one company are required' }, { status: 400 })
  }

  const filters = body?.filters && typeof body.filters === 'object' ? body.filters : {}
  const totalFound = Number.isFinite(body?.totalFound) ? Number(body.totalFound) : companies.length

  const supabase = createServerClient()

  // Re-running the same search (same sector + filters) should update the
  // existing Recent Searches entry, not add a duplicate row - see this
  // file's header comment. Matched by a key-order-blind stableStringify
  // (not a DB-level jsonb comparison) since jsonb round-trips don't
  // preserve the client's original key order.
  const { data: existingRows } = await supabase
    .from('company_discovery_segments')
    .select('id, filters')
    .eq('sector', sector)
  const serializedFilters = stableStringify(filters)
  const existing = (existingRows ?? []).find(r => stableStringify(r.filters ?? {}) === serializedFilters)

  if (existing) {
    const { error } = await supabase
      .from('company_discovery_segments')
      .update({ name, companies, total_found: totalFound, last_viewed_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) {
      logger.warn('CompanyDiscoverySegments', 'failed to update segment', error.message)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true, id: existing.id })
  }

  const { data, error } = await supabase
    .from('company_discovery_segments')
    .insert({ name, sector, filters, companies, total_found: totalFound })
    .select('id')
    .single()

  if (error) {
    logger.warn('CompanyDiscoverySegments', 'failed to save segment', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, id: data.id })
}

// Non-fatal per-segment progress annotation — an unannotated segment (0/0)
// is far cheaper than the whole list failing, same discipline as
// explee-discovery/route.ts's annotateAlreadyResearched().
async function annotateProgress(segments: { id: string; companies: SegmentCompany[] }[]) {
  const supabase = createServerClient()
  try {
    const { data: history } = await supabase
      .from('pipeline_test_runs')
      .select('company_url, domain')
      .eq('operation', 'company_signals_research')

    const researchedDomains = new Set<string>()
    const researchedNames = new Set<string>()
    for (const h of history ?? []) {
      if (h.domain) researchedDomains.add(normalizeDomain(h.domain))
      if (h.company_url) {
        const looksLikeDomainOrUrl = /^https?:\/\//i.test(h.company_url) || h.company_url.includes('.')
        if (looksLikeDomainOrUrl) researchedDomains.add(normalizeDomain(h.company_url))
        else researchedNames.add(normalizeName(h.company_url))
      }
    }

    return segments.map(s => {
      const researchedCount = s.companies.filter(c =>
        (c.domain && researchedDomains.has(normalizeDomain(c.domain))) ||
        (c.name && researchedNames.has(normalizeName(c.name)))
      ).length
      return { researchedCount, totalCount: s.companies.length }
    })
  } catch (e) {
    logger.warn('CompanyDiscoverySegments', 'progress annotation skipped', e instanceof Error ? e.message : String(e))
    return segments.map(s => ({ researchedCount: 0, totalCount: s.companies.length }))
  }
}

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit')) || 5, 1), 20)

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('company_discovery_segments')
    .select('id, name, sector, filters, companies, total_found, created_at, last_viewed_at')
    .order('last_viewed_at', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const rows = data ?? []
  const progress = await annotateProgress(rows.map(r => ({ id: r.id, companies: (r.companies as SegmentCompany[]) ?? [] })))

  const segments = rows.map((r, i) => ({
    id: r.id,
    name: r.name,
    sector: r.sector,
    filters: r.filters,
    totalFound: r.total_found,
    createdAt: r.created_at,
    lastViewedAt: r.last_viewed_at,
    researchedCount: progress[i].researchedCount,
    totalCount: progress[i].totalCount,
  }))

  return NextResponse.json({ success: true, segments })
}

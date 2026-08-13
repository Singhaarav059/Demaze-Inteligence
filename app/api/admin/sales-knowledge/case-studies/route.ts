// ============================================================
// Admin: Sales Knowledge Case Studies — GET / POST /api/admin/sales-knowledge/case-studies
// ============================================================
// Same convention as .../industries/route.ts. outcomes is a JSONB array of
// {metric, value, window?} — validated/filtered here rather than trusted
// as-is from the client, since a malformed entry would otherwise reach
// generated outreach copy.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import type { SalesKnowledgeCaseStudyOutcome } from '@/lib/sales-knowledge/types'

function toTagArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

function toOutcomes(value: unknown): SalesKnowledgeCaseStudyOutcome[] {
  if (!Array.isArray(value)) return []
  const out: SalesKnowledgeCaseStudyOutcome[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const metric = 'metric' in item ? String((item as Record<string, unknown>).metric ?? '').trim() : ''
    const val = 'value' in item ? String((item as Record<string, unknown>).value ?? '').trim() : ''
    if (!metric || !val) continue
    const windowVal = 'window' in item ? String((item as Record<string, unknown>).window ?? '').trim() : ''
    out.push(windowVal ? { metric, value: val, window: windowVal } : { metric, value: val })
  }
  return out
}

function toProvenance(value: unknown): 'named_client' | 'composite_illustrative' {
  return value === 'named_client' ? 'named_client' : 'composite_illustrative'
}

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const includeInactive = req.nextUrl.searchParams.get('include_inactive') === '1'
  const supabase = createServerClient()

  let query = supabase.from('sales_knowledge_case_studies').select('*').order('title', { ascending: true })
  if (!includeInactive) query = query.eq('is_active', true)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, caseStudies: data ?? [] })
}

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json()
  const { title, client, provenance, industry_tags, capability_tags, challenge, outcomes, source_doc } = body

  if (!title || !client || !challenge) {
    return NextResponse.json({ success: false, error: 'title, client, and challenge are required' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('sales_knowledge_case_studies')
    .insert({
      title: String(title).trim(),
      client: String(client).trim(),
      provenance: toProvenance(provenance),
      industry_tags: toTagArray(industry_tags),
      capability_tags: toTagArray(capability_tags),
      challenge: String(challenge).trim(),
      outcomes: toOutcomes(outcomes),
      source_doc: source_doc ? String(source_doc).trim() : null,
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, caseStudy: data })
}

// ============================================================
// Admin: Sales Knowledge Problems — GET / POST /api/admin/sales-knowledge/problems
// ============================================================
// Same convention as .../industries/route.ts.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

function toTagArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const includeInactive = req.nextUrl.searchParams.get('include_inactive') === '1'
  const supabase = createServerClient()

  let query = supabase.from('sales_knowledge_problems').select('*').order('label', { ascending: true })
  if (!includeInactive) query = query.eq('is_active', true)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, problems: data ?? [] })
}

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json()
  const { slug, label, description, industry_tags, evidence_keywords, capability_tags } = body

  if (!slug || !label) {
    return NextResponse.json({ success: false, error: 'slug and label are required' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('sales_knowledge_problems')
    .insert({
      slug: String(slug).trim(),
      label: String(label).trim(),
      description: description ? String(description).trim() : null,
      industry_tags: toTagArray(industry_tags),
      evidence_keywords: toTagArray(evidence_keywords),
      capability_tags: toTagArray(capability_tags),
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, problem: data })
}

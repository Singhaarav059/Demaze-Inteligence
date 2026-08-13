// ============================================================
// Admin: Sales Knowledge Industries — GET / POST /api/admin/sales-knowledge/industries
// ============================================================
// Same convention as /api/admin/outbound/integrations: verifyAdminRequest
// first, {success, ...} envelope, direct Supabase client, no repository
// abstraction. GET defaults to active-only (matches how the matcher reads
// this table); pass ?include_inactive=1 for the admin CRUD UI itself,
// which needs to show and let a user re-activate a soft-deleted row.
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

  let query = supabase.from('sales_knowledge_industries').select('*').order('label', { ascending: true })
  if (!includeInactive) query = query.eq('is_active', true)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, industries: data ?? [] })
}

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json()
  const { slug, label, description, keywords } = body

  if (!slug || !label) {
    return NextResponse.json({ success: false, error: 'slug and label are required' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('sales_knowledge_industries')
    .insert({
      slug: String(slug).trim(),
      label: String(label).trim(),
      description: description ? String(description).trim() : null,
      keywords: toTagArray(keywords),
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, industry: data })
}

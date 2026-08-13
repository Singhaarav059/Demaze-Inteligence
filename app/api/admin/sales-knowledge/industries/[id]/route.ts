// ============================================================
// Admin: Sales Knowledge Industry — PUT / DELETE /api/admin/sales-knowledge/industries/[id]
// ============================================================
// DELETE is a soft-delete (is_active=false), not a hard delete — matches
// this table's own soft-disable convention (see migration 021's header
// comment) so a historical outbound_sales_intelligence row that already
// snapshotted this industry's slug never breaks.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

function toTagArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const body = await req.json()
  const { slug, label, description, keywords, is_active } = body

  if (!slug || !label) {
    return NextResponse.json({ success: false, error: 'slug and label are required' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('sales_knowledge_industries')
    .update({
      slug: String(slug).trim(),
      label: String(label).trim(),
      description: description ? String(description).trim() : null,
      keywords: toTagArray(keywords),
      is_active: is_active ?? true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, industry: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const supabase = createServerClient()

  const { error } = await supabase
    .from('sales_knowledge_industries')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

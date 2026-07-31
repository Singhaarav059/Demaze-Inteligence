// ============================================================
// Admin: Generated Content — GET / PATCH /api/admin/outbound/contacts/[id]/generated-content
// ============================================================
// GET   — fetch the saved generated-content row for a contact (may not
//         exist yet if nothing has been generated).
// PATCH — SDR edits (email_draft after using "Edit"), a single follow-up's
//         copy (followups — added for the Follow-up Control Panel, Session
//         2 — the caller sends back the full followups array with just one
//         entry's body changed, same "send the whole array back" shape the
//         generate-followups route already produces), or status changes
//         (Approve). Only whitelisted fields are writable here — generation
//         itself always goes through the generate-* routes.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('outbound_generated_content')
    .select('*')
    .eq('contact_id', id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, generated: data ?? null })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const body = await req.json()
  const { email_draft, selected_subject_line, followups, status } = body

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (email_draft !== undefined) update.email_draft = email_draft
  if (selected_subject_line !== undefined) update.selected_subject_line = selected_subject_line
  if (followups !== undefined) {
    if (!Array.isArray(followups)) {
      return NextResponse.json({ success: false, error: 'followups must be an array.' }, { status: 400 })
    }
    update.followups = followups
  }
  if (status !== undefined) {
    if (!['draft', 'approved', 'sent'].includes(status)) {
      return NextResponse.json({ success: false, error: `Invalid status: ${status}` }, { status: 400 })
    }
    update.status = status
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('outbound_generated_content')
    .update(update)
    .eq('contact_id', id)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, generated: data })
}

// ============================================================
// Admin: Generate Email — POST /api/admin/outbound/contacts/[id]/generate-email
// ============================================================
// Body: { subjectLine: string } — the subject line the SDR picked from the
// generated list (or their own edited version).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { loadGenerationContext } from '@/lib/outbound/generation/fetch-context'
import { generateEmail } from '@/lib/outbound/generation/generate-email'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const body = await req.json()
  const subjectLine = typeof body.subjectLine === 'string' ? body.subjectLine.trim() : ''

  if (!subjectLine) {
    return NextResponse.json({ success: false, error: 'subjectLine is required' }, { status: 400 })
  }

  const loaded = await loadGenerationContext(id)
  if ('error' in loaded) {
    return NextResponse.json({ success: false, error: loaded.error }, { status: loaded.status })
  }

  const result = await generateEmail(loaded.context.input, subjectLine)
  if (result.status === 'error' || !result.draft) {
    return NextResponse.json({ success: false, error: result.error }, { status: 502 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('outbound_generated_content')
    .upsert(
      {
        contact_id: id,
        selected_subject_line: subjectLine,
        email_draft: result.draft,
        ai_provider_used: result.providerUsed,
        ai_model_used: result.modelUsed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'contact_id' }
    )
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, generated: data, result })
}

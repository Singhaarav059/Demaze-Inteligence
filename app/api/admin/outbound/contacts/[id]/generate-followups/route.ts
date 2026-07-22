// ============================================================
// Admin: Generate Follow-Ups — POST /api/admin/outbound/contacts/[id]/generate-followups
// ============================================================
// Uses the already-generated + saved email_draft for this contact by
// default; body may pass { emailDraft } to use an SDR-edited version
// instead (e.g. after using the Edit action on the generated email).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { loadGenerationContext } from '@/lib/outbound/generation/fetch-context'
import { generateFollowups } from '@/lib/outbound/generation/generate-followups'
import type { EmailDraft } from '@/lib/outbound/generation/types'

function isEmailDraft(value: unknown): value is EmailDraft {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).fullText === 'string'
  )
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const loaded = await loadGenerationContext(id)
  if ('error' in loaded) {
    return NextResponse.json({ success: false, error: loaded.error }, { status: loaded.status })
  }

  const supabase = createServerClient()

  let emailDraft: EmailDraft | null = isEmailDraft(body.emailDraft) ? body.emailDraft : null
  if (!emailDraft) {
    const { data: existing } = await supabase
      .from('outbound_generated_content')
      .select('email_draft')
      .eq('contact_id', id)
      .maybeSingle()
    emailDraft = isEmailDraft(existing?.email_draft) ? (existing!.email_draft as EmailDraft) : null
  }

  if (!emailDraft) {
    return NextResponse.json(
      { success: false, error: 'No generated email found for this contact. Run Generate Email first.' },
      { status: 400 }
    )
  }

  const result = await generateFollowups(loaded.context.input, emailDraft)
  if (result.status === 'error') {
    return NextResponse.json({ success: false, error: result.error }, { status: 502 })
  }

  const { data, error } = await supabase
    .from('outbound_generated_content')
    .upsert(
      {
        contact_id: id,
        followups: result.followups,
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

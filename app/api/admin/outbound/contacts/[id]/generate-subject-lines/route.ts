// ============================================================
// Admin: Generate Subject Lines — POST /api/admin/outbound/contacts/[id]/generate-subject-lines
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { loadGenerationContext } from '@/lib/outbound/generation/fetch-context'
import { generateSubjectLines } from '@/lib/outbound/generation/generate-subject-lines'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const loaded = await loadGenerationContext(id)
  if ('error' in loaded) {
    return NextResponse.json({ success: false, error: loaded.error }, { status: loaded.status })
  }

  const result = await generateSubjectLines(loaded.context.input)
  if (result.status === 'error') {
    return NextResponse.json({ success: false, error: result.error }, { status: 502 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('outbound_generated_content')
    .upsert(
      {
        contact_id: id,
        subject_lines: result.subjectLines,
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

// ============================================================
// Admin: Find Email — POST /api/admin/outbound/contacts/[id]/find-email
// ============================================================
// Runs the active Email Finder provider against this contact's
// person_name + company_domain and persists the result.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { findEmail } from '@/lib/outbound/email-finder/provider-factory'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const supabase = createServerClient()

  const { data: contact, error: fetchError } = await supabase
    .from('outbound_contacts')
    .select('id, person_name, company_name, company_domain')
    .eq('id', id)
    .single()

  if (fetchError || !contact) {
    return NextResponse.json({ success: false, error: fetchError?.message ?? 'Contact not found' }, { status: 404 })
  }

  const result = await findEmail({
    personName: contact.person_name,
    companyName: contact.company_name,
    domain: contact.company_domain,
  })

  const { data: updated, error: updateError } = await supabase
    .from('outbound_contacts')
    .update({
      email: result.email,
      email_confidence: result.confidence,
      email_finder_provider: result.providerUsed,
      email_finder_status: result.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, contact: updated, result })
}

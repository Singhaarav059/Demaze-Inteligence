// ============================================================
// Admin: Enqueue Campaign Contacts — POST /api/admin/outbound/campaigns/[id]/contacts
// ============================================================
// Body: { contact_ids: string[] }. Duplicate (campaign_id, contact_id)
// pairs are ignored (unique index) rather than erroring.
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
    .from('outbound_campaign_contacts')
    .select('*, outbound_contacts(person_name, email, company_name)')
    .eq('campaign_id', id)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, contacts: data ?? [] })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const body = await req.json()
  const contactIds: string[] = Array.isArray(body.contact_ids) ? body.contact_ids : []

  if (contactIds.length === 0) {
    return NextResponse.json({ success: false, error: 'contact_ids must be a non-empty array' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('outbound_campaign_contacts')
    .upsert(
      contactIds.map(contactId => ({ campaign_id: id, contact_id: contactId })),
      { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true }
    )
    .select('*')

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, enqueued: data ?? [] })
}

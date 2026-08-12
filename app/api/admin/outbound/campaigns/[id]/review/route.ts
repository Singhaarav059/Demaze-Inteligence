// ============================================================
// Admin: Campaign Review — GET /api/admin/outbound/campaigns/[id]/review
// ============================================================
// Backs the Review & Send step: ready / missing-email / suppressed /
// already-sent / not-ready counts and per-contact detail for a given set of
// contact ids, via the shared lib/outbound/sending/campaign-review.ts
// classifier (also used by the step-6 dashboard's "Queued" segment, so the
// two screens can never disagree on what's ready).
//
// Query: ?contact_ids=a,b,c (required — same company-scoping shape as
// every other campaign_id-scoped route that filters by contact_ids, e.g.
// send/route.ts and process-followups/route.ts).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { classifyCampaignContacts } from '@/lib/outbound/sending/campaign-review'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id: campaignId } = await params
  const contactIdsParam = req.nextUrl.searchParams.get('contact_ids')
  const contactIds = contactIdsParam ? contactIdsParam.split(',').map(s => s.trim()).filter(Boolean) : []

  const supabase = createServerClient()

  const { data: campaign, error: campaignError } = await supabase
    .from('outbound_campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle()

  if (campaignError) {
    return NextResponse.json({ success: false, error: campaignError.message }, { status: 500 })
  }
  if (!campaign) {
    return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
  }

  const summary = await classifyCampaignContacts(supabase, campaignId, contactIds)

  return NextResponse.json({ success: true, campaign, summary })
}

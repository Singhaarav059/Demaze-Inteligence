// ============================================================
// Admin: Pause Campaign — POST /api/admin/outbound/campaigns/[id]/pause
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { pauseCampaign } from '@/lib/outbound/sending/provider-factory'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const result = await pauseCampaign(id)

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('outbound_campaigns')
    .update({ status: 'paused', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  await supabase.from('outbound_campaign_events').insert({
    campaign_id: id,
    event_type: 'paused',
    detail: { providerUsed: result.providerUsed },
  })

  return NextResponse.json({ success: true, campaign: data })
}

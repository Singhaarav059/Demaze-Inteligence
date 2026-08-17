// ============================================================
// Atomic Contact Claim — shared by campaign-send and follow-up sending
// ============================================================
// Extracted from the two near-identical inline claim blocks in
// app/api/admin/outbound/campaigns/[id]/send/route.ts and
// lib/outbound/sending/process-followup.ts (Production Hardening Master
// Plan, Step 8.6 originally; Phase A dedupes them into one place so the
// concurrency guarantee has one implementation to test, not two).
//
// A conditional UPDATE ... WHERE status = expectedStatus is atomic at the
// Postgres row level, so of any two overlapping callers racing on the same
// row, only one's WHERE clause can match. The loser gets `false` back and
// must not send.
// ============================================================

import type { createServerClient } from '@/lib/supabase/server'

export async function claimCampaignContact(
  supabase: ReturnType<typeof createServerClient>,
  campaignContactId: string,
  expectedStatus: string,
  newStatus: string
): Promise<boolean> {
  const { data } = await supabase
    .from('outbound_campaign_contacts')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', campaignContactId)
    .eq('status', expectedStatus)
    .select('id')

  return Boolean(data && data.length > 0)
}

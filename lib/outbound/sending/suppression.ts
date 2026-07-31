// ============================================================
// Suppression List — bounces + unsubscribes, one mechanism
// ============================================================
// Checked from exactly one chokepoint: lib/outbound/sending/provider-
// factory.ts's sendEmail(), which every real send (initial, manual "Send
// Now", and scheduled/forced follow-ups) already funnels through — so
// adding the check there means every send path is covered without having
// to remember to call this from each route individually.
//
// Same "any DB failure just falls back to the safe default" discipline as
// lib/outbound/settings/provider-selection.ts and lib/outbound/sending/
// followup-settings.ts — for isSuppressed() specifically, the safe default
// on failure is "not suppressed" (fail open on a read error, since this
// table being briefly unreachable shouldn't block every send in the app),
// but the two exceptions below (add/remove) surface their errors properly
// since a failed suppression WRITE is a real problem worth knowing about,
// not something to silently swallow.
// ============================================================

import { createServerClient } from '@/lib/supabase/server'

export type SuppressionReason = 'bounced' | 'unsubscribed' | 'manual'

export interface SuppressionEntry {
  id: string
  email: string
  reason: SuppressionReason
  detail: string | null
  contact_id: string | null
  campaign_id: string | null
  created_at: string
}

export async function isSuppressed(email: string): Promise<{ suppressed: boolean; reason?: SuppressionReason; detail?: string | null }> {
  try {
    const supabase = createServerClient()
    const { data } = await supabase
      .from('outbound_suppression_list')
      .select('reason, detail')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle()

    if (!data) return { suppressed: false }
    return { suppressed: true, reason: data.reason, detail: data.detail }
  } catch {
    return { suppressed: false }
  }
}

export async function addToSuppressionList(input: {
  email: string
  reason: SuppressionReason
  detail?: string
  contactId?: string
  campaignId?: string
}): Promise<{ ok: true; entry: SuppressionEntry } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'A valid email address is required.' }
  }

  try {
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('outbound_suppression_list')
      .upsert(
        {
          email,
          reason: input.reason,
          detail: input.detail ?? null,
          contact_id: input.contactId ?? null,
          campaign_id: input.campaignId ?? null,
        },
        { onConflict: 'email' }
      )
      .select('*')
      .single()

    if (error) return { ok: false, error: error.message }
    return { ok: true, entry: data }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not add to suppression list.' }
  }
}

export async function removeFromSuppressionList(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = createServerClient()
    const { error } = await supabase.from('outbound_suppression_list').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not remove suppression entry.' }
  }
}

export async function listSuppressions(): Promise<SuppressionEntry[]> {
  try {
    const supabase = createServerClient()
    const { data } = await supabase
      .from('outbound_suppression_list')
      .select('*')
      .order('created_at', { ascending: false })
    return data ?? []
  } catch {
    return []
  }
}

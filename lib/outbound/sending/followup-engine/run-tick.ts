// ============================================================
// Automatic Follow-Up Engine — tick orchestration
// ============================================================
// Impure: DB + Gmail API calls. Mirrors lib/outbound/warmup/engine/
// run-tick.ts's shape exactly (same pure/impure split, same
// runAndLog*Tick() wrapper convention).
//
// Per tick, per non-paused campaign: check replies first (so a contact who
// just replied is never mistaken for "unopened, still eligible"), then
// select contacts that are BOTH past the existing follow-up cadence AND
// confirmed unopened (isAutoFollowupEligible, tick-logic.ts), then send via
// the same processFollowupForContact() manual "Process Follow-ups" already
// uses — no duplicated send logic.
//
// Called by: app/api/admin/outbound/followups/engine/tick/route.ts (manual,
// on-demand) and instrumentation.ts's setInterval (autonomous, gated behind
// FOLLOWUP_ENGINE_ENABLED — see that file's own comment).
// ============================================================

import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { checkRepliesForCampaign } from '../reply-check'
import {
  processFollowupForContact,
  resolveGmailContext,
  FOLLOWUP_ELIGIBLE_STATUSES,
} from '../process-followup'
import { getFollowupIntervals } from '../followup-settings'
import { isAutoFollowupEligible } from './tick-logic'

export interface FollowupEngineTickSummary {
  campaignsChecked: number
  contactsEligible: number
  sent: number
  cancelledByReply: number
  cancelledByBounce: number
  skipped: number
  failed: number
  errors: string[]
}

function newSummary(): FollowupEngineTickSummary {
  return { campaignsChecked: 0, contactsEligible: 0, sent: 0, cancelledByReply: 0, cancelledByBounce: 0, skipped: 0, failed: 0, errors: [] }
}

interface ContactRow {
  id: string
  status: string
  updated_at: string
  opened_at: string | null
}

export async function runFollowupEngineTick(
  supabase: ReturnType<typeof createServerClient>
): Promise<FollowupEngineTickSummary> {
  const summary = newSummary()

  // Fail-closed gate (see tick-logic.ts's own header comment for why this
  // is checked once here rather than silently letting every contact read as
  // "unopened" via a per-contact fallback).
  const trackingConfigured = Boolean(process.env.OUTBOUND_TRACKING_BASE_URL)
  if (!trackingConfigured) {
    summary.errors.push('OUTBOUND_TRACKING_BASE_URL is not configured — skipping this tick entirely rather than falling back to blind time-based sending.')
    return summary
  }

  const { data: campaigns, error: campaignError } = await supabase
    .from('outbound_campaigns')
    .select('id')
    .neq('status', 'paused')

  if (campaignError) {
    summary.errors.push(`Failed to load campaigns: ${campaignError.message}`)
    return summary
  }

  const activeCampaigns = campaigns ?? []
  summary.campaignsChecked = activeCampaigns.length
  if (activeCampaigns.length === 0) return summary

  // Resolved once for the whole tick, not per campaign — same discipline as
  // process-followups/route.ts (one Gmail credential is shared by every
  // campaign in this app; there's no per-campaign sending identity).
  const gmail = await resolveGmailContext()
  const intervalsDays = await getFollowupIntervals()

  for (const campaign of activeCampaigns) {
    if (gmail.accessToken) {
      const replySummary = await checkRepliesForCampaign(supabase, campaign.id, gmail.accessToken, gmail.connectedEmail)
      summary.errors.push(...replySummary.errors)
    }

    const { data: contacts, error: fetchError } = await supabase
      .from('outbound_campaign_contacts')
      .select('id, status, updated_at, opened_at')
      .eq('campaign_id', campaign.id)
      .in('status', FOLLOWUP_ELIGIBLE_STATUSES)

    if (fetchError) {
      summary.errors.push(`Failed to load contacts for campaign ${campaign.id}: ${fetchError.message}`)
      continue
    }

    const now = new Date()
    const eligible = ((contacts ?? []) as ContactRow[]).filter(cc =>
      isAutoFollowupEligible(cc.status, cc.updated_at, cc.opened_at, trackingConfigured, now, intervalsDays)
    )
    summary.contactsEligible += eligible.length

    for (const cc of eligible) {
      const outcome = await processFollowupForContact(supabase, campaign.id, cc.id, gmail, intervalsDays, false)
      if (outcome.status === 'sent') summary.sent++
      else if (outcome.status === 'cancelled_reply') summary.cancelledByReply++
      else if (outcome.status === 'cancelled_bounce') summary.cancelledByBounce++
      else if (outcome.status === 'failed') summary.failed++
      else summary.skipped++ // 'not_due'/'skipped' — not_due shouldn't occur here since isAutoFollowupEligible already checked isFollowupDue, but kept as a safe bucket
    }
  }

  return summary
}

// Convenience wrapper for callers that just want to run + log, matching
// the shape instrumentation.ts's scheduler and the manual tick route both
// want (same precedent as the warmup engine's runAndLogWarmupEngineTick).
export async function runAndLogFollowupEngineTick(): Promise<FollowupEngineTickSummary> {
  const supabase = createServerClient()
  try {
    const summary = await runFollowupEngineTick(supabase)
    logger.info('followup-engine', 'Tick complete', summary)
    return summary
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('followup-engine', 'Tick failed', message)
    return { ...newSummary(), errors: [message] }
  }
}

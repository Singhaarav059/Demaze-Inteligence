// ============================================================
// Lemlist Webhook Receiver — POST /api/webhooks/lemlist
// ============================================================
// Public route (no x-admin-token — Lemlist's servers call this, not our
// admin UI), so this is NOT gated by verifyAdminRequest(). Auth instead
// comes from the shared `secret` field Lemlist echoes back in every webhook
// call body when the user registers a webhook with a `secret` set (see
// lib/outbound/shared/lemlist-client.ts's getLemlistWebhookSecret and the
// Lemlist campaign ID card in /admin/outbound/integrations). If no secret
// is configured yet, requests are accepted unverified — same "degrade
// gracefully, don't hard-block on missing optional config" precedent as
// every other outbound module's isAvailable() check.
//
// Registration itself is NOT done by this codebase — the exact Add Webhook
// request/response shape was researched but not built against, since it's
// a one-time setup action better done directly in the user's Lemlist
// dashboard (Settings -> Webhooks -> target this route's full URL, with a
// secret pasted into the integrations settings page above).
//
// Payload field names are BEST-EFFORT, not confirmed against a real Lemlist
// webhook delivery (developer.lemlist.com's public docs describe webhooks
// conceptually — real-time POST callbacks for events like emailsOpened/
// emailsReplied/emailsClicked — without a worked payload example). This
// handler defensively checks several plausible field-name variants and
// always stores the full raw body in detail.rawPayload regardless of
// whether parsing succeeds, so nothing is lost if a guessed field name is
// wrong. Treat this as verified only after a real webhook delivery has been
// inspected live — same "defer live run" discipline used throughout this
// repo for vendor integrations that need real credentials to exercise.
//
// Lemlist retries failed webhook deliveries, so this dedupes by whatever
// event-id-shaped field the payload provides (migration 014's
// provider_event_id unique index) before inserting.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getLemlistWebhookSecret } from '@/lib/outbound/shared/lemlist-client'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

const WEBHOOK_RATE_LIMIT = { limit: 60, windowMs: 60_000 }

// Lemlist's documented `type` values are broader than email (linkedinInterested,
// whatsappReplied, signalRegistered, ...) — only the email-relevant ones map
// onto outbound_campaign_events' CHECK-constrained event_type; anything else
// (or an unrecognized value) is acknowledged but not inserted, so we never
// violate the CHECK constraint by guessing a type-name mapping.
export const EVENT_TYPE_MAP: Record<string, string> = {
  emailsSent: 'sent',
  emailsOpened: 'opened',
  emailsClicked: 'clicked',
  emailsReplied: 'replied',
  emailsBounced: 'bounced',
}

export function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit(`lemlist-webhook:${getClientIp(req)}`, WEBHOOK_RATE_LIMIT)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds ?? 60) } }
    )
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    // Ack with 200 anyway — an unparseable body isn't something retrying will fix,
    // and a non-2xx here would just make Lemlist retry indefinitely.
    return NextResponse.json({ success: true, ignored: 'unparseable body' })
  }

  const payload = body as Record<string, unknown>

  const configuredSecret = await getLemlistWebhookSecret('sending')
  if (configuredSecret) {
    const providedSecret = firstString(payload.secret)
    if (providedSecret !== configuredSecret) {
      return NextResponse.json({ success: false, error: 'Invalid webhook secret' }, { status: 401 })
    }
  }

  const rawType = firstString(payload.type, payload.event)
  const mappedEventType = rawType ? EVENT_TYPE_MAP[rawType] : null

  // Non-email event types (linkedinInterested, etc.) or anything unrecognized:
  // ack without inserting, rather than guessing a CHECK-constrained value.
  if (!mappedEventType) {
    return NextResponse.json({ success: true, ignored: rawType ?? 'no type field' })
  }

  const leadEmail = firstString(
    payload.leadEmail,
    payload.email,
    (payload.lead as Record<string, unknown> | undefined)?.email
  )
  const providerEventId = firstString(payload._id, payload.id, payload.eventId)
  const leadProviderId = firstString(
    payload.leadId,
    payload.contactId,
    (payload.lead as Record<string, unknown> | undefined)?._id
  )

  if (!leadEmail && !leadProviderId) {
    // Nothing to correlate this event against — ack, store nothing.
    return NextResponse.json({ success: true, ignored: 'no lead identifier in payload' })
  }

  const supabase = createServerClient()

  // Primary correlation: match on the lead/contact id we stored as
  // provider_message_id when the lead was created (lib/outbound/sending/
  // providers/lemlist.ts's sendEmail()). Falls back to "most recent
  // campaign_contact for this email" when the id isn't present or doesn't
  // match — less precise, but Lemlist events always carry an email too.
  let campaignContactId: string | null = null
  let matchedCampaignId: string | null = null

  if (leadProviderId) {
    const { data: byProviderId } = await supabase
      .from('outbound_campaign_contacts')
      .select('id, campaign_id')
      .eq('provider_message_id', leadProviderId)
      .maybeSingle()
    if (byProviderId) {
      campaignContactId = byProviderId.id
      matchedCampaignId = byProviderId.campaign_id
    }
  }

  if (!campaignContactId && leadEmail) {
    const { data: contact } = await supabase
      .from('outbound_contacts')
      .select('id')
      .eq('email', leadEmail)
      .maybeSingle()

    if (contact) {
      const { data: recentCampaignContact } = await supabase
        .from('outbound_campaign_contacts')
        .select('id, campaign_id')
        .eq('contact_id', contact.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (recentCampaignContact) {
        campaignContactId = recentCampaignContact.id
        matchedCampaignId = recentCampaignContact.campaign_id
      }
    }
  }

  if (!campaignContactId || !matchedCampaignId) {
    return NextResponse.json({ success: true, ignored: 'no matching campaign contact found' })
  }

  if (providerEventId) {
    const { data: existing } = await supabase
      .from('outbound_campaign_events')
      .select('id')
      .eq('provider_event_id', providerEventId)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ success: true, deduped: true })
    }
  }

  const { error: insertError } = await supabase.from('outbound_campaign_events').insert({
    campaign_id: matchedCampaignId,
    campaign_contact_id: campaignContactId,
    event_type: mappedEventType,
    provider_event_id: providerEventId,
    detail: { source: 'lemlist_webhook', rawType, rawPayload: payload },
  })

  if (insertError) {
    return NextResponse.json({ success: false, error: insertError.message }, { status: 500 })
  }

  if (mappedEventType === 'replied' || mappedEventType === 'bounced') {
    await supabase
      .from('outbound_campaign_contacts')
      .update({ status: mappedEventType, updated_at: new Date().toISOString() })
      .eq('id', campaignContactId)
  }

  return NextResponse.json({ success: true })
}

// ============================================================
// Public: One-click unsubscribe — GET /api/unsubscribe/[campaignContactId]
// ============================================================
// Deliberately public — no verifyAdminRequest(), same reasoning as
// app/api/track/open/[campaignContactId]/route.ts: this is requested by a
// mail client (RFC 8058 one-click List-Unsubscribe) or a recipient's
// browser, not an admin session.
//
// campaignContactId IS outbound_campaign_contacts.id — same "already an
// unguessable UUID, worst case a guess just suppresses one email address
// that never asked to be sent to again" reasoning as the tracking pixel.
//
// Real gap this closes (found during the production-hardening deliverability
// audit): before this route existed, a recipient had no way to opt out
// short of manually replying and someone adding them to the suppression
// list by hand. This — plus the List-Unsubscribe/List-Unsubscribe-Post
// headers now sent by lib/outbound/sending/providers/gmail.ts — gives every
// sent email a real, working unsubscribe mechanism, which Gmail's bulk-
// sender guidelines expect present regardless of send volume.
//
// GET (not POST) so a plain click on the mailto/https link works without a
// form; RFC 8058's one-click POST semantics for mail clients that support it
// go through the SAME URL (List-Unsubscribe-Post: List-Unsubscribe=One-Click
// tells the mail client to POST here instead of GET) — handled by the POST
// export below, sharing the same suppression logic.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { addToSuppressionList } from '@/lib/outbound/sending/suppression'
import { logger } from '@/lib/logger'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function confirmationPage(): NextResponse {
  return new NextResponse(
    '<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center;color:#333">' +
    '<p>You’ve been unsubscribed and won’t receive further emails from this sender.</p>' +
    '</body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

async function unsubscribe(campaignContactId: string): Promise<void> {
  if (!UUID_RE.test(campaignContactId)) return
  try {
    const supabase = createServerClient()
    const { data: cc } = await supabase
      .from('outbound_campaign_contacts')
      .select('id, campaign_id, contact_id')
      .eq('id', campaignContactId)
      .maybeSingle()
    if (!cc) return

    const { data: contact } = await supabase
      .from('outbound_contacts')
      .select('email')
      .eq('id', cc.contact_id)
      .maybeSingle()
    if (!contact?.email) return

    await addToSuppressionList({
      email: contact.email,
      reason: 'unsubscribed',
      detail: 'recipient-initiated unsubscribe link',
      contactId: cc.contact_id,
      campaignId: cc.campaign_id,
    })

    await supabase.from('outbound_campaign_events').insert({
      campaign_id: cc.campaign_id,
      campaign_contact_id: cc.id,
      event_type: 'unsubscribed',
    })
  } catch (err) {
    logger.error('unsubscribe', 'Unexpected error processing unsubscribe', { error: err instanceof Error ? err.message : String(err) })
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ campaignContactId: string }> }) {
  const { campaignContactId } = await params
  await unsubscribe(campaignContactId)
  return confirmationPage()
}

// RFC 8058 one-click unsubscribe — mail clients that support it POST here
// with no confirmation UI expected in the response.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ campaignContactId: string }> }) {
  const { campaignContactId } = await params
  await unsubscribe(campaignContactId)
  return new NextResponse(null, { status: 200 })
}

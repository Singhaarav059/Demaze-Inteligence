// ============================================================
// Public: Email Open Tracking Pixel — GET /api/track/open/[campaignContactId]
// ============================================================
// Deliberately public — no verifyAdminRequest(). This is requested by an
// email client rendering a sent message, not an admin session; there is no
// middleware.ts in this repo forcing admin auth on /api/*, so omitting the
// check is sufficient to make this reachable.
//
// campaignContactId IS outbound_campaign_contacts.id directly — no separate
// token column. It's already an unguessable UUID, and the only thing it
// grants is "idempotently mark this one row opened," which is harmless even
// if guessed (worst case: one automatic follow-up gets suppressed that
// shouldn't have been — see followup-engine's tick-logic.ts for why that's
// the safe-direction failure, never a wrong/duplicate send).
//
// Must NEVER throw or return a non-image response to the email client,
// regardless of what happens with the DB — every step below is best-effort.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

// 1x1 transparent GIF, 34 bytes — inlined rather than a public/ asset so
// this entire unauthenticated route's behavior is auditable in one file.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function pixelResponse() {
  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(PIXEL.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
    },
  })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ campaignContactId: string }> }) {
  try {
    const { campaignContactId } = await params
    if (!UUID_RE.test(campaignContactId)) return pixelResponse()

    const supabase = createServerClient()
    const { data: updated, error } = await supabase
      .from('outbound_campaign_contacts')
      .update({ opened_at: new Date().toISOString() })
      .eq('id', campaignContactId)
      .is('opened_at', null)
      .select('id, campaign_id')
      .maybeSingle()

    if (error) {
      logger.warn('track-open', 'Failed to record open', { campaignContactId, error: error.message })
    } else if (updated) {
      const { error: eventError } = await supabase.from('outbound_campaign_events').insert({
        campaign_id: updated.campaign_id,
        campaign_contact_id: updated.id,
        event_type: 'opened',
        detail: { source: 'tracking_pixel' },
      })
      if (eventError) {
        logger.warn('track-open', 'Recorded open but failed to log event', { campaignContactId, error: eventError.message })
      }
    }
  } catch (err) {
    logger.error('track-open', 'Unexpected error serving tracking pixel', { error: err instanceof Error ? err.message : String(err) })
  }

  return pixelResponse()
}

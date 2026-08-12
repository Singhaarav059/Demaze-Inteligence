// ============================================================
// Shared human-readable event labels — used by both CampaignDashboard.tsx
// (one segment across many contacts) and ContactTimeline.tsx (everything
// for one contact), so the two never describe the same event differently.
// ============================================================

export interface CampaignEvent {
  id: string
  campaign_contact_id: string | null
  event_type: string
  detail: Record<string, unknown>
  occurred_at: string
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

// One-line description of what happened — deliberately does not invent a
// "Delivered" event or a hard/soft bounce distinction; only describes event
// types this app actually records (see migration 020's CHECK constraint).
export function describeEvent(e: CampaignEvent): string {
  switch (e.event_type) {
    case 'sent': {
      const seq = e.detail?.followupSequence
      return typeof seq === 'number' ? `Follow-up ${seq} sent` : 'Email sent'
    }
    case 'send_failed': {
      const err = str(e.detail?.error)
      return err ? `Send failed — ${err}` : 'Send failed'
    }
    case 'suppressed': {
      const reason = str(e.detail?.reason)
      return reason ? `Suppressed — not sent (${reason})` : 'Suppressed — not sent'
    }
    case 'opened':
      return 'Open detected'
    case 'clicked':
      return 'Clicked a link'
    case 'replied':
      return 'Reply received'
    case 'bounced': {
      const from = str(e.detail?.fromHeader)
      return from ? `Bounced — ${from}` : 'Bounced'
    }
    case 'followup_scheduled':
      return 'Follow-up scheduled'
    case 'followup_stopped': {
      const source = e.detail?.source
      return source === 'manual_admin_action' ? 'Follow-ups stopped — manually stopped' : 'Follow-ups stopped'
    }
    case 'removed':
      return 'Removed from campaign'
    case 'paused':
      return 'Campaign paused'
    case 'resumed':
      return 'Campaign resumed'
    default:
      return e.event_type
  }
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

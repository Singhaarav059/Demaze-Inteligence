// ============================================================
// Follow-Up Scheduling — pure logic
// ============================================================
// This app has no background scheduler anywhere (same constraint as the
// Warm-Up module's on-view metrics snapshot and check-replies/route.ts's
// on-demand reply polling) — there is no queue/cron process that wakes up
// and sends a follow-up at the right time on its own. What exists instead
// is the same "on-demand, re-evaluated whenever an admin asks" shape: this
// module answers "is contact X's next follow-up due right now, and what
// sequence number is it" as a pure function of already-stored state
// (outbound_campaign_contacts.status/updated_at) — no new table, no new
// column. app/api/admin/outbound/campaigns/[id]/process-followups/route.ts
// calls these functions and does the actual sending/DB-writing.
//
// Cadence is DAYS SINCE THE PREVIOUS SEND IN THE SEQUENCE, not cumulative
// from the original send — updated_at is overwritten every time a contact's
// status advances (initial send, then each follow-up), so it always holds
// "when did the last outreach to this person happen."
// ============================================================

export const FOLLOWUP_INTERVALS_DAYS: readonly [number, number, number] = [3, 4, 7]

const STATUS_TO_NEXT_SEQUENCE: Record<string, 1 | 2 | 3 | undefined> = {
  sent: 1,
  followup_1: 2,
  followup_2: 3,
  // followup_3 has no next sequence — 3 is the max (matches
  // outbound_campaign_contacts.status's CHECK constraint, which has no
  // followup_4). queued/replied/bounced/stopped are all terminal or
  // not-yet-sent — none of them have a next follow-up either.
}

export function nextFollowupSequence(status: string): 1 | 2 | 3 | null {
  return STATUS_TO_NEXT_SEQUENCE[status] ?? null
}

// intervalsDays defaults to the hardcoded FOLLOWUP_INTERVALS_DAYS constant,
// but every real call site now threads through the admin-configurable value
// from lib/outbound/sending/followup-settings.ts instead (Session 2, the
// Follow-up Control Panel) — the default here just keeps this function safe
// to call before that settings table exists/is reachable.
export function nextFollowupDueAt(
  status: string,
  lastActionAt: string | Date,
  intervalsDays: readonly [number, number, number] = FOLLOWUP_INTERVALS_DAYS
): Date | null {
  const sequence = nextFollowupSequence(status)
  if (sequence === null) return null
  const intervalDays = intervalsDays[sequence - 1]
  const lastActionMs = typeof lastActionAt === 'string' ? new Date(lastActionAt).getTime() : lastActionAt.getTime()
  return new Date(lastActionMs + intervalDays * 24 * 60 * 60 * 1000)
}

export function isFollowupDue(
  status: string,
  lastActionAt: string | Date,
  now: Date = new Date(),
  intervalsDays: readonly [number, number, number] = FOLLOWUP_INTERVALS_DAYS
): boolean {
  const dueAt = nextFollowupDueAt(status, lastActionAt, intervalsDays)
  if (!dueAt) return false
  return now.getTime() >= dueAt.getTime()
}

// Gmail only groups a new send into an existing thread when (among other
// requirements — see gmail-client.ts's sendGmailMessage header) the Subject
// header matches the thread's subject — "Re: " is the one prefix Gmail's own
// grouping heuristic normalizes away, so every follow-up uses the ORIGINAL
// subject with this prefix, not the follow-up draft's own AI-generated
// subject (that text is still shown to the SDR for review in the UI, just
// not used as the literal Subject header sent to Gmail).
export function buildFollowupSubject(originalSubject: string): string {
  const trimmed = originalSubject.trim()
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`
}

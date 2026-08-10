// ============================================================
// Automatic Follow-Up Engine — pure tick logic
// ============================================================
// No I/O — same split as the warmup engine's tick-logic.ts (pure math) vs.
// run-tick.ts (impure orchestration), and as followup-schedule.ts (pure) vs.
// process-followup.ts (impure) already established for manual follow-ups.
//
// This is the one place the "only auto-send if unopened" rule the user
// explicitly authorized actually lives — isAutoFollowupEligible() is a
// strict AND on top of the existing, unmodified isFollowupDue() from
// followup-schedule.ts, never a replacement for it. Manual actions (Send
// Now / Process Follow-ups) call isFollowupDue()/processFollowupForContact()
// directly and never pass through this function — this gate exists only for
// the automatic engine's own contact-selection query.
// ============================================================

import { isFollowupDue } from '../followup-schedule'

// Fail-closed by design (confirmed with the user before building this): if
// open-tracking isn't configured (OUTBOUND_TRACKING_BASE_URL unset), opened_at
// can never be set for ANY contact, so every due contact would look
// "unopened forever" — that would silently degrade this engine into blind
// time-based auto-sending, expanding what the user actually authorized
// ("auto-send only if we know it went unopened") rather than preserving it.
// trackingConfigured is checked first and short-circuits to false rather
// than ever reaching the isFollowupDue check in that case.
export function isAutoFollowupEligible(
  status: string,
  updatedAt: string | Date,
  openedAt: string | Date | null,
  trackingConfigured: boolean,
  now: Date = new Date(),
  intervalsDays?: readonly [number, number, number]
): boolean {
  if (!trackingConfigured) return false
  if (openedAt !== null) return false
  return isFollowupDue(status, updatedAt, now, intervalsDays)
}

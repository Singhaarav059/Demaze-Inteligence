// ============================================================
// Redirect - /admin/outbound/followups -> /admin/followups
// ============================================================
// Follow-ups moved to a top-level route in the 2026-08-31 UX
// restructuring (promoted to primary nav). Kept as a redirect, not
// deleted, so any bookmark or old link still lands somewhere real.
// ============================================================

import { redirect } from 'next/navigation'

export default function OldFollowupsRedirect() {
  redirect('/admin/followups')
}

// ============================================================
// Deterministic, non-overridable pre-send checks
// ============================================================
// Post-Hardening Pilot Readiness Plan, Phase B (B4/B6) — shared by
// campaign-review.ts (Review & Send UI classification) and the real send
// routes (send/route.ts, process-followup.ts) so the UI's "ready" bucket
// and the actual enforcement point can never disagree — same "one place to
// get this right" discipline as claim.ts in Phase A.
//
// See docs/outbound-safety-policy.md for which checks are BLOCKING
// (no user override, this file) vs. ADVISORY (a UI badge only, computed
// elsewhere — personalization-check.ts, research-quality.ts, grounding.ts's
// own 'not_found' status).
// ============================================================

export interface SendBlockCheck {
  blocked: boolean
  reason?: string
}

// A simple, deliberately permissive syntax check (not full RFC 5322, no
// MX/deliverability lookup) — this exists to catch a clearly-malformed
// address ("not-an-email", a name typed into the email field, a stray
// trailing comma from a pasted list), not to second-guess a real address's
// deliverability. Vendor-reported email_confidence (Prospeo's 'low'/'none')
// already covers the "might not be deliverable" signal and stays advisory
// per the plan's B1/B2 guidance — this is strictly a syntax gate.
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmailFormat(email: string): boolean {
  return EMAIL_FORMAT.test(email.trim())
}

// B6 — invalid email. A missing email was already blocked before Phase B
// (classified 'missing_email'); this adds the format check that never
// existed at all — a present-but-malformed address used to sail straight
// through to a real send attempt.
export function checkEmailFormat(email: string | null | undefined): SendBlockCheck {
  if (!email) return { blocked: true, reason: 'No email address on file.' }
  if (!isValidEmailFormat(email)) return { blocked: true, reason: `"${email}" is not a valid email address.` }
  return { blocked: false }
}

// B4 — decision-maker company identity mismatch. Only the 'conflict'
// grounding status blocks: it means the discovery-time check found the
// candidate's name/title actively CONTRADICTING the company's own scraped
// leadership evidence — a real, evidence-based signal, not an absence of
// one. 'not_found' (no leadership evidence was scraped at all to check
// against — the common case for most companies, a data-availability gap,
// not a mismatch signal) deliberately stays ADVISORY, unchanged from
// today — blocking on it too would refuse the large majority of otherwise-
// legitimate sends on no positive evidence of a problem. Documented as a
// deliberate judgment call, not a literal reading of "cannot be adequately
// established" — see docs/outbound-safety-policy.md.
export function checkCompanyIdentity(groundingStatus: string | null | undefined): SendBlockCheck {
  if (groundingStatus === 'conflict') {
    return { blocked: true, reason: 'Company identity conflict — this contact could not be confirmed against the researched company\'s own site.' }
  }
  return { blocked: false }
}

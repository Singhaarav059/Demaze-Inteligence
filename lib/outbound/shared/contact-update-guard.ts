// ============================================================
// Contact Update Overwrite Guard
// ============================================================
// Bug found 2026-09-01: find-email/route.ts (and the analogous branch in
// enrich/route.ts) wrote result.email/result.enrichment onto
// outbound_contacts unconditionally, even when a re-run's fresh provider
// call came back weaker (or not_found/none) than what was already stored —
// a previously-verified email or high-confidence enrichment silently got
// wiped by a later re-run that happened to hit a soft "not found". This is
// a property of the SHARED route logic, not any one provider (Exa or
// otherwise) — fixed once here rather than per-caller, per the standing
// "fix at the point every caller routes through" discipline.
// ============================================================

// 'verified' ranks strictly above 'high' — a real provider-confirmed
// verification (currently only Prospeo's SMTP-verified match) must never be
// overwritten by any non-verified result, from any provider, regardless of
// its own confidence.
const EMAIL_CONFIDENCE_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, verified: 4 }
const ENRICHMENT_CONFIDENCE_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 }

// True when the incoming email-finder result is at least as strong as
// whatever confidence is already stored (missing/unrecognized existing
// confidence counts as the weakest tier, so a first-ever result always
// writes). A not_found/error result always carries confidence 'none', so
// it never outranks any prior found result.
export function shouldOverwriteEmail(
  existingConfidence: string | null | undefined,
  incomingConfidence: string
): boolean {
  const existingRank = EMAIL_CONFIDENCE_RANK[existingConfidence ?? ''] ?? 0
  const incomingRank = EMAIL_CONFIDENCE_RANK[incomingConfidence] ?? 0
  return incomingRank >= existingRank
}

// Same discipline for Contact Enrichment: a fresh 'not_found' never
// overwrites an existing 'enriched'/'partial' result, and a weaker
// confidence tier never overwrites a stronger one.
export function shouldOverwriteEnrichment(
  existingStatus: string | null | undefined,
  existingConfidence: string | null | undefined,
  incomingStatus: string,
  incomingConfidence: string
): boolean {
  if (incomingStatus === 'not_found' && existingStatus && existingStatus !== 'not_found') return false
  const existingRank = ENRICHMENT_CONFIDENCE_RANK[existingConfidence ?? ''] ?? 0
  const incomingRank = ENRICHMENT_CONFIDENCE_RANK[incomingConfidence] ?? 0
  return incomingRank >= existingRank
}

// Plain-language fit label (2026-08-31 IA redesign) - the raw 0-100
// qualification score and its metric breakdown stay available behind
// "See scoring details" disclosures, but the primary thing a non-technical
// user reads is this label. Shared by SectorQualificationCard and the
// Research report so both agree on the same thresholds/wording.
export function fitLabel(score: number): string {
  if (score >= 65) return 'Strong potential fit'
  if (score >= 40) return 'Possible fit'
  return 'Low priority'
}

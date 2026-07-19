// ============================================================
// JSON extraction — same fence-stripping shape as business-profile.ts's
// extractJsonFromResponse. Kept as its own copy rather than a shared
// import, matching this codebase's existing precedent for small per-module
// duplicated helpers (see business-profile.ts's own header comment).
// ============================================================

export function extractJsonFromResponse(raw: string): string {
  const trimmed = raw.trim()
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start !== -1 && end > start) return stripped.slice(start, end + 1)
  return stripped
}

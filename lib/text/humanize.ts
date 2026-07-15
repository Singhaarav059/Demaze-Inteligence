// ============================================================
// humanizeText — strip the tells of AI-generated prose
// ============================================================
// The LLM narrative fields (company_summary, opening_angle,
// pain points, etc.) tend to read "AI-written": em/en dashes
// used as sentence connectors, doubled hyphens, and a few
// stock filler phrases. SDR-facing copy should read like a
// person wrote it. This runs as a light display-layer cleanup
// so a rep never sees an "— " mid-sentence dash.
//
// Deliberately conservative: it only touches punctuation and a
// short list of filler phrases. It never rewrites meaning.
// ============================================================

// Filler openers/phrases that scream "written by a model".
// Matched case-insensitively at a word boundary.
const FILLER_PATTERNS: Array<[RegExp, string]> = [
  [/\bI hope this (?:email|message|note) finds you well[.,]?\s*/gi, ''],
  [/\bIt(?:'|’)s worth noting that\b/gi, ''],
  [/\bIt is worth noting that\b/gi, ''],
  [/\bIn today(?:'|’)s (?:fast-paced|ever-changing|competitive) (?:world|landscape|market)[,.]?\s*/gi, ''],
  [/\bAs an? (?:AI|language model)[^.]*\.\s*/gi, ''],
  [/\bIn conclusion,\s*/gi, ''],
  [/\bFurthermore,\s*/gi, 'Also, '],
  [/\bMoreover,\s*/gi, 'And '],
  [/\bleverage\b/gi, 'use'],
  [/\bleveraging\b/gi, 'using'],
  [/\butilize\b/gi, 'use'],
  [/\butilizing\b/gi, 'using'],
]

/**
 * Replace em/en dashes used as sentence-level connectors with plain
 * punctuation. A dash flanked by spaces (" — ") is the classic AI tell;
 * we turn it into a comma or, when it clearly joins two clauses, keep it
 * readable as a comma. Hyphens inside words (e.g. "multi-plant",
 * "30-50%", "tier-1") are left completely alone.
 */
function replaceConnectorDashes(input: string): string {
  let s = input

  // Doubled ASCII hyphens "--" (often produced instead of a real dash)
  // when used as a connector (spaces around it) → comma.
  s = s.replace(/\s+--\s+/g, ', ')

  // Em dash (—) or en dash (–) surrounded by spaces → comma.
  // Require spaces on both sides so unspaced numeric ranges like
  // "30–50%" are left alone (only \s* here would eat those too).
  s = s.replace(/\s+[—–]\s+/g, ', ')

  // A comma immediately before another comma / period from stacked
  // replacements → single mark.
  s = s.replace(/,\s*,/g, ', ')
  s = s.replace(/,\s*\./g, '.')

  return s
}

/**
 * Clean a single narrative string for display. Safe to call on any
 * user-facing text field. Returns '' for empty/nullish input.
 */
export function humanizeText(input: unknown): string {
  if (input == null) return ''
  let s = String(input)

  s = replaceConnectorDashes(s)

  for (const [re, replacement] of FILLER_PATTERNS) {
    s = s.replace(re, replacement)
  }

  // Normalize whitespace and stray leading punctuation left by removals.
  s = s.replace(/\s{2,}/g, ' ')
  s = s.replace(/^\s*[,;:]\s*/, '')
  s = s.replace(/\s+([.,;:!?])/g, '$1')
  s = s.trim()

  // Re-capitalize sentence openers a removed filler phrase left lowercase
  // (start of string, or right after a ".", "!" or "?").
  s = s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, prefix, letter) => prefix + letter.toUpperCase())

  return s
}

/** Humanize every string in an array (drops empties). */
export function humanizeList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.map((x) => humanizeText(x)).filter((x) => x.length > 0)
}

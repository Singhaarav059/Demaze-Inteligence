// ============================================================
// Quote Verification — does an LLM-claimed evidence quote genuinely
// appear in the real source content?
// ============================================================
// Built for the evidence-grounded LLM opportunity path (normalize.ts) — see
// CLAUDE.md "Research-quality initiative" 2026-07-22 Session 2. The LLM is
// allowed to surface an opportunity/pain-point the deterministic regex
// catalog missed, but only if it can back the claim with a quote that's a
// real exact or close-fuzzy substring of the content it was actually shown —
// otherwise it's treated the same as any other unverifiable claim.
//
// Reuses this repo's existing matching discipline rather than inventing a
// new heuristic: word-boundary/ratio matching from
// lib/enrichment/competitor-discovery.ts's isSelfName(), and the
// snippet-window style from lib/pipeline/service-evidence.ts's firstMatch()
// (±45/55 chars) for debug/audit output.
// ============================================================

export type QuoteMatchTier = 'exact' | 'close' | 'none'

export interface QuoteVerificationResult {
  tier: QuoteMatchTier
  matchedSnippet?: string   // real substring of `content` that matched, for debug/audit
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'nor', 'but', 'so', 'yet', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'this', 'that',
  'these', 'those', 'with', 'from', 'into', 'onto', 'over', 'under', 'than',
  'then', 'they', 'their', 'them', 'its', 'our', 'your', 'not', 'also', 'can',
  'will', 'would', 'could', 'should', 'about', 'across', 'which', 'while',
])

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Lowercase, normalize smart quotes/dashes, collapse whitespace — same
// normalization shape as competitor-discovery.ts's normalizeName(), applied
// to free-text quotes/content instead of company names.
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function significantWords(s: string): string[] {
  const words = s.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []
  return words.filter(w => w.length > 3 && !STOPWORDS.has(w))
}

function extractSnippet(content: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - 45)
  const end = Math.min(content.length, index + matchLength + 55)
  return content.slice(start, end).replace(/\s+/g, ' ').trim()
}

/**
 * Checks whether `quote` (an LLM-claimed piece of evidence) genuinely appears
 * in `content` (the real source text the LLM was shown), either as an exact
 * (whitespace/quote-normalized) substring, or as a close paraphrase — most of
 * the quote's significant words present AND at least one 4-word run shared
 * verbatim, so two unrelated sentences that merely share common words don't
 * pass on bag-of-words overlap alone.
 *
 * Quotes under ~8 significant words are rejected outright as unverifiable —
 * same reasoning service-evidence.ts already uses to keep bare "AI"/
 * "data-driven" mentions capped at weak tier: a short quote would trivially
 * word-match almost anything.
 */
export function verifyQuoteInContent(quote: string, content: string): QuoteVerificationResult {
  const trimmedQuote = quote.trim()
  if (trimmedQuote.length < 30) return { tier: 'none' }

  const normQuote = normalizeText(trimmedQuote)
  const normContent = normalizeText(content)

  // ── Exact tier ────────────────────────────────────────────────
  // Checked before the significant-word-count gate below — a short but
  // genuine verbatim quote (e.g. one that happens to lean on common
  // prepositions filtered out of `significantWords`) must not be rejected
  // just because it doesn't clear the fuzzy-match word-count bar; that bar
  // only exists to keep the CLOSE tier's bag-of-words heuristic reliable.
  const exactIdx = normContent.indexOf(normQuote)
  if (exactIdx !== -1) {
    return { tier: 'exact', matchedSnippet: extractSnippet(content, exactIdx, normQuote.length) }
  }

  // ── Close tier ────────────────────────────────────────────────
  const sigWords = significantWords(trimmedQuote)
  if (sigWords.length < 8) return { tier: 'none' }

  // Word-overlap ratio: most of the quote's significant words appear
  // somewhere in content, as whole words.
  const contentWordSet = new Set(significantWords(content))
  const overlapCount = sigWords.filter(w => contentWordSet.has(w)).length
  const overlapRatio = overlapCount / sigWords.length
  if (overlapRatio < 0.75) return { tier: 'none' }

  // Shared 4-gram: at least one run of 4 consecutive raw quote words
  // (not just significant ones, so short connector words stay in place)
  // appears verbatim, in order, somewhere in content.
  const rawWords = trimmedQuote.match(/[a-z0-9][a-z0-9'-]*/gi) ?? []
  for (let i = 0; i + 4 <= rawWords.length; i++) {
    const gram = rawWords.slice(i, i + 4)
    const gramRegex = new RegExp(gram.map(escapeRegex).join('\\s+'), 'i')
    const m = gramRegex.exec(content)
    if (m) {
      return { tier: 'close', matchedSnippet: extractSnippet(content, m.index, m[0].length) }
    }
  }

  return { tier: 'none' }
}

export function isQuoteGrounded(
  quote: string,
  content: string,
  minTier: QuoteMatchTier = 'close',
): boolean {
  const { tier } = verifyQuoteInContent(quote, content)
  if (minTier === 'exact') return tier === 'exact'
  if (minTier === 'close') return tier === 'exact' || tier === 'close'
  return true
}

// ============================================================
// Service Offerings Extractor — lib/pipeline/service-offerings.ts
// ============================================================
// Answers a question the pipeline never asked before: what does the
// RESEARCHED COMPANY ITSELF sell? Every other extracted fact in this
// pipeline (pain_points, ai_opportunities, executive_brief.what_to_sell)
// is framed around which Demaze service to pitch AT this company — none
// of them capture the company's own services/products as a first-class
// fact. That's the actual anchor needed to ground Competitor Discovery
// and ICP Generation in "same level of service" comparisons instead of
// pure company-name search luck (see competitor-discovery.ts /
// icp-generator.ts, whose queries are built from the company name alone).
//
// Deliberately content-derived only, no LLM invention — same discipline
// as every other discovery module in this codebase (competitor-discovery.ts,
// icp-generator.ts, market-intelligence.ts): every offering phrase comes
// from the company's own self-referential language on its own scraped
// pages ("we offer...", "our services include...", "we are a provider
// of..."), never guessed or inferred from industry context.
//
// Governing principle, same as website-discovery.ts and friends: prefer
// under-confidence to over-confidence. A missed offering is better than a
// fabricated one.
// ============================================================

import { looksLikeSentenceFragment } from '@/lib/enrichment/extraction-guards'

const OFFERING_TRIGGER =
  /\bwe\s+are\s+a\s+(?:leading\s+)?(?:provider|manufacturer|developer|designer|supplier)\s+of\b|\bwe\s+(?:offer|provide|specialize\s+in|deliver|design|manufacture)\b|\bour\s+(?:core\s+)?(?:services?|solutions?|products?|offerings?)\s+include\b/i

const WINDOW_CHARS = 160
const MIN_LEN = 4
const MAX_LEN = 140
const MAX_OFFERINGS = 8

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim()
}

// A trigger match sometimes leaves a leftover connector right after it
// (e.g. "our services include" matches, but the source text continues
// "...include: web design, SEO..." — the colon isn't part of the trigger).
// Same post-processing shape as icp-generator.ts's LEFTOVER_CONNECTOR.
const LEFTOVER_CONNECTOR = /^\s*(?:of|for|include[sd]?|including|are|is|:|-)\s*/i

export function extractOfferingsFromText(text: string): string[] {
  const found: string[] = []
  const regex = new RegExp(OFFERING_TRIGGER.source, 'gi')
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const start = match.index + match[0].length
    const after = text.slice(start, start + WINDOW_CHARS)
    const stopAt = after.search(/[.!?\n]/)
    const window = (stopAt >= 0 ? after.slice(0, stopAt) : after).replace(LEFTOVER_CONNECTOR, '').trim()

    if (window.length < MIN_LEN || window.length > MAX_LEN) continue
    if (looksLikeSentenceFragment(window)) continue

    found.push(window)

    // Avoid runaway loops on pathological content — same defensive cap
    // shape as evidence-extractor.ts's per-page/per-pattern limit.
    if (found.length >= MAX_OFFERINGS * 2) break
  }

  return found
}

/**
 * Extracts what the researched company says it sells/does, from its own
 * scraped website content only (not third-party enrichment sources — a
 * "we offer" phrase inside a press release or partner page more often
 * describes the SOURCE's own business, not the researched company's).
 * Deduped, capped, and quality-filtered. Returns [] rather than guessing
 * when no self-referential offering language is found.
 */
export function extractCompanyOfferings(websiteContent: string): string[] {
  const raw = extractOfferingsFromText(websiteContent)

  const seen = new Set<string>()
  const deduped: string[] = []
  for (const phrase of raw) {
    const key = normalize(phrase)
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(phrase)
    if (deduped.length >= MAX_OFFERINGS) break
  }

  return deduped
}

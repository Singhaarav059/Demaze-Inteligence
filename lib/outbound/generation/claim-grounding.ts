// ============================================================
// Unsupported Numeric Claim Detector (Phase B, safety policy B5)
// ============================================================
// Deterministic only — no new LLM call (Master Plan Rule 2), same
// discipline as personalization-check.ts right next to it. Scope
// deliberately narrow: a general "is this sentence a fabricated fact"
// detector would need real NLP/another LLM call (Rule 2, Rule 10 — don't
// expand the feature surface for a soft, high-false-positive heuristic).
// Numbers are the highest-risk, most checkable hallucination class in this
// domain specifically — see CLAUDE.md's own "Signal: 6 manufacturing
// facilities... Confidence: medium (facility count confirmed...)" example —
// a specific count/percentage the model states about the PROSPECT that
// doesn't trace back to anything it was actually given is the clearest,
// cheapest, lowest-noise signal available without new AI infrastructure.
//
// Computed once at generation time (generate-email route, same call site as
// checkPersonalization) and stored on the draft — BLOCKING, unlike
// checkPersonalization: see docs/outbound-safety-policy.md's B5 entry.
// ============================================================

import type { EmailGenerationInput } from './types'

export interface ClaimGroundingCheckResult {
  hasUnsupportedClaim: boolean
  flaggedClaims: string[]
  reason: string
}

// A number immediately followed by a time-duration unit is this codebase's
// own standard CTA phrasing ("worth 15 minutes?" — see prompts.ts's own
// buildEmailPrompt instruction), never a factual claim about the prospect —
// excluded regardless of which sentence it appears in.
const TIME_OFFER_NUMBER = /\b\d+\s*(?:min|mins|minute|minutes)\b/gi

const NUMBER_PATTERN = /\b\d[\d,]*(?:\.\d+)?%?\b/g

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collectEvidenceText(input: EmailGenerationInput): string {
  return [
    input.companySummary,
    ...input.painPoints,
    ...input.opportunities.map(o => `${o.title} ${o.description ?? ''}`),
    ...input.recentActivity,
    input.openingAngle,
    input.whatToSell,
    input.whyNow,
    input.salesIntelligence?.evidenceSentence,
  ]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(' ')
}

// Checks only sentences that explicitly name the researched company — a
// much lower-noise anchor than "you"/"your" (which appears in nearly every
// sentence of a cold email, including generic CTA boilerplate that has
// nothing to do with the prospect specifically).
export function checkUnsupportedClaims(
  emailBody: string,
  input: EmailGenerationInput
): ClaimGroundingCheckResult {
  const companyName = input.companyName.trim()
  const flagged: string[] = []

  if (companyName) {
    const evidenceText = collectEvidenceText(input)
    const companyPattern = new RegExp(`\\b${companyName.split(/\s+/).map(escapeRegex).join('\\s+')}`, 'i')

    for (const sentence of splitSentences(emailBody)) {
      if (!companyPattern.test(sentence)) continue
      const withoutTimeOffers = sentence.replace(TIME_OFFER_NUMBER, '')
      const numbers = withoutTimeOffers.match(NUMBER_PATTERN) ?? []
      for (const num of numbers) {
        // Substring match, not word-boundary — deliberately the more
        // permissive direction (a real "16" could spuriously "clear" a
        // fabricated "6" this way), same "prefer under-confidence" trade-off
        // this repo already makes throughout its grounding/quote-verification
        // code: a false pass here is far less costly than a false BLOCK on a
        // legitimate send.
        if (!evidenceText.includes(num)) {
          flagged.push(`"${num}" in: "${sentence}"`)
        }
      }
    }
  }

  const hasUnsupportedClaim = flagged.length > 0
  return {
    hasUnsupportedClaim,
    flaggedClaims: flagged,
    reason: hasUnsupportedClaim
      ? `Email states ${flagged.length} number(s) about ${companyName} that don't appear anywhere in the research this email was generated from.`
      : 'No unsupported numeric claims about the prospect detected.',
  }
}

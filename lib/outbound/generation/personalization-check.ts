// ============================================================
// Generic Personalization Detector (Master Plan Phase 5, Step 5.2)
// ============================================================
// Deterministic only — no new LLM call (Master Plan Rule 2). Two signals,
// combined:
//   1. A blacklist of filler phrases that could apply to almost any company
//      (the plan's own examples, plus common cold-email boilerplate).
//   2. Specificity against the real evidence this email was generated from
//      (EmailGenerationInput — the exact input assemble-input.ts built) —
//      per the plan's own instruction not to rely on the blacklist alone.
//      An email that shares none of the researched evidence's distinctive
//      words is the real red flag, even with zero blacklisted phrases.
//
// Advisory only — never blocks generation or send. The caller (generate-
// email route) attaches the result to the stored draft; the UI (OutreachStep)
// renders it as a warning badge for the human reviewer, same "flag, don't
// silently reject" discipline as decision-maker grounding elsewhere in this
// module family.
// ============================================================

import type { EmailGenerationInput } from './types'

export interface PersonalizationCheckResult {
  isGeneric: boolean
  genericPhrasesFound: string[]
  referencesRealEvidence: boolean
  reason: string
}

// Master Plan Step 5.2's own examples, plus common cold-email filler in the
// same shape. Not exhaustive — extend as real generic drafts get caught,
// same "keyword-list guard, extend on evidence" discipline as
// matchesKeyword()/NON_COMPETITOR_NAMES elsewhere in this repo.
const GENERIC_PHRASES: RegExp[] = [
  /impressed by your (commitment|dedication|focus)/i,
  /noticed (that )?your company is growing/i,
  /your digital transformation journey/i,
  /given today'?s competitive (environment|landscape|market)/i,
  /in today'?s (fast-paced|rapidly evolving|ever-changing) (world|market|business|landscape)/i,
  /caught my (eye|attention)/i,
  /excited about what you'?re building/i,
  /i (was |am )?impressed with your/i,
  /your commitment to innovation/i,
  /stood out to me/i,
  /companies (like yours|of your size)/i,
  /businesses (like yours|in your industry)/i,
  /i hope this email finds you well/i,
]

// Duplicated shape (not imported) from lib/pipeline/quote-verification.ts's
// significantWords()/STOPWORDS — same "small helper, duplicate over share"
// precedent used throughout this repo's discovery/generation modules.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'nor', 'but', 'so', 'yet', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'this', 'that',
  'these', 'those', 'with', 'from', 'into', 'onto', 'over', 'under', 'than',
  'then', 'they', 'their', 'them', 'its', 'our', 'your', 'not', 'also', 'can',
  'will', 'would', 'could', 'should', 'about', 'across', 'which', 'while',
  'you', 'we', 'i', 'to', 'of', 'in', 'on', 'at', 'as', 'if', 'by', 'my',
])

function significantWords(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []).filter(
    w => w.length > 3 && !STOPWORDS.has(w)
  )
}

// How many of the email's significant words must overlap with the real
// research-evidence vocabulary before it counts as "references real
// evidence." Deliberately low — this is a coarse specificity signal, not an
// exact-quote check (that's quote-verification.ts's job upstream, already
// gating pain_points/opportunities before they ever reach this input).
const MIN_EVIDENCE_WORD_MATCHES = 3

function collectEvidenceText(input: EmailGenerationInput): string {
  return [
    input.companySummary,
    ...input.painPoints,
    ...input.opportunities.map(o => `${o.title} ${o.description ?? ''}`),
    ...input.recentActivity,
    input.openingAngle,
    input.whatToSell,
    input.whyNow,
  ]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(' ')
}

export function checkPersonalization(
  emailBody: string,
  input: EmailGenerationInput
): PersonalizationCheckResult {
  const genericPhrasesFound = GENERIC_PHRASES.filter(p => p.test(emailBody)).map(p => p.source)

  const evidenceWords = new Set(significantWords(collectEvidenceText(input)))
  const bodyWords = significantWords(emailBody)
  const matchedCount = new Set(bodyWords.filter(w => evidenceWords.has(w))).size

  const referencesRealEvidence = evidenceWords.size > 0 && matchedCount >= MIN_EVIDENCE_WORD_MATCHES
  const isGeneric = genericPhrasesFound.length > 0 || !referencesRealEvidence

  let reason: string
  if (genericPhrasesFound.length > 0 && !referencesRealEvidence) {
    reason = `Contains ${genericPhrasesFound.length} generic filler phrase(s) and doesn't reference the researched evidence.`
  } else if (genericPhrasesFound.length > 0) {
    reason = `Contains ${genericPhrasesFound.length} generic filler phrase(s) that could apply to almost any company.`
  } else if (!referencesRealEvidence) {
    reason = evidenceWords.size === 0
      ? 'No research evidence was available to check this email against.'
      : `Doesn't clearly reference the researched evidence (only ${matchedCount} shared specific word(s), needs ${MIN_EVIDENCE_WORD_MATCHES}+).`
  } else {
    reason = 'References specific evidence from the research.'
  }

  return { isGeneric, genericPhrasesFound, referencesRealEvidence, reason }
}

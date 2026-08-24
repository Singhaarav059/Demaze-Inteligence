// ============================================================
// Shared title-matching helpers for decision-maker discovery providers
// ============================================================
// Extracted from providers/prospeo.ts and providers/explee.ts, which had
// byte-identical copies of all of this — same directory, so a shared file
// here doesn't cross this repo's usual "duplicate small helpers instead of
// coupling across modules" line.
// ============================================================

import type { DecisionMakerConfidence } from './types'

// Common C-level/VP acronyms expanded so e.g. "CEO" and "Chief Executive
// Officer" are recognized as the same title — without this, an acronym-
// shaped target title would never word-overlap with a spelled-out real job
// title, or vice versa.
export const TITLE_EXPANSIONS: Record<string, string> = {
  ceo: 'chief executive officer',
  cto: 'chief technology officer',
  coo: 'chief operating officer',
  cfo: 'chief financial officer',
  cmo: 'chief marketing officer',
  cio: 'chief information officer',
  vp: 'vice president',
}

export const STOPWORDS = new Set(['of', 'the', 'and', 'for', 'a', 'an', '&'])

export function normalizeTitleWords(title: string): string[] {
  const raw = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const expanded = raw.flatMap(w => (TITLE_EXPANSIONS[w] ? TITLE_EXPANSIONS[w].split(' ') : [w]))
  return expanded.filter(w => !STOPWORDS.has(w))
}

// Ratio of targetTitle's own words found in candidateTitle — same word-
// boundary discipline as matchesKeyword()/classifySubject() elsewhere in
// this repo, never a naive substring match (which would e.g. collide "VP"
// inside an unrelated word).
export function titleOverlapRatio(candidateTitle: string, targetTitle: string): number {
  const targetWords = normalizeTitleWords(targetTitle)
  if (targetWords.length === 0) return 0
  const candidateWords = new Set(normalizeTitleWords(candidateTitle))
  const matched = targetWords.filter(w => candidateWords.has(w)).length
  return matched / targetWords.length
}

export function bestTargetTitleMatch(candidateTitle: string, targetTitles: string[]): { target: string; ratio: number } | null {
  let best: { target: string; ratio: number } | null = null
  for (const target of targetTitles) {
    const ratio = titleOverlapRatio(candidateTitle, target)
    if (ratio > 0 && (!best || ratio > best.ratio)) best = { target, ratio }
  }
  return best
}

export function tierConfidence(ratio: number, isCurrentTitle: boolean = true): DecisionMakerConfidence {
  if (ratio >= 1 && isCurrentTitle) return 'high'
  if (ratio >= 0.5) return 'medium'
  return 'low'
}

export function stripToHostname(domain: string): string {
  return domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

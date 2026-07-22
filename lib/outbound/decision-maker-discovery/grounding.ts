// ============================================================
// Decision-Maker Discovery — Website Grounding
// ============================================================
// 2026-07-18 fix: decision-maker discovery previously called an external
// vendor (Prospeo Search Person, or the mock provider) with zero
// cross-reference to leadershipContacts — the names/titles the scraper
// ALREADY extracted from the company's own site
// (lib/pipeline/evidence-extractor.ts). A vendor candidate could silently
// contradict what's plainly visible on the company's own site with no way
// to detect that.
//
// This module is a simple match/no-match/conflict flag, not a heavyweight
// reconciliation system — same "flag for manual review, never silently
// auto-merge" discipline as possibleDuplicateOf in
// lib/batch/company-dedup.ts. Pure, no I/O, applied uniformly to every
// provider's output from provider-factory.ts (mock and real alike) rather
// than duplicated per-provider.
// ============================================================

import { normalizeName } from '@/lib/enrichment/competitor-discovery'
import type { DecisionMakerCandidate, LeadershipContactInput } from './types'

const TITLE_STOPWORDS = new Set(['of', 'the', 'and', 'for', 'a', 'an', '&'])

function normalizeTitleWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !TITLE_STOPWORDS.has(w))
}

// Word-overlap name match — same discipline as isSelfName()/matchesKeyword()
// elsewhere in this repo, never a naive substring match (which would
// collide e.g. "Jan" inside "Janardhan").
function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const wordsA = na.split(' ').filter(w => w.length > 1)
  const wordsB = nb.split(' ').filter(w => w.length > 1)
  if (wordsA.length === 0 || wordsB.length === 0) return false
  const overlap = wordsA.filter(w => wordsB.includes(w)).length
  return overlap / wordsA.length >= 0.6 || overlap / wordsB.length >= 0.6
}

// Symmetric overlap ratio (best of A-covers-B / B-covers-A) — a candidate
// title of "CEO" and an on-site title of "Chief Executive Officer" share no
// literal words, so this is intentionally forgiving on exact wording; the
// name match already did the hard work of finding the right person.
function titleOverlapRatio(a: string, b: string): number {
  const wordsA = normalizeTitleWords(a)
  const wordsB = normalizeTitleWords(b)
  if (wordsA.length === 0 || wordsB.length === 0) return 0
  const setB = new Set(wordsB)
  const setA = new Set(wordsA)
  const aInB = wordsA.filter(w => setB.has(w)).length / wordsA.length
  const bInA = wordsB.filter(w => setA.has(w)).length / wordsB.length
  return Math.max(aInB, bInA)
}

const TITLE_MATCH_THRESHOLD = 0.4

export function groundCandidate(
  candidate: DecisionMakerCandidate,
  leadershipContacts: LeadershipContactInput[] | undefined
): DecisionMakerCandidate {
  if (!leadershipContacts || leadershipContacts.length === 0) return candidate

  const match = leadershipContacts.find(lc => namesMatch(lc.name, candidate.personName))

  if (!match) {
    return {
      ...candidate,
      grounding: {
        status: 'not_found',
        reason: "Not found in the company's own scraped leadership content — from the discovery provider only.",
      },
    }
  }

  // Acronym vs. spelled-out titles ("CEO" vs "Chief Executive Officer")
  // share zero literal words but often still mean the same role — a plain
  // acronym-equals-first-letters check catches that common case before
  // falling back to the looser word-overlap ratio.
  const acronymMatch =
    /^[A-Za-z]{2,5}$/.test(candidate.title.trim()) &&
    match.title
      .split(/\s+/)
      .map(w => w[0]?.toUpperCase() ?? '')
      .join('') === candidate.title.trim().toUpperCase()

  const ratio = titleOverlapRatio(candidate.title, match.title)

  if (acronymMatch || ratio >= TITLE_MATCH_THRESHOLD) {
    return {
      ...candidate,
      grounding: {
        status: 'confirmed',
        reason: `Confirmed on the company's own website as "${match.title}".`,
      },
    }
  }

  return {
    ...candidate,
    grounding: {
      status: 'conflict',
      reason: `Name found on the company's own website, but listed there as "${match.title}", not "${candidate.title}".`,
    },
  }
}

export function groundCandidates(
  candidates: DecisionMakerCandidate[],
  leadershipContacts: LeadershipContactInput[] | undefined
): DecisionMakerCandidate[] {
  return candidates.map(c => groundCandidate(c, leadershipContacts))
}

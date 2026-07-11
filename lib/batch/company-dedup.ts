// ============================================================
// Batch Company Dedup — v1
// ============================================================
// Collapses multiple person-rows for the same company into one entry with
// contacts nested underneath. Real exports spell the same company several
// ways ("A.T.E. Group" / "ATE Group" / "A T E Group") — plain exact-string
// matching misses this, and naive fuzzy matching risks merging two
// genuinely different companies that happen to share a short name.
//
// Reuses the same word-boundary discipline as website-discovery.ts's
// normalizeCompanyName()/wordMatchRatio() rather than inventing a new
// mechanism — same false-positive class (single-word/acronym names are
// unsafe to auto-merge on a loose match alone).
//
// Tiered, safest-first:
//   1. Domain match       — both rows have a website, same hostname -> merge
//   2. Exact normalized   — suffix/punctuation/case stripped, identical -> merge
//   3. Acronym-insensitive — all internal whitespace also stripped, identical,
//                            AND squashed length >= 5 chars -> merge
//   4. Anything weaker     — NOT auto-merged, flagged as a possible duplicate
//                            for the user to confirm in the UI
// ============================================================

import type { LeadRow } from './file-parser'

export interface Contact {
  personName?: string
  jobTitle?: string
  personLinkedIn?: string
}

export interface DedupedCompany {
  /** Stable id for this group — used as the React key / selection key. */
  id: string
  companyName: string
  companyWebsite?: string
  companyLinkedIn?: string
  industry?: string
  country?: string
  contacts: Contact[]
  /** Other company names in this batch that share a weak/partial name match
   * but weren't confident enough to auto-merge — surfaced for manual review. */
  possibleDuplicateOf: string[]
}

// ── Name normalization (same principle as website-discovery.ts) ────────

const LEGAL_SUFFIXES = /\b(?:pvt\.?|private|ltd\.?|limited|inc\.?|incorporated|llc|corp\.?|corporation|co\.?)\b/gi

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function squash(normalized: string): string {
  return normalized.replace(/\s+/g, '')
}

function significantWords(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean)
}

function wordOverlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setB = new Set(b)
  const matched = a.filter(w => setB.has(w)).length
  return matched / Math.max(a.length, b.length)
}

function normalizeDomain(website: string): string | null {
  try {
    const withProtocol = website.match(/^https?:\/\//) ? website : `https://${website}`
    const host = new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, '')
    return host || null
  } catch {
    return null
  }
}

// ── Matching ──────────────────────────────────────────────────

type MatchTier = 'domain' | 'exact' | 'squash' | 'partial' | 'none'

function matchTier(
  a: { normalized: string; squashed: string; words: string[]; domain: string | null },
  b: { normalized: string; squashed: string; words: string[]; domain: string | null },
): MatchTier {
  if (a.domain && b.domain && a.domain === b.domain) return 'domain'
  if (a.normalized === b.normalized) return 'exact'
  if (a.squashed === b.squashed && a.squashed.length >= 5) return 'squash'

  const ratio = wordOverlapRatio(a.words, b.words)
  if (ratio >= 0.5) return 'partial'

  return 'none'
}

// ── Main export ───────────────────────────────────────────────

export function dedupeCompanies(rows: LeadRow[]): DedupedCompany[] {
  interface Group {
    company: DedupedCompany
    normalized: string
    squashed: string
    words: string[]
    domain: string | null
  }

  const groups: Group[] = []
  let nextId = 1

  for (const row of rows) {
    const normalized = normalizeCompanyName(row.companyName)
    const squashed = squash(normalized)
    const words = significantWords(normalized)
    const domain = row.companyWebsite ? normalizeDomain(row.companyWebsite) : null

    let bestMatch: { group: Group; tier: MatchTier } | null = null
    for (const group of groups) {
      const tier = matchTier({ normalized, squashed, words, domain }, group)
      if (tier === 'none') continue
      // domain > exact > squash > partial, in that preference order
      const tierRank: Record<MatchTier, number> = { domain: 3, exact: 2, squash: 1, partial: 0, none: -1 }
      if (!bestMatch || tierRank[tier] > tierRank[bestMatch.tier]) {
        bestMatch = { group, tier }
      }
    }

    const contact: Contact = {
      personName: row.personName,
      jobTitle: row.jobTitle,
      personLinkedIn: row.personLinkedIn,
    }

    if (bestMatch && bestMatch.tier !== 'partial') {
      // Confident merge (domain/exact/squash) — fold into the existing group,
      // filling in any fields the earlier row(s) left blank.
      const g = bestMatch.group
      g.company.contacts.push(contact)
      g.company.companyWebsite ??= row.companyWebsite
      g.company.companyLinkedIn ??= row.companyLinkedIn
      g.company.industry ??= row.industry
      g.company.country ??= row.country
      continue
    }

    // No confident match — new group. If a 'partial' match was found, flag
    // it as a possible duplicate on BOTH sides rather than silently treating
    // them as unrelated, but do not merge their contacts.
    const newCompany: DedupedCompany = {
      id: `co_${nextId++}`,
      companyName: row.companyName,
      companyWebsite: row.companyWebsite,
      companyLinkedIn: row.companyLinkedIn,
      industry: row.industry,
      country: row.country,
      contacts: [contact],
      possibleDuplicateOf: [],
    }

    if (bestMatch && bestMatch.tier === 'partial') {
      newCompany.possibleDuplicateOf.push(bestMatch.group.company.companyName)
      bestMatch.group.company.possibleDuplicateOf.push(newCompany.companyName)
    }

    groups.push({ company: newCompany, normalized, squashed, words, domain })
  }

  return groups.map(g => g.company)
}

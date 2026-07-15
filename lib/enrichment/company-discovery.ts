// ============================================================
// Company Discovery Engine (Roadmap Phase 2, item 3) — 2026-07-15
// ============================================================
// Given an ICP segment (e.g. an ICPSegment.name from icp-generator.ts, or
// free text typed by a user on the new /admin/company-discovery page),
// surface real, named companies that plausibly belong to that segment —
// candidates for the SDR to send into the existing 4-step research
// pipeline. This is the reverse direction from Competitor Discovery Engine
// and ICP Generator: those enrich a report for a company ALREADY being
// researched; this one finds NEW companies to research in the first place.
// See CLAUDE.md "SCOPE PIVOT" / docs/ROADMAP.md item 3.
//
// Architecture mirrors competitor-discovery.ts / icp-generator.ts (the
// documented reference pattern — see docs/DECISIONS.md): search-grounded,
// not LLM-invented. Every candidate NAME below comes only from search-result
// regex extraction, never from an LLM — there is no LLM narration step in
// this module at all (unlike competitors/ICP segments, a discovered company
// doesn't get "narrated," it either gets researched or it doesn't).
//
// Domain resolution reuses website-discovery.ts's discoverCompanyWebsite()
// directly rather than reinventing candidate-domain verification — same
// content-based, word-boundary-matched, prefer-under-confidence discipline.
// This is the expensive part (2 extra search queries + up to 4 homepage
// fetches PER candidate), so it only runs for the top-ranked survivors after
// filtering, sequentially, capped at MAX_COMPANIES.
//
// Governing principle, same as every other discovery module in this repo:
// prefer under-confidence to over-confidence. A wrong company name or a
// wrongly-attributed domain is worse than an honest empty list.
// ============================================================

import { searchTavily, searchSerper } from './discovery-engine'
import { isSelfName } from './competitor-discovery'
import { discoverCompanyWebsite } from './website-discovery'

export type CompanyMatchConfidence = 'high' | 'medium' | 'low'
export type CompanyDiscoverySufficiency = 'sufficient' | 'insufficient'

// Raw candidate, pre-filter — one per company name surfaced by search,
// before the self-name/directory/generic-term filter runs. Kept distinct
// from CompanyMatch so the filter step has something to discard without
// mutating the final shape, same reason CompetitorCandidate/ICPCandidate
// stay separate from their filtered counterparts.
export interface CompanyDiscoveryCandidate {
  name: string
  mention_count: number   // independent search results naming this candidate
  source_urls: string[]
  snippets: string[]      // raw search snippets — becomes the fallback `reason` text
}

// Final, filtered shape — one per surfaced company. `domain` is only set
// when discoverCompanyWebsite() confirms it (confidence 'high' or 'medium')
// — never a guess, same discipline as everywhere else in this codebase.
export interface CompanyMatch {
  name: string
  domain?: string
  domain_confidence?: 'high' | 'medium'
  reason: string           // code-derived, built from the matched search snippet — never LLM-narrated
  confidence: CompanyMatchConfidence
  source_urls: string[]
}

export interface CompanyDiscoveryResult {
  companies: CompanyMatch[]
  sufficiency: CompanyDiscoverySufficiency
  reason: string                 // human-readable summary for diagnostics/logs
  candidates_considered: number  // pre-filter candidate count
  rejected_candidates?: Array<{ name: string; reason: string }>
}

// ── Name normalization (same LEGAL_SUFFIXES list as the sibling modules) ──

const LEGAL_SUFFIXES = /\b(?:pvt\.?|private|ltd\.?|limited|inc\.?|incorporated|llc|corp\.?|corporation|co\.?)\b/gi

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── Rejection rules ───────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'top', 'best', 'list', 'guide',
  'review', 'in', 'of', 'to', 'with', 'by', 'is', 'are', 'this', 'that',
  'these', 'those', 'you', 'your', 'other', 'others',
  // The trigger vocabulary itself — same "candidate whose entire name IS the
  // trigger word" bug class found live in competitor-discovery.ts and
  // icp-generator.ts (2026-07-15).
  'companies', 'company', 'businesses', 'firms', 'players', 'vendors',
])

// Known directories/aggregators/review sites/news outlets/social networks —
// a search RESULT from one of these can legitimately name real companies in
// its snippet, but the site's own brand name must never be extracted AS a
// discovered company. Same list class as competitor-discovery.ts's
// NON_COMPETITOR_NAMES (not shared/imported — this codebase's existing
// precedent duplicates these small per-file constant lists rather than
// centralizing them, see website-discovery.ts/competitor-discovery.ts
// history in docs/DECISIONS.md).
const NON_COMPANY_NAMES = [
  'G2', 'Capterra', 'TrustRadius', 'Crunchbase', 'SimilarWeb', 'Gartner',
  'Wikipedia', 'LinkedIn', 'Glassdoor', 'Indeed', 'YouTube', 'Facebook',
  'Twitter', 'Instagram', 'Reuters', 'Bloomberg', 'Forbes', 'BusinessWire',
  'PRNewswire', 'Clutch', 'Google', 'Yelp', 'Medium', 'Quora', 'Reddit',
]

// Returns a rejection reason, or null if the candidate survives. Order
// matters for diagnostic quality, same discipline as the sibling modules'
// classifyRejection()/classifySegmentRejection().
export function classifyCompanyRejection(name: string, excludeCompanyName: string | undefined): string | null {
  if (excludeCompanyName && isSelfName(name, excludeCompanyName)) {
    return 'self-name (matches the excluded/researched company)'
  }
  for (const bad of NON_COMPANY_NAMES) {
    if (new RegExp(`\\b${escapeRegex(bad)}\\b`, 'i').test(name)) {
      return 'known directory/aggregator/news-outlet/social-network name, not a company'
    }
  }
  const normalized = normalizeName(name)
  if (!normalized || normalized.length < 3) {
    return 'too short/generic to be a real company name'
  }
  const words = normalized.split(' ').filter(Boolean)
  if (words.every(w => STOPWORDS.has(w))) {
    return 'generic/stopword phrase, not a company name'
  }
  return null
}

// ── Candidate-name extraction (regex, no LLM) ────────────────────
// Companies are proper nouns, same shape as competitor names — reuses the
// same PROPER_NOUN capture group. Trigger vocabulary is company-list framing
// ("companies like X, Y, Z" / "leading companies include..." / "top N
// companies:") rather than competitor "vs"/"alternatives" framing.

const PROPER_NOUN = /\b[A-Z][a-zA-Z0-9&.'-]*(?:\s+[A-Z][a-zA-Z0-9&.'-]*){0,3}\b/g

const LIST_TRIGGER =
  /\b(?:top|leading|major|well-?known|notable)\s+companies\b|\bcompanies\s+(?:like|such\s+as|include[sd]?|including)\b|\bcompanies\s+in\s+this\s+space\s+include\b/i

export function extractCompaniesAfterTrigger(text: string): string[] {
  const m = LIST_TRIGGER.exec(text)
  if (!m) return []
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 200)
  const stopAt = after.search(/[.!?]/)
  const window = stopAt >= 0 ? after.slice(0, stopAt) : after
  const names = window.match(PROPER_NOUN) ?? []
  return names.map(n => n.trim()).filter(n => n.length >= 3 && n.length <= 60)
}

// Numbered-list extraction ("1. Zoho\n2. Freshworks" / "1) Chargebee") — a
// second, distinct pattern from the trigger-phrase list above. Search-result
// snippets frequently render "Top 10 X Companies" posts as a flattened
// numbered sequence with no single trigger sentence to anchor on.
const NUMBERED_ITEM = /(?:^|\n|\s)(?:\d{1,2}[.)]\s+)([A-Z][a-zA-Z0-9&.'-]*(?:\s+[A-Z][a-zA-Z0-9&.'-]*){0,3})/g

export function extractNumberedListCompanies(text: string): string[] {
  const names: string[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(NUMBERED_ITEM)
  while ((match = re.exec(text)) !== null) {
    const name = match[1].trim()
    if (name.length >= 3 && name.length <= 60) names.push(name)
  }
  return names
}

// ── Confidence tiering ────────────────────────────────────────────

export function tierMatchConfidence(c: CompanyDiscoveryCandidate): CompanyMatchConfidence {
  if (c.mention_count >= 2) return 'high'
  if (c.mention_count === 1) return 'medium'
  return 'low'
}

export function fallbackReason(candidate: CompanyDiscoveryCandidate, icpSegment: string): string {
  const snippet = candidate.snippets[0]
  if (snippet) return `Surfaced via search for "${icpSegment}": "${snippet.slice(0, 150)}"`
  return `Surfaced via search for "${icpSegment}" (no snippet captured).`
}

// ── Search ─────────────────────────────────────────────────────────
// Duplicated per-query Tavily→Serper fallback, same shape as the sibling
// discovery modules — kept as its own copy rather than a shared import,
// matching this codebase's existing precedent (see website-discovery.ts /
// competitor-discovery.ts / icp-generator.ts, each has its own copy).

async function searchWithFallback(
  query: string,
  tavilyKey: string | undefined,
  serperKey: string | undefined,
): Promise<Array<{ title: string; url: string; content: string }>> {
  if (tavilyKey) {
    const results = await searchTavily(query, tavilyKey)
    if (results.length > 0) return results
  }
  if (serperKey) return searchSerper(query, serperKey)
  return []
}

function buildCompanyDiscoveryQueries(icpSegment: string): string[] {
  return [
    `top companies in ${icpSegment}`,
    `leading ${icpSegment} companies`,
    `list of ${icpSegment} companies`,
    `${icpSegment} companies list`,
  ]
}

// ── Main export ───────────────────────────────────────────────────

const MAX_COMPANIES = 6
const MAX_SNIPPETS_PER_CANDIDATE = 2

export async function discoverCompanies(
  icpSegment: string,
  excludeCompanyName?: string,
): Promise<CompanyDiscoveryResult> {
  const tavilyKey = process.env.TAVILY_API_KEY
  const serperKey = process.env.SERPER_API_KEY

  if (!tavilyKey && !serperKey) {
    return { companies: [], sufficiency: 'insufficient', reason: 'no search API configured', candidates_considered: 0 }
  }
  if (!icpSegment || icpSegment.trim().length === 0) {
    return { companies: [], sufficiency: 'insufficient', reason: 'no ICP segment given to search for', candidates_considered: 0 }
  }

  const queries = buildCompanyDiscoveryQueries(icpSegment.trim())
  let allResults: Array<{ title: string; url: string; content: string }>
  try {
    const resultsPerQuery = await Promise.all(queries.map(q => searchWithFallback(q, tavilyKey, serperKey)))
    allResults = resultsPerQuery.flat()
  } catch (e) {
    return {
      companies: [], sufficiency: 'insufficient',
      reason: `search failed: ${e instanceof Error ? e.message : String(e)}`,
      candidates_considered: 0,
    }
  }

  if (allResults.length === 0) {
    return { companies: [], sufficiency: 'insufficient', reason: 'search returned no results for any company-discovery query', candidates_considered: 0 }
  }

  // ── Extract + group raw candidates by normalized name ─────────────
  const grouped = new Map<string, { displayName: string; mention_count: number; source_urls: Set<string>; snippets: string[] }>()

  for (const r of allResults) {
    const names = [
      ...extractCompaniesAfterTrigger(r.title),
      ...extractCompaniesAfterTrigger(r.content),
      ...extractNumberedListCompanies(r.content),
    ]
    const namesInThisResult = new Set(names.map(n => n.trim()).filter(Boolean))

    for (const name of namesInThisResult) {
      const key = normalizeName(name)
      if (!key) continue
      const existing = grouped.get(key)
      const snippetText = (r.content || r.title).slice(0, 300)
      if (existing) {
        existing.mention_count += 1
        existing.source_urls.add(r.url)
        if (existing.snippets.length < MAX_SNIPPETS_PER_CANDIDATE) existing.snippets.push(snippetText)
      } else {
        grouped.set(key, {
          displayName: name,
          mention_count: 1,
          source_urls: new Set([r.url]),
          snippets: [snippetText],
        })
      }
    }
  }

  // ── Filter ──────────────────────────────────────────────────────
  const rejected: Array<{ name: string; reason: string }> = []
  const survivors: CompanyDiscoveryCandidate[] = []

  for (const c of grouped.values()) {
    const rejectReason = classifyCompanyRejection(c.displayName, excludeCompanyName)
    if (rejectReason) {
      rejected.push({ name: c.displayName, reason: rejectReason })
      continue
    }
    survivors.push({
      name: c.displayName,
      mention_count: c.mention_count,
      source_urls: Array.from(c.source_urls),
      snippets: c.snippets,
    })
  }

  if (survivors.length === 0) {
    return {
      companies: [],
      sufficiency: 'insufficient',
      reason: `${grouped.size} raw candidate(s) found, all rejected (self-name/directory/generic-term)`,
      candidates_considered: grouped.size,
      rejected_candidates: rejected,
    }
  }

  // ── Confidence tiering + cap (pre-domain-resolution rank) ──────────
  const rank: Record<CompanyMatchConfidence, number> = { high: 2, medium: 1, low: 0 }
  const tiered = survivors
    .map(c => ({ candidate: c, confidence: tierMatchConfidence(c) }))
    .sort((a, b) => rank[b.confidence] - rank[a.confidence] || b.candidate.mention_count - a.candidate.mention_count)
    .slice(0, MAX_COMPANIES)

  // ── Domain resolution — sequential, only for the capped survivor set.
  // This is the expensive step (2 search queries + up to 4 homepage fetches
  // PER candidate via discoverCompanyWebsite()) — deliberately sequential,
  // not Promise.all, same "respect real quota limits" discipline as
  // batch-upload's researchSelected() loop (CLAUDE.md Item 7).
  const companies: CompanyMatch[] = []
  for (const { candidate, confidence } of tiered) {
    const site = await discoverCompanyWebsite(candidate.name)
    companies.push({
      name: candidate.name,
      domain: site.status === 'confirmed' ? site.domain ?? undefined : undefined,
      domain_confidence: site.status === 'confirmed' && site.confidence !== 'none' ? site.confidence : undefined,
      reason: fallbackReason(candidate, icpSegment),
      confidence,
      source_urls: candidate.source_urls,
    })
  }

  return {
    companies,
    sufficiency: 'sufficient',
    reason: `${companies.length} of ${grouped.size} raw candidate(s) survived filtering`,
    candidates_considered: grouped.size,
    rejected_candidates: rejected,
  }
}

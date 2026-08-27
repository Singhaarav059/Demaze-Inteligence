// ============================================================
// LinkedIn Search-Discovery Decision-Maker Provider
// ============================================================
// Public search-engine discovery only: `site:linkedin.com/in/ "Company"
// ("Title" OR "Title" ...)` via the same searchTavily/searchSerper functions
// every other discovery module in this repo already uses (evidence
// discovery, website-discovery.ts). Never logs in, scrapes, or automates a
// LinkedIn session — CLAUDE.md's LinkedIn exclusion stays intact; this reads
// only what a public search engine already indexes (a result URL + title
// snippet), the same as a person manually Googling. Recommended option in
// docs/EPITAXY_VNEXT_AUDIT.md §E (option 1); §K.3 requires this to fail
// closed like every other provider — a result with no parseable title never
// becomes a candidate with a guessed/fabricated title.
// ============================================================

import { searchTavily, searchSerper } from '@/lib/enrichment/discovery-engine'
import { bestTargetTitleMatch, tierConfidence } from '../title-match'
import { DEFAULT_TARGET_TITLES } from '../types'
import type {
  DecisionMakerDiscoveryProvider,
  DecisionMakerDiscoveryRequest,
  DecisionMakerDiscoveryResult,
  DecisionMakerCandidate,
} from '../types'

// One combined OR-query per company rather than one query per title — same
// reasoning as buildDiscoveryQueries() capping its own template count: each
// call costs a real search-API credit, and a search engine's own OR-clause
// handling degrades well past this many terms anyway.
const MAX_TITLES_PER_QUERY = 6
const MAX_RESULTS = 10

function buildQuery(companyName: string, titles: string[]): string {
  const titleClause = titles.slice(0, MAX_TITLES_PER_QUERY).map(t => `"${t}"`).join(' OR ')
  return `site:linkedin.com/in/ "${companyName}" (${titleClause})`
}

// LinkedIn search-result titles are typically "Name - Title - Company |
// LinkedIn" or "Name | LinkedIn" — split on the separators, first segment is
// the name, the next non-"LinkedIn" segment (if any) is a title guess.
function parseResultTitle(title: string): { name: string; titleGuess: string | null } {
  const parts = title.split(/\s[-|]\s/).map(p => p.trim()).filter(Boolean)
  const name = parts[0] ?? ''
  const titleGuess = parts.slice(1).find(p => !/linkedin/i.test(p)) ?? null
  return { name, titleGuess }
}

export const LinkedInSearchDecisionMakerDiscoveryProvider: DecisionMakerDiscoveryProvider = {
  name: 'linkedin-search',
  displayName: 'LinkedIn Search Discovery',

  async discoverDecisionMakers(request: DecisionMakerDiscoveryRequest): Promise<DecisionMakerDiscoveryResult> {
    const { companyName } = request
    if (!companyName?.trim()) {
      return { candidates: [], providerUsed: 'linkedin-search', status: 'error', reason: 'companyName is required.' }
    }

    const tavilyKey = process.env.TAVILY_API_KEY
    const serperKey = process.env.SERPER_API_KEY
    if (!tavilyKey && !serperKey) {
      return {
        candidates: [],
        providerUsed: 'linkedin-search',
        status: 'error',
        reason: 'No search API key configured (TAVILY_API_KEY or SERPER_API_KEY).',
      }
    }

    const titles = request.targetTitles?.length ? request.targetTitles : DEFAULT_TARGET_TITLES
    const query = buildQuery(companyName, titles)

    let raw = tavilyKey ? await searchTavily(query, tavilyKey, MAX_RESULTS) : []
    if (raw.length === 0 && serperKey) raw = await searchSerper(query, serperKey, MAX_RESULTS)

    const seen = new Set<string>()
    const candidates: DecisionMakerCandidate[] = []

    for (const r of raw) {
      if (!/linkedin\.com\/in\//i.test(r.url) || seen.has(r.url)) continue

      const { name, titleGuess } = parseResultTitle(r.title)
      if (!name || !titleGuess) continue

      const match = bestTargetTitleMatch(titleGuess, titles)
      if (!match) continue

      seen.add(r.url)
      candidates.push({
        personName: name,
        title: match.target,
        linkedinUrl: r.url,
        confidence: tierConfidence(match.ratio, true),
      })
    }

    if (candidates.length === 0) {
      return {
        candidates: [],
        providerUsed: 'linkedin-search',
        status: 'not_found',
        reason: 'No public LinkedIn profile results matched this company and the requested titles.',
      }
    }

    return { candidates, providerUsed: 'linkedin-search', status: 'found' }
  },

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.TAVILY_API_KEY || process.env.SERPER_API_KEY)
  },
}

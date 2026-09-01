// ============================================================
// Exa Decision-Maker Discovery Provider
// ============================================================
// Uses Exa's Search API (category: 'people') — not Websets or the Agent
// API, per the "cheapest capability that can plausibly solve this" rule;
// a synchronous search is enough here, unlike Email Finder below, which
// genuinely has no synchronous per-person endpoint. `outputSchema` asks
// Exa's synthesis for a structured { candidates: [{name, title,
// linkedinUrl}] } shape — that's best-effort, not guaranteed (Exa's docs
// don't promise output.content is always populated), so when it's absent
// this falls back to parsing each raw result's title/url — LinkedIn
// people-search results commonly title themselves
// "Name - Title - Company | LinkedIn". Local word-overlap title tiering
// (title-match.ts, shared with Prospeo/Explee) tiers confidence when a
// candidate's title matches a requested phrase; when it doesn't, the
// candidate is kept (not dropped) with their own real title and an honest
// 'low' confidence — Exa's semantic search can correctly find a real person
// whose actual title just doesn't literally overlap with the 8 requested
// phrases (see Bharat Forge's Amit Kalyani in benchmarks/exa/REPORT.md).
// ============================================================

import { exaSearch } from '@/lib/enrichment/sources/exa-client'
import type { ExaResultItem } from '@/lib/enrichment/sources/exa-client'
import { getExaCredential } from '@/lib/outbound/shared/exa-outbound-client'
import { DEFAULT_TARGET_TITLES } from '../types'
import { bestTargetTitleMatch, tierConfidence, stripToHostname } from '../title-match'
import type {
  DecisionMakerDiscoveryProvider,
  DecisionMakerDiscoveryRequest,
  DecisionMakerDiscoveryResult,
  DecisionMakerCandidate,
} from '../types'

const MAX_CANDIDATES = 50

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          title: { type: 'string' },
          linkedinUrl: { type: 'string' },
        },
        required: ['name', 'title'],
      },
    },
  },
  required: ['candidates'],
} as const

// Natural-language query, not a filter — Exa's Search API doesn't support
// Prospeo/Explee-style exact job-title filters, so this is deliberately
// short and readable rather than a comma-dump of every target title.
function buildQuery(companyName: string, domain: string, titles: string[]): string {
  const titlePhrase = titles.length
    ? titles.slice(0, 6).join(', ')
    : 'operations, manufacturing, IT, or digital transformation'
  const companyPhrase = domain ? `${companyName || domain} (${stripToHostname(domain)})` : companyName
  return `${titlePhrase} leaders at ${companyPhrase}`
}

interface StructuredCandidate {
  name?: string
  title?: string
  linkedinUrl?: string
}

function fromStructuredOutput(content: unknown): StructuredCandidate[] | null {
  if (!content || typeof content !== 'object') return null
  const candidates = (content as Record<string, unknown>).candidates
  if (!Array.isArray(candidates)) return null
  return candidates.filter((c): c is StructuredCandidate => typeof c === 'object' && c !== null)
}

// Defensive parse only — never fabricates a name/title split from free
// text. Anything that doesn't match the common LinkedIn title shape is
// dropped rather than guessed at.
function fromRawResult(item: ExaResultItem): StructuredCandidate | null {
  if (!item.title) return null
  const parts = item.title.split(' - ').map(p => p.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const isLinkedin = /linkedin\.com\/in\//i.test(item.url || '')
  return {
    name: parts[0],
    title: parts[1].replace(/\s*\|\s*LinkedIn\s*$/i, ''),
    linkedinUrl: isLinkedin ? item.url : undefined,
  }
}

export const ExaDecisionMakerDiscoveryProvider: DecisionMakerDiscoveryProvider = {
  name: 'exa',
  displayName: 'Exa',

  async discoverDecisionMakers(request: DecisionMakerDiscoveryRequest): Promise<DecisionMakerDiscoveryResult> {
    const { companyName, domain } = request
    if (!companyName?.trim() && !domain?.trim()) {
      return { candidates: [], providerUsed: 'exa', status: 'error', reason: 'companyName or domain is required.' }
    }

    const apiKey = await getExaCredential('decision_maker_discovery')
    if (!apiKey) {
      return {
        candidates: [],
        providerUsed: 'exa',
        status: 'error',
        reason: 'No Exa API key configured. Set it in Outbound Integrations or EXA_API_KEY.',
      }
    }

    const titles = request.targetTitles?.length ? request.targetTitles : DEFAULT_TARGET_TITLES

    let response
    try {
      response = await exaSearch(
        {
          query: buildQuery(companyName, domain, titles),
          category: 'people',
          numResults: MAX_CANDIDATES,
          outputSchema: OUTPUT_SCHEMA,
          contents: { highlights: true },
        },
        apiKey
      )
    } catch (e) {
      return {
        candidates: [],
        providerUsed: 'exa',
        status: 'error',
        reason: e instanceof Error ? e.message : 'Exa search request failed.',
      }
    }

    const structured = fromStructuredOutput(response.output?.content)
    const rawCandidates: StructuredCandidate[] =
      structured ?? (response.results ?? []).map(fromRawResult).filter((c): c is StructuredCandidate => c !== null)

    const seen = new Set<string>()
    const candidates: DecisionMakerCandidate[] = []

    for (const raw of rawCandidates) {
      if (!raw.name?.trim() || !raw.title?.trim()) continue
      const key = (raw.linkedinUrl || raw.name).toLowerCase().trim()
      if (seen.has(key)) continue

      const match = bestTargetTitleMatch(raw.title, titles)
      // Unlike Prospeo/Explee (server-side filters that never return a
      // candidate whose title doesn't match at all), Exa's people search
      // can surface a real, correctly-identified person whose real title
      // just doesn't literally overlap with any of the requested phrases
      // (e.g. "Vice-Chairman and Joint Managing Director" vs the 8 stock
      // phrases). Dropping them entirely throws away a real find; forcing
      // them into one of the 8 phrases mislabels them. Keep them with their
      // own real title and an honest 'low' confidence instead of either.
      seen.add(key)
      candidates.push({
        personName: raw.name.trim(),
        title: match ? match.target : raw.title.trim(),
        linkedinUrl: raw.linkedinUrl || undefined,
        confidence: match ? tierConfidence(match.ratio) : 'low',
      })
      if (candidates.length >= MAX_CANDIDATES) break
    }

    if (candidates.length === 0) {
      return {
        candidates: [],
        providerUsed: 'exa',
        status: 'not_found',
        reason:
          rawCandidates.length === 0
            ? 'Exa returned no people results for this company.'
            : `Exa returned ${rawCandidates.length} candidate(s), but none had a usable name and title.`,
      }
    }

    return { candidates, providerUsed: 'exa', status: 'found' }
  },

  // Cheap credential-presence check only — no network ping before every
  // request, same discipline as the other real providers in this repo.
  async isAvailable(): Promise<boolean> {
    return (await getExaCredential('decision_maker_discovery')) !== null
  },
}

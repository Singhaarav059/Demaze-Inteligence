// ============================================================
// Explee Decision-Maker Discovery Provider
// ============================================================
// Calls Explee's /search/people endpoint with a job-title filter, scoped
// to a specific company via company_linkedin_ids when a confident Explee
// company match can be resolved (via the EXISTING company-search POC
// client, lib/enrichment/sources/explee-client.ts — see
// resolveCompanyLinkedinId's own comment for the precision tradeoff this
// implies), else falls back to the looser company_filters.definition
// (natural-language name match). Local word-overlap title tiering
// (lib/outbound/decision-maker-discovery/title-match.ts, shared with
// providers/prospeo.ts) — a result whose job_title shares no word with
// any requested title is dropped rather than surfaced as a guess.
// ============================================================

import { getExpleeApiKey, callExpleeSearchPeople } from '@/lib/outbound/shared/explee-client'
import type { ExpleePerson } from '@/lib/outbound/shared/explee-client'
import { searchExpleeCompanies } from '@/lib/enrichment/sources/explee-client'
import { DEFAULT_TARGET_TITLES } from '../types'
import { bestTargetTitleMatch, tierConfidence, stripToHostname } from '../title-match'
import type {
  DecisionMakerDiscoveryProvider,
  DecisionMakerDiscoveryRequest,
  DecisionMakerDiscoveryResult,
  DecisionMakerCandidate,
} from '../types'

const MAX_CANDIDATES = 50

// Resolves a confirmed Explee company match, preferring an exact domain
// match over a bare "only one candidate came back" guess.
//
// Precision tradeoff, documented not hidden: this reuses the EXISTING
// company-search POC client directly (lib/enrichment/sources/
// explee-client.ts's searchExpleeCompanies()), which resolves its own
// credential from the flat EXPLEE_API_KEY env var only — it has no
// outbound_integrations DB-row awareness. So a deployment that configured
// its Explee credential ONLY via /admin/outbound/integrations (no matching
// env var set) will silently skip this resolution step (the try/catch
// below swallows the resulting "EXPLEE_API_KEY is not set" throw) and
// fall through to the lower-precision company_filters.definition path.
async function resolveCompanyLinkedinId(companyName: string, domain: string): Promise<number | null> {
  if (!companyName?.trim()) return null
  try {
    const result = await searchExpleeCompanies({ definition: companyName }, 5, 1)
    const hostname = domain?.trim() ? stripToHostname(domain) : ''
    const match = hostname
      ? result.companies.find(c => c.domain && stripToHostname(c.domain) === hostname)
      : result.companies.length === 1 ? result.companies[0] : undefined
    return match?.linkedin_id ?? null
  } catch {
    return null
  }
}

function dedupeKey(person: ExpleePerson): string {
  return (person.linkedin_url || person.email || `${person.first_name ?? ''} ${person.last_name ?? ''}`)
    .toLowerCase()
    .trim()
}

export const ExpleeDecisionMakerDiscoveryProvider: DecisionMakerDiscoveryProvider = {
  name: 'explee',
  displayName: 'Explee',

  async discoverDecisionMakers(request: DecisionMakerDiscoveryRequest): Promise<DecisionMakerDiscoveryResult> {
    const { companyName, domain } = request
    if (!companyName?.trim() && !domain?.trim()) {
      return { candidates: [], providerUsed: 'explee', status: 'error', reason: 'companyName or domain is required.' }
    }

    const apiKey = await getExpleeApiKey('decision_maker_discovery')
    if (!apiKey) {
      return {
        candidates: [],
        providerUsed: 'explee',
        status: 'error',
        reason: 'No Explee API key configured. Set it in Outbound Integrations or EXPLEE_API_KEY.',
      }
    }

    const titles = request.targetTitles?.length ? request.targetTitles : DEFAULT_TARGET_TITLES
    const linkedinId = await resolveCompanyLinkedinId(companyName, domain)

    const result = await callExpleeSearchPeople(apiKey, {
      people_filters: { job_titles: titles },
      ...(linkedinId
        ? { company_linkedin_ids: [linkedinId] }
        : { company_filters: { definition: companyName || domain } }),
    })

    if (!result.ok) {
      return { candidates: [], providerUsed: 'explee', status: 'error', reason: result.error }
    }

    const rawPeople = result.data.people ?? []
    const seen = new Set<string>()
    const candidates: DecisionMakerCandidate[] = []

    for (const person of rawPeople) {
      const fullName = [person.first_name, person.last_name].filter(Boolean).join(' ').trim()
      if (!fullName) continue
      const key = dedupeKey(person)
      if (key && seen.has(key)) continue

      const match = bestTargetTitleMatch(person.job_title || '', titles)
      // Same discipline as ProspeoDecisionMakerDiscoveryProvider: a person
      // whose own title text shares no word with any requested title is
      // more likely noise than a real decision-maker match.
      if (!match) continue

      if (key) seen.add(key)
      candidates.push({
        personName: fullName,
        title: match.target,
        linkedinUrl: person.linkedin_url || undefined,
        confidence: tierConfidence(match.ratio),
      })
      if (candidates.length >= MAX_CANDIDATES) break
    }

    if (candidates.length === 0) {
      return {
        candidates: [],
        providerUsed: 'explee',
        status: 'not_found',
        reason: rawPeople.length === 0
          ? `Explee's search returned zero candidates for this company${linkedinId ? '' : ' (matched by company name/description only — no confirmed Explee company record found)'}.`
          : `Explee returned ${rawPeople.length} candidate(s), but none had a title matching the requested roles closely enough.`,
      }
    }

    return { candidates, providerUsed: 'explee', status: 'found' }
  },

  // Cheap credential-presence check only — no network ping before every
  // request, same discipline as the other real providers in this repo.
  async isAvailable(): Promise<boolean> {
    return (await getExpleeApiKey('decision_maker_discovery')) !== null
  },
}

// ============================================================
// Prospeo Decision-Maker Discovery Provider
// ============================================================
// Calls Prospeo's search-person endpoint (POST /search-person) with a
// company (domain preferred, else name) + job-title filter, then maps each
// returned person to a DecisionMakerCandidate. Prospeo's own title filter
// is not exact, so results are still tiered locally by how closely the
// person's real title text matches the specific target title it's reported
// against — a result with zero word overlap against every requested title
// is dropped rather than surfaced as a guess.
// ============================================================

import { getProspeoApiKey, callProspeoSearchPerson } from '@/lib/outbound/shared/prospeo-client'
import type { ProspeoPerson, ProspeoJobHistoryEntry } from '@/lib/outbound/shared/prospeo-client'
import { DEFAULT_TARGET_TITLES } from '../types'
import type {
  DecisionMakerDiscoveryProvider,
  DecisionMakerDiscoveryRequest,
  DecisionMakerDiscoveryResult,
  DecisionMakerCandidate,
  DecisionMakerConfidence,
} from '../types'

const MAX_CANDIDATES = 10

// Common C-level/VP acronyms expanded so e.g. "CEO" and "Chief Executive
// Officer" are recognized as the same title — without this, an acronym-
// shaped target title would never word-overlap with a spelled-out real job
// title, or vice versa.
const TITLE_EXPANSIONS: Record<string, string> = {
  ceo: 'chief executive officer',
  cto: 'chief technology officer',
  coo: 'chief operating officer',
  cfo: 'chief financial officer',
  cmo: 'chief marketing officer',
  cio: 'chief information officer',
  vp: 'vice president',
}

const STOPWORDS = new Set(['of', 'the', 'and', 'for', 'a', 'an', '&'])

function normalizeTitleWords(title: string): string[] {
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
function titleOverlapRatio(candidateTitle: string, targetTitle: string): number {
  const targetWords = normalizeTitleWords(targetTitle)
  if (targetWords.length === 0) return 0
  const candidateWords = new Set(normalizeTitleWords(candidateTitle))
  const matched = targetWords.filter(w => candidateWords.has(w)).length
  return matched / targetWords.length
}

function bestTargetTitleMatch(candidateTitle: string, targetTitles: string[]): { target: string; ratio: number } | null {
  let best: { target: string; ratio: number } | null = null
  for (const target of targetTitles) {
    const ratio = titleOverlapRatio(candidateTitle, target)
    if (ratio > 0 && (!best || ratio > best.ratio)) best = { target, ratio }
  }
  return best
}

function currentJob(person: ProspeoPerson): ProspeoJobHistoryEntry | undefined {
  return person.job_history?.find(j => j.current) ?? person.job_history?.[0]
}

// Considers the person's current title first (highest signal), then falls
// back to any past job_history entry — someone who was VP Operations a few
// years ago is still a useful lead if nothing more current matches, just
// tiered at lower confidence.
function bestMatchForPerson(
  person: ProspeoPerson,
  targetTitles: string[]
): { target: string; ratio: number; isCurrentTitle: boolean } | null {
  const currentEntry = currentJob(person)
  const currentTitle = person.current_job_title || currentEntry?.title
  const candidates: Array<{ title: string; isCurrentTitle: boolean }> = []
  if (currentTitle) candidates.push({ title: currentTitle, isCurrentTitle: true })
  for (const job of person.job_history ?? []) {
    if (job.title && job.title !== currentTitle) candidates.push({ title: job.title, isCurrentTitle: Boolean(job.current) })
  }

  let best: { target: string; ratio: number; isCurrentTitle: boolean } | null = null
  for (const c of candidates) {
    const match = bestTargetTitleMatch(c.title, targetTitles)
    if (!match) continue
    if (!best || match.ratio > best.ratio || (match.ratio === best.ratio && c.isCurrentTitle && !best.isCurrentTitle)) {
      best = { target: match.target, ratio: match.ratio, isCurrentTitle: c.isCurrentTitle }
    }
  }
  return best
}

function tierConfidence(ratio: number, isCurrentTitle: boolean): DecisionMakerConfidence {
  if (ratio >= 1 && isCurrentTitle) return 'high'
  if (ratio >= 0.5) return 'medium'
  return 'low'
}

function stripToHostname(domain: string): string {
  return domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

function dedupeKey(person: ProspeoPerson): string {
  return (person.linkedin_url || person.full_name || '').toLowerCase().trim()
}

export const ProspeoDecisionMakerDiscoveryProvider: DecisionMakerDiscoveryProvider = {
  name: 'prospeo',
  displayName: 'Prospeo',

  async discoverDecisionMakers(request: DecisionMakerDiscoveryRequest): Promise<DecisionMakerDiscoveryResult> {
    const { companyName, domain } = request
    if (!companyName?.trim() && !domain?.trim()) {
      return { candidates: [], providerUsed: 'prospeo', status: 'error', reason: 'companyName or domain is required.' }
    }

    const apiKey = await getProspeoApiKey('decision_maker_discovery')
    if (!apiKey) {
      return {
        candidates: [],
        providerUsed: 'prospeo',
        status: 'error',
        reason: 'No Prospeo API key configured. Set it in Outbound Integrations or PROSPEO_API_KEY.',
      }
    }

    const titles = request.targetTitles?.length ? request.targetTitles : DEFAULT_TARGET_TITLES
    const hostname = domain?.trim() ? stripToHostname(domain) : ''

    const result = await callProspeoSearchPerson(apiKey, {
      page: 1,
      filters: {
        company: hostname ? { websites: { include: [hostname] } } : { names: { include: [companyName] } },
        person_job_title: { include: titles },
      },
    })

    if (!result.ok) {
      return { candidates: [], providerUsed: 'prospeo', status: 'error', reason: result.error }
    }

    const { data } = result
    if (data.error) {
      if (data.error_code === 'NO_MATCH') {
        return {
          candidates: [],
          providerUsed: 'prospeo',
          status: 'not_found',
          reason: 'Prospeo found no matching people for this company/title search.',
        }
      }
      return {
        candidates: [],
        providerUsed: 'prospeo',
        status: 'error',
        reason: data.error_code ?? 'Prospeo returned an error.',
      }
    }

    const rawResults = data.results ?? []
    const seen = new Set<string>()
    const candidates: DecisionMakerCandidate[] = []

    for (const item of rawResults) {
      const person = item.person
      if (!person?.full_name) continue
      const key = dedupeKey(person)
      if (key && seen.has(key)) continue

      const match = bestMatchForPerson(person, titles)
      // A person the title filter returned but whose own title text shares
      // no word with any requested title is more likely noise than a real
      // decision-maker match — skip rather than surface a title-less guess.
      if (!match) continue

      if (key) seen.add(key)
      const job = currentJob(person)

      candidates.push({
        personName: person.full_name,
        title: match.target,
        seniority: job?.seniority,
        department: job?.departments?.[0],
        linkedinUrl: person.linkedin_url,
        confidence: tierConfidence(match.ratio, match.isCurrentTitle),
      })

      if (candidates.length >= MAX_CANDIDATES) break
    }

    if (candidates.length === 0) {
      // Distinguish "Prospeo's own title filter found nobody at all" (its
      // person_job_title matching is closer to literal than semantic — see
      // DEFAULT_TARGET_TITLES's 2026-07-19 note) from "it found people, but
      // our stricter local word-overlap check rejected all of them" —
      // confirmed live these are genuinely different situations, and the
      // old single message claimed the second even when it was really the
      // first, which reads as "titles were close but not close enough" when
      // the truth is "Prospeo has nobody indexed under these titles at all."
      return {
        candidates: [],
        providerUsed: 'prospeo',
        status: 'not_found',
        reason: rawResults.length === 0
          ? 'Prospeo\'s own title-filtered search returned zero candidates for this company. It may not have senior leadership indexed for it under any of the requested titles.'
          : `Prospeo returned ${rawResults.length} candidate(s), but none had a title matching the requested roles closely enough.`,
      }
    }

    return { candidates, providerUsed: 'prospeo', status: 'found' }
  },

  // Cheap credential-presence check only — no network ping before every
  // request, same discipline as the other real providers in this repo.
  async isAvailable(): Promise<boolean> {
    return (await getProspeoApiKey('decision_maker_discovery')) !== null
  },
}

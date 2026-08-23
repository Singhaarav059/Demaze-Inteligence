// ============================================================
// Explee Email Finder Provider
// ============================================================
// Calls Explee's /enrich/email endpoint (first_name + last_name +
// company_domain -> email). Requires a company DOMAIN specifically —
// unlike Prospeo's enrich-person, Explee's EnrichEmailPayload has no
// company-name-only fallback field. Uses the "basic" preset (1.5 credits
// if an email is found, 0 if not — same "only charge on a real find"
// behavior as Prospeo, per Explee's own OpenAPI schema).
// ============================================================

import { getExpleeApiKey, callExpleeEnrichEmail } from '@/lib/outbound/shared/explee-client'
import type { EmailFinderProvider, EmailFinderRequest, EmailFinderResult } from '../types'

// Explee's own confidence_score (0-1 float) mapped to this repo's tiers
// with the same "prefer under-confidence" discipline
// ProspeoEmailFinderProvider's person.email.status mapping already uses —
// a score has to be genuinely high to earn 'high', not just "found something".
function mapConfidence(score: number | undefined): EmailFinderResult['confidence'] {
  if (score === undefined || score === null) return 'medium'
  if (score >= 0.85) return 'high'
  if (score >= 0.5) return 'medium'
  return 'low'
}

function splitName(personName: string): { first_name: string; last_name: string } | null {
  const parts = personName.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') }
}

export const ExpleeEmailFinderProvider: EmailFinderProvider = {
  name: 'explee',
  displayName: 'Explee',

  async findEmail(request: EmailFinderRequest): Promise<EmailFinderResult> {
    const { personName, domain } = request

    if (!personName?.trim()) {
      return { email: null, confidence: 'none', providerUsed: 'explee', status: 'error', reason: 'personName is required.' }
    }
    if (!domain?.trim()) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'explee',
        status: 'error',
        reason: 'A company domain is required for Explee to match against (Explee has no company-name-only lookup).',
      }
    }

    const name = splitName(personName)
    if (!name) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'explee',
        status: 'error',
        reason: 'personName must include both a first and last name for Explee to match against.',
      }
    }

    const apiKey = await getExpleeApiKey('email_finder')
    if (!apiKey) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'explee',
        status: 'error',
        reason: 'No Explee API key configured, set it in Outbound Integrations or EXPLEE_API_KEY.',
      }
    }

    const result = await callExpleeEnrichEmail(apiKey, {
      first_name: name.first_name,
      last_name: name.last_name,
      company_domain: domain,
      preset: 'basic',
    })

    if (!result.ok) {
      return { email: null, confidence: 'none', providerUsed: 'explee', status: 'error', reason: result.error }
    }

    const { data } = result
    if (!data.email) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'explee',
        status: 'not_found',
        reason: 'Explee found no email for this person/domain.',
      }
    }

    return {
      email: data.email,
      confidence: mapConfidence(data.confidence_score),
      providerUsed: 'explee',
      status: 'found',
    }
  },

  // Cheap credential-presence check only — no network ping before every
  // request, same discipline as the other real providers in this repo.
  async isAvailable(): Promise<boolean> {
    return (await getExpleeApiKey('email_finder')) !== null
  },
}

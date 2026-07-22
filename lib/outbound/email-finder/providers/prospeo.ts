// ============================================================
// Prospeo Email Finder Provider
// ============================================================
// Calls Prospeo's enrich-person endpoint (POST /enrich-person) with
// only_verified_email:true — per Prospeo's docs this guarantees a credit
// debit (and a response) only when a VERIFIED email is actually found,
// so a "not found" result never costs credits.
// ============================================================

import { getProspeoApiKey, callProspeoEnrichPerson, type ProspeoCallResult } from '@/lib/outbound/shared/prospeo-client'
import type { EmailFinderProvider, EmailFinderRequest, EmailFinderResult } from '../types'

function mapConfidence(status: string | undefined): EmailFinderResult['confidence'] {
  if (!status) return 'medium'
  return /verif/i.test(status) ? 'high' : 'medium'
}

// Pure interpreter — derives an EmailFinderResult from any Prospeo
// enrich-person response, whether it came from a fresh call this provider
// made itself or was reused from a shared/cached response the Contact
// Enrichment provider (or a prior call) already fetched. Extracted
// (2026-07-21) so app/api/admin/outbound/contacts/[id]/find-email and
// .../enrich can share ONE Prospeo call instead of each provider making its
// own — see prospeo-contact-cache.ts for the shared-call orchestration.
export function interpretProspeoEmailResult(result: ProspeoCallResult): EmailFinderResult {
  if (!result.ok) {
    return { email: null, confidence: 'none', providerUsed: 'prospeo', status: 'error', reason: result.error }
  }

  const { data } = result

  if (data.error) {
    if (data.error_code === 'NO_MATCH') {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'prospeo',
        status: 'not_found',
        reason: 'Prospeo found no matching person for this name/company.',
      }
    }
    return {
      email: null,
      confidence: 'none',
      providerUsed: 'prospeo',
      status: 'error',
      reason: data.error_code ?? 'Prospeo returned an error.',
    }
  }

  const email = data.person?.email?.email
  if (!email || data.person?.email?.revealed === false) {
    return {
      email: null,
      confidence: 'none',
      providerUsed: 'prospeo',
      status: 'not_found',
      reason: 'No verified email found for this person.',
    }
  }

  return {
    email,
    confidence: mapConfidence(data.person?.email?.status),
    providerUsed: 'prospeo',
    status: 'found',
  }
}

export const ProspeoEmailFinderProvider: EmailFinderProvider = {
  name: 'prospeo',
  displayName: 'Prospeo',

  async findEmail(request: EmailFinderRequest): Promise<EmailFinderResult> {
    const { personName, companyName, domain } = request

    if (!personName?.trim()) {
      return { email: null, confidence: 'none', providerUsed: 'prospeo', status: 'error', reason: 'personName is required.' }
    }
    if (!domain && !companyName) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'prospeo',
        status: 'error',
        reason: 'A company domain or name is required for Prospeo to match against.',
      }
    }

    const apiKey = await getProspeoApiKey('email_finder')
    if (!apiKey) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'prospeo',
        status: 'error',
        reason: 'No Prospeo API key configured — set it in Outbound Integrations or PROSPEO_API_KEY.',
      }
    }

    const result = await callProspeoEnrichPerson(apiKey, {
      only_verified_email: true,
      data: {
        full_name: personName,
        company_website: domain || undefined,
        company_name: companyName || undefined,
      },
    })

    return interpretProspeoEmailResult(result)
  },

  // Cheap credential-presence check only — no network ping before every
  // request, same discipline as lib/ai/providers/nvidia-nim.ts. Real
  // failures are caught by findEmail()'s own error handling.
  async isAvailable(): Promise<boolean> {
    return (await getProspeoApiKey('email_finder')) !== null
  },
}

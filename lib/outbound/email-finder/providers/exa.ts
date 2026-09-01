// ============================================================
// Exa Email Finder Provider
// ============================================================
// Exa has no synchronous single-person email-lookup endpoint — the only
// path is a Webset enrichment (format: 'email'): create a one-item Webset
// scoped to this person+company, ask for an 'email' enrichment, then poll
// until the Webset goes idle. This is a MATERIALLY SLOWER path (seconds to
// up to a minute) than Prospeo's synchronous call — that's a real UX
// difference worth surfacing later (e.g. in a provider benchmark), not
// hidden here. Bounded to a 45s timeout; a timeout is reported as
// status: 'not_found' with a clear reason, never left hanging and never
// treated as a hard 'error' (Exa may just need longer, not be broken).
// ============================================================

import {
  exaCreateWebset,
  exaWaitForWebsetIdle,
  exaListWebsetItems,
} from '@/lib/enrichment/sources/exa-client'
import { getExaCredential } from '@/lib/outbound/shared/exa-outbound-client'
import type { EmailFinderProvider, EmailFinderRequest, EmailFinderResult } from '../types'

const WEBSET_TIMEOUT_MS = 45_000

// Exa Websets' item enrichment result shape isn't fully specified in Exa's
// own fetched docs beyond "an open record that varies by entity type and
// enrichment format" (see exa-client.ts's ExaWebsetItem comment) — rather
// than guess a specific key, this walks the whole enrichments value
// looking for the first email-shaped string anywhere in it. Defensive by
// design; tighten this once a real Webset response for an 'email'
// enrichment has been captured and its exact shape confirmed.
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

function findEmailInEnrichments(value: unknown, depth = 0): string | null {
  if (depth > 5 || value == null) return null
  if (typeof value === 'string') {
    const match = value.match(EMAIL_REGEX)
    return match ? match[0] : null
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findEmailInEnrichments(v, depth + 1)
      if (found) return found
    }
    return null
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const found = findEmailInEnrichments(v, depth + 1)
      if (found) return found
    }
  }
  return null
}

export const ExaEmailFinderProvider: EmailFinderProvider = {
  name: 'exa',
  displayName: 'Exa',

  async findEmail(request: EmailFinderRequest): Promise<EmailFinderResult> {
    const { personName, companyName, domain } = request

    if (!personName?.trim()) {
      return { email: null, confidence: 'none', providerUsed: 'exa', status: 'error', reason: 'personName is required.' }
    }
    if (!domain && !companyName) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'exa',
        status: 'error',
        reason: 'A company domain or name is required for Exa to match against.',
      }
    }

    const apiKey = await getExaCredential('email_finder')
    if (!apiKey) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'exa',
        status: 'error',
        reason: 'No Exa API key configured. Set it in Outbound Integrations or EXA_API_KEY.',
      }
    }

    const companyLabel = companyName || domain
    let websetId: string

    try {
      const webset = await exaCreateWebset(
        {
          title: `Email lookup: ${personName} at ${companyLabel}`,
          search: {
            query: `${personName}, ${companyLabel}${domain ? ` (${domain})` : ''}`,
            count: 1,
            entity: { type: 'person' },
          },
          enrichments: [{ description: `Work email address for ${personName} at ${companyLabel}`, format: 'email' }],
        },
        apiKey
      )
      websetId = webset.id
    } catch (e) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'exa',
        status: 'error',
        reason: e instanceof Error ? e.message : 'Exa Webset creation failed.',
      }
    }

    let idled
    try {
      idled = await exaWaitForWebsetIdle(websetId, { timeoutMs: WEBSET_TIMEOUT_MS }, apiKey)
    } catch (e) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'exa',
        status: 'error',
        reason: e instanceof Error ? e.message : 'Exa Webset polling failed.',
      }
    }

    if (idled.status !== 'idle') {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'exa',
        status: 'not_found',
        reason: `Exa's Webset search did not finish within ${WEBSET_TIMEOUT_MS / 1000}s (still "${idled.status}"). This is an async lookup and can genuinely take longer — retry, or use a synchronous provider (Prospeo) when an immediate result is required.`,
      }
    }

    let items
    try {
      items = await exaListWebsetItems(websetId, { limit: 5 }, apiKey)
    } catch (e) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'exa',
        status: 'error',
        reason: e instanceof Error ? e.message : 'Exa Webset item lookup failed.',
      }
    }

    const item = items.data[0]
    if (!item) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'exa',
        status: 'not_found',
        reason: 'Exa completed the search but found no matching person.',
      }
    }

    const email = findEmailInEnrichments(item.enrichments)
    if (!email) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'exa',
        status: 'not_found',
        reason: 'Exa found a matching person but returned no email enrichment result.',
      }
    }

    return {
      email,
      // Exa gives no explicit verification/confidence signal on a Webset
      // enrichment result (unlike Prospeo's "verified" status) — 'medium'
      // is honest, not a guess dressed up as 'high'.
      confidence: 'medium',
      providerUsed: 'exa',
      status: 'found',
    }
  },

  // Cheap credential-presence check only — no network ping before every
  // request, same discipline as the other real providers in this repo.
  async isAvailable(): Promise<boolean> {
    return (await getExaCredential('email_finder')) !== null
  },
}

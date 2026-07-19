// ============================================================
// Mock Email Finder Provider
// ============================================================
// Deterministic stand-in for a real vendor (Hunter/Apollo/Findymail/Snov).
// Derives a plausible firstname.lastname@domain address and uses
// seededRatio() so the same (personName, domain) pair always produces the
// same found/not_found + confidence outcome — reproducible demos, no flaky
// tests.
// ============================================================

import { seededRatio } from '@/lib/outbound/shared/mock-utils'
import type { EmailFinderProvider, EmailFinderRequest, EmailFinderResult } from '../types'

function toLocalPart(personName: string): string | null {
  const words = personName
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, '')
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) return null
  if (words.length === 1) return words[0]

  const first = words[0]
  const last = words[words.length - 1]
  return `${first}.${last}`
}

export const MockEmailFinderProvider: EmailFinderProvider = {
  name: 'mock',
  displayName: 'Mock Email Finder',

  async findEmail(request: EmailFinderRequest): Promise<EmailFinderResult> {
    const { personName, domain } = request

    if (!domain) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'mock',
        status: 'error',
        reason: 'No domain provided — cannot derive an email address.',
      }
    }

    const localPart = toLocalPart(personName)
    if (!localPart) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'mock',
        status: 'error',
        reason: 'Could not derive a name from the provided personName.',
      }
    }

    const foundRatio = seededRatio(`${personName}::${domain}::found`)
    if (foundRatio >= 0.85) {
      return {
        email: null,
        confidence: 'none',
        providerUsed: 'mock',
        status: 'not_found',
        reason: 'Mock provider did not resolve an address for this name/domain pair.',
      }
    }

    const confidenceRatio = seededRatio(`${personName}::${domain}::confidence`)
    const confidence = confidenceRatio < 0.6 ? 'high' : confidenceRatio < 0.85 ? 'medium' : 'low'

    return {
      email: `${localPart}@${domain}`,
      confidence,
      providerUsed: 'mock',
      status: 'found',
    }
  },

  async isAvailable(): Promise<boolean> {
    return true
  },
}

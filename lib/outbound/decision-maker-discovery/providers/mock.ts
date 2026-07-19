// ============================================================
// Mock Decision-Maker Discovery Provider
// ============================================================
// Deterministic stand-in for a real people-data API (Prospeo Search Person
// or similar). For each requested title, seededRatio() decides whether a
// candidate is "found" (~65% match rate — titles like "Plant Head" won't
// always resolve for e.g. a SaaS company, same realism goal as the mock
// email finder's not-found branch). Found candidates get a seeded name
// from fixed first/last-name pools and a seeded confidence tier. Same
// input always produces the same result — reproducible demos, no flaky
// tests.
// ============================================================

import { seededRatio, seededPick } from '@/lib/outbound/shared/mock-utils'
import { DEFAULT_TARGET_TITLES } from '../types'
import type {
  DecisionMakerDiscoveryProvider,
  DecisionMakerDiscoveryRequest,
  DecisionMakerDiscoveryResult,
  DecisionMakerCandidate,
  DecisionMakerConfidence,
} from '../types'

const FIRST_NAMES = [
  'James', 'Priya', 'Michael', 'Sarah', 'David', 'Anita', 'Robert', 'Meera',
  'John', 'Lakshmi', 'William', 'Emma', 'Arjun', 'Olivia', 'Rajesh', 'Sofia',
] as const

const LAST_NAMES = [
  'Chen', 'Sharma', 'Patel', 'Torres', 'Kumar', 'Nair', 'Reddy', 'Wilson',
  'Gupta', 'Singh', 'Mehta', 'Rao', 'Anderson', 'Iyer', 'Verma', 'Clark',
] as const

const SENIORITY_BY_TITLE: Record<string, string> = {
  ceo: 'C-Suite',
  cto: 'C-Suite',
  coo: 'C-Suite',
  cfo: 'C-Suite',
  'vp operations': 'VP',
  'vp sales': 'VP',
  'plant head': 'Director',
}

function seniorityFor(title: string): string {
  return SENIORITY_BY_TITLE[title.trim().toLowerCase()] ?? 'Manager'
}

function tierConfidence(ratio: number): DecisionMakerConfidence {
  if (ratio < 0.5) return 'high'
  if (ratio < 0.8) return 'medium'
  return 'low'
}

export const MockDecisionMakerDiscoveryProvider: DecisionMakerDiscoveryProvider = {
  name: 'mock',
  displayName: 'Mock Decision-Maker Discovery',

  async discoverDecisionMakers(request: DecisionMakerDiscoveryRequest): Promise<DecisionMakerDiscoveryResult> {
    const { companyName, domain } = request

    if (!companyName?.trim() || !domain?.trim()) {
      return {
        candidates: [],
        providerUsed: 'mock',
        status: 'error',
        reason: 'companyName and domain are required.',
      }
    }

    const titles = request.targetTitles?.length ? request.targetTitles : DEFAULT_TARGET_TITLES
    const seedBase = `${companyName}::${domain}`

    const candidates: DecisionMakerCandidate[] = titles
      .map(title => {
        const foundRatio = seededRatio(`${seedBase}::${title}::found`)
        if (foundRatio >= 0.65) return null

        const firstName = seededPick(`${seedBase}::${title}::first`, FIRST_NAMES)
        const lastName = seededPick(`${seedBase}::${title}::last`, LAST_NAMES)
        const confidenceRatio = seededRatio(`${seedBase}::${title}::confidence`)

        const candidate: DecisionMakerCandidate = {
          personName: `${firstName} ${lastName}`,
          title,
          seniority: seniorityFor(title),
          confidence: tierConfidence(confidenceRatio),
        }
        return candidate
      })
      .filter((c): c is DecisionMakerCandidate => c !== null)

    if (candidates.length === 0) {
      return {
        candidates: [],
        providerUsed: 'mock',
        status: 'not_found',
        reason: 'Mock provider found no candidates for the requested titles.',
      }
    }

    return { candidates, providerUsed: 'mock', status: 'found' }
  },

  async isAvailable(): Promise<boolean> {
    return true
  },
}

// ============================================================
// Company qualification — the cheap gate between discovery and full research
// ============================================================
// Runs, per candidate, in order: (1) identity dedup against company_registry
// (already-researched / already-outreached / plain duplicate); (2) sector
// signal match; (3) size-band check. Only candidates that clear all three
// are persisted as 'qualified' and eligible to enter full Demaze research —
// everything else is persisted as 'disqualified' with one honest reason, so
// re-discovering the same company later is an instant lookup, not a re-search.
//
// Deliberately generic (QualificationCandidate), not typed against
// company-discovery.ts's CompanyDiscoveryCandidate/CompanyMatch — this
// avoids a circular import (company-discovery.ts calls into this module)
// and keeps this function usable by anything that can produce a name +
// optional domain/snippets, not just the automatic-discovery path.
//
// Uploaded Excel/CSV rows do NOT go through this function — per the
// governing plan, uploads only need the identity/dedup check
// (findExistingCompany(), called directly from the batch-parse route),
// not the sector/size gate, since an uploaded list is a manually-curated
// input, not an automated sector-scoped search.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TargetSector } from '../sector-playbook/types'
import { getSectorPlaybook } from '../sector-playbook/playbooks'
import { escapeRegex } from '../utils/regex'
import {
  buildIdentityKeys, findExistingCompany, upsertDiscovered, markQualified, markDisqualified,
  type RejectionReason,
} from '../companies/identity'
import { assessCompanySize, type SizeQualification } from './company-size'
import { recordQualified, recordRejection, type DiscoveryFunnel } from './discovery-funnel'

export interface QualificationCandidate {
  name: string
  domain?: string | null
  linkedinUrl?: string | null
  /** Raw evidence text (search snippets) used for sector/size checks. Empty for inputs with no text evidence at all. */
  snippets?: string[]
  discoverySource?: string | null
  discoveryQuery?: string | null
}

export interface QualificationOutcome {
  status: 'qualified' | 'disqualified'
  reason: RejectionReason | null
  companyId: string
  sizeQualification?: SizeQualification
}

// Plural-tolerant word-boundary regex — only the LAST word of a (possibly
// multi-word) signal phrase gets a plural alternation; earlier words match
// literally. Real bug found live 2026-08-19: a "top manufacturers in
// Europe" listicle snippet naming Volkswagen/Bosch was rejected as
// "wrong_sector" because the signal list has "manufacturer" (singular)
// and \bmanufacturer\b does not match inside "manufacturers" — the
// trailing "s" is a word character, so there's no boundary there. Handles
// the two real English plural shapes this signal vocabulary actually
// needs: regular +s (manufacturer -> manufacturers, plant -> plants) and
// consonant+y -> ies (factory -> factories, assembly -> assemblies).
function pluralTolerantSignalRegex(phrase: string): RegExp {
  const words = phrase.split(' ')
  const last = words[words.length - 1]
  const lastPattern = /[^aeiou]y$/i.test(last)
    ? `${escapeRegex(last.slice(0, -1))}(?:y|ies)`
    : `${escapeRegex(last)}s?`
  const prefix = words.slice(0, -1).map(escapeRegex)
  const fullPattern = [...prefix, lastPattern].join('\\s+')
  return new RegExp(`\\b${fullPattern}\\b`, 'i')
}

// Same word-boundary discipline as lib/sector-playbook/classify.ts's
// classifySector() (which runs post-research against structured profile
// fields) — this is the pre-research equivalent, run against raw search
// snippet text instead. Exported so company-discovery.ts can apply the
// same cheap check BEFORE spending a discoverCompanyWebsite() domain
// resolution call, not just here at the final qualification gate.
export function matchesSectorSignals(text: string, sector: TargetSector): boolean {
  const playbook = getSectorPlaybook(sector)
  return playbook.signals.some(signal => pluralTolerantSignalRegex(signal).test(text))
}

export async function qualifyCandidate(
  supabase: SupabaseClient,
  candidate: QualificationCandidate,
  sector: TargetSector,
): Promise<QualificationOutcome> {
  const keys = buildIdentityKeys({ domain: candidate.domain, name: candidate.name, linkedinUrl: candidate.linkedinUrl })
  const existing = await findExistingCompany(supabase, keys)

  if (existing) {
    if (existing.status === 'researched') {
      return { status: 'disqualified', reason: 'already_researched', companyId: existing.id }
    }
    if (existing.status === 'outreached') {
      return { status: 'disqualified', reason: 'already_outreached', companyId: existing.id }
    }
    if (existing.status === 'discovered' || existing.status === 'qualified') {
      return { status: 'disqualified', reason: 'duplicate', companyId: existing.id }
    }
    // status === 'disqualified' from an earlier run — re-evaluate fresh
    // below rather than permanently locking a company out on a prior
    // reason that might no longer hold.
  }

  const row = existing ?? await upsertDiscovered(supabase, {
    domain: candidate.domain,
    name: candidate.name,
    linkedinUrl: candidate.linkedinUrl,
    sector,
    discoverySource: candidate.discoverySource,
    discoveryQuery: candidate.discoveryQuery,
  })

  const snippets = candidate.snippets ?? []

  // Sector check only applies when there's evidence text to judge —
  // never reject for "wrong sector" on an absence of evidence (that's
  // exactly the "don't reject just because a figure/fact is unavailable"
  // discipline applied to sector matching too).
  if (snippets.length > 0 && !matchesSectorSignals(snippets.join(' '), sector)) {
    await markDisqualified(supabase, row.id, 'wrong_sector')
    return { status: 'disqualified', reason: 'wrong_sector', companyId: row.id }
  }

  const sizeQualification = await assessCompanySize(snippets, candidate.domain ?? row.canonical_domain ?? undefined)
  await supabase.from('company_registry').update({ size_evidence: sizeQualification.evidence }).eq('id', row.id)

  if (sizeQualification.verdict === 'too_large' || sizeQualification.verdict === 'too_small') {
    await markDisqualified(supabase, row.id, 'outside_size_range')
    return { status: 'disqualified', reason: 'outside_size_range', companyId: row.id, sizeQualification }
  }

  await markQualified(supabase, row.id)
  return { status: 'qualified', reason: null, companyId: row.id, sizeQualification }
}

// ── Route-layer convenience: qualify a whole discovery result batch ────
// Both discovery routes (company-discovery, demaze-leads) need the exact
// same "run every surfaced candidate through qualifyCandidate(), record the
// funnel, and annotate each one with its outcome for the UI (so a locked
// row can still be SHOWN with a reason, not silently dropped)" logic —
// shared here rather than duplicated per route. Generic over T so this
// doesn't need to import company-discovery.ts's CompanyMatch type (which
// would create a circular import, since company-discovery.ts already
// imports this module).
export async function qualifyAndAnnotate<
  T extends { name: string; domain?: string; reason?: string; discoverySource?: string; discoveryQuery?: string },
>(
  supabase: SupabaseClient,
  items: T[],
  sector: TargetSector,
  funnel: DiscoveryFunnel,
): Promise<Array<T & { existingStatus: 'qualified' | 'disqualified'; rejectionReason: RejectionReason | null }>> {
  const annotated: Array<T & { existingStatus: 'qualified' | 'disqualified'; rejectionReason: RejectionReason | null }> = []
  for (const item of items) {
    const outcome = await qualifyCandidate(supabase, {
      name: item.name,
      domain: item.domain,
      snippets: item.reason ? [item.reason] : [],
      discoverySource: item.discoverySource ?? null,
      discoveryQuery: item.discoveryQuery ?? null,
    }, sector)

    if (outcome.status === 'qualified') recordQualified(funnel)
    else if (outcome.reason) recordRejection(funnel, outcome.reason)

    annotated.push({ ...item, existingStatus: outcome.status, rejectionReason: outcome.reason })
  }
  return annotated
}

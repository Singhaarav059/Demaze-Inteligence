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
  type RejectionReason, type QualificationProvenance, type SectorEvidence, type DomainEvidence,
} from '../companies/identity'
import { assessCompanySize, type SizeQualification, type SizeEvidenceSource } from './company-size'
import { recordQualified, recordRejection, type DiscoveryFunnel } from './discovery-funnel'
import { classifyEntityType, type EntityType } from './entity-classification'
import { scoreDiscoveryCandidate, type QualificationVerdict } from './discovery-confidence'

// ============================================================
// Qualification ruleset version
// ============================================================
// Bumped whenever qualifyCandidate()'s actual decision logic changes in a
// way that could flip a past decision (a new entity-classification rule, a
// new size-check tier, a changed threshold) — NOT for unrelated changes
// elsewhere in this file. v1 (implicit, unversioned) was the original
// binary identity/sector/size gate with no entity-type check and no
// AI-knowledge size tier. v2 (this version) adds both — see
// entity-classification.ts and company-size.ts's assessCompanySizeViaKnowledge.
//
// A company_registry row with qualification_version !== this value (or
// NULL, which covers every pre-versioning row) is STALE — see the
// duplicate-check logic in qualifyCandidate() below for what that changes.
export const CURRENT_QUALIFICATION_VERSION = 'v2'

function sizeConfidenceFromSource(source: SizeEvidenceSource): 'high' | 'medium' | 'low' {
  if (source === 'snippets' || source === 'homepage') return 'high'
  if (source === 'knowledge') return 'medium'
  return 'low'
}

function icpConfidenceFromMatch(sectorTextMatches: boolean | null): 'confirmed' | 'unconfirmed' {
  return sectorTextMatches === null ? 'unconfirmed' : 'confirmed'
}

export interface QualificationCandidate {
  name: string
  domain?: string | null
  /** Confidence tier discoverCompanyWebsite() already assigned to `domain`,
   * when the caller has it (e.g. company-discovery.ts's CompanyMatch) —
   * threaded through so it can be persisted as DomainEvidence instead of
   * discarded. Absent (not just 'unknown') for callers that only have a
   * bare domain string. */
  domainConfidence?: 'high' | 'medium' | null
  /** Search-result URLs the domain/candidate was surfaced from, when the
   * caller has them — persisted as DomainEvidence.sourceUrls. */
  sourceUrls?: string[]
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
  /** Diagnostic-only score/verdict (see discovery-confidence.ts) — does not
   * change `status`/`reason` or what gets persisted. A `status: 'qualified'`
   * result can still be `verdict: 'REVIEW'` when it barely cleared the hard
   * gates (e.g. size genuinely unknown, no confirmed domain) — surfaced for
   * audit visibility, not to silently hold anything back that the existing,
   * already-tested qualification behavior would have let through. */
  verdict: QualificationVerdict
  score: number
  scoreReasons: string[]
  /** True when this call actually re-ran qualification logic against an
   * existing row that was previously 'discovered'/'qualified' under a
   * stale (or absent) qualification_version, instead of short-circuiting
   * to 'duplicate'. False for a genuinely new candidate or a clean
   * current-version duplicate reuse. */
  wasStaleReevaluation: boolean
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
//
// Detailed variant returns WHICH signal words matched, not just a boolean —
// this is what lets qualifyCandidate() persist real sector/ICP-fit evidence
// (see SectorEvidence) instead of only a pass/fail. matchesSectorSignals()
// stays the thin boolean wrapper every existing caller already uses.
export function matchSectorSignalsDetailed(text: string, sector: TargetSector): { matched: boolean; matchedSignals: string[] } {
  const playbook = getSectorPlaybook(sector)
  const matchedSignals = playbook.signals.filter(signal => pluralTolerantSignalRegex(signal).test(text))
  return { matched: matchedSignals.length > 0, matchedSignals }
}

export function matchesSectorSignals(text: string, sector: TargetSector): boolean {
  return matchSectorSignalsDetailed(text, sector).matched
}

// Diagnostic-only — see QualificationOutcome's own comment. Every
// disqualified path is a hard gate, so this is always REJECTED/score 0;
// the specific reason text still varies per gate for audit readability.
function rejectedOutcome(reason: RejectionReason, companyId: string, reasonText: string, sizeQualification?: SizeQualification, wasStaleReevaluation = false): QualificationOutcome {
  return { status: 'disqualified', reason, companyId, sizeQualification, verdict: 'REJECTED', score: 0, scoreReasons: [reasonText], wasStaleReevaluation }
}

// Partial provenance for a hard-gate rejection where later checks (sector/
// size) never ran — those fields are honestly 'unknown'/'no_evidence'
// rather than a fabricated value, same "don't invent evidence" discipline
// as everywhere else in this codebase.
function baseProvenance(reasonText: string, entity: { type: EntityType; confidence: 'high' | 'medium' | 'low' }): QualificationProvenance {
  return {
    qualification_version: CURRENT_QUALIFICATION_VERSION,
    qualification_reason: reasonText,
    qualification_confidence: 'REJECTED',
    qualification_score: 0,
    entity_type: entity.type,
    entity_confidence: entity.confidence,
    size_classification: 'unknown',
    size_confidence: 'low',
    size_evidence_source: 'none',
    icp_fit: 'no_evidence',
    icp_confidence: 'unconfirmed',
    // Rejected before the sector/domain checks ever ran — honestly null,
    // not fabricated (see SectorEvidence/DomainEvidence's own comments).
    sector_evidence: null,
    domain_evidence: null,
  }
}

// Truncated the same way size-evidence sourceSnippets already are
// (company-size.ts uses 200 chars) — enough to re-run
// matchSectorSignalsDetailed() against later, not a full page dump.
const SECTOR_EVIDENCE_SNIPPET_MAX_CHARS = 500

function buildDomainEvidence(candidate: QualificationCandidate, fallbackDomain: string | null): DomainEvidence | null {
  const domain = candidate.domain ?? fallbackDomain
  if (!domain) return null
  return {
    domain,
    confidence: candidate.domainConfidence ?? null,
    sourceUrls: candidate.sourceUrls ?? [],
  }
}

export async function qualifyCandidate(
  supabase: SupabaseClient,
  candidate: QualificationCandidate,
  sector: TargetSector,
): Promise<QualificationOutcome> {
  const keys = buildIdentityKeys({ domain: candidate.domain, name: candidate.name, linkedinUrl: candidate.linkedinUrl })
  const existing = await findExistingCompany(supabase, keys)

  let wasStaleReevaluation = false

  if (existing) {
    if (existing.status === 'researched') {
      // Deliberately no markDisqualified() call here — the row's real
      // status ('researched') must not be overwritten just because a
      // later discovery pass re-surfaced the same company.
      return rejectedOutcome('already_researched', existing.id, 'already researched in a prior run')
    }
    if (existing.status === 'outreached') {
      return rejectedOutcome('already_outreached', existing.id, 'already outreached to in a prior campaign')
    }
    if (existing.status === 'discovered' || existing.status === 'qualified') {
      if (existing.qualification_version === CURRENT_QUALIFICATION_VERSION) {
        // A real, already-qualified-under-the-current-ruleset duplicate —
        // reuse it, no re-evaluation needed. This is the efficiency case
        // identity dedup exists for.
        return rejectedOutcome('duplicate', existing.id, 'duplicate: already a company_registry row (qualified under the current ruleset)')
      }
      // Stale: either qualification_version is an older value, or NULL
      // (covers both a pre-versioning row AND a 'discovered'-only row that
      // was never actually run through qualification at all). Fall
      // through to real re-evaluation below instead of blindly reusing
      // a decision made under superseded rules — this is the fix for the
      // "17 mega-caps stayed 'qualified' forever" bug found live 2026-08-20.
      wasStaleReevaluation = true
    }
    // status === 'disqualified' from an earlier run — always re-evaluate
    // fresh (unchanged, predates versioning) rather than permanently
    // locking a company out on a prior reason that might no longer hold.
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
  const entity = classifyEntityType(candidate.name)

  // Defense-in-depth: company-discovery.ts's classifyCompanyRejection()
  // already filters non-company entity types before a candidate ever
  // reaches this function via the normal discovery path — but this is the
  // actual DB-writing authoritative gate, so it must not silently qualify
  // a government/association/media/directory/generic-term name reaching it
  // through some other path (e.g. a future direct caller). Mapped to the
  // existing 'other' RejectionReason rather than adding a new DB-persisted
  // value — company_registry.rejection_reason has a CHECK constraint, and
  // the specific entity type is still visible in qualification_reason.
  if (entity.type !== 'COMPANY' && entity.type !== 'UNKNOWN') {
    const reasonText = entity.reason ?? `entity type is ${entity.type}, not a company`
    await markDisqualified(supabase, row.id, 'other', baseProvenance(reasonText, entity))
    return rejectedOutcome('other', row.id, reasonText, undefined, wasStaleReevaluation)
  }

  // Sector check only applies when there's evidence text to judge —
  // never reject for "wrong sector" on an absence of evidence (that's
  // exactly the "don't reject just because a figure/fact is unavailable"
  // discipline applied to sector matching too).
  const combinedSnippetText = snippets.join(' ')
  const sectorDetail = snippets.length > 0 ? matchSectorSignalsDetailed(combinedSnippetText, sector) : null
  const sectorTextMatches = sectorDetail ? sectorDetail.matched : null
  const sectorEvidence: SectorEvidence = {
    sector,
    matched: sectorTextMatches,
    matchedSignals: sectorDetail?.matchedSignals ?? [],
    query: candidate.discoveryQuery ?? row.discovery_query ?? null,
    snippet: snippets.length > 0 ? combinedSnippetText.slice(0, SECTOR_EVIDENCE_SNIPPET_MAX_CHARS) : null,
  }
  const domainEvidence = buildDomainEvidence(candidate, row.canonical_domain)

  if (sectorTextMatches === false) {
    const reasonText = `no ${sector} sector-signal match in available evidence`
    await markDisqualified(supabase, row.id, 'wrong_sector', {
      ...baseProvenance(reasonText, entity),
      icp_fit: 'no_match', icp_confidence: 'confirmed',
      sector_evidence: sectorEvidence, domain_evidence: domainEvidence,
    })
    return rejectedOutcome('wrong_sector', row.id, reasonText, undefined, wasStaleReevaluation)
  }

  const sizeQualification = await assessCompanySize(snippets, candidate.domain ?? row.canonical_domain ?? undefined, candidate.name)
  await supabase.from('company_registry').update({ size_evidence: sizeQualification.evidence }).eq('id', row.id)

  const icpFit = sectorTextMatches === true ? 'match' : 'no_evidence'
  const icpConfidence = icpConfidenceFromMatch(sectorTextMatches)

  if (sizeQualification.verdict === 'too_large' || sizeQualification.verdict === 'too_small') {
    const reasonText = `size evidence places it ${sizeQualification.verdict === 'too_large' ? 'above' : 'below'} the target band`
    await markDisqualified(supabase, row.id, 'outside_size_range', {
      qualification_version: CURRENT_QUALIFICATION_VERSION,
      qualification_reason: reasonText,
      qualification_confidence: 'REJECTED',
      qualification_score: 0,
      entity_type: entity.type,
      entity_confidence: entity.confidence,
      size_classification: sizeQualification.verdict,
      size_confidence: sizeConfidenceFromSource(sizeQualification.source),
      size_evidence_source: sizeQualification.source,
      icp_fit: icpFit,
      icp_confidence: icpConfidence,
      sector_evidence: sectorEvidence,
      domain_evidence: domainEvidence,
    })
    return rejectedOutcome('outside_size_range', row.id, reasonText, sizeQualification, wasStaleReevaluation)
  }

  const { score, verdict, reasons } = scoreDiscoveryCandidate({
    entityType: entity.type,
    isDuplicateOrAlreadyClaimed: false,
    sectorSignalMatch: icpFit,
    sizeVerdict: sizeQualification.verdict,
    domainConfirmed: !!domainEvidence,
    domainConfidence: domainEvidence?.confidence ?? undefined,
  })
  await markQualified(supabase, row.id, {
    qualification_version: CURRENT_QUALIFICATION_VERSION,
    qualification_reason: reasons.join('; '),
    qualification_confidence: verdict,
    qualification_score: score,
    entity_type: entity.type,
    entity_confidence: entity.confidence,
    size_classification: sizeQualification.verdict,
    size_confidence: sizeConfidenceFromSource(sizeQualification.source),
    size_evidence_source: sizeQualification.source,
    icp_fit: icpFit,
    icp_confidence: icpConfidence,
    sector_evidence: sectorEvidence,
    domain_evidence: domainEvidence,
  })
  return { status: 'qualified', reason: null, companyId: row.id, sizeQualification, verdict, score, scoreReasons: reasons, wasStaleReevaluation }
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
  T extends {
    name: string; domain?: string; reason?: string; discoverySource?: string; discoveryQuery?: string
    domain_confidence?: 'high' | 'medium'; source_urls?: string[]
  },
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
      domainConfidence: item.domain_confidence ?? null,
      sourceUrls: item.source_urls ?? [],
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

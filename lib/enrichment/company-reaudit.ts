// ============================================================
// Company re-audit — re-evaluate already-qualified company_registry rows
// against the CURRENT qualification ruleset
// ============================================================
// Built 2026-08-20 after the fresh discovery benchmark proved
// qualifyCandidate()'s duplicate short-circuit alone isn't enough: a row
// qualified under a stale ruleset only gets re-evaluated the NEXT TIME
// discovery happens to re-surface that exact name/domain — which may never
// happen. This module lets someone deliberately re-check a batch of
// already-qualified rows on demand (e.g. right after a qualification-logic
// change ships), independent of any live discovery run.
//
// UPDATED 2026-08-21 (migration 029, evidence persistence): the "cannot
// re-validate sector/ICP fit" limitation this header used to describe is
// now only true for rows that predate migration 029 — every row
// qualifyCandidate() writes NOW carries a SectorEvidence record (the
// snippet text actually evaluated, which signal words matched, at what
// query) and a DomainEvidence record. When that evidence is present, this
// module re-runs matchSectorSignalsDetailed() against the CURRENT sector
// signal list from the stored snippet — a genuine re-verification, zero
// network cost, not a carried-forward assumption — and reuses the stored
// domain confirmation for the confidence score, both of which let a row
// reach a real STILL_QUALIFIED outcome instead of being permanently capped
// at REVIEW. A row with NO stored sector_evidence (every pre-migration-029
// row) still honestly falls back to icp_fit='no_evidence' — this module
// never invents evidence retroactively, so those rows keep landing at
// REVIEW at best, for a correct reason (genuinely insufficient evidence),
// not an architectural limitation.
//
// What this module can re-validate, in order:
//   - entity type (classifyEntityType() needs only the name — always
//     available)
//   - sector/ICP fit — re-run from stored SectorEvidence.snippet against
//     the CURRENT sector signal list, when that evidence exists
//   - domain confirmation — reused from stored DomainEvidence, falling
//     back to the mere presence of company_registry.canonical_domain
//     (itself only ever set from a domain qualifyCandidate() already
//     confirmed — a legitimate reuse of an existing field, not a guess)
//   - size (verdictFromStoredEvidence() re-runs the CURRENT threshold
//     logic against already-stored evidence with zero network cost; if
//     that stays 'unknown', assessCompanySizeViaKnowledge() is tried next
//     — the one real, bounded, per-row LLM call this module can make)
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TargetSector } from '../sector-playbook/types'
import type {
  CompanyLifecycleStatus, QualificationProvenance, SectorEvidence, DomainEvidence,
} from '../companies/identity'
import { markQualified, markDisqualified } from '../companies/identity'
import { classifyEntityType } from './entity-classification'
import {
  verdictFromStoredEvidence, assessCompanySizeViaKnowledge, type SizeEvidence, type SizeEvidenceSource,
} from './company-size'
import { scoreDiscoveryCandidate } from './discovery-confidence'
import { CURRENT_QUALIFICATION_VERSION, matchSectorSignalsDetailed } from './company-qualification'

export interface ReAuditFilters {
  /** Rows must have this status. Defaults to ['qualified'] — re-auditing
   * disqualified rows would need fresh evidence to reconsider them, which
   * this module doesn't have (see header). */
  status?: CompanyLifecycleStatus[]
  sector?: TargetSector
  /** Only rows with this exact qualification_version (e.g. re-check only
   * rows still on an old version). Use 'stale' as shorthand for "anything
   * that isn't CURRENT_QUALIFICATION_VERSION, including NULL". Omit for
   * "all versions". */
  qualificationVersion?: string | 'stale'
  /** ISO date strings, inclusive, compared against qualified_at. */
  since?: string
  until?: string
  /** Hard cap on rows evaluated in one call — a re-audit is meant to be
   * run in bounded batches, not as an unbounded full-table sweep by
   * accident. */
  limit?: number
}

// 'unchanged' kept as an alias of 'still_qualified' — same outcome, the
// governing task names both ("UNCHANGED / STILL_QUALIFIED") as the
// surviving-clean case. 'still_qualified' is the value this module actually
// produces; 'unchanged' stays as a type-level synonym so any external
// caller reading for that word doesn't need special-casing.
export type ReAuditOutcome = 'still_qualified' | 'unchanged' | 'now_disqualified' | 'now_review' | 'error'

/** Which check produced a disqualify/review outcome — for the Priority 7
 * reason-category breakdown. 'NONE' for a still_qualified/error result. */
export type ReAuditReasonCategory = 'ENTITY_TYPE' | 'SECTOR' | 'SIZE' | 'NONE'

export interface ReAuditResult {
  companyId: string
  displayName: string
  previousStatus: CompanyLifecycleStatus
  newStatus: CompanyLifecycleStatus
  outcome: ReAuditOutcome
  reason: string
  reasonCategory: ReAuditReasonCategory
  /** Set only for a SIZE-category result — which tier resolved it, so a
   * report can show how many of the size-based calls came from
   * deterministic stored evidence vs. the AI-knowledge tier vs. both
   * (Priority 7). */
  sizeEvidenceSource?: SizeEvidenceSource
}

export interface ReAuditSummary {
  dryRun: boolean
  evaluated: number
  /** Alias of stillQualified — kept for existing callers reading this name. */
  unchanged: number
  stillQualified: number
  nowDisqualified: number
  nowReview: number
  errors: number
  results: ReAuditResult[]
}

interface RegistryRowForAudit {
  id: string
  display_name: string
  status: CompanyLifecycleStatus
  size_evidence: unknown
  sector: TargetSector | null
  canonical_domain: string | null
  sector_evidence: SectorEvidence | null
  domain_evidence: DomainEvidence | null
}

async function loadCandidateRows(supabase: SupabaseClient, filters: ReAuditFilters): Promise<RegistryRowForAudit[]> {
  let query = supabase
    .from('company_registry')
    .select('id, display_name, status, size_evidence, sector, canonical_domain, sector_evidence, domain_evidence, qualification_version, qualified_at')
    .in('status', filters.status ?? ['qualified'])

  if (filters.sector) query = query.eq('sector', filters.sector)
  if (filters.since) query = query.gte('qualified_at', filters.since)
  if (filters.until) query = query.lte('qualified_at', filters.until)
  if (filters.qualificationVersion && filters.qualificationVersion !== 'stale') {
    query = query.eq('qualification_version', filters.qualificationVersion)
  }
  if (filters.limit) query = query.limit(filters.limit)

  const { data, error } = await query
  if (error) throw new Error(`Failed to load company_registry rows for re-audit: ${error.message}`)

  const rows = (data ?? []) as Array<RegistryRowForAudit & { qualification_version: string | null }>
  if (filters.qualificationVersion === 'stale') {
    return rows.filter(r => r.qualification_version !== CURRENT_QUALIFICATION_VERSION)
  }
  return rows
}

function sizeConfidenceFromSource(source: SizeEvidenceSource): 'high' | 'medium' | 'low' {
  if (source === 'snippets' || source === 'homepage') return 'high'
  if (source === 'knowledge') return 'medium'
  return 'low'
}

interface ReEvaluation {
  outcome: ReAuditOutcome
  provenance: QualificationProvenance
  reason: string
  reasonCategory: ReAuditReasonCategory
  sizeEvidenceSource?: SizeEvidenceSource
}

// Re-evaluates one row's entity type, sector/ICP fit, domain confirmation,
// and size classification against the current ruleset — see module header
// for exactly what's re-verified from stored evidence vs. honestly carried
// forward as unconfirmed for a pre-evidence-persistence row.
async function reEvaluateRow(row: RegistryRowForAudit): Promise<ReEvaluation> {
  const entity = classifyEntityType(row.display_name)

  if (entity.type !== 'COMPANY' && entity.type !== 'UNKNOWN') {
    const reason = entity.reason ?? `entity type is ${entity.type}, not a company`
    return {
      outcome: 'now_disqualified',
      reason,
      reasonCategory: 'ENTITY_TYPE',
      provenance: {
        qualification_version: CURRENT_QUALIFICATION_VERSION,
        qualification_reason: reason,
        qualification_confidence: 'REJECTED',
        qualification_score: 0,
        entity_type: entity.type,
        entity_confidence: entity.confidence,
        size_classification: 'unknown',
        size_confidence: 'low',
        size_evidence_source: 'none',
        icp_fit: 'no_evidence',
        icp_confidence: 'unconfirmed',
        sector_evidence: null, // never ran — the entity gate short-circuits first, same order as qualifyCandidate()
        domain_evidence: null,
      },
    }
  }

  // ── Sector/ICP fit — re-verify from stored evidence when present,
  // otherwise honestly unconfirmed. A stored snippet is re-run against the
  // CURRENT sector signal list (not just replayed) so a real playbook
  // change is correctly reflected on re-audit, same principle as size's
  // verdictFromStoredEvidence() below.
  let icpFit: 'match' | 'no_evidence' | 'no_match' = 'no_evidence'
  let icpConfidence: 'confirmed' | 'unconfirmed' = 'unconfirmed'
  let sectorEvidenceOut: SectorEvidence | null = row.sector_evidence
  if (row.sector_evidence?.snippet && row.sector) {
    const detail = matchSectorSignalsDetailed(row.sector_evidence.snippet, row.sector)
    icpFit = detail.matched ? 'match' : 'no_match'
    icpConfidence = 'confirmed'
    sectorEvidenceOut = { ...row.sector_evidence, matched: detail.matched, matchedSignals: detail.matchedSignals }
  }

  if (icpFit === 'no_match') {
    const reason = `re-audit: stored sector evidence no longer matches ${row.sector} signals under the current ruleset (was: ${(row.sector_evidence?.matchedSignals ?? []).join(', ') || 'none recorded'})`
    return {
      outcome: 'now_disqualified',
      reason,
      reasonCategory: 'SECTOR',
      provenance: {
        qualification_version: CURRENT_QUALIFICATION_VERSION,
        qualification_reason: reason,
        qualification_confidence: 'REJECTED',
        qualification_score: 0,
        entity_type: entity.type,
        entity_confidence: entity.confidence,
        size_classification: 'unknown',
        size_confidence: 'low',
        size_evidence_source: 'none',
        icp_fit: 'no_match',
        icp_confidence: 'confirmed',
        sector_evidence: sectorEvidenceOut,
        domain_evidence: row.domain_evidence, // carried forward, unrelated to this check
      },
    }
  }

  // ── Domain confirmation — reuse stored DomainEvidence; fall back to the
  // mere presence of canonical_domain (only ever set from a domain
  // qualifyCandidate() already confirmed — a real, existing field, not a
  // guess) for rows that predate migration 029.
  const domainConfirmed = !!(row.domain_evidence?.domain ?? row.canonical_domain)
  const domainConfidence = row.domain_evidence?.confidence ?? undefined

  // ── Size — unchanged from before: re-derive from stored evidence first
  // (zero network cost), fall back to the AI-knowledge tier only when that
  // stays 'unknown'.
  const storedEvidence = Array.isArray(row.size_evidence) ? (row.size_evidence as SizeEvidence[]) : []
  let size = verdictFromStoredEvidence(storedEvidence)
  if (size.verdict === 'unknown') {
    size = await assessCompanySizeViaKnowledge(row.display_name)
  }

  if (size.verdict === 'too_large' || size.verdict === 'too_small') {
    const reason = `re-audit: size evidence places it ${size.verdict === 'too_large' ? 'above' : 'below'} the target band (${size.reason})`
    return {
      outcome: 'now_disqualified',
      reason,
      reasonCategory: 'SIZE',
      sizeEvidenceSource: size.source,
      provenance: {
        qualification_version: CURRENT_QUALIFICATION_VERSION,
        qualification_reason: reason,
        qualification_confidence: 'REJECTED',
        qualification_score: 0,
        entity_type: entity.type,
        entity_confidence: entity.confidence,
        size_classification: size.verdict,
        size_confidence: sizeConfidenceFromSource(size.source),
        size_evidence_source: size.source,
        icp_fit: icpFit,
        icp_confidence: icpConfidence,
        sector_evidence: sectorEvidenceOut,
        domain_evidence: row.domain_evidence,
      },
    }
  }

  const { score, verdict, reasons } = scoreDiscoveryCandidate({
    entityType: entity.type,
    isDuplicateOrAlreadyClaimed: false,
    sectorSignalMatch: icpFit,
    sizeVerdict: size.verdict,
    domainConfirmed,
    domainConfidence,
  })

  const provenance: QualificationProvenance = {
    qualification_version: CURRENT_QUALIFICATION_VERSION,
    qualification_reason: `re-audit: ${reasons.join('; ')}`,
    qualification_confidence: verdict,
    qualification_score: score,
    entity_type: entity.type,
    entity_confidence: entity.confidence,
    size_classification: size.verdict,
    size_confidence: sizeConfidenceFromSource(size.source),
    size_evidence_source: size.source,
    icp_fit: icpFit,
    icp_confidence: icpConfidence,
    sector_evidence: sectorEvidenceOut,
    domain_evidence: row.domain_evidence,
  }

  // Every hard gate (entity/sector/size) already returned above — reaching
  // here means scoreDiscoveryCandidate() can only produce QUALIFIED or
  // REVIEW, never REJECTED. The 'now_disqualified' branch is defensive only
  // (a future change to that scorer's gate order shouldn't silently
  // misreport a rejection as a review).
  return {
    outcome: verdict === 'QUALIFIED' ? 'still_qualified' : verdict === 'REVIEW' ? 'now_review' : 'now_disqualified',
    reason: provenance.qualification_reason,
    reasonCategory: 'NONE',
    sizeEvidenceSource: size.source,
    provenance,
  }
}

// reasonCategory -> the real RejectionReason enum company_registry's CHECK
// constraint requires — the disqualify write used to hardcode
// 'outside_size_range' regardless of the actual cause; now it reflects
// whichever gate actually fired.
const CATEGORY_TO_REJECTION_REASON: Record<ReAuditReasonCategory, 'other' | 'wrong_sector' | 'outside_size_range'> = {
  ENTITY_TYPE: 'other',
  SECTOR: 'wrong_sector',
  SIZE: 'outside_size_range',
  NONE: 'outside_size_range', // unreachable in practice — see reEvaluateRow's defensive comment
}

export async function reAuditCompanies(
  supabase: SupabaseClient,
  filters: ReAuditFilters = {},
  options: { dryRun?: boolean } = {},
): Promise<ReAuditSummary> {
  const dryRun = options.dryRun !== false // dry-run by default, matching every other quota-spending/destructive script in this codebase

  const rows = await loadCandidateRows(supabase, filters)
  const results: ReAuditResult[] = []
  let stillQualified = 0, nowDisqualified = 0, nowReview = 0, errors = 0

  for (const row of rows) {
    let evaluation
    try {
      evaluation = await reEvaluateRow(row)
    } catch (e) {
      errors++
      results.push({
        companyId: row.id, displayName: row.display_name,
        previousStatus: row.status, newStatus: row.status,
        outcome: 'error', reason: e instanceof Error ? e.message : String(e),
        reasonCategory: 'NONE',
      })
      continue
    }

    const { outcome, provenance, reason, reasonCategory, sizeEvidenceSource } = evaluation
    const newStatus: CompanyLifecycleStatus = outcome === 'now_disqualified' ? 'disqualified' : row.status

    if (outcome === 'still_qualified' || outcome === 'unchanged') stillQualified++
    else if (outcome === 'now_review') nowReview++
    else if (outcome === 'now_disqualified') nowDisqualified++

    results.push({
      companyId: row.id, displayName: row.display_name,
      previousStatus: row.status, newStatus,
      outcome, reason, reasonCategory, sizeEvidenceSource,
    })

    if (!dryRun) {
      if (outcome === 'now_disqualified') {
        await markDisqualified(supabase, row.id, CATEGORY_TO_REJECTION_REASON[reasonCategory], provenance)
      } else {
        // still_qualified/unchanged or now_review both keep
        // status='qualified' — only the provenance/version is refreshed,
        // so a later duplicate lookup correctly sees the current version
        // and doesn't re-audit it again. A REVIEW verdict is a visible
        // flag (qualification_confidence='REVIEW'), not a status change —
        // this codebase has no separate 'review' lifecycle status, and
        // adding one would touch every other status-based query in the app.
        await markQualified(supabase, row.id, provenance)
      }
    }
  }

  return {
    dryRun, evaluated: rows.length,
    unchanged: stillQualified, stillQualified,
    nowDisqualified, nowReview, errors, results,
  }
}

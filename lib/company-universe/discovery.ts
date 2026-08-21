// ============================================================
// Company Universe — structured-first discovery orchestration
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md, Section 14:
//   DISCOVERY REQUEST -> determine target countries/regions -> query
//   structured company sources -> merge results -> identity deduplication
//   -> canonical company records -> basic deterministic qualification ->
//   web research only where needed -> final qualification.
//
// And Section 15: "Structured provider returns 1,000 companies -> ICP
// filtering -> 300 candidates -> Research only those 300. Do NOT perform
// expensive web research against thousands of companies before basic
// structured filtering." — this module is exactly the "query structured
// sources + basic deterministic qualification" half of that pipeline; the
// existing lib/enrichment/company-discovery.ts (search-grounded,
// unmodified) remains the "web research enrichment" half, called by
// whoever orchestrates both (see the new API route below) only for the
// gap this module's structured sources didn't fill — Section 5 of the
// source prompt: "search should no longer be the ONLY way to generate
// company candidates," not that search stops being used at all.
//
// "Merge results" + "identity deduplication" + "canonical company records"
// are already handled upstream by ingestion.ts's ingestOneRecord() (every
// search()/bulkIngest() result is identity-resolved and merged into
// company_universe as it's ingested) — this module doesn't redo that work,
// it queries the ALREADY-deduplicated table (queryLocalCompanyUniverse)
// and orchestrates calling providers live when the local table doesn't yet
// have enough.
// ============================================================

import { createServerClient } from '@/lib/supabase/server'
import { queryLocalCompanyUniverse, runProviderSearch, type LocalUniverseCompany } from './ingestion'
import { ALL_PROVIDERS } from './providers'
import type { CanonicalCompanyFields, CompanySearchQuery, ProviderName } from './types'

type SupabaseClient = ReturnType<typeof createServerClient>

// Below this many locally-known matches, this module also tries live
// provider search() calls to fill the gap — Section 21: "external
// providers are used for... missing data," not for every single request
// once a jurisdiction/segment has already been ingested once.
const LOCAL_SUFFICIENCY_THRESHOLD = 5

export interface StructuredDiscoveryCandidate {
  companyUniverseId: string
  fields: CanonicalCompanyFields
  sourceProviders: ProviderName[]
  dataConfidence: string
  sizeQualification: SizeQualification
}

export interface StructuredDiscoveryResult {
  candidates: StructuredDiscoveryCandidate[]
  // Which providers were actually queried live this call (vs. served
  // purely from the local table) — Section 25/26-adjacent visibility, so a
  // caller/operator can tell "this came from cache" from "this triggered 3
  // real API calls."
  providersQueriedLive: ProviderName[]
  providersSkipped: Array<{ provider: ProviderName; reason: string }>
  localMatchCount: number
}

// ── Section 18 — deterministic size qualification from structured evidence
// ── only. This function only ever returns a definitive REJECT or
// 'insufficient_data' (never a definitive ACCEPT) — Section 17's "uncertain
// = unknown, never convert uncertainty into too_large" applies to the
// positive case too: structured data confirming a company is IN-range is
// still just one signal, not sufficient on its own to skip the rest of the
// qualification pipeline (evidence-based signals, ICP fit, etc.), so a
// clean pass here is reported as 'insufficient_data' (i.e. "nothing here
// disqualifies it, continue"), not as a final "qualified" verdict — that
// verdict belongs to whatever qualification stage already exists downstream
// (this repo's sector-playbook/qualify.ts for a fully-researched company;
// this function's whole job is only the cheap pre-filter Section 15 asks
// for, so expensive web research never even starts for an obviously-
// oversized company).
export type SizeQualification =
  | { verdict: 'reject'; reason: string }
  | { verdict: 'insufficient_data'; reason: string }

export function qualifyBySizeStructured(
  fields: CanonicalCompanyFields,
  range: { employeeCountMax?: number; revenueMaxUsd?: number }
): SizeQualification {
  if (range.employeeCountMax !== undefined) {
    const knownCount = fields.employeeCount ?? fields.employeeCountMin
    if (knownCount !== undefined && knownCount > range.employeeCountMax) {
      return { verdict: 'reject', reason: `Structured source reports ~${knownCount} employees, above the ICP ceiling of ${range.employeeCountMax}` }
    }
  }
  if (range.revenueMaxUsd !== undefined && fields.revenue !== undefined) {
    // Only compares directly when the source already reports USD — this
    // module deliberately does NOT do its own currency conversion (a
    // wrong/stale FX rate silently misqualifying a real candidate is worse
    // than skipping the check and letting it fall through to the existing
    // snippet/LLM-tier heuristics in lib/enrichment/company-discovery.ts,
    // which already has its own explicitly-approximate INR conversion
    // precedent documented in CLAUDE.md — reusing that discipline here
    // rather than inventing a second one).
    if ((fields.revenueCurrency ?? 'USD').toUpperCase() === 'USD' && fields.revenue > range.revenueMaxUsd) {
      return { verdict: 'reject', reason: `Structured source reports ~$${fields.revenue.toLocaleString()} revenue, above the ICP ceiling of $${range.revenueMaxUsd.toLocaleString()}` }
    }
  }
  return { verdict: 'insufficient_data', reason: 'No structured employee/revenue evidence on this record, or the value is within range — continue to the existing evidence-based qualification pipeline' }
}

function candidateFromLocal(row: LocalUniverseCompany, range: { employeeCountMax?: number; revenueMaxUsd?: number }): StructuredDiscoveryCandidate {
  return {
    companyUniverseId: row.id,
    fields: row.fields,
    sourceProviders: row.sourceProviders,
    dataConfidence: row.dataConfidence,
    sizeQualification: qualifyBySizeStructured(row.fields, range),
  }
}

/**
 * Section 14's target discovery architecture, structured-sources half.
 * Queries company_universe first; if that returns fewer than
 * LOCAL_SUFFICIENCY_THRESHOLD matches, also calls every configured
 * provider's live search() (each provider independently — a provider with
 * no API key configured, or currently unhealthy, is skipped and reported
 * in `providersSkipped` rather than silently ignored, per Section 25's
 * "Demaze should know... rather than silently returning incomplete
 * discovery"). Every live search() result is ingested (identity-resolved,
 * merged, persisted) before being returned, so a repeat call for the same
 * criteria later serves from the local table without spending quota again.
 */
export async function discoverCompaniesStructuredFirst(
  supabase: SupabaseClient,
  query: CompanySearchQuery,
  sizeRange: { employeeCountMax?: number; revenueMaxUsd?: number } = {}
): Promise<StructuredDiscoveryResult> {
  const local = await queryLocalCompanyUniverse(supabase, query)
  const localCandidates = local.map(row => candidateFromLocal(row, sizeRange))

  if (local.length >= LOCAL_SUFFICIENCY_THRESHOLD) {
    return { candidates: localCandidates, providersQueriedLive: [], providersSkipped: [], localMatchCount: local.length }
  }

  const providersQueriedLive: ProviderName[] = []
  const providersSkipped: Array<{ provider: ProviderName; reason: string }> = []
  const liveCandidateMap = new Map<string, StructuredDiscoveryCandidate>()
  for (const c of localCandidates) liveCandidateMap.set(c.companyUniverseId, c)

  // Independent providers hitting independent external APIs — Promise.all
  // across DIFFERENT providers is not the "aggressive parallelism against
  // one source" Section 23 warns against; each provider's own
  // fetchProviderJson() call still goes through its own local rate limiter.
  const results = await Promise.all(
    ALL_PROVIDERS.filter(p => p.capabilities.search).map(async (provider) => {
      const health = await provider.healthCheck()
      if (!health.configured) {
        return { provider: provider.name, skipped: true as const, reason: health.reason ?? 'not configured' }
      }
      if (!health.healthy) {
        return { provider: provider.name, skipped: true as const, reason: health.reason ?? 'currently unhealthy' }
      }
      const { result } = await runProviderSearch(supabase, provider, query)
      return { provider: provider.name, skipped: false as const, result }
    })
  )

  for (const r of results) {
    if (r.skipped) {
      providersSkipped.push({ provider: r.provider, reason: r.reason })
      continue
    }
    providersQueriedLive.push(r.provider)
    if (r.result.error) continue
    for (const record of r.result.records) {
      // The record's own id in company_universe isn't known here without a
      // second lookup — runProviderSearch already ingested it, so the
      // simplest honest thing is to re-derive candidates from a fresh local
      // query after all providers have run, rather than tracking
      // per-record ids through the ingestion return value (ingestBatch's
      // summary is a count, not a list, by design — see ingestion.ts).
      void record
    }
  }

  const refreshed = providersQueriedLive.length > 0 ? await queryLocalCompanyUniverse(supabase, query) : local
  const candidates = refreshed.map(row => candidateFromLocal(row, sizeRange))

  return { candidates, providersQueriedLive, providersSkipped, localMatchCount: local.length }
}

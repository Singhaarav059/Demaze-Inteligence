// ============================================================
// Coresignal Discovery — Company Discovery Engine, Coresignal-sourced
// ============================================================
// Given firmographic filters (geography, industry, employee-count range,
// founding-year range), searches Coresignal's Base Company API and
// normalizes real, named candidate companies into the SAME CompanyMatch
// shape lib/enrichment/company-discovery.ts already produces from search-
// engine extraction — so both paths feed the identical downstream flow:
// basic deterministic filtering (classifyCompanyRejection, reused directly,
// not reimplemented) -> the existing qualification/research pipeline
// (discoverCompanyWebsite is NOT needed here, since Coresignal already
// gives a real recorded website per company -> the existing intelligence
// pipeline at /api/admin/test-analysis, which does its own scrape-based
// verification of that website as part of research, is the "Website
// verification/research" step this module hands off to).
//
// Deliberately does NOT reimplement a second qualification system, a second
// provider-abstraction layer, or LinkedIn/decision-maker/email logic — see
// CLAUDE.md's Coresignal reset session for the explicit scope boundary.
// ============================================================

import type { CompanyMatch, CompanyDiscoverySufficiency } from './company-discovery'
import { classifyCompanyRejection, normalizeName, normalizeDomain } from './company-discovery'
import {
  searchCoresignalCompanyIds,
  collectCoresignalCompany,
  getCoresignalApiKey,
  CoresignalApiError,
  type CoresignalCompanyRecord,
  type CoresignalSearchFilter,
} from './sources/coresignal-client'

export interface CoresignalDiscoveryFilters {
  industry?: string
  country?: string
  employeesCountGte?: number
  employeesCountLte?: number
  foundedYearGte?: number
  foundedYearLte?: number
  name?: string
}

export interface CoresignalDiscoveryResult {
  companies: CompanyMatch[]
  sufficiency: CompanyDiscoverySufficiency
  reason: string
  candidates_considered: number
  rejected_candidates?: Array<{ name: string; reason: string }>
}

// Hard ceiling independent of the caller-requested maxResults — each
// surviving ID costs one additional collect() call, so this bounds worst-
// case spend on a misconfigured/too-broad filter regardless of what the
// caller asks for.
const MAX_RESULTS_CEILING = 100
const DEFAULT_MAX_RESULTS = 25
const SEARCH_PAGE_SIZE = 100
const COLLECT_CONCURRENCY = 5

function buildCoresignalFilter(filters: CoresignalDiscoveryFilters): CoresignalSearchFilter {
  const filter: CoresignalSearchFilter = { deleted: false }
  if (filters.industry?.trim()) filter.industry = filters.industry.trim()
  if (filters.country?.trim()) filter.country = filters.country.trim()
  if (filters.name?.trim()) filter.name = filters.name.trim()
  if (typeof filters.employeesCountGte === 'number') filter.employees_count_gte = filters.employeesCountGte
  if (typeof filters.employeesCountLte === 'number') filter.employees_count_lte = filters.employeesCountLte
  if (typeof filters.foundedYearGte === 'number') filter.founded_year_gte = filters.foundedYearGte
  if (typeof filters.foundedYearLte === 'number') filter.founded_year_lte = filters.foundedYearLte
  return filter
}

function hasAnyMeaningfulFilter(filters: CoresignalDiscoveryFilters): boolean {
  return Boolean(
    filters.industry?.trim() || filters.country?.trim() || filters.name?.trim() ||
    typeof filters.employeesCountGte === 'number' || typeof filters.employeesCountLte === 'number' ||
    typeof filters.foundedYearGte === 'number' || typeof filters.foundedYearLte === 'number',
  )
}

function firmographicReason(record: CoresignalCompanyRecord): string {
  const parts: string[] = []
  if (record.industry) parts.push(`industry: ${record.industry}`)
  const country = record.headquarters_country_parsed || record.headquarters_country
  if (country) parts.push(`HQ: ${country}`)
  if (typeof record.employees_count === 'number') parts.push(`~${record.employees_count} employees`)
  else if (record.size) parts.push(`size: ${record.size}`)
  if (typeof record.founded === 'number') parts.push(`founded ${record.founded}`)
  const detail = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  return `Coresignal firmographic match${detail}.`
}

// Coresignal's own `website` field is a real recorded company site, not a
// search-inferred guess — normalizeDomain (shared with the search-extraction
// path) just strips protocol/www for consistent identity/dedup comparison,
// it does not weaken the confidence of the source.
function normalizeCoresignalCompany(record: CoresignalCompanyRecord): CompanyMatch | null {
  const name = record.name?.trim()
  if (!name) return null

  const rawWebsite = record.website?.trim()
  const domain = rawWebsite ? normalizeDomain(rawWebsite) : undefined
  const sourceUrl = rawWebsite
    ? (rawWebsite.startsWith('http') ? rawWebsite : `https://${rawWebsite}`)
    : (typeof record.url === 'string' && record.url.startsWith('http') ? record.url : undefined)

  return {
    name,
    domain,
    domain_confidence: domain ? 'high' : undefined,
    reason: firmographicReason(record),
    confidence: domain ? 'high' : 'medium',
    source_urls: sourceUrl ? [sourceUrl] : [],
    source: 'coresignal',
  }
}

/**
 * Searches Coresignal for candidate companies matching the given
 * firmographic filters, applies the existing basic deterministic filtering
 * (self-name exclusion, degenerate-name rejection — reused from
 * company-discovery.ts, not reimplemented), and dedupes within the batch by
 * normalized name/domain. Never throws — a Coresignal API failure (missing
 * key, auth error, exhausted retries) comes back as `sufficiency:
 * 'insufficient'` with the real error in `reason`, same "honest empty
 * result over a crash" discipline as every other discovery module here.
 */
export async function discoverCompaniesFromCoresignal(
  filters: CoresignalDiscoveryFilters,
  excludeCompanyNames?: string[],
  opts: { maxResults?: number } = {},
): Promise<CoresignalDiscoveryResult> {
  if (!getCoresignalApiKey()) {
    return { companies: [], sufficiency: 'insufficient', reason: 'CORESIGNAL_API_KEY is not configured', candidates_considered: 0 }
  }
  if (!hasAnyMeaningfulFilter(filters)) {
    return {
      companies: [], sufficiency: 'insufficient',
      reason: 'at least one filter (industry, country, employee-count range, founding-year range, or name) is required',
      candidates_considered: 0,
    }
  }

  const maxResults = Math.min(opts.maxResults ?? DEFAULT_MAX_RESULTS, MAX_RESULTS_CEILING)
  const filter = buildCoresignalFilter(filters)

  // ── Search: paginate until we have enough IDs or run out of pages ──
  const ids: number[] = []
  let after: string | undefined
  try {
    do {
      const page = await searchCoresignalCompanyIds(filter, { itemsPerPage: SEARCH_PAGE_SIZE, after })
      ids.push(...page.ids)
      after = page.nextAfter ?? undefined
    } while (after && ids.length < maxResults)
  } catch (e) {
    const reason = e instanceof CoresignalApiError ? e.message : (e instanceof Error ? e.message : String(e))
    return { companies: [], sufficiency: 'insufficient', reason: `Coresignal search failed: ${reason}`, candidates_considered: 0 }
  }

  if (ids.length === 0) {
    return { companies: [], sufficiency: 'insufficient', reason: 'Coresignal search returned no matching companies for these filters', candidates_considered: 0 }
  }

  const uniqueIds = Array.from(new Set(ids)).slice(0, maxResults)

  // ── Collect: bounded-concurrency batches, one call per surviving ID ──
  const records: CoresignalCompanyRecord[] = []
  let collectError: string | null = null
  for (let i = 0; i < uniqueIds.length && !collectError; i += COLLECT_CONCURRENCY) {
    const batch = uniqueIds.slice(i, i + COLLECT_CONCURRENCY)
    try {
      const results = await Promise.all(batch.map(id => collectCoresignalCompany(id)))
      for (const r of results) if (r) records.push(r)
    } catch (e) {
      collectError = e instanceof CoresignalApiError ? e.message : (e instanceof Error ? e.message : String(e))
    }
  }
  if (collectError) {
    return {
      companies: [], sufficiency: 'insufficient',
      reason: `Coresignal collect failed after retrieving ${records.length} of ${uniqueIds.length} record(s): ${collectError}`,
      candidates_considered: uniqueIds.length,
    }
  }

  // ── Filter + dedupe ────────────────────────────────────────────────
  const rejected: Array<{ name: string; reason: string }> = []
  const survivors: CompanyMatch[] = []
  const seenDomains = new Set<string>()
  const seenNames = new Set<string>()

  for (const record of records) {
    if (record.deleted) {
      rejected.push({ name: record.name || `#${record.id}`, reason: 'Coresignal marks this record deleted/stale' })
      continue
    }
    const match = normalizeCoresignalCompany(record)
    if (!match) {
      rejected.push({ name: `#${record.id}`, reason: 'Coresignal record has no company name' })
      continue
    }
    const rejectReason = classifyCompanyRejection(match.name, excludeCompanyNames)
    if (rejectReason) {
      rejected.push({ name: match.name, reason: rejectReason })
      continue
    }
    const dedupeKey = match.domain ? `domain:${normalizeDomain(match.domain)}` : `name:${normalizeName(match.name)}`
    if (match.domain ? seenDomains.has(dedupeKey) : seenNames.has(dedupeKey)) {
      rejected.push({ name: match.name, reason: 'duplicate within this Coresignal result set' })
      continue
    }
    if (match.domain) seenDomains.add(dedupeKey)
    else seenNames.add(dedupeKey)
    survivors.push(match)
  }

  if (survivors.length === 0) {
    return {
      companies: [], sufficiency: 'insufficient',
      reason: `${records.length} Coresignal record(s) retrieved, all rejected (self-name/duplicate/missing-name)`,
      candidates_considered: records.length,
      rejected_candidates: rejected,
    }
  }

  return {
    companies: survivors,
    sufficiency: 'sufficient',
    reason: `${survivors.length} of ${records.length} Coresignal record(s) survived filtering (${ids.length} ID(s) matched the search)`,
    candidates_considered: records.length,
    rejected_candidates: rejected,
  }
}

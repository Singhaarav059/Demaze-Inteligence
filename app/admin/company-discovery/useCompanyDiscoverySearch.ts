// ============================================================
// Company Discovery search + sequential-research hook
// ============================================================
// Owns: structured search against /api/admin/explee-discovery (the only
// company-discovery data source - see explee-client.ts), and the existing
// sequential "research the selected companies with Demaze's own pipeline"
// loop. Explee is an implementation detail of handleSearch()'s network call
// only - everything this hook returns (CompanyMatch-shaped results,
// sufficiency, reason strings) is vendor-neutral.
// ============================================================

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type { DedupedCompany } from '@/lib/batch/company-dedup'
import type { CompanyMatch, CompanyDiscoverySufficiency } from '@/lib/enrichment/company-discovery'
import type { CompanyDiscoveryCompany, CompanyDiscoveryMeta } from '@/lib/enrichment/company-discovery-provider-factory'
import type { CompanyResearchResult } from '@/lib/research/company-signals'
import { quotaSignatureIn, nextConsecutiveHits, shouldPauseBatch, QUOTA_PAUSE_THRESHOLD } from '@/lib/batch/quota-pause'
import { EMPLOYEE_RANGES, REVENUE_RANGES, sectorDefinition, type SectorOption } from './search-options'

export type CompanyStatus = 'not_researched' | 'already_researched' | 'running' | 'done' | 'failed'

// CompanyMatch plus the real Explee firmographic fields the results list
// renders (employee count, HQ location, industry, founding year, revenue) -
// nothing here is invented, all of it comes straight off ExpleeCompany.
export interface DiscoveredMatch extends CompanyMatch {
  industry?: string | null
  // FIXED (Exa provider work, 2026-09-01): industry used to silently
  // backfill with the searched sector/definition label whenever the
  // provider returned no real industry value — indistinguishable downstream
  // from a real value (it even flowed into company-research's research
  // input). `industry` above now stays null when the provider didn't report
  // one; this flag is the only place the UI should check to render
  // "industry not reported" instead of guessing.
  industryInferred?: boolean
  // Which provider produced this row (COMPANY_DISCOVERY_PROVIDER) — purely
  // informational, no UI currently branches on it.
  provider?: 'explee' | 'exa'
  // Set only for Exa rows by its conservative post-processing (see
  // exa-company-discovery.ts's applyDataQualityChecks) — annotation only,
  // never a reason a company is missing from this list. No UI branches on
  // it yet; carried through so one can be built later without re-plumbing.
  dataQualityFlags?: string[]
  employeeCount?: number | null
  hqLocation?: string | null
  hqCountryCode?: string | null
  founded?: number | null
  revenueAnnual?: number | null
  lastResearchedAt?: string | null
  // Already returned by the same Explee company-search call that populates
  // everything above (no extra credit spent) but previously dropped on the
  // floor - description/funding_stage/linkedin_id/url all come straight off
  // ExpleeCompany, same "nothing invented" discipline as every other field
  // on this type.
  description?: string | null
  fundingStage?: string | null
  linkedinUrl?: string | null
  websiteUrl?: string | null
  // True when a prior result exists AND was produced by this same page's
  // research call (operation='company_signals_research') - see
  // explee-discovery/route.ts's annotateAlreadyResearched. Only then can
  // viewStoredResult() below actually fetch something back; a company
  // researched only via the separate deep pipeline still shows
  // "Already researched" but has nothing to fetch through this page.
  hasStoredResult?: boolean
}

export interface DiscoveredCompanyState {
  company: DedupedCompany
  match: DiscoveredMatch
  selected: boolean
  status: CompanyStatus
  result?: CompanyResearchResult
  errorMessage?: string
}

export function toDedupedCompany(match: DiscoveredMatch, idx: number): DedupedCompany {
  return {
    id: `discovered-${idx}-${match.name}`,
    companyName: match.name,
    companyWebsite: match.domain,
    contacts: [],
    possibleDuplicateOf: [],
  }
}

export interface DiscoverySearchFilters {
  sector?: SectorOption
  // Final, resolved ISO 3166-1 alpha-2 codes - the page merges its region
  // buttons (India/Europe/America) and any individually-picked "more
  // locations" countries into this one list before calling handleSearch.
  countries?: string[]
  employeeRangeKey?: string
  revenueRangeKey?: string
  foundedAfter?: number
  foundedBefore?: number
  // Keys from COMPANY_TYPE_FILTERS / PRESENCE_FILTERS that are checked.
  companyTypeKeys?: string[]
  presenceKeys?: string[]
  excludeKeywords?: string[]
  // Deep-link escape hatch for ResearchCard's "Find companies in this
  // segment →" link - bypasses the sector enum with a raw free-text
  // definition, and excludes the one company the segment came from.
  definitionOverride?: string
  excludeCompanyName?: string
}

function sanitizeSearchError(message?: string): string {
  if (!message) return 'Something went wrong while searching for companies.'
  if (/explee/i.test(message)) return 'Company search is temporarily unavailable. Please try again shortly.'
  return message
}

const PAGE_SIZE = 20

// Pure function of its arguments (no hook state) — hoisted to module scope
// and exported so the industry-null-honesty behavior below is directly
// unit-testable without a React render harness.
export function toMatches(raw: CompanyDiscoveryCompany[], filters: DiscoverySearchFilters, industryLabel: string | null): DiscoveredMatch[] {
  const excludeKeywords = (filters.excludeKeywords ?? []).map(k => k.trim().toLowerCase()).filter(Boolean)
  const excludeName = filters.excludeCompanyName?.trim().toLowerCase()
  return raw
    .filter((c): c is CompanyDiscoveryCompany & { name: string } => !!c.name)
    .filter(c => !excludeName || !c.name.toLowerCase().includes(excludeName))
    .filter(c => excludeKeywords.length === 0 || !excludeKeywords.some(k =>
      [c.name, c.domain, c.description, c.industry].some(field => field?.toLowerCase().includes(k))
    ))
    .map(c => ({
      name: c.name,
      domain: c.domain ?? undefined,
      reason: `Matches your search criteria${industryLabel ? ` (${industryLabel})` : ''}.`,
      confidence: 'high' as const,
      source_urls: c.source_urls ?? (c.url ? [c.url] : []),
      // FIXED (Exa provider work, 2026-09-01): used to be `c.industry ??
      // industryLabel`, silently backfilling with the *searched* sector
      // string whenever the provider returned no real industry — an
      // Explee/Exa row genuinely missing an industry became
      // indistinguishable from one that actually reported it, and this
      // fabricated value even flowed into /api/admin/company-research's
      // research input. Never backfilled with the searched industryLabel
      // — see DiscoveredMatch.industryInferred's comment. A null industry
      // here means the provider genuinely didn't report one.
      industry: c.industry ?? null,
      industryInferred: !c.industry,
      provider: c.provider,
      dataQualityFlags: c.dataQualityFlags,
      employeeCount: c.size,
      hqLocation: c.geo_city || c.geo,
      hqCountryCode: c.geo,
      founded: c.founded,
      revenueAnnual: c.revenue_annual,
      description: c.description ?? null,
      fundingStage: c.funding_stage ?? null,
      linkedinUrl: c.linkedin_id
        ? `https://www.linkedin.com/company/${c.linkedin_id}`
        : (c.linkedin_url ?? null),
      websiteUrl: c.url ?? null,
      lastResearchedAt: (c as CompanyDiscoveryCompany & { lastResearchedAt?: string | null }).lastResearchedAt ?? null,
      hasStoredResult: (c as CompanyDiscoveryCompany & { hasStoredResult?: boolean }).hasStoredResult ?? false,
    }))
}

export function useCompanyDiscoverySearch() {
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [sufficiency, setSufficiency] = useState<CompanyDiscoverySufficiency | null>(null)
  const [discoveryReason, setDiscoveryReason] = useState<string | null>(null)
  const [totalAvailable, setTotalAvailable] = useState(0)

  const [companies, setCompanies] = useState<DiscoveredCompanyState[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [pausedReason, setPausedReason] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)

  const stopRequested = useRef(false)
  // Remembers the last-run request so "Load more" can re-issue it at the
  // next page without the caller re-passing every filter.
  const lastRequestBody = useRef<Record<string, unknown> | null>(null)
  const lastPage = useRef(1)
  const lastIndustryLabel = useRef<string | null>(null)
  // FIXED (audit follow-up, 2026-08-24): loadMore() used to build its
  // results with an empty filters object, dropping excludeKeywords/
  // excludeCompanyName from the original search - a company the user
  // explicitly excluded could reappear on page 2. Remembered here the same
  // way lastRequestBody/lastIndustryLabel already are.
  const lastFilters = useRef<DiscoverySearchFilters>({})

  function buildRequestBody(filters: DiscoverySearchFilters, definition: string) {
    const employeeRange = EMPLOYEE_RANGES.find(r => r.key === filters.employeeRangeKey)
    const revenueRange = REVENUE_RANGES.find(r => r.key === filters.revenueRangeKey)
    const body: Record<string, unknown> = {
      definition,
      geoInclude: filters.countries && filters.countries.length > 0 ? filters.countries : undefined,
      sizeMin: employeeRange?.min,
      sizeMax: employeeRange?.max,
      revenueMin: revenueRange?.min,
      revenueMax: revenueRange?.max,
      foundedMin: filters.foundedAfter,
      foundedMax: filters.foundedBefore,
      pageSize: PAGE_SIZE,
    }
    for (const key of filters.companyTypeKeys ?? []) body[key] = true
    for (const key of filters.presenceKeys ?? []) body[key] = true
    return body
  }

  async function runSearchRequest(body: Record<string, unknown>, page: number): Promise<{ ok: true; companies: CompanyDiscoveryCompany[]; meta?: CompanyDiscoveryMeta } | { ok: false; error: string }> {
    try {
      const res = await fetch('/api/admin/explee-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, page }),
      })
      const data = await res.json()
      if (!data.success) return { ok: false, error: sanitizeSearchError(data.error) }
      return { ok: true, companies: data.companies ?? [], meta: data.meta }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Network error while searching' }
    }
  }

  // ── Search ──────────────────────────────────────────────────
  // Returns the matches found (empty + count -1 on error) so the caller can
  // save a real segment snapshot - never fabricated data, and never reliant
  // on stale `companies` state (this return value reflects the fresh result
  // synchronously, before React has re-rendered).

  async function handleSearch(filters: DiscoverySearchFilters): Promise<{ count: number; matches: DiscoveredMatch[]; total: number }> {
    const definition = filters.definitionOverride?.trim() || (filters.sector ? sectorDefinition(filters.sector) : '')
    if (!definition) {
      setSearchError('Select an industry to search.')
      return { count: -1, matches: [], total: 0 }
    }

    setSearching(true)
    setSearchError(null)
    setSufficiency(null)
    setDiscoveryReason(null)
    setCompanies([])
    setTotalAvailable(0)

    const industryLabel = filters.sector ?? filters.definitionOverride ?? null
    const body = buildRequestBody(filters, definition)
    const result = await runSearchRequest(body, 1)
    setSearching(false)

    if (!result.ok) {
      setSearchError(result.error)
      return { count: -1, matches: [], total: 0 }
    }

    lastRequestBody.current = body
    lastPage.current = 1
    lastIndustryLabel.current = industryLabel
    lastFilters.current = filters

    const matches = toMatches(result.companies, filters, industryLabel)
    const total = result.meta?.total ?? matches.length
    setSufficiency(matches.length > 0 ? 'sufficient' : 'insufficient')
    setTotalAvailable(total)
    setDiscoveryReason(
      matches.length > 0
        ? `${matches.length} compan${matches.length === 1 ? 'y' : 'ies'} found${total > matches.length ? ` - showing the best ${matches.length}` : ''}.`
        : 'No companies matched these criteria. Try a broader location or employee range.'
    )
    setCompanies(matches.map((match, idx) => ({
      company: toDedupedCompany(match, idx),
      match,
      selected: !match.lastResearchedAt,
      status: (match.lastResearchedAt ? 'already_researched' : 'not_researched') as CompanyStatus,
    })))
    return { count: matches.length, matches, total }
  }

  // ── Load more - same filters, next page, appended ────────────

  async function loadMore() {
    if (!lastRequestBody.current || loadingMore) return
    setLoadingMore(true)
    const nextPage = lastPage.current + 1
    const result = await runSearchRequest(lastRequestBody.current, nextPage)
    setLoadingMore(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    lastPage.current = nextPage
    const matches = toMatches(result.companies, lastFilters.current, lastIndustryLabel.current)
    setCompanies(prev => {
      const seen = new Set(prev.map(c => (c.match.domain ? `d:${c.match.domain}` : `n:${c.match.name.toLowerCase()}`)))
      const fresh = matches.filter(m => !seen.has(m.domain ? `d:${m.domain}` : `n:${m.name.toLowerCase()}`))
      return [
        ...prev,
        ...fresh.map((match, idx) => ({
          company: toDedupedCompany(match, prev.length + idx),
          match,
          selected: !match.lastResearchedAt,
          status: (match.lastResearchedAt ? 'already_researched' : 'not_researched') as CompanyStatus,
        })),
      ]
    })
  }

  // ── Selection ───────────────────────────────────────────────

  function toggle(id: string) {
    setCompanies(prev => prev.map(c => c.company.id === id ? { ...c, selected: !c.selected } : c))
  }
  // FIXED (audit follow-up, 2026-08-24): used to force-select every row
  // including already-researched ones, unlike the smart initial default
  // (`selected: !match.lastResearchedAt` above) that skips them - so
  // "Select all" -> "Research" re-ran paid research on companies already
  // researched. Mirrors that same default; an individual row can still be
  // checked by hand to deliberately re-research it.
  function selectAll() {
    setCompanies(prev => prev.map(c => ({ ...c, selected: c.status !== 'already_researched' })))
  }
  function selectNone() {
    setCompanies(prev => prev.map(c => ({ ...c, selected: false })))
  }

  function updateCompany(id: string, patch: Partial<DiscoveredCompanyState>) {
    setCompanies(prev => prev.map(c => c.company.id === id ? { ...c, ...patch } : c))
  }

  // ── View a previously-researched company's stored result ──────────
  // For 'already_researched' rows whose result was never fetched into
  // React state (see explee-discovery/route.ts's hasStoredResult flag).
  // On success this populates `result`, at which point CompanyMatchList's
  // existing "View report"/"Find decision makers" UI lights up exactly as
  // it already does for a freshly-researched ('done') company.
  async function viewStoredResult(id: string) {
    const item = companies.find(c => c.company.id === id)
    if (!item) return
    setViewingId(id)
    try {
      const params = new URLSearchParams()
      if (item.match.domain) params.set('domain', item.match.domain)
      else params.set('name', item.match.name)
      const res = await fetch(`/api/admin/company-research?${params.toString()}`)
      const data = await res.json()
      if (data.success && data.result) {
        updateCompany(id, { result: data.result })
      } else {
        toast.error('Could not load this company’s saved research.')
      }
    } catch {
      toast.error('Could not load this company’s saved research.')
    } finally {
      setViewingId(null)
    }
  }

  // ── Sequential research loop - one company at a time, by design ────
  // Calls the Demaze intelligence layer (one grounded search call per
  // company, see lib/research/company-signals.ts) instead of the full
  // scrape pipeline - Explee already supplied the company record, so this
  // step only needs to find recent public signals, not re-derive who the
  // company is. The route persists its own run-history row.

  async function researchSelected() {
    const queue = companies.filter(c => c.selected && c.status !== 'done')
    if (queue.length === 0) return

    setRunning(true)
    setPausedReason(null)
    stopRequested.current = false

    let consecutiveQuotaHits = 0
    let succeededCount = 0
    let paused = false

    for (let i = 0; i < queue.length; i++) {
      if (stopRequested.current) break

      const item = queue[i]
      setProgress({ done: i, total: queue.length, current: item.company.companyName })
      updateCompany(item.company.id, { status: 'running' })

      try {
        const res = await fetch('/api/admin/company-research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: item.match.name,
            domain: item.match.domain,
            industry: item.match.industry,
            hqLocation: item.match.hqLocation,
            employeeCount: item.match.employeeCount,
            founded: item.match.founded,
            revenueAnnual: item.match.revenueAnnual,
          }),
        })
        const data = await res.json()
        const succeeded = data.success && !data.result?.error
        const result: CompanyResearchResult | undefined = data.result

        if (succeeded) succeededCount += 1
        updateCompany(item.company.id, {
          status: succeeded ? 'done' : 'failed',
          result,
          errorMessage: succeeded ? undefined : (result?.error ?? data.error ?? 'Unknown error'),
        })

        const quotaMsg = quotaSignatureIn({ error: result?.error ?? data.error })
        consecutiveQuotaHits = nextConsecutiveHits(consecutiveQuotaHits, quotaMsg)
        if (quotaMsg && shouldPauseBatch(consecutiveQuotaHits)) {
          const reason = `Stopped at company ${i + 1} of ${queue.length}, quota likely exhausted (${QUOTA_PAUSE_THRESHOLD} consecutive companies hit the same provider limit): "${quotaMsg}". Already-completed results below are saved. Re-run the remaining companies once quota resets.`
          setPausedReason(reason)
          toast.warning('Batch paused: quota likely exhausted', { description: `Stopped at company ${i + 1} of ${queue.length}. Already-completed results are saved.` })
          paused = true
          break
        }
      } catch (e) {
        updateCompany(item.company.id, {
          status: 'failed',
          errorMessage: e instanceof Error ? e.message : 'Network error',
        })
      }
    }

    setRunning(false)
    setProgress(null)
    if (!stopRequested.current && !paused) {
      toast.success(`Research complete: ${succeededCount} of ${queue.length} succeeded`)
    }
  }

  function stopBatch() {
    stopRequested.current = true
  }

  const selectedCount = companies.filter(c => c.selected).length
  const doneCount = companies.filter(c => c.status === 'done' || c.status === 'already_researched').length
  const hasMore = companies.length > 0 && companies.length < totalAvailable

  return {
    searching, searchError, setSearchError,
    sufficiency, setSufficiency,
    discoveryReason, setDiscoveryReason,
    totalAvailable, hasMore, loadingMore, loadMore,
    companies, setCompanies,
    running, progress, pausedReason,
    expandedId, setExpandedId,
    viewingId, viewStoredResult,
    selectedCount, doneCount,
    handleSearch, toggle, selectAll, selectNone, updateCompany,
    researchSelected, stopBatch,
  }
}

export type CompanyDiscoverySearch = ReturnType<typeof useCompanyDiscoverySearch>

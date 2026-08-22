// ============================================================
// Company Discovery search + sequential-research hook
// ============================================================
// Owns: structured search against /api/admin/explee-discovery (the only
// company-discovery data source — see explee-client.ts), and the existing
// sequential "research the selected companies with Demaze's own pipeline"
// loop. Explee is an implementation detail of handleSearch()'s network call
// only — everything this hook returns (CompanyMatch-shaped results,
// sufficiency, reason strings) is vendor-neutral.
// ============================================================

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type { RunResult } from '../intelligence-lab/_types'
import type { DedupedCompany } from '@/lib/batch/company-dedup'
import type { CompanyMatch, CompanyDiscoverySufficiency } from '@/lib/enrichment/company-discovery'
import type { ExpleeCompany, ExpleeSearchMeta } from '@/lib/enrichment/sources/explee-client'
import { quotaSignatureIn, nextConsecutiveHits, shouldPauseBatch, QUOTA_PAUSE_THRESHOLD } from '@/lib/batch/quota-pause'
import { EMPLOYEE_RANGES, sectorDefinition, type SectorOption } from './search-options'

export type CompanyStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

// CompanyMatch plus the real Explee firmographic fields the results list
// renders (employee count, HQ location, industry, founding year) — nothing
// here is invented, all of it comes straight off ExpleeCompany.
export interface DiscoveredMatch extends CompanyMatch {
  industry?: string | null
  employeeCount?: number | null
  hqLocation?: string | null
  founded?: number | null
}

export interface DiscoveredCompanyState {
  company: DedupedCompany
  match: DiscoveredMatch
  selected: boolean
  status: CompanyStatus
  result?: RunResult
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
  countries?: string[]
  employeeRangeKey?: string
  excludeKeywords?: string[]
  // Deep-link escape hatch for ResearchCard's "Find companies in this
  // segment →" link — bypasses the sector enum with a raw free-text
  // definition, and excludes the one company the segment came from.
  definitionOverride?: string
  excludeCompanyName?: string
}

function sanitizeSearchError(message?: string): string {
  if (!message) return 'Something went wrong while searching for companies.'
  if (/explee/i.test(message)) return 'Company search is temporarily unavailable. Please try again shortly.'
  return message
}

export function useCompanyDiscoverySearch() {
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [sufficiency, setSufficiency] = useState<CompanyDiscoverySufficiency | null>(null)
  const [discoveryReason, setDiscoveryReason] = useState<string | null>(null)

  const [companies, setCompanies] = useState<DiscoveredCompanyState[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [pausedReason, setPausedReason] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const stopRequested = useRef(false)

  // ── Search ──────────────────────────────────────────────────
  // Returns the number of matches found (or -1 on error) so the caller can
  // record a real "recent search" entry — never a fabricated count.

  async function handleSearch(filters: DiscoverySearchFilters): Promise<number> {
    const definition = filters.definitionOverride?.trim() || (filters.sector ? sectorDefinition(filters.sector) : '')
    if (!definition) {
      setSearchError('Select an industry to search.')
      return -1
    }

    setSearching(true)
    setSearchError(null)
    setSufficiency(null)
    setDiscoveryReason(null)
    setCompanies([])

    const range = EMPLOYEE_RANGES.find(r => r.key === filters.employeeRangeKey)
    const excludeKeywords = (filters.excludeKeywords ?? []).map(k => k.trim().toLowerCase()).filter(Boolean)
    const excludeName = filters.excludeCompanyName?.trim().toLowerCase()
    const industryLabel = filters.sector ?? filters.definitionOverride ?? null

    try {
      const res = await fetch('/api/admin/explee-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          definition,
          geoInclude: filters.countries && filters.countries.length > 0 ? filters.countries : undefined,
          sizeMin: range?.min,
          sizeMax: range?.max,
          pageSize: 20,
        }),
      })
      const data = await res.json()

      if (!data.success) {
        setSearchError(sanitizeSearchError(data.error))
        return -1
      }

      const raw: ExpleeCompany[] = data.companies ?? []
      const matches: DiscoveredMatch[] = raw
        .filter((c): c is ExpleeCompany & { name: string } => !!c.name)
        .filter(c => !excludeName || !c.name.toLowerCase().includes(excludeName))
        .filter(c => excludeKeywords.length === 0 || !excludeKeywords.some(k =>
          [c.name, c.domain, c.description, c.industry].some(field => field?.toLowerCase().includes(k))
        ))
        .map(c => ({
          name: c.name,
          domain: c.domain ?? undefined,
          reason: `Matches your search criteria${industryLabel ? ` (${industryLabel})` : ''}.`,
          confidence: 'high' as const,
          source_urls: c.url ? [c.url] : [],
          industry: c.industry ?? industryLabel,
          employeeCount: c.size,
          hqLocation: c.geo_city || c.geo,
          founded: c.founded,
        }))

      const meta: ExpleeSearchMeta | undefined = data.meta
      setSufficiency(matches.length > 0 ? 'sufficient' : 'insufficient')
      setDiscoveryReason(
        matches.length > 0
          ? `${matches.length} compan${matches.length === 1 ? 'y' : 'ies'} found${meta && meta.total > matches.length ? ` (${meta.total} total matches, showing top ${matches.length})` : ''}.`
          : 'No companies matched these criteria. Try a broader location or employee range.'
      )
      setCompanies(matches.map((match, idx) => ({
        company: toDedupedCompany(match, idx),
        match,
        selected: true,
        status: 'pending' as CompanyStatus,
      })))
      return matches.length
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Network error while searching')
      return -1
    } finally {
      setSearching(false)
    }
  }

  // ── Selection ───────────────────────────────────────────────

  function toggle(id: string) {
    setCompanies(prev => prev.map(c => c.company.id === id ? { ...c, selected: !c.selected } : c))
  }
  function selectAll() {
    setCompanies(prev => prev.map(c => ({ ...c, selected: true })))
  }
  function selectNone() {
    setCompanies(prev => prev.map(c => ({ ...c, selected: false })))
  }

  function updateCompany(id: string, patch: Partial<DiscoveredCompanyState>) {
    setCompanies(prev => prev.map(c => c.company.id === id ? { ...c, ...patch } : c))
  }

  // ── Persist a completed result to run-history immediately ───
  // Same as batch-upload/page.tsx's persistResult — non-fatal on failure.

  async function persistResult(company: DedupedCompany, data: RunResult) {
    try {
      await fetch('/api/admin/test-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_url: company.companyWebsite ?? company.companyName,
          domain: data.domain,
          operation: 'full_pipeline',
          status: data.success ? 'completed' : 'error',
          scraped_pages: data.scrapeResult?.successfulUrls.length ?? 0,
          failed_pages: data.scrapeResult?.failedUrls.length ?? 0,
          quality_score: data.quality?.score ?? 0,
          quality_note: data.quality?.note,
          token_usage: data.aiMeta?.tokensUsed ?? 0,
          provider_used: data.aiMeta?.provider,
          model_used: data.aiMeta?.model,
          ai_latency_ms: data.aiMeta?.latencyMs,
          execution_time_ms: data.executionTimeMs,
          scrape_time_ms: data.scrapeTimeMs,
          analysis_time_ms: data.analysisTimeMs,
          discovery_method: data.scrapeResult?.discoveryMethod,
          website_discovery: data.websiteDiscovery ?? null,
          scrape_result: data.scrapeResult,
          final_result: data.analysisResult,
          prompts: data.prompts,
          error_message: data.error,
        }),
      })
    } catch (e) {
      console.warn('[CompanyDiscovery] Failed to persist result:', e)
      toast.warning(`Couldn't save "${company.companyName}" to History, but its result is still shown below`)
    }
  }

  // ── Sequential research loop — one company at a time, by design ────
  // Identical shape to batch-upload/page.tsx's researchSelected().

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
        const body = item.company.companyWebsite
          ? { url: item.company.companyWebsite, mode: 'full' }
          : { companyName: item.company.companyName, mode: 'full' }

        const res = await fetch('/api/admin/test-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data: RunResult = await res.json()

        if (data.success) succeededCount += 1
        updateCompany(item.company.id, {
          status: data.success ? 'done' : 'failed',
          result: data,
          errorMessage: data.success ? undefined : (data.error ?? 'Unknown error'),
        })

        await persistResult(item.company, data)

        const quotaMsg = quotaSignatureIn(data)
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
  const doneCount = companies.filter(c => c.status === 'done').length

  return {
    searching, searchError, setSearchError,
    sufficiency, setSufficiency,
    discoveryReason, setDiscoveryReason,
    companies, setCompanies,
    running, progress, pausedReason,
    expandedId, setExpandedId,
    selectedCount, doneCount,
    handleSearch, toggle, selectAll, selectNone, updateCompany,
    persistResult, researchSelected, stopBatch,
  }
}

export type CompanyDiscoverySearch = ReturnType<typeof useCompanyDiscoverySearch>

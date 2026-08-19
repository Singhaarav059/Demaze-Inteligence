// ============================================================
// Shared company-discovery search + sequential-research hook
// ============================================================
// The Demaze-specific "Find Leads for Demaze" aggregate flow stays
// page-local but still needs write access to this hook's companies/
// sufficiency/discoveryReason/searchError state and its persistResult,
// since it populates the same shared results list — those setters/helpers
// are returned alongside the higher-level handlers for that reason.
//
// 2026-08-18 REWORK: the free-text-only `icpSegment` search is gone —
// `sector` (one of the 3 active target sectors) is now required, with an
// optional `refinement` free-text string composed alongside it, matching
// /api/admin/company-discovery's new contract. Every returned candidate is
// now pre-qualified server-side (company-qualification.ts, against the
// persistent company_registry) and annotated with `existingStatus` —
// genuinely new ('qualified') candidates default to selected, anything
// locked ('disqualified': already researched/outreached/duplicate/wrong
// sector/size) defaults to UNselected with a reason badge. The existing
// per-row checkbox IS the manual "research again" / "reconsider" override
// — no separate confirm dialog needed, since ticking the box is already an
// explicit action.
// ============================================================

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type { RunResult } from '../intelligence-lab/_types'
import type { DedupedCompany } from '@/lib/batch/company-dedup'
import type { CompanyMatch, CompanyDiscoverySufficiency } from '@/lib/enrichment/company-discovery'
import type { TargetSector } from '@/lib/sector-playbook/types'
import type { DiscoveryFunnel } from '@/lib/enrichment/discovery-funnel'
import { quotaSignatureIn, nextConsecutiveHits, shouldPauseBatch, QUOTA_PAUSE_THRESHOLD } from '@/lib/batch/quota-pause'

export type CompanyStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

// `segments` is only set when a row came from the "Find Leads for Demaze"
// aggregate flow (one company can surface under more than one ICP segment)
// — absent for the manual single-sector search, same component renders both.
// `existingStatus`/`rejectionReason` come from the qualification pass every
// discovery route now runs server-side.
export type DemazeMatch = CompanyMatch & {
  segments?: string[]
  existingStatus?: 'qualified' | 'disqualified'
  rejectionReason?: string | null
}

export interface DiscoveredCompanyState {
  company: DedupedCompany
  match: DemazeMatch
  selected: boolean
  status: CompanyStatus
  result?: RunResult
  errorMessage?: string
}

export function toDedupedCompany(match: DemazeMatch, idx: number): DedupedCompany {
  return {
    id: `discovered-${idx}-${match.name}`,
    companyName: match.name,
    companyWebsite: match.domain,
    contacts: [],
    possibleDuplicateOf: [],
  }
}

export interface UseCompanyDiscoverySearchOptions {
  initialSector?: TargetSector
  initialRefinement?: string
  initialExclude?: string
}

const DEFAULT_SECTOR: TargetSector = 'manufacturing'

export function useCompanyDiscoverySearch(options?: UseCompanyDiscoverySearchOptions) {
  const [sector, setSector] = useState<TargetSector>(options?.initialSector ?? DEFAULT_SECTOR)
  const [refinement, setRefinement] = useState(options?.initialRefinement ?? '')
  const [excludeCompanyName, setExcludeCompanyName] = useState(options?.initialExclude ?? '')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [sufficiency, setSufficiency] = useState<CompanyDiscoverySufficiency | null>(null)
  const [discoveryReason, setDiscoveryReason] = useState<string | null>(null)
  const [funnel, setFunnel] = useState<DiscoveryFunnel | null>(null)

  const [companies, setCompanies] = useState<DiscoveredCompanyState[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [pausedReason, setPausedReason] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const stopRequested = useRef(false)

  // ── Search ──────────────────────────────────────────────────
  // Accepts optional overrides so callers (arrive-via-link autosearch on
  // the standalone page) can fire immediately without waiting on a
  // setState round-trip. Optional `targetCount` switches the server onto
  // discoverCompaniesUntil()'s "keep going until N genuinely new companies
  // are found" loop instead of a single search pass.

  async function handleSearch(overrideSector?: TargetSector, overrideRefinement?: string, overrideExclude?: string, targetCount?: number) {
    const searchSector = overrideSector ?? sector
    setSearching(true)
    setSearchError(null)
    setSufficiency(null)
    setDiscoveryReason(null)
    setFunnel(null)
    setCompanies([])

    try {
      const res = await fetch('/api/admin/company-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sector: searchSector,
          refinement: (overrideRefinement ?? refinement).trim() || undefined,
          excludeCompanyName: (overrideExclude ?? excludeCompanyName).trim() || undefined,
          targetCount,
        }),
      })
      const data = await res.json()

      if (!data.success) {
        setSearchError(data.error ?? 'Company discovery failed')
        return
      }

      setSufficiency(data.sufficiency)
      setDiscoveryReason(data.reason)
      setFunnel(data.funnel ?? null)
      const matches: DemazeMatch[] = data.companies ?? []
      // Tag with the searched sector so the "Industry" column in
      // CompanyMatchList always has something to show, same as the
      // "Find Leads for Demaze" aggregate path's real `segments` field —
      // this is literally the sector the user searched, not invented.
      // A locked row (existingStatus === 'disqualified' — already
      // researched/outreached/duplicate/wrong-sector/size) defaults to
      // UNselected; the checkbox itself is the manual override.
      setCompanies(matches.map((match, idx) => ({
        company: toDedupedCompany(match, idx),
        match: { ...match, segments: [searchSector] },
        selected: match.existingStatus !== 'disqualified',
        status: 'pending' as CompanyStatus,
      })))
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Network error while searching')
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
    sector, setSector,
    refinement, setRefinement,
    excludeCompanyName, setExcludeCompanyName,
    searching, searchError, setSearchError,
    sufficiency, setSufficiency,
    discoveryReason, setDiscoveryReason,
    funnel, setFunnel,
    companies, setCompanies,
    running, progress, pausedReason,
    expandedId, setExpandedId,
    selectedCount, doneCount,
    handleSearch, toggle, selectAll, selectNone, updateCompany,
    persistResult, researchSelected, stopBatch,
  }
}

export type CompanyDiscoverySearch = ReturnType<typeof useCompanyDiscoverySearch>

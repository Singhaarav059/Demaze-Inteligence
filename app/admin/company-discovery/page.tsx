'use client'

// ============================================================
// Company Discovery — /admin/company-discovery
// ============================================================
// Given an ICP segment (typed free text, or copied from a prior research
// run's "Target Customer Segments"), find real candidate companies via
// lib/enrichment/company-discovery.ts -> select which to research -> run the
// existing 4-step pipeline sequentially, same "Research Selected" loop
// pattern as batch-upload/page.tsx (one company at a time, by design — real
// Firecrawl/Tavily quota limits, see CLAUDE.md Item 7). This is the reverse
// direction from batch-upload: that page starts from an uploaded lead list,
// this page starts from an ICP and finds the lead list.
// ============================================================

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ResearchCard } from '../intelligence-lab/ResearchCard'
import type { RunResult } from '../intelligence-lab/_types'
import type { DedupedCompany } from '@/lib/batch/company-dedup'
import type { CompanyMatch, CompanyDiscoverySufficiency } from '@/lib/enrichment/company-discovery'
import { quotaSignatureIn, nextConsecutiveHits, shouldPauseBatch, QUOTA_PAUSE_THRESHOLD } from '@/lib/batch/quota-pause'

type CompanyStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

interface DiscoveredCompanyState {
  company: DedupedCompany
  match: CompanyMatch
  selected: boolean
  status: CompanyStatus
  result?: RunResult
  errorMessage?: string
}

function toDedupedCompany(match: CompanyMatch, idx: number): DedupedCompany {
  return {
    id: `discovered-${idx}-${match.name}`,
    companyName: match.name,
    companyWebsite: match.domain,
    contacts: [],
    possibleDuplicateOf: [],
  }
}

export default function CompanyDiscoveryPage() {
  const [icpSegment, setIcpSegment] = useState('')
  const [excludeCompanyName, setExcludeCompanyName] = useState('')
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

  async function handleSearch() {
    if (!icpSegment.trim()) return
    setSearching(true)
    setSearchError(null)
    setSufficiency(null)
    setDiscoveryReason(null)
    setCompanies([])

    try {
      const res = await fetch('/api/admin/company-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icpSegment: icpSegment.trim(), excludeCompanyName: excludeCompanyName.trim() || undefined }),
      })
      const data = await res.json()

      if (!data.success) {
        setSearchError(data.error ?? 'Company discovery failed')
        return
      }

      setSufficiency(data.sufficiency)
      setDiscoveryReason(data.reason)
      const matches: CompanyMatch[] = data.companies ?? []
      setCompanies(matches.map((match, idx) => ({
        company: toDedupedCompany(match, idx),
        match,
        selected: true,
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

    for (let i = 0; i < queue.length; i++) {
      if (stopRequested.current) break

      const item = queue[i]
      setProgress({ done: i, total: queue.length, current: item.company.companyName })
      updateCompany(item.company.id, { status: 'running' })

      try {
        const body = item.company.companyWebsite
          ? { url: item.company.companyWebsite, mode: 'lightweight' }
          : { companyName: item.company.companyName, mode: 'lightweight' }

        const res = await fetch('/api/admin/test-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data: RunResult = await res.json()

        updateCompany(item.company.id, {
          status: data.success ? 'done' : 'failed',
          result: data,
          errorMessage: data.success ? undefined : (data.error ?? 'Unknown error'),
        })

        await persistResult(item.company, data)

        const quotaMsg = quotaSignatureIn(data)
        consecutiveQuotaHits = nextConsecutiveHits(consecutiveQuotaHits, quotaMsg)
        if (quotaMsg && shouldPauseBatch(consecutiveQuotaHits)) {
          setPausedReason(
            `Stopped at company ${i + 1} of ${queue.length}, quota likely exhausted (${QUOTA_PAUSE_THRESHOLD} consecutive companies hit the same provider limit): "${quotaMsg}". Already-completed results below are saved. Re-run the remaining companies once quota resets.`
          )
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
  }

  function stopBatch() {
    stopRequested.current = true
  }

  // ── Render ──────────────────────────────────────────────────

  const selectedCount = companies.filter(c => c.selected).length
  const doneCount = companies.filter(c => c.status === 'done').length

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Company Discovery</h1>
          <p className="text-sm text-muted-foreground mt-0.5">ICP segment → matching companies → research in batch</p>
        </div>
      </div>

      {/* ── ICP search ──────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardContent className="px-5 py-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">ICP segment</label>
            <Input
              value={icpSegment}
              onChange={(e) => setIcpSegment(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !searching) handleSearch() }}
              placeholder="e.g. automotive manufacturers, oil and gas, mid-size SaaS companies…"
              className="bg-background border-border text-foreground placeholder:text-muted-foreground/60 text-sm"
            />
            <p className="text-muted-foreground/70 text-xs">
              Paste a segment name from a prior research run&rsquo;s &ldquo;Target Customer Segments&rdquo;, or type your own.
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Exclude company (optional)</label>
            <Input
              value={excludeCompanyName}
              onChange={(e) => setExcludeCompanyName(e.target.value)}
              placeholder="e.g. the company you researched this segment from"
              className="bg-background border-border text-foreground placeholder:text-muted-foreground/60 text-sm max-w-sm"
            />
          </div>
          <Button size="sm" onClick={handleSearch} disabled={searching || !icpSegment.trim()}>
            {searching ? 'Searching…' : 'Find Companies'}
          </Button>

          {searchError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
              <p className="text-destructive">{searchError}</p>
            </div>
          )}

          {sufficiency === 'insufficient' && !searchError && (
            <div className="rounded-lg border border-signal-medium/30 bg-signal-medium/10 px-3 py-2 text-xs">
              <p className="text-signal-medium">No companies surfaced — {discoveryReason}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Results / selection list ────────────────────────────── */}
      {companies.length > 0 && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="border-border bg-card text-foreground/90 hover:bg-accent" onClick={selectAll}>Select all</Button>
            <Button size="sm" variant="outline" className="border-border bg-card text-foreground/90 hover:bg-accent" onClick={selectNone}>Select none</Button>
            <span className="text-muted-foreground text-xs">{selectedCount} of {companies.length} selected · {doneCount} done</span>

            <div className="ml-auto flex items-center gap-2">
              {running ? (
                <Button size="sm" variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20" onClick={stopBatch}>
                  Stop after current
                </Button>
              ) : (
                <Button size="sm" onClick={researchSelected} disabled={selectedCount === 0}>
                  Research Selected ({selectedCount})
                </Button>
              )}
            </div>
          </div>

          {progress && (
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-primary/10 border border-primary/40 text-xs">
              <span className="text-primary font-medium">Researching {progress.done + 1} of {progress.total}</span>
              <span className="text-muted-foreground truncate">{progress.current}</span>
            </div>
          )}

          {pausedReason && (
            <div className="rounded-lg border border-signal-medium/30 bg-signal-medium/10 px-3 py-2.5 text-xs">
              <p className="text-signal-medium font-medium">⏸ Batch paused</p>
              <p className="text-signal-medium/80 mt-1">{pausedReason}</p>
            </div>
          )}

          <div className="space-y-1.5">
            {companies.map(({ company, match, selected, status, result, errorMessage }) => (
              <div key={company.id} className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggle(company.id)}
                    disabled={running}
                    className="accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-foreground text-sm truncate">{match.name}</span>
                      <ConfidenceBadge confidence={match.confidence} />
                      {!match.domain && (
                        <Badge className="text-[10px] bg-signal-medium/10 text-signal-medium border border-signal-medium/30">
                          domain not confirmed
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground/70 text-xs truncate">
                      {match.domain ?? 'no domain resolved — will research by name only'}
                    </p>
                    <p className="text-muted-foreground/70 text-xs mt-0.5 truncate" title={match.reason}>
                      {match.reason}
                    </p>
                  </div>

                  <StatusBadge status={status} />

                  {status === 'done' && (
                    <button
                      onClick={() => setExpandedId(expandedId === company.id ? null : company.id)}
                      className="text-muted-foreground hover:text-foreground/90 text-xs px-2 py-1 rounded border border-border hover:border-border"
                    >
                      {expandedId === company.id ? 'Hide' : 'View'}
                    </button>
                  )}
                </div>

                {status === 'failed' && errorMessage && (
                  <div className="px-3 pb-2 -mt-1">
                    <p className="text-destructive text-xs">{errorMessage}</p>
                  </div>
                )}

                {expandedId === company.id && result && (
                  <div className="border-t border-border px-4 py-4">
                    <ResearchCard result={result} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: CompanyMatch['confidence'] }) {
  const map: Record<CompanyMatch['confidence'], string> = {
    high: 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30',
    medium: 'bg-signal-medium/10 text-signal-medium border border-signal-medium/30',
    low: 'bg-accent text-muted-foreground',
  }
  return <Badge className={`text-[10px] ${map[confidence]}`}>{confidence}</Badge>
}

function StatusBadge({ status }: { status: CompanyStatus }) {
  const map: Record<CompanyStatus, { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-accent text-muted-foreground' },
    running: { label: 'Researching…', className: 'bg-primary/10 text-primary border border-primary/40' },
    done: { label: 'Done', className: 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30' },
    failed: { label: 'Failed', className: 'bg-destructive/10 text-destructive border border-destructive/40' },
    skipped: { label: 'Skipped', className: 'bg-accent text-muted-foreground' },
  }
  const { label, className } = map[status]
  return <Badge className={`text-[10px] flex-shrink-0 ${className}`}>{label}</Badge>
}

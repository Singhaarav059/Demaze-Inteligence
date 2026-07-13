'use client'

// ============================================================
// Batch Upload — /admin/batch-upload
// ============================================================
// Upload a lead-list file (xlsx/csv/docx/pdf) -> parse + dedupe companies
// server-side -> select which to research -> run the existing 4-step
// pipeline SEQUENTIALLY (one company at a time, by design — see CLAUDE.md/
// Phase 1 plan: batch-level parallelism was deliberately rejected given
// real Firecrawl/Tavily quota limits already hit this session) -> persist
// each completed result to run-history as it finishes, so a closed tab or
// navigation mid-batch never loses already-completed (already-paid-for)
// research.
// ============================================================

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ResearchCard } from '../intelligence-lab/ResearchCard'
import type { RunResult } from '../intelligence-lab/_types'
import type { DedupedCompany } from '@/lib/batch/company-dedup'
import { quotaSignatureIn, nextConsecutiveHits, shouldPauseBatch, QUOTA_PAUSE_THRESHOLD } from '@/lib/batch/quota-pause'

type CompanyStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

interface BatchCompanyState {
  company: DedupedCompany
  selected: boolean
  status: CompanyStatus
  result?: RunResult
  errorMessage?: string
}

export default function BatchUploadPage() {
  const [companies, setCompanies] = useState<BatchCompanyState[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([])
  const [detectedHeaders, setDetectedHeaders] = useState<string[] | null>(null)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [pausedReason, setPausedReason] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const stopRequested = useRef(false)

  // ── Upload + parse ─────────────────────────────────────────

  async function handleFile(file: File) {
    setUploading(true)
    setUploadError(null)
    setUploadWarnings([])
    setDetectedHeaders(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/admin/batch-parse', { method: 'POST', body: formData })
      const data = await res.json()

      if (!data.success) {
        setUploadError(data.error ?? 'Failed to parse file')
        setDetectedHeaders(data.detectedHeaders ?? null)
        return
      }

      setUploadWarnings(data.warnings ?? [])
      setCompanies((data.companies as DedupedCompany[]).map(company => ({
        company, selected: true, status: 'pending' as CompanyStatus,
      })))
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Network error while uploading')
    } finally {
      setUploading(false)
    }
  }

  // ── Selection ───────────────────────────────────────────────

  const filtered = companies.filter(c =>
    !search.trim() || c.company.companyName.toLowerCase().includes(search.toLowerCase())
  )

  function toggle(id: string) {
    setCompanies(prev => prev.map(c => c.company.id === id ? { ...c, selected: !c.selected } : c))
  }
  function selectAll() {
    setCompanies(prev => prev.map(c => ({ ...c, selected: true })))
  }
  function selectNone() {
    setCompanies(prev => prev.map(c => ({ ...c, selected: false })))
  }

  function updateCompany(id: string, patch: Partial<BatchCompanyState>) {
    setCompanies(prev => prev.map(c => c.company.id === id ? { ...c, ...patch } : c))
  }

  // ── Persist a completed result to run-history immediately ───

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
      // Persist failures are non-fatal to the batch — the result is still
      // shown in this session, just not saved to history. Same "display
      // unaffected" principle as the single-URL flow.
      console.warn('[BatchUpload] Failed to persist result:', e)
    }
  }

  // ── Sequential research loop — one company at a time, by design ────

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

        // Persist as-you-go — regardless of success/failure, so failed
        // attempts are visible in history too, not just silently dropped.
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
          <h1 className="text-xl font-semibold text-foreground">Batch Upload</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Upload a lead list → select companies → research in batch</p>
        </div>
      </div>

      {/* ── Upload ──────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardContent className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.docx,.pdf"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              disabled={uploading}
              className="text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-accent file:text-foreground/90 file:text-xs hover:file:bg-accent"
            />
            {uploading && <span className="text-xs text-muted-foreground">Parsing…</span>}
          </div>
          <p className="text-muted-foreground/70 text-xs">
            Supported: .xlsx (priority), .csv, .docx, .pdf. PDF is the least reliable format —
            text extraction can interleave columns from a real table; verify extracted rows carefully.
          </p>

          {uploadError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
              <p className="text-destructive">{uploadError}</p>
              {detectedHeaders && detectedHeaders.length > 0 && (
                <p className="text-destructive/70 mt-1">Headers found: {detectedHeaders.join(', ')}</p>
              )}
            </div>
          )}

          {uploadWarnings.length > 0 && (
            <div className="rounded-lg border border-signal-medium/30 bg-signal-medium/10 px-3 py-2 text-xs space-y-0.5">
              {uploadWarnings.map((w, i) => <p key={i} className="text-signal-medium">⚠ {w}</p>)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Company selection list ────────────────────────────── */}
      {companies.length > 0 && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search companies…"
              className="bg-card border-border text-foreground placeholder:text-muted-foreground/60 max-w-xs text-sm"
            />
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
            {filtered.map(({ company, selected, status, result, errorMessage }) => (
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
                      <span className="text-foreground text-sm truncate">{company.companyName}</span>
                      {company.contacts.length > 1 && (
                        <Badge className="text-[10px] bg-accent text-muted-foreground">{company.contacts.length} contacts</Badge>
                      )}
                      {company.possibleDuplicateOf.length > 0 && (
                        <Badge className="text-[10px] bg-signal-medium/10 text-signal-medium border border-signal-medium/30">
                          possible duplicate of {company.possibleDuplicateOf.join(', ')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground/70 text-xs truncate">
                      {[company.companyWebsite, company.industry, company.country].filter(Boolean).join(' · ') || 'no website/industry/country given'}
                    </p>
                    {company.contacts.some(c => c.personName) && (
                      <p className="text-muted-foreground/70 text-xs mt-0.5">
                        {company.contacts.filter(c => c.personName).map(c => `${c.personName}${c.jobTitle ? ` (${c.jobTitle})` : ''}`).join('; ')}
                      </p>
                    )}
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

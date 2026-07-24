'use client'

// ============================================================
// Intelligence Lab — /admin/intelligence-lab
// ============================================================

import { useState, useCallback, type ReactNode, type ReactElement } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { humanizeText } from '@/lib/text/humanize'
import {
  getCompanyFit,
  getAutomationOpportunity,
  getWhyNow,
  getSignals,
  getOpportunities,
  getPainPointsStructured,
  getReasoningChains,
  getOutreachIntelligence,
  getBusinessModelAnalysis,
  getSignalClusters,
  getStrategicChallenges,
  getExecutiveBrief,
  getDeterministicOpportunities,
  getServiceEvidenceDebug,
} from '@/lib/pipeline/analysis-sections'
import type { RunResult, Operation, AnalysisMode, ActiveTab } from './_types'
import { ComparisonPanel } from './ComparisonPanel'
import { ResearchCard } from './ResearchCard'

// ── Types ─────────────────────────────────────────────────────

interface ScrapeCache {
  url: string             // the normalized URL this cache is for
  quality: { score: number; note: string }
  pagesScraped: number
  cachedAt: string        // ISO, when the scrape was saved
  source: 'fresh' | 'database' // where it came from
}


// ── Helpers ────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function isCacheStale(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() > 24 * 60 * 60 * 1000
}

// ── Main Component ────────────────────────────────────────────

export default function IntelligenceLab() {
  const [url, setUrl] = useState('https://bharatforge.com')
  const [mode, setMode] = useState<AnalysisMode>('full')
  const [running, setRunning] = useState(false)
  const [activeOp, setActiveOp] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [activeTab, setActiveTab] = useState<ActiveTab>('analysis')
  const [activePageIdx, setActivePageIdx] = useState(0)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  // Scrape cache — survives between Test Scraper and Test Analysis in same session
  const [scrapeCache, setScrapeCache] = useState<ScrapeCache | null>(null)
  const [clearingCache, setClearingCache] = useState(false)

  // Comparison mode
  const [compareA, setCompareA] = useState<RunResult | null>(null)
  const [compareB, setCompareB] = useState<RunResult | null>(null)

  // ── API call helper (no auth headers — auth bypassed in dev) ─

  const callApi = useCallback(async (endpoint: string, body: Record<string, unknown>) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    return res.json()
  }, [])

  // ── Save to history (INDEPENDENT of result display) ────────

  const saveRun = useCallback(async (data: RunResult, operation: string) => {
    const sr = data.scrapeResult
    const res = await fetch('/api/admin/test-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_url: url,
        domain: data.domain,
        operation,
        status: data.success ? 'completed' : 'error',
        scraped_pages: sr?.successfulUrls.length ?? 0,
        failed_pages: sr?.failedUrls.length ?? 0,
        quality_score: data.quality?.score ?? 0,
        quality_note: data.quality?.note,
        token_usage: data.aiMeta?.tokensUsed ?? 0,
        provider_used: data.aiMeta?.provider,
        model_used: data.aiMeta?.model,
        ai_latency_ms: data.aiMeta?.latencyMs,
        execution_time_ms: data.executionTimeMs,
        scrape_time_ms: data.scrapeTimeMs,
        analysis_time_ms: data.analysisTimeMs,
        discovery_method: sr?.discoveryMethod,
        website_discovery: data.websiteDiscovery ?? null,
        scrape_result: sr,
        final_result: data.analysisResult,
        prompts: data.prompts,
        error_message: data.error,
      }),
    })
    if (!res.ok) throw new Error(`test-runs POST ${res.status}`)
  }, [url])

  // ── Main run function ──────────────────────────────────────

  async function run(
    operation: Operation,
    opts: { force?: boolean } = {}
  ) {
    if (!url.trim()) return

    setRunning(true)
    setActiveOp(operation + (opts.force ? '-force' : ''))
    setResult(null)
    setSaveStatus('idle')
    setActivePageIdx(0)

    // rescrape = scraper with force=true
    const isRescrape = operation === 'rescrape'
    const isAnalysis = operation === 'analysis' || operation === 'pipeline'
    const endpoint = isAnalysis ? '/api/admin/test-analysis' : '/api/admin/test-scraper'

    const urlNormalized = url.trim()

    // Re-Scrape always forces, others never force (cache is handled server-side)
    const sendForce = isRescrape || opts.force === true

    let runData: RunResult | null = null

    // Block 1: API call
    try {
      const data: RunResult = await callApi(endpoint, {
        url: urlNormalized,
        mode,
        force: sendForce,
      })
      runData = data

      console.log('[Lab] API response:', {
        success: data.success,
        scrapeSource: data.scrapeSource,
        cachedAt: data.cachedAt,
        hasAnalysis: Boolean(data.analysisResult),
      })

      setResult(data)

      // Update in-session scrape cache whenever we get a scrape result
      if (data.success && data.scrapeResult && data.quality) {
        setScrapeCache({
          url: urlNormalized,
          quality: data.quality,
          pagesScraped: data.scrapeResult.successfulUrls.length,
          cachedAt: data.cachedAt ?? new Date().toISOString(),
          source: data.scrapeSource === 'cache' ? 'database' : 'fresh',
        })
      }

      // Switch to most relevant tab
      if (operation === 'scraper') {
        setActiveTab('scraper')
      } else if (data.analysisResult && !data.parseError) {
        setActiveTab('analysis')
      } else if (data.parseError) {
        setActiveTab('debug')
      } else {
        setActiveTab('scraper')
      }

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('[Lab] API call failed:', message)
      setResult({ success: false, error: message })
    } finally {
      setRunning(false)
      setActiveOp(null)
    }

    // Block 2: Save to history (never affects result display)
    if (runData) {
      setSaveStatus('saving')
      try {
        const opKey =
          (operation === 'scraper' || operation === 'rescrape') ? 'scraper_only'
          : operation === 'analysis' ? 'analysis'
          : 'full_pipeline'
        await saveRun(runData, opKey)
        setSaveStatus('saved')
      } catch (saveErr) {
        setSaveStatus('failed')
        console.warn('[Lab] Save to history failed (display unaffected):', saveErr)
      }
    }
  }

  function saveToCompare(slot: 'A' | 'B') {
    if (!result) return
    if (slot === 'A') setCompareA(result)
    else setCompareB(result)
  }

  // Cache validity for current URL
  const urlNormalized = url.trim()
  const cacheIsValidForUrl =
    scrapeCache !== null &&
    scrapeCache.url === urlNormalized &&
    !isCacheStale(scrapeCache.cachedAt)

  const sr = result?.scrapeResult
  const successfulPages = sr?.pages.filter((p) => p.success && p.charCount > 0) ?? []
  const activePage = successfulPages[activePageIdx]
  const hasAnalysis = Boolean(result?.analysisResult && !result?.parseError)

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">

      {/* ── Header ─────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Company Research</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter a company URL to generate an outbound research brief.
        </p>
      </div>

      {/* ── URL Input + Mode ───────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            aria-label="Company URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://company.com"
            className="flex-1 font-mono text-sm"
            disabled={running}
            onKeyDown={(e) => e.key === 'Enter' && run('analysis')}
          />

          {/* Mode toggle */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            <button
              onClick={() => setMode('lightweight')}
              disabled={running}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs transition-colors',
                mode === 'lightweight' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Lightweight <span className="ml-1 opacity-60">3k</span>
            </button>
            <button
              onClick={() => setMode('full')}
              disabled={running}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs transition-colors',
                mode === 'full' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Full <span className="ml-1 opacity-60">15k</span>
            </button>
          </div>
        </div>

        {/* ── Scrape Status ──────────────────────────────────── */}
        {cacheIsValidForUrl ? (
          <div className="flex items-center gap-3 rounded-lg border border-signal-strong/30 bg-signal-strong/10 px-3 py-2 text-xs">
            <span className="font-medium text-signal-strong">✓ Cached</span>
            <span className="text-muted-foreground">
              {scrapeCache!.pagesScraped} pages · quality {scrapeCache!.quality.score}/100 · {timeAgo(scrapeCache!.cachedAt)}
            </span>
            <span className="text-muted-foreground/60">Analyze will reuse this scrape.</span>
            <button
              onClick={async () => {
                const u = urlNormalized
                if (!u) return
                setClearingCache(true)
                try {
                  const res = await fetch(`/api/admin/scrape-cache?url=${encodeURIComponent(u)}`, { method: 'DELETE' })
                  const data = await res.json().catch(() => ({ success: res.ok }))
                  if (!res.ok || data.success === false) {
                    toast.error(data.error ?? 'Failed to clear cache')
                    return
                  }
                  setScrapeCache(null)
                  toast.success('Cache cleared, next Analyze will scrape fresh')
                } catch {
                  toast.error('Could not reach the scrape-cache API')
                } finally {
                  setClearingCache(false)
                }
              }}
              disabled={clearingCache}
              className="ml-auto flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
              title="Delete cache, next Analyze will scrape fresh"
            >
              {clearingCache ? <Spinner className="size-3" /> : null}
              Clear cache
            </button>
          </div>
        ) : scrapeCache && scrapeCache.url !== urlNormalized ? (
          <div className="flex items-center gap-2 rounded-lg border border-signal-medium/30 bg-signal-medium/10 px-3 py-2 text-xs">
            <span className="text-signal-medium">⚠ URL changed, no scrape for this site yet</span>
          </div>
        ) : null}

        {/* ── Action Buttons ─────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Analyze, uses cached scrape if available, scrapes fresh if not */}
          <Button
            onClick={() => run('analysis')}
            disabled={running || !url.trim()}
          >
            {running && (activeOp === 'analysis' || activeOp === 'pipeline')
              ? <><Spinner /> Analyzing…</>
              : cacheIsValidForUrl ? 'Analyze (cached scrape)' : 'Analyze'}
          </Button>

          {/* Scrape only, loads from cache if available, scrapes fresh if not */}
          <Button
            onClick={() => run('scraper')}
            disabled={running || !url.trim()}
            variant="outline"
          >
            {running && activeOp === 'scraper'
              ? <><Spinner /> Scraping…</>
              : cacheIsValidForUrl ? 'Scrape (cached)' : 'Scrape'}
          </Button>

          {/* Re-Scrape, always force fresh, bypasses + overwrites cache */}
          <Button
            onClick={() => run('rescrape')}
            disabled={running || !url.trim()}
            variant="outline"
            className="text-signal-medium hover:text-signal-medium"
          >
            {running && activeOp === 'rescrape'
              ? <><Spinner /> Re-scraping…</>
              : '↻ Re-Scrape (force fresh)'}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {mode === 'lightweight'
            ? 'Lightweight: sends up to 3,000 chars to AI, faster, lower cost.'
            : 'Full: sends up to 15,000 chars, thorough analysis, higher cost.'}
          {cacheIsValidForUrl
            ? ' Analyze and Scrape will reuse the cached scrape. Use Re-Scrape or Clear Cache to force a fresh scrape.'
            : ' No cache, will scrape fresh.'}
        </p>
      </div>

      {/* ── Running indicator ───────────────────────────────── */}
      {running && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3">
          <Spinner className="text-primary" />
          <span className="text-sm text-primary">
            {activeOp === 'rescrape' ? 'Re-scraping website content…'
              : activeOp === 'scraper' ? 'Scraping website content…'
              : activeOp === 'analysis' || activeOp === 'pipeline'
                ? `${cacheIsValidForUrl ? 'Using cached scrape · ' : 'Scraping · '}Running AI analysis (${mode} mode)…`
              : 'Running…'}
          </span>
        </div>
      )}

      {/* ── Save status ─────────────────────────────────────── */}
      {saveStatus === 'failed' && (
        <div className="flex items-center justify-between rounded-lg border border-signal-medium/30 bg-signal-medium/10 px-4 py-2">
          <p className="text-xs text-signal-medium">
            ⚠ Failed to save run to history. Run migration 002_test_runs.sql in Supabase if you haven&apos;t.
          </p>
          <span className="text-xs text-muted-foreground">(non-blocking)</span>
        </div>
      )}
      {saveStatus === 'saved' && (
        <div className="text-right text-xs text-muted-foreground">✓ Saved to run history</div>
      )}

      {/* ── Error state ─────────────────────────────────────── */}
      {result && !result.success && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
          <p className="text-sm font-medium text-destructive">Error</p>
          <p className="mt-1 font-mono text-xs text-destructive/80">{result.error}</p>
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────── */}
      {result && result.success && (
        <>
          {result.parseError && (
            <div className="rounded-lg border border-signal-weak/40 bg-signal-weak/10 px-4 py-3">
              <p className="text-sm font-medium text-signal-weak">AI response received but failed to parse as JSON</p>
              <p className="mt-1 font-mono text-xs text-signal-weak/80">{result.parseError}</p>
            </div>
          )}

          {/* ── Inspector (engineer surfaces, collapsed) — TOP ─── */}
          <details className="group rounded-xl border border-border bg-card/40">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-foreground select-none">
              <span className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-4 text-muted-foreground transition-transform group-open:rotate-90">
                  <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Inspector
                <span className="text-xs font-normal text-muted-foreground">scraper · content · analysis · intelligence · sources · debug</span>
              </span>
            </summary>

            <div className="border-t border-border px-4 py-4">
          {/* ── Comparison save ─────────────────────────────── */}
          <div className="mb-4 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Save for comparison:</span>
            <button onClick={() => saveToCompare('A')} className="rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">→ Slot A</button>
            <button onClick={() => saveToCompare('B')} className="rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">→ Slot B</button>
            {(compareA || compareB) && (
              <button onClick={() => setActiveTab('comparison')} className="rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">View comparison →</button>
            )}
          </div>

          {/* ── Tabs ──────────────────────────────────────────── */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)}>
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <TabsList className="border border-border bg-card">
              <TabsTrigger value="scraper" className="text-xs text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground">
                Scraper
              </TabsTrigger>
              <TabsTrigger value="content" className="text-xs text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground">
                Content ({successfulPages.length})
              </TabsTrigger>
              <TabsTrigger value="analysis" className="text-xs text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground">
                Analysis {hasAnalysis ? '✓' : result.parseError ? '⚠' : ''}
              </TabsTrigger>
              <TabsTrigger value="intelligence" className="text-xs text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground">
                Intelligence{result?.synthesisResult ? ' ✦' : ''}
              </TabsTrigger>
              <TabsTrigger value="debug" className="text-xs text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground">
                Debug
              </TabsTrigger>
              <TabsTrigger value="sources" className="text-xs text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground">
                Sources{result?.enrichmentMeta ? ` (${result.enrichmentMeta.sources_used})` : result?.recoveryTriggered ? ' ⚡' : ''}
              </TabsTrigger>
              <TabsTrigger value="comparison" className="text-xs text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground">
                Compare {(compareA || compareB) ? '●' : ''}
              </TabsTrigger>
            </TabsList>
            </div>

            {/* ── Scraper Results ──────────────────────────── */}
            <TabsContent value="scraper" className="mt-4 space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card className="bg-card border-border">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm text-foreground">Quality Assessment</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <Progress value={result.quality?.score ?? 0} className="flex-1 h-2" />
                      <span className="text-white font-mono text-sm w-12 text-right">{result.quality?.score ?? 0}/100</span>
                    </div>
                    <p className="text-muted-foreground text-xs">{result.quality?.note}</p>
                  </CardContent>
                </Card>

                <Card className="bg-card border-border">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm text-foreground">Timing</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-2">
                    <TimingRow label="Total" ms={result.executionTimeMs} />
                    {result.scrapeTimeMs !== undefined && (
                      <TimingRow
                        label={`Scrape${result.scrapeSource === 'cache' ? ' (cached)' : ''}`}
                        ms={result.scrapeTimeMs}
                      />
                    )}
                    {result.analysisTimeMs !== undefined && <TimingRow label="Analysis" ms={result.analysisTimeMs} />}
                    {result.aiMeta && <TimingRow label="AI latency" ms={result.aiMeta.latencyMs} />}
                    {result.aiMeta && (
                      <div className="flex justify-between pt-1 border-t border-border">
                        <span className="text-muted-foreground text-xs">Tokens used</span>
                        <span className="text-foreground text-xs font-mono">{result.aiMeta.tokensUsed?.toLocaleString()}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="bg-card border-border">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm text-foreground">Successful Pages ({sr?.successfulUrls.length ?? 0})</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-1">
                  {sr?.successfulUrls.map((u, i) => (
                    <div key={`${u}-${i}`} className="flex items-center gap-2 py-0.5">
                      <span className="w-2 h-2 rounded-full bg-signal-strong flex-shrink-0" />
                      <span className="text-foreground text-xs font-mono truncate">{u}</span>
                    </div>
                  ))}
                  {(sr?.successfulUrls.length ?? 0) === 0 && (
                    <p className="text-muted-foreground/70 text-xs">No pages scraped successfully</p>
                  )}
                </CardContent>
              </Card>

              {(sr?.failedUrls.length ?? 0) > 0 && (
                <Card className="bg-card border-border">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm text-foreground">Failed / Thin Pages ({sr?.failedUrls.length ?? 0})</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    {sr?.failedUrls.map((u) => {
                      const page = sr.pages.find((p) => p.url === u)
                      return (
                        <div key={u} className="flex items-start gap-2 py-0.5">
                          <span className="w-2 h-2 rounded-full bg-destructive flex-shrink-0 mt-1" />
                          <div>
                            <span className="text-muted-foreground text-xs font-mono">{u}</span>
                            {page?.error && <p className="text-muted-foreground/70 text-xs">{page.error}</p>}
                          </div>
                        </div>
                      )
                    })}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ── Content Viewer ────────────────────────────── */}
            <TabsContent value="content" className="mt-4 space-y-4">
              {successfulPages.length === 0 ? (
                <EmptyState message="No pages with content to display" />
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      disabled={activePageIdx === 0}
                      onClick={() => setActivePageIdx((i) => Math.max(0, i - 1))}
                      aria-label="Previous page"
                      className="text-xs px-2 py-1 rounded bg-card border border-border-strong text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      ← Prev
                    </button>
                    {successfulPages.map((p, i) => (
                      <button
                        key={p.url}
                        onClick={() => setActivePageIdx(i)}
                        className={`text-xs px-2 py-1 rounded font-mono transition-colors ${i === activePageIdx ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
                      >
                        {new URL(p.url).pathname || '/'}
                      </button>
                    ))}
                    <button
                      disabled={activePageIdx === successfulPages.length - 1}
                      onClick={() => setActivePageIdx((i) => Math.min(successfulPages.length - 1, i + 1))}
                      aria-label="Next page"
                      className="text-xs px-2 py-1 rounded bg-card border border-border-strong text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      Next →
                    </button>
                    <span className="text-muted-foreground/70 text-xs ml-auto">
                      {activePage?.charCount.toLocaleString()} chars
                    </span>
                  </div>

                  {activePage && (
                    <Card className="bg-card border-border">
                      <CardHeader className="pb-2 pt-3 px-4">
                        <CardTitle className="text-xs font-mono text-muted-foreground truncate">{activePage.url}</CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <pre className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed max-h-[600px] overflow-y-auto">
                          {activePage.markdown}
                        </pre>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </TabsContent>

            {/* ── Analysis ──────────────────────────────────── */}
            <TabsContent value="analysis" className="mt-4">
              {hasAnalysis ? (
                <AnalysisViewer data={result.analysisResult!} extractorResult={result.extractorResult} />
              ) : result.parseError ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-6 text-center">
                  <p className="text-destructive text-sm font-medium">AI responded but output was not valid JSON</p>
                  <p className="text-destructive/80 text-xs mt-2 font-mono max-w-xl mx-auto">{result.parseError}</p>
                  <p className="text-muted-foreground text-xs mt-3">Check Debug tab → Raw AI Response.</p>
                </div>
              ) : (
                <EmptyState message="Run 'Test Analysis' or 'Full Pipeline' to see AI output here." />
              )}
            </TabsContent>

            {/* ── Debug ─────────────────────────────────────── */}
            <TabsContent value="intelligence" className="mt-4">
              <IntelligencePanel result={result} />
            </TabsContent>

            <TabsContent value="debug" className="mt-4">
              <DebugPanel result={result} expandedSection={expandedSection} setExpandedSection={setExpandedSection} />
            </TabsContent>

            {/* ── Comparison ────────────────────────────────── */}
            <TabsContent value="sources" className="mt-4">
              <SourcesPanel result={result} />
            </TabsContent>

            <TabsContent value="comparison" className="mt-4">
              <ComparisonPanel a={compareA} b={compareB} />
            </TabsContent>
          </Tabs>
            </div>
          </details>

          {/* ── Hero: the SDR research brief ─────────────────── */}
          {hasAnalysis && <ResearchCard result={result} />}

          {/* ── Summary strip ──────────────────────────────── */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
            <StatCard label="Total time" value={`${((result.executionTimeMs ?? 0) / 1000).toFixed(1)}s`} />
            <StatCard label="Pages scraped" value={String(sr?.successfulUrls.length ?? 0)} />
            <StatCard label="Pages failed" value={String(sr?.failedUrls.length ?? 0)} dim />
            <StatCard label="Content sent" value={`${((result.contentCharsUsed ?? sr?.totalCharCount ?? 0) / 1000).toFixed(1)}k`} />
            <StatCard label="Quality" value={`${result.quality?.score ?? 0}/100`} />
            <StatCard label="Mode" value={result.mode ?? mode} />
            <StatCard
              label="Scrape"
              value={result.scrapeSource === 'cache' ? '✓ Cached' : '↻ Fresh'}
              highlight={result.scrapeSource === 'cache'}
            />
          </div>

          {/* Scrape source detail */}
          {result.scrapeSource === 'cache' && result.cachedAt && (
            <div className="flex items-center gap-1.5 text-xs text-signal-strong">
              <span>✓ Used cached scrape from {timeAgo(result.cachedAt)}</span>
            </div>
          )}
        </>
      )}

      {/* ── Empty state (no run yet) ─────────────────────────── */}
      {!result && !running && (
        <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">Enter a company URL and click a button to begin.</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Click <strong className="text-foreground">Analyze</strong> to scrape and run AI analysis. Use <strong className="text-foreground">Re-Scrape</strong> to refresh the website content before re-analyzing.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Stat / Timing helpers ─────────────────────────────────────

function StatCard({ label, value, dim = false, highlight = false }: { label: string; value: string; dim?: boolean; highlight?: boolean }) {
  return (
    <div className={cn('rounded-lg border px-3 py-2.5', highlight ? 'border-signal-strong/30 bg-signal-strong/10' : 'border-border bg-card')}>
      <p className="mb-0.5 text-xs text-muted-foreground">{label}</p>
      <p className={cn('font-mono text-sm font-medium', highlight ? 'text-signal-strong' : dim ? 'text-muted-foreground' : 'text-foreground')}>{value}</p>
    </div>
  )
}

function TimingRow({ label, ms }: { label: string; ms?: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xs text-foreground/80">{ms !== undefined ? `${(ms / 1000).toFixed(2)}s` : 'N/A'}</span>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 px-6 py-12 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

// ── Analysis Viewer ───────────────────────────────────────────
// Mirrored by buildAnalysisAppendix (lib/export/brief-html.ts), which
// independently re-extracts these same analysisResult fields for the
// downloaded brief. Keep both in sync when sections change here.

function AnalysisViewer({ data, extractorResult }: {
  data: Record<string, unknown>
  extractorResult?: RunResult['extractorResult']
}) {
  const [showBreakdown, setShowBreakdown] = useState<'fit' | 'opp' | null>(null)
  const [showEvidence, setShowEvidence] = useState(false)

  // Route non-empty display text through humanizeText so AI-ism dashes/filler
  // are stripped everywhere in this viewer; keep '—' as the empty placeholder.
  const s = (val: unknown) => (val != null && val !== '' ? humanizeText(val) : 'N/A')
  // Verbatim source quotes must never be humanized — keep them exactly as
  // scraped, same rule brief-html.ts's export appendix already follows.
  const raw = (val: unknown) => (val == null ? '' : String(val))
  const n = (val: unknown): number => (typeof val === 'number' ? val : 0)

  const score    = getCompanyFit(data)
  const opp      = getAutomationOpportunity(data)
  const whyNow   = getWhyNow(data)
  const signals  = getSignals(data)
  const opps     = getOpportunities(data)
  const painPts  = getPainPointsStructured(data)
  const chains   = getReasoningChains(data)
  const warnings = Array.isArray(data.validation_warnings) ? (data.validation_warnings as string[]) : []
  const contentFlags = Array.isArray(data.content_quality_flags) ? (data.content_quality_flags as string[]) : []
  const outreachIntel = getOutreachIntelligence(data)
  const bma = getBusinessModelAnalysis(data)
  const businessModelType = data.business_model_type as string | undefined
  const signalClusters = getSignalClusters(data)
  const strategicChallenges = getStrategicChallenges(data)
  const executiveBrief = getExecutiveBrief(data)
  const deterministicOpps = getDeterministicOpportunities(data)

  return (
    <div className="space-y-4">

      {/* Content quality flags */}
      {contentFlags.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 space-y-1">
          <p className="text-destructive text-xs font-medium mb-1">⚠ Content Quality Issues, Analysis may be limited</p>
          {contentFlags.map((f, i) => (
            <p key={i} className="text-destructive text-xs font-mono">{f}</p>
          ))}
        </div>
      )}

      {/* Validation warnings */}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-signal-medium/40 bg-signal-medium/10 px-4 py-3 space-y-1">
          <p className="text-signal-medium text-xs font-medium mb-1">⚠ Validation Notes</p>
          {warnings.map((w, i) => (
            <p key={i} className="text-signal-medium text-xs">{w}</p>
          ))}
        </div>
      )}

      {/* Executive Brief */}
      {executiveBrief && (executiveBrief.what_to_sell || (executiveBrief.what_we_observed && executiveBrief.what_we_observed.length > 0)) && (
        <Card className="bg-card border-primary/30 shadow-lg shadow-primary/10">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-primary font-semibold tracking-wide">Executive Brief</CardTitle>
              {executiveBrief.overall_confidence && (
                <Badge className={`text-[10px] ${
                  executiveBrief.overall_confidence === 'high'   ? 'bg-signal-strong/15 text-signal-strong border-signal-strong/40' :
                  executiveBrief.overall_confidence === 'medium' ? 'bg-signal-medium/15 text-signal-medium border-signal-medium/40' :
                                                                   'bg-muted text-muted-foreground border-border-strong'
                }`}>{executiveBrief.overall_confidence} confidence</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {executiveBrief.what_we_observed && executiveBrief.what_we_observed.length > 0 && (
                <div>
                  <p className="text-[10px] text-signal-strong uppercase tracking-wide mb-1.5 font-medium">What we observed</p>
                  <ul className="space-y-1">
                    {executiveBrief.what_we_observed.map((obs, i) => (
                      <li key={i} className="flex gap-2 text-xs text-foreground">
                        <span className="text-signal-strong mt-0.5 flex-shrink-0">●</span>
                        <span>{humanizeText(obs)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {executiveBrief.what_it_means && executiveBrief.what_it_means.length > 0 && (
                <div>
                  <p className="text-[10px] text-signal-medium uppercase tracking-wide mb-1.5 font-medium">What it means</p>
                  <ul className="space-y-1">
                    {executiveBrief.what_it_means.map((imp, i) => (
                      <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                        <span className="text-signal-medium mt-0.5 flex-shrink-0">→</span>
                        <span>{humanizeText(imp)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-border">
              {executiveBrief.what_to_sell && (
                <div>
                  <p className="text-[10px] text-primary uppercase tracking-wide mb-1">What to sell</p>
                  <p className="text-primary text-xs font-medium">{humanizeText(executiveBrief.what_to_sell)}</p>
                </div>
              )}
              {executiveBrief.why_now && (
                <div>
                  <p className="text-[10px] text-signal-medium uppercase tracking-wide mb-1">Why now</p>
                  <p className="text-signal-medium text-xs">{humanizeText(executiveBrief.why_now)}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Row 1: Overview + Scores */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Company Overview */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-foreground">Company Overview</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {[
              ['Company', data.company_name],
              ['Industry', data.industry],
              ['Sub-industry', data.sub_industry],
              ['Type', data.company_type],
              ['Size', data.company_size_estimate],
              ['HQ', data.headquarters_location],
            ].map(([label, value]) => value && value !== '' && value !== 'Not stated' && value !== 'Not determinable from available content' ? (
              <div key={String(label)}>
                <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">{String(label)}</p>
                <p className="text-white text-sm">{s(value)}</p>
              </div>
            ) : null)}
            <div>
              <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Summary</p>
              <p className="text-foreground text-sm leading-relaxed">{s(data.company_summary)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Scores */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-foreground">Scores</CardTitle>
              <Badge className={
                data.confidence_level === 'high' ? 'bg-signal-strong/15 text-signal-strong text-[10px]'
                : data.confidence_level === 'medium' ? 'bg-signal-medium/15 text-signal-medium text-[10px]'
                : 'bg-signal-weak/15 text-signal-weak text-[10px]'
              }>
                {s(data.confidence_level)} confidence
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            {score && (
              <ScoreRow
                label="Company Fit"
                value={n(score.value)}
                label2={`${n(score.value)}, ${score.label}`}
                note={score.rationale}
                breakdown={score.breakdown}
                expandId="fit"
                expanded={showBreakdown === 'fit'}
                onToggle={() => setShowBreakdown(showBreakdown === 'fit' ? null : 'fit')}
                factorSourceMap={extractorResult?.factorSourceMap}
              />
            )}
            {opp && (
              <ScoreRow
                label="Automation Opportunity"
                value={n(opp.value)}
                label2={`${n(opp.value)}, ${opp.label}`}
                breakdown={opp.breakdown}
                expandId="opp"
                expanded={showBreakdown === 'opp'}
                onToggle={() => setShowBreakdown(showBreakdown === 'opp' ? null : 'opp')}
                factorSourceMap={extractorResult?.factorSourceMap}
              />
            )}
            {whyNow && (
              <ScoreRow
                label="Why Now"
                value={n(whyNow.score) * 10}
                label2={`${whyNow.score}/10, ${whyNow.urgency_label ?? ''}`}
                note={s(whyNow.explanation)}
              />
            )}
            <Separator className="bg-muted" />
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Outreach Priority</span>
              <span className="text-sm font-mono text-signal-strong font-bold">
                {typeof data.outreach_priority_score === 'number'
                  ? Math.round(data.outreach_priority_score)
                  : 'N/A'}/100
                {Boolean(data.outreach_priority_label) && (
                  <span className="text-xs font-normal text-muted-foreground ml-1.5">({s(data.outreach_priority_label)})</span>
                )}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Business Model Analysis */}
      {bma && bma.model_type && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-foreground">Business Model Analysis</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {bma.model_type && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Model Type</p>
                  <p className="text-foreground text-xs font-medium">{bma.model_type}</p>
                </div>
              )}
              {bma.value_chain_position && (
                <div className="sm:col-span-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Value Chain Position</p>
                  <p className="text-foreground text-xs">{bma.value_chain_position}</p>
                </div>
              )}
            </div>
            {bma.core_operational_activities && bma.core_operational_activities.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Core Internal Activities</p>
                <div className="flex flex-wrap gap-1.5">
                  {bma.core_operational_activities.map((a, i) => (
                    <span key={i} className="text-[10px] bg-muted text-foreground px-2 py-0.5 rounded">{a}</span>
                  ))}
                </div>
              </div>
            )}
            {bma.strategic_pressures && bma.strategic_pressures.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Strategic Pressures</p>
                <div className="space-y-1">
                  {bma.strategic_pressures.map((p, i) => (
                    <p key={i} className="text-muted-foreground text-xs">• {p}</p>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Signal Clusters (code-computed) */}
      {signalClusters.length > 0 ? (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-foreground">Signal Clusters</CardTitle>
              {businessModelType ? (
                <Badge className="bg-muted text-muted-foreground border-border-strong text-[10px]">{businessModelType}</Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {signalClusters.map((cluster) => (
                <div key={cluster.id} className={`rounded-md border px-3 py-2.5 space-y-1.5 ${
                  cluster.confidence === 'high'   ? 'border-signal-strong/40 bg-signal-strong/10' :
                  cluster.confidence === 'medium' ? 'border-signal-medium/40 bg-signal-medium/10' :
                                                    'border-border-strong/50 bg-muted/30'
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-foreground">{cluster.theme}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                      cluster.confidence === 'high'   ? 'bg-signal-strong/15 text-signal-strong' :
                      cluster.confidence === 'medium' ? 'bg-signal-medium/15 text-signal-medium' :
                                                        'bg-muted text-muted-foreground'
                    }`}>{cluster.confidence} · T{cluster.tier}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{cluster.description}</p>
                  {cluster.signals_present.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {cluster.signals_present.map((s, i) => (
                        <span key={i} className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-mono">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Strategic Challenges */}
      {strategicChallenges.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-foreground">Strategic Challenges</CardTitle>
            <p className="text-[10px] text-muted-foreground">Business-model-specific challenges that Demaze can address</p>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-2">
              {strategicChallenges.slice(0, 6).map((challenge) => (
                <div key={challenge.id} className="flex items-start gap-3 rounded-md bg-muted/40 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-medium text-foreground">{challenge.title}</p>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                        challenge.priority === 'critical' ? 'bg-destructive/15 text-destructive' :
                        challenge.priority === 'high'     ? 'bg-signal-medium/15 text-signal-medium' :
                                                            'bg-muted text-muted-foreground'
                      }`}>{challenge.priority}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{challenge.description}</p>
                  </div>
                  <span className="text-[10px] text-primary bg-primary/10 border border-primary/30 px-2 py-0.5 rounded whitespace-nowrap flex-shrink-0">{challenge.service}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deterministic Opportunities */}
      {deterministicOpps.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-foreground">Opportunity Engine Output</CardTitle>
            <p className="text-[10px] text-muted-foreground">Code-determined opportunities based on signal clusters</p>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {deterministicOpps.map((opp) => (
              <div key={opp.id} className="rounded-md border border-border-strong/50 bg-muted/30 px-3 py-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs font-medium text-foreground">{opp.title}</p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono text-muted-foreground">P{opp.priority}</span>
                    <Badge className={`text-[10px] ${
                      opp.relevance === 'High'   ? 'bg-signal-strong/15 text-signal-strong border-signal-strong/40' :
                      opp.relevance === 'Medium' ? 'bg-signal-medium/15 text-signal-medium border-signal-medium/40' :
                                                   'bg-muted text-muted-foreground border-border-strong'
                    }`}>{opp.relevance}</Badge>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">{opp.strategic_challenge}</p>
                <p className="text-[10px] text-muted-foreground font-mono">→ {opp.entry_point}</p>
                {/* Score source, which clusters triggered this opportunity */}
                {opp.triggered_by_clusters && opp.triggered_by_clusters.length > 0 && (
                  <p className="text-[9px] text-muted-foreground/70 pt-0.5">
                    triggered by:{' '}
                    {opp.triggered_by_clusters.map((c: { name: string; confidence: string }, i: number) => (
                      <span key={i}>
                        {i > 0 && ', '}
                        <span className="text-muted-foreground">{c.name}</span>
                        <span className="text-muted-foreground/70"> ({c.confidence})</span>
                      </span>
                    ))}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <MaybeWhyDemaze data={data} />

      {/* Outreach Intelligence */}
      {outreachIntel && outreachIntel.conversation_angle && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-foreground">Outreach Intelligence</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            <div className="rounded-md bg-primary/10 border border-primary/30 px-4 py-3">
              <p className="text-[10px] text-primary uppercase tracking-wide mb-1.5">Opening angle (use verbatim)</p>
              <p className="text-foreground text-sm leading-relaxed italic">
                &ldquo;{outreachIntel.conversation_angle}&rdquo;
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {outreachIntel.why_contact && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Trigger</p>
                  <p className="text-foreground text-xs">{outreachIntel.why_contact}</p>
                </div>
              )}
              {outreachIntel.likely_problem && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Problem to address</p>
                  <p className="text-foreground text-xs">{outreachIntel.likely_problem}</p>
                </div>
              )}
              {outreachIntel.recommended_service && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Lead with</p>
                  <p className="text-foreground text-xs">{outreachIntel.recommended_service}</p>
                </div>
              )}
            </div>
            {outreachIntel.why_now && (
              <div className="rounded-md bg-muted/40 px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Why contact now?</p>
                <p className="text-muted-foreground text-xs">{outreachIntel.why_now}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Fallback outreach angle if no structured intel */}
      {(!outreachIntel?.conversation_angle) && Boolean(data.outreach_angle) && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-foreground">Outreach Recommendation</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <p className="text-foreground text-sm leading-relaxed">{s(data.outreach_angle)}</p>
          </CardContent>
        </Card>
      )}

      {/* Pain Points (structured) */}
      {painPts.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-foreground">Pain Points ({painPts.length})</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {painPts.map((pp, i) => (
              <div key={i} className="rounded-md bg-muted/60 px-3 py-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <ConfidenceBadge confidence={s(pp.confidence)} />
                  <span className="text-foreground text-xs font-medium">{s(pp.title)}</span>
                </div>
                {Boolean(pp.reasoning) && (
                  <p className="text-muted-foreground text-xs leading-relaxed">{s(pp.reasoning)}</p>
                )}
                {Boolean(pp.evidence) && (
                  <p className="text-muted-foreground/70 text-xs italic border-l-2 border-border-strong pl-2">&ldquo;{raw(pp.evidence)}&rdquo;</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Reasoning Chains */}
      {chains.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-foreground">Reasoning Chains</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {chains.map((chain, i) => (
              <div key={i} className="rounded-md bg-muted/40 border border-border-strong/50 p-3 space-y-2">
                <div className="flex flex-col gap-1.5 text-xs">
                  <ChainStep icon="⚡" label="Signal" value={s(chain.signal)} color="text-primary" />
                  <ChainStep icon="→" label="Implication" value={s(chain.business_implication)} color="text-muted-foreground" />
                  <ChainStep icon="⚠" label="Pain Point" value={s(chain.pain_point)} color="text-signal-medium" />
                  <ChainStep icon="✓" label="Opportunity" value={s(chain.opportunity)} color="text-signal-strong" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Signals */}
      {signals.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-foreground">Signals ({signals.length})</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {signals.map((sig, i) => (
              <div key={i} className="rounded-md bg-muted/60 px-3 py-2 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="text-[10px] bg-muted text-foreground">{s(sig.category)}</Badge>
                  <Badge className={`text-[10px] ${sig.strength === 'strong' ? 'bg-signal-strong/15 text-signal-strong' : sig.strength === 'moderate' ? 'bg-signal-medium/15 text-signal-medium' : 'bg-muted text-muted-foreground'}`}>
                    {s(sig.strength)}
                  </Badge>
                  <span className="text-foreground text-xs font-medium">{s(sig.type)}</span>
                </div>
                <p className="text-muted-foreground/70 text-xs italic">&ldquo;{raw(sig.evidence)}&rdquo;</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* AI Opportunities */}
      {opps.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-foreground">AI Opportunities ({opps.length})</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {opps.map((o, i) => {
              const oppConf = s(o.opportunity_confidence)
              const claimType = s(o.claim_type)
              const demazefit = s(o.demaze_fit_score)
              return (
              <div key={i} className="rounded-md border border-border-strong/60 bg-muted/40 px-3 py-3 space-y-2">
                {/* Header row */}
                <div className="flex items-start gap-2 flex-wrap">
                  {/* Opportunity confidence badge */}
                  {oppConf && (
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                      oppConf === 'very_high'   ? 'bg-signal-strong/15 text-signal-strong border border-signal-strong/40' :
                      oppConf === 'high'        ? 'bg-primary/10 text-primary border border-primary/30' :
                      oppConf === 'medium'      ? 'bg-signal-medium/15 text-signal-medium border border-signal-medium/40' :
                      oppConf === 'exploratory' ? 'bg-muted text-muted-foreground border border-border-strong' :
                                                  'bg-muted text-muted-foreground'
                    }`}>
                      {oppConf === 'very_high' ? 'Very High' : oppConf === 'exploratory' ? 'Exploratory' : oppConf.charAt(0).toUpperCase() + oppConf.slice(1)}
                    </span>
                  )}
                  {/* Claim type badge */}
                  {claimType && (
                    <span className={`text-[9px] px-2 py-0.5 rounded-full border flex-shrink-0 ${
                      claimType === 'observed' ? 'bg-signal-strong/15 text-signal-strong border-signal-strong/40' :
                                                 'bg-signal-medium/15 text-signal-medium border-signal-medium/40'
                    }`}>
                      {claimType === 'observed' ? 'Observed' : 'Inferred'}
                    </span>
                  )}
                  {/* Demaze fit */}
                  {demazefit && (
                    <span className={`text-[9px] px-2 py-0.5 rounded border flex-shrink-0 ${
                      demazefit === 'high'   ? 'bg-signal-strong/15 text-signal-strong border-signal-strong/40' :
                      demazefit === 'medium' ? 'bg-muted text-muted-foreground border-border-strong' :
                                              'bg-signal-weak/15 text-signal-weak border-signal-weak/40'
                    }`}>Demaze fit: {demazefit}</span>
                  )}
                  <span className="text-foreground text-xs font-medium leading-snug">{s(o.title)}</span>
                </div>

                {/* Description */}
                <p className="text-muted-foreground text-xs leading-relaxed">{s(o.description)}</p>

                {/* Reasoning chain: observed → inferred → opportunity */}
                {(Boolean(o.observed_basis) || Boolean(o.inferred_from)) && (
                  <div className="space-y-1 border-l-2 border-border-strong pl-3 mt-1">
                    {Boolean(o.observed_basis) && (
                      <div>
                        <span className="text-[9px] text-signal-strong uppercase tracking-wide">Observed </span>
                        <span className="text-[11px] text-muted-foreground">{s(o.observed_basis)}</span>
                      </div>
                    )}
                    {Boolean(o.inferred_from) && (
                      <div>
                        <span className="text-[9px] text-signal-medium uppercase tracking-wide">Inferred from </span>
                        <span className="text-[11px] text-muted-foreground">{s(o.inferred_from)}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Supporting evidence quote */}
                {Boolean(o.evidence) && (
                  <p className="text-muted-foreground/70 text-[11px] italic border-l-2 border-border-strong pl-2">&ldquo;{raw(o.evidence)}&rdquo;</p>
                )}

                {/* Impact + entry point */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                  {Boolean(o.expected_impact) && (
                    <p className="text-signal-strong text-[11px]">Impact: {s(o.expected_impact)}</p>
                  )}
                  {Boolean(o.entry_point) && (
                    <p className="text-muted-foreground/70 text-[11px]">Entry: {s(o.entry_point)}</p>
                  )}
                </div>
              </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Evidence Bank, extractor signals with full evidence traces */}
      {extractorResult && extractorResult.signals.length > 0 && (() => {
        // Flatten all evidence items with their parent signal context
        const allEvidence = extractorResult.signals.flatMap(sig =>
          sig.evidence.map((ev, evIdx) => ({ ...ev, sigType: sig.type, sigStrength: sig.strength, sigValidated: sig.validated, evIdx }))
        )
        const totalEvidence = allEvidence.length
        return (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <button
              onClick={() => setShowEvidence((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">Evidence Bank</span>
                <span className="text-[10px] bg-muted border border-border-strong text-muted-foreground px-2 py-0.5 rounded-full">
                  {extractorResult.signals.length} signals · {totalEvidence} quotes
                </span>
                {extractorResult.companySubjectCount > 0 && (
                  <span className="text-[10px] bg-signal-strong/15 border border-signal-strong/40 text-signal-strong px-2 py-0.5 rounded-full">
                    {extractorResult.companySubjectCount} company-subject
                  </span>
                )}
              </div>
              <span className="text-muted-foreground/70 text-xs">{showEvidence ? '▲ collapse' : '▼ expand'}</span>
            </button>
            {showEvidence && (
              <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
                {extractorResult.signals.map((sig, sIdx) => (
                  <div key={sIdx} className="space-y-1.5">
                    {/* Signal header */}
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[11px] font-semibold text-foreground font-mono">{sig.type}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                        sig.strength === 'strong'   ? 'bg-signal-strong/15 text-signal-strong border-signal-strong/40' :
                        sig.strength === 'moderate' ? 'bg-signal-medium/15 text-signal-medium border-signal-medium/40' :
                                                      'bg-muted text-muted-foreground border-border-strong'
                      }`}>{sig.strength}</span>
                      {sig.validated && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">validated</span>
                      )}
                      {!sig.is_company_subject && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-card text-muted-foreground/70 border border-border-strong">not company-subject</span>
                      )}
                    </div>
                    {/* Evidence items */}
                    {sig.evidence.map((ev, eIdx) => (
                      <div key={eIdx} className="rounded-md bg-muted/40 border border-border-strong/40 px-3 py-2 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[9px] font-mono text-muted-foreground/70">{ev.id}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                            ev.evidence_strength === 'very_high' ? 'text-signal-strong bg-signal-strong/15' :
                            ev.evidence_strength === 'high'      ? 'text-primary bg-primary/10' :
                            ev.evidence_strength === 'medium'    ? 'text-muted-foreground bg-muted' :
                                                                   'text-muted-foreground/70 bg-card'
                          }`}>{ev.evidence_strength.replace('_', ' ')}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                            ev.source_tier === 'tier1' ? 'bg-primary/10 text-primary border-primary/30' :
                            ev.source_tier === 'tier2' ? 'bg-muted text-muted-foreground border-border-strong' :
                                                         'bg-card text-muted-foreground/70 border-border-strong'
                          }`}>{ev.source_tier}</span>
                          <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{ev.page_type}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                            ev.subject === 'company_operations' ? 'bg-chart-2/15 text-chart-2 border-chart-2/40' :
                            ev.subject === 'company_strategy'   ? 'bg-chart-5/15 text-chart-5 border-chart-5/40' :
                            ev.subject === 'internal_technology' ? 'bg-chart-1/15 text-chart-1 border-chart-1/40' :
                                                                   'bg-card text-muted-foreground/70 border-border-strong'
                          }`}>{ev.subject.replace(/_/g, ' ')}</span>
                        </div>
                        <p className="text-muted-foreground text-xs italic leading-relaxed">&ldquo;{ev.quote}&rdquo;</p>
                        {ev.source_url && (
                          <p className="text-muted-foreground/70 text-[10px] truncate">{ev.source_url}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

type WhyDemazeReason = string | {
  signal?: string; evidence?: string; evidence_tier?: string;
  business_implication?: string; strategic_challenge?: string;
  recommended_service?: string; confidence?: string
}

function MaybeWhyDemaze({ data }: { data: Record<string, unknown> }): ReactElement | null {
  const wd = data.why_demaze as { reasons?: WhyDemazeReason[]; relevant_services?: string[]; summary?: string } | undefined
  return wd ? <WhyDemazeCard whyDemaze={wd} /> : null
}

function WhyDemazeCard({ whyDemaze }: { whyDemaze: { reasons?: WhyDemazeReason[]; relevant_services?: string[]; summary?: string } | undefined }): ReactNode {
  if (!whyDemaze || !whyDemaze.reasons?.length) return null
  const isV4 = whyDemaze.reasons.some(r => typeof r === 'object' && r !== null)
  return (
    <Card className="bg-card border-signal-strong/30">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm text-signal-strong">Why Demaze Should Contact This Company</CardTitle>
        {whyDemaze.summary && <p className="text-[11px] text-muted-foreground mt-1">{whyDemaze.summary}</p>}
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {isV4 ? (
          // v4: structured reasons
          <div className="space-y-3">
            {(whyDemaze.reasons ?? []).map((reason, i) => {
              if (typeof reason === 'string') {
                return (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-signal-strong text-xs mt-0.5 flex-shrink-0">→</span>
                    <p className="text-foreground text-sm">{humanizeText(reason)}</p>
                  </div>
                )
              }
              const r = reason as Exclude<WhyDemazeReason, string>
              return (
                <div key={i} className="rounded-md border border-signal-strong/30 bg-signal-strong/10 px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-xs font-medium text-signal-strong">{r.signal}</p>
                    <div className="flex items-center gap-1.5">
                      {r.confidence && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                          r.confidence === 'high'   ? 'bg-signal-strong/15 text-signal-strong' :
                          r.confidence === 'medium' ? 'bg-signal-medium/15 text-signal-medium' :
                                                      'bg-muted text-muted-foreground'
                        }`}>{r.confidence}</span>
                      )}
                      {r.evidence_tier && (
                        <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-mono">{r.evidence_tier}</span>
                      )}
                    </div>
                  </div>
                  {r.evidence && (
                    <p className="text-[11px] text-muted-foreground italic border-l-2 border-border-strong pl-2">
                      &ldquo;{r.evidence}&rdquo;
                    </p>
                  )}
                  {r.business_implication && (
                    <p className="text-[11px] text-foreground">{humanizeText(r.business_implication)}</p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    {r.recommended_service && (
                      <span className="text-[10px] bg-primary/15 text-primary border border-primary/30 px-2 py-0.5 rounded">{r.recommended_service}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          // v3: string array fallback
          <div className="space-y-2">
            {(whyDemaze.reasons ?? []).map((reason, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-signal-strong text-xs mt-0.5 flex-shrink-0">→</span>
                <p className="text-foreground text-sm">{humanizeText(reason)}</p>
              </div>
            ))}
          </div>
        )}
        {(whyDemaze.relevant_services?.length ?? 0) > 0 && (
          <div className="pt-2 border-t border-border">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Relevant Demaze Services</p>
            <div className="flex flex-wrap gap-1.5">
              {(whyDemaze.relevant_services ?? []).map((svc, i) => (
                <Badge key={i} className="bg-signal-strong/15 text-signal-strong border-signal-strong/40 text-xs">{svc}</Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ScoreRow({
  label, value, label2, note, breakdown, expanded, onToggle, factorSourceMap,
}: {
  label: string
  value: number
  label2?: string
  note?: string
  breakdown?: Array<{ factor: string; points: number; present: boolean }>
  expandId?: string
  expanded?: boolean
  onToggle?: () => void
  factorSourceMap?: Record<string, string[]>
}) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-mono text-white">{label2 ?? `${value}`}</span>
      </div>
      <Progress value={value} className="h-1.5" />
      {note && <p className="text-muted-foreground/70 text-xs mt-1">{note}</p>}
      {breakdown && breakdown.length > 0 && onToggle && (
        <button
          onClick={onToggle}
          className="text-[10px] text-muted-foreground/70 hover:text-muted-foreground transition-colors mt-1"
        >
          {expanded ? '▲ hide breakdown' : '▼ show breakdown'}
        </button>
      )}
      {expanded && breakdown && (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {breakdown.map((b) => {
            // Map breakdown factor label → DetectedFactors key (e.g. "Digital Transformation Initiative" → "digital_transformation")
            const factorKey = b.factor.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
            const sources = factorSourceMap?.[factorKey] ?? factorSourceMap?.[Object.keys(factorSourceMap ?? {}).find(k => b.factor.toLowerCase().includes(k.replace(/_/g, ' ').toLowerCase())) ?? '']
            return (
              <div key={b.factor}>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] ${b.present ? 'text-foreground' : 'text-muted-foreground/70'}`}>
                    {b.present ? '✓' : '○'} {b.factor}
                  </span>
                  <span className={`text-[10px] font-mono ${b.present && b.points > 0 ? 'text-signal-strong' : 'text-muted-foreground/70'}`}>
                    {b.points > 0 ? `+${b.points}` : b.points}
                  </span>
                </div>
                {b.present && sources && sources.length > 0 && (
                  <p className="text-[9px] text-muted-foreground/70 pl-3">← {sources.join(', ')}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


function ConfidenceBadge({ confidence }: { confidence: string }) {
  const cls =
    confidence === 'high'   ? 'bg-signal-strong/15 text-signal-strong border-signal-strong/40' :
    confidence === 'medium' ? 'bg-signal-medium/15 text-signal-medium border-signal-medium/40' :
                              'bg-muted text-muted-foreground border-border-strong'
  return <Badge className={`text-[10px] ${cls}`}>{confidence}</Badge>
}

function ChainStep({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  if (!value || value === 'N/A') return null
  return (
    <div className="flex items-start gap-2">
      <span className="w-4 text-center flex-shrink-0">{icon}</span>
      <span className="text-muted-foreground/70 w-20 flex-shrink-0">{label}</span>
      <span className={color}>{value}</span>
    </div>
  )
}



// ── Intelligence Report Panel ─────────────────────────────────

const CONF_COLOR: Record<string, string> = {
  very_high: 'text-primary bg-primary/10 border-primary/40',
  high: 'text-signal-strong bg-signal-strong/15 border-signal-strong/40',
  medium: 'text-signal-medium bg-signal-medium/15 border-signal-medium/40',
  low: 'text-muted-foreground bg-muted border-border-strong',
}

const PRI_COLOR: Record<string, string> = {
  critical: 'text-destructive bg-destructive/10 border-destructive/40',
  important: 'text-signal-medium bg-signal-medium/10 border-signal-medium/40',
  secondary: 'text-muted-foreground bg-muted border-border-strong',
}

const URG_COLOR: Record<string, string> = {
  immediate: 'text-destructive', near_term: 'text-signal-medium', emerging: 'text-signal-weak',
}

function QualityBar({ score, label, note }: { score: number; label: string; note: string }) {
  const bar = score >= 70 ? 'bg-signal-strong' : score >= 50 ? 'bg-signal-medium' : 'bg-destructive'
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground w-44 shrink-0">{label}</span>
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${bar}`} style={{ width: `${score}%` }} />
        </div>
        <span className="text-xs text-muted-foreground w-8 text-right font-mono">{score}</span>
      </div>
      <p className="text-[10px] text-muted-foreground/50 ml-[11.5rem] mt-0.5 truncate">{note}</p>
    </div>
  )
}

function IntelligencePanel({ result }: { result: RunResult | null }) {
  if (!result?.synthesisResult) return (
    <div className="rounded-lg border border-border bg-card px-4 py-8 text-center text-muted-foreground text-sm">
      Run an analysis to see the Intelligence Report.
    </div>
  )
  const s = result.synthesisResult
  const { intelligenceQuality: iq, strategicThemes, validatedSignals, whyNow } = s
  const tierColor: Record<string, string> = {
    A: 'text-signal-strong border-signal-strong/40 bg-signal-strong/10',
    B: 'text-signal-medium border-signal-medium/40 bg-signal-medium/10',
    C: 'text-signal-weak border-signal-weak/40 bg-signal-weak/10',
    D: 'text-destructive border-destructive/40 bg-destructive/10',
  }
  return (
    <div className="space-y-4">
      {/* Intelligence Quality */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm text-foreground">Intelligence Quality</CardTitle>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded border font-bold ${tierColor[iq.tier] ?? ''}`}>Tier {iq.tier}</span>
              <span className="text-sm font-bold text-foreground">{iq.overall}/100</span>
              <span className="text-xs text-muted-foreground">{iq.overall_label}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-1.5">
          {[iq.data_coverage, iq.evidence_strength, iq.validation_strength, iq.signal_confidence, iq.opportunity_confidence].map(d => (
            <QualityBar key={d.label} score={d.score} label={d.label} note={d.note} />
          ))}
        </CardContent>
      </Card>

      {/* Strategic Themes */}
      {strategicThemes.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">Strategic Themes</h3>
          <div className="space-y-3">
            {strategicThemes.map(theme => (
              <Card key={theme.id} className="bg-card border-border">
                <CardContent className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${PRI_COLOR[theme.priority] ?? ''}`}>{theme.priority.toUpperCase()}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${CONF_COLOR[theme.confidence] ?? ''}`}>{theme.confidence.replace('_', ' ')} confidence</span>
                      </div>
                      <p className="text-sm font-semibold text-foreground">{theme.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{humanizeText(theme.tagline)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold text-foreground">{theme.priorityScore}</div>
                      <div className="text-[10px] text-muted-foreground/70">priority</div>
                    </div>
                  </div>
                  <div className="border-t border-border pt-2 space-y-1">
                    <p className="text-xs text-muted-foreground"><span className="text-muted-foreground/70">Impact: </span>{humanizeText(theme.businessImpact)}</p>
                    <p className="text-xs text-primary"><span className="text-muted-foreground/70">Angle: </span>{humanizeText(theme.demazeAngle)}</p>
                  </div>
                  {theme.supportingEvidence.slice(0, 2).map((ev, i) => (
                    <div key={i} className="text-[10px] text-muted-foreground/70 mt-1 pl-2 border-l border-border-strong line-clamp-1">
                      <span className="text-muted-foreground/50">[{ev.source_label}] </span>{ev.quote}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Why Now */}
      {whyNow && (
        <Card className={`border ${whyNow.genericityFlag ? 'border-border-strong bg-card' : 'border-primary/30 bg-primary/10'}`}>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-foreground">Why Now</CardTitle>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${URG_COLOR[whyNow.urgency] ?? 'text-muted-foreground'}`}>{whyNow.urgency.replace('_', ' ').toUpperCase()}</span>
                <span className="text-xs text-muted-foreground/70 font-mono">{whyNow.urgencyScore}/100</span>
                {whyNow.genericityFlag && <span className="text-[10px] text-signal-medium border border-signal-medium/40 bg-signal-medium/10 px-1.5 py-0.5 rounded">limited evidence</span>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-sm text-foreground font-medium mb-2">{humanizeText(whyNow.headline)}</p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">{humanizeText(whyNow.narrative)}</p>
            <div className="space-y-1.5">
              {whyNow.triggers.slice(0, 3).map((t, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-muted-foreground/70 font-mono w-6 shrink-0">+{t.urgency_contribution}</span>
                  <div>
                    <span className="text-muted-foreground font-medium">{t.signal_type.replace(/_/g, ' ')}</span>
                    {t.evidence_quote && <span className="text-muted-foreground/70">, &ldquo;{t.evidence_quote.slice(0, 100)}&rdquo;</span>}
                    <span className="text-muted-foreground/50"> [{t.source_label}]</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Validated Signals */}
      {validatedSignals.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">Validated Signals</h3>
          <div className="space-y-2">
            {validatedSignals.slice(0, 8).map(sig => (
              <div key={sig.id} className="rounded-lg border border-border bg-card px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-foreground font-medium">{sig.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${CONF_COLOR[sig.confidenceLevel] ?? ''}`}>{sig.confidenceLevel.replace('_', ' ')}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/70 shrink-0">{sig.sourceCount} source{sig.sourceCount !== 1 ? 's' : ''}</span>
                </div>
                {sig.supportingEvidence[0]?.quote && (
                  <p className="text-[10px] text-muted-foreground/70 mt-1 line-clamp-1">&ldquo;{sig.supportingEvidence[0].quote}&rdquo;</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

// ── Sources Panel ─────────────────────────────────────────────

const SRC_TYPE_COLOR: Record<string, string> = {
  annual_report: 'bg-primary/10 text-primary border border-primary/30',
  investor_presentation: 'bg-primary/10 text-primary border border-primary/30',
  earnings_release: 'bg-chart-5/15 text-chart-5 border border-chart-5/40',
  press_release: 'bg-signal-strong/15 text-signal-strong border border-signal-strong/40',
  careers_page: 'bg-chart-3/15 text-chart-3 border border-chart-3/40',
  news_article: 'bg-muted text-muted-foreground border border-border-strong',
  sustainability_report: 'bg-chart-2/15 text-chart-2 border border-chart-2/40',
  other: 'bg-muted text-muted-foreground border border-border-strong',
}

const SRC_STR_COLOR: Record<string, string> = {
  very_high: 'text-primary', high: 'text-signal-strong',
  medium: 'text-signal-medium', low: 'text-muted-foreground',
}

function sLabel(t: string): string {
  const m: Record<string, string> = {
    annual_report: 'Annual Report', investor_presentation: 'Investor Presentation',
    earnings_release: 'Earnings Release', press_release: 'Press Release',
    careers_page: 'Careers Page', news_article: 'News Article',
    sustainability_report: 'Sustainability Report', corporate_website: 'Corporate Website',
    other: 'External Source',
  }
  return m[t] ?? t
}

function SourcesPanel({ result }: { result: RunResult | null }) {
  if (!result) return null
  const sources = result.sourcesUsed ?? []
  const fetched = sources.filter(s => s.should_fetch)
  const skipped = sources.filter(s => !s.should_fetch)
  return (
    <div className="space-y-3">
      {result.enrichmentMeta ? (
        <div className="rounded-lg border border-signal-strong/40 bg-signal-strong/10 px-4 py-3 flex items-start gap-3">
          <span className="text-signal-strong text-lg mt-0.5">🔍</span>
          <div className="flex-1">
            <p className="text-signal-strong text-sm font-semibold">External Intelligence Active</p>
            <p className="text-signal-strong/70 text-xs mt-0.5">
              {result.enrichmentMeta.sources_found} URLs discovered → {result.enrichmentMeta.sources_used} fetched → {result.enrichmentMeta.signals_extracted} signals extracted
              {result.recoveryTriggered && <span className="text-signal-medium"> · Recovery mode (thin content)</span>}
            </p>
          </div>
        </div>
      ) : result.recoveryTriggered ? (
        <div className="rounded-lg border border-signal-medium/40 bg-signal-medium/10 px-4 py-3 flex items-start gap-3">
          <span className="text-signal-medium text-lg mt-0.5">⚡</span>
          <div>
            <p className="text-signal-medium text-sm font-semibold">Evidence Recovery Triggered</p>
            <p className="text-signal-medium/70 text-xs mt-0.5">Content quality was below threshold, external source discovery was activated.</p>
          </div>
        </div>
      ) : null}
      {sources.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-4 py-8 text-center text-muted-foreground text-sm">
          No external sources discovered. Set TAVILY_API_KEY or SERPER_API_KEY to enable source discovery.
        </div>
      ) : (
        <>
          {fetched.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm text-foreground flex items-center gap-2">
                  <span className="text-signal-strong">✓</span> Sources Fetched
                  <span className="text-xs font-normal text-muted-foreground">({fetched.length} in LLM context)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {fetched.map(src => (
                  <div key={src.url} className="rounded-lg border border-border bg-background p-3">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-muted-foreground/70 text-xs font-mono">{src.fetch_order}.</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${SRC_TYPE_COLOR[src.source_type] ?? SRC_TYPE_COLOR.other}`}>{sLabel(src.source_type)}</span>
                      <span className={`text-[10px] font-medium ${SRC_STR_COLOR[src.evidence_strength] ?? 'text-muted-foreground'}`}>{src.evidence_strength.replace('_', ' ')} confidence</span>
                    </div>
                    <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:text-primary-hover font-mono truncate block">{src.url}</a>
                    {src.snippet && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{src.snippet}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {skipped.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <span className="text-muted-foreground/70">○</span> Discovered, Not Fetched
                  <span className="text-xs font-normal text-muted-foreground/70">({skipped.length} over budget)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {skipped.slice(0, 5).map(src => (
                  <div key={src.url} className="flex items-center gap-2 text-xs">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${SRC_TYPE_COLOR[src.source_type] ?? SRC_TYPE_COLOR.other}`}>{sLabel(src.source_type)}</span>
                    <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-muted-foreground font-mono truncate">{src.url}</a>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function DebugPanel({
  result,
  expandedSection,
  setExpandedSection,
}: {
  result: RunResult | null
  expandedSection: string | null
  setExpandedSection: (s: string | null) => void
}) {
  if (!result) return <EmptyState message="Run an analysis to see debug output." />
  const serviceEvidenceDebug = result.analysisResult ? getServiceEvidenceDebug(result.analysisResult) : undefined
  return (
    <div className="space-y-3">
      {/* Evidence & Opportunity Debug — added 2026-07-24. Answers "why did
          this run come back with 0 pain points / 0 opportunities" without
          needing a live re-run: shows exactly which of the 4 insufficientEvidence
          conditions fired, and the per-service evidence trail (including
          weak-tier matches that never made it into the final report). */}
      {serviceEvidenceDebug && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-foreground flex items-center gap-2">
              Evidence &amp; Opportunity Debug
              {serviceEvidenceDebug.insufficient_evidence?.fired && (
                <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600 dark:text-amber-400">
                  insufficient evidence fired
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground/70">
                Insufficient-evidence gate — all 4 must be true to suppress pain_points/opportunities:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(serviceEvidenceDebug.insufficient_evidence?.conditions ?? {}).map(([k, v]) => (
                  <Badge
                    key={k}
                    variant="outline"
                    className={cn(
                      'text-[10px] font-mono',
                      v ? 'border-amber-500/50 text-amber-600 dark:text-amber-400' : 'border-border text-muted-foreground/70'
                    )}
                  >
                    {k}: {String(v)}
                  </Badge>
                ))}
              </div>
            </div>

            {(serviceEvidenceDebug.services?.length ?? 0) > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground/70">Per-service evidence (includes weak-tier matches discarded from the final report):</p>
                {serviceEvidenceDebug.services!.map((s) => {
                  const id = `service-evidence-${s.service}`
                  const hasEvidence = (s.evidence?.length ?? 0) > 0
                  return (
                    <div key={s.service} className="rounded-lg border border-border bg-card overflow-hidden">
                      <button
                        onClick={() => hasEvidence && setExpandedSection(expandedSection === id ? null : id)}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2',
                          hasEvidence && 'hover:bg-muted/50 transition-colors'
                        )}
                        disabled={!hasEvidence}
                      >
                        <span className="text-xs text-foreground text-left">{s.service}</span>
                        <span className="flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px] font-mono',
                              s.threshold === 'strong' ? 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
                              : s.threshold === 'medium' ? 'border-blue-500/50 text-blue-600 dark:text-blue-400'
                              : s.threshold === 'weak' ? 'border-amber-500/50 text-amber-600 dark:text-amber-400'
                              : 'border-border text-muted-foreground/70'
                            )}
                          >
                            {s.threshold}
                          </Badge>
                          {s.surfaced ? (
                            <Badge variant="outline" className="text-[10px] border-emerald-500/50 text-emerald-600 dark:text-emerald-400">surfaced</Badge>
                          ) : s.disqualified ? (
                            <Badge variant="outline" className="text-[10px] border-red-500/50 text-red-600 dark:text-red-400" title={s.disqualifier_matched}>disqualified</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] border-border text-muted-foreground/70">not surfaced</Badge>
                          )}
                          {hasEvidence && (
                            <span className="text-muted-foreground/70 text-[10px]">{expandedSection === id ? '▲' : '▼'}</span>
                          )}
                        </span>
                      </button>
                      {expandedSection === id && hasEvidence && (
                        <div className="border-t border-border p-3 space-y-2">
                          {s.disqualifier_matched && (
                            <p className="text-[10px] text-red-600 dark:text-red-400 font-mono">disqualifier: {s.disqualifier_matched}</p>
                          )}
                          {s.evidence!.map((e, i) => (
                            <div key={i} className="text-[10px] font-mono text-muted-foreground border-l-2 border-border pl-2">
                              <span className="text-muted-foreground/70">[{e.pattern}]</span> {e.snippet}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* AI Meta */}
      {result.aiMeta && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-foreground">AI Metadata</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-1 font-mono text-xs">
            {[
              ['Provider', result.aiMeta.provider],
              ['Model', result.aiMeta.model],
              ['Tokens Used', String(result.aiMeta.tokensUsed)],
              ['Latency', `${result.aiMeta.latencyMs}ms`],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <span className="text-muted-foreground/70 w-28">{k}</span>
                <span className="text-foreground">{v}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Prompts */}
      {result.prompts && (
        <div className="space-y-2">
          {[
            { id: 'system', label: 'System Prompt', content: result.prompts.systemPrompt },
            { id: 'user', label: 'User Prompt', content: result.prompts.userPrompt },
          ].map(({ id, label, content }) => (
            <div key={id} className="rounded-lg border border-border bg-card overflow-hidden">
              <button
                onClick={() => setExpandedSection(expandedSection === id ? null : id)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-muted-foreground/70 text-xs">{expandedSection === id ? '▲ collapse' : '▼ expand'}</span>
              </button>
              {expandedSection === id && (
                <div className="border-t border-border p-4">
                  <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                    {content}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Raw AI response */}
      {result.aiMeta?.rawResponse && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <button
            onClick={() => setExpandedSection(expandedSection === 'raw' ? null : 'raw')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
          >
            <span className="text-sm text-muted-foreground">Raw AI Response</span>
            <span className="text-muted-foreground/70 text-xs">{expandedSection === 'raw' ? '▲ collapse' : '▼ expand'}</span>
          </button>
          {expandedSection === 'raw' && (
            <div className="border-t border-border p-4">
              <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                {result.aiMeta.rawResponse}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


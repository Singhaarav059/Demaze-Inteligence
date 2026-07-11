'use client'

// ============================================================
// Intelligence Lab — /admin/intelligence-lab
// ============================================================

import { useState, useCallback, type ReactNode, type ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import type { RunResult, Operation, AnalysisMode, ActiveTab } from './_types'
import { ComparisonPanel } from './ComparisonPanel'

// ── Types ─────────────────────────────────────────────────────

interface ScrapePageResult {
  url: string
  success: boolean
  markdown: string
  charCount: number
  error?: string
}

interface ScoredLink {
  url: string
  score: number
  tier: string
}

interface ScrapeResult {
  pages: ScrapePageResult[]
  combinedContent: string
  successfulUrls: string[]
  failedUrls: string[]
  totalCharCount: number
  wasTruncated: boolean
  discoveryMethod: string
  scrapedAt: string
  debug: {
    homepageLinksRaw: number
    homepageLinksSameDomain: number
    linkScores: ScoredLink[]
    urlsSelectedForScraping: string[]
    sitemapChecked: boolean
    sitemapUrlsFound: number
    warnings: string[]
    errors: string[]
  }
}

interface ScrapeCache {
  url: string             // the normalized URL this cache is for
  quality: { score: number; note: string }
  pagesScraped: number
  cachedAt: string        // ISO — when the scrape was saved
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
  const [mode, setMode] = useState<AnalysisMode>('lightweight')
  const [running, setRunning] = useState(false)
  const [activeOp, setActiveOp] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [activeTab, setActiveTab] = useState<ActiveTab>('research_card')
  const [activePageIdx, setActivePageIdx] = useState(0)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  // Scrape cache — survives between Test Scraper and Test Analysis in same session
  const [scrapeCache, setScrapeCache] = useState<ScrapeCache | null>(null)

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
        setActiveTab('research_card')
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
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Demaze Research Agent</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Enter a company URL → get a research brief for outbound outreach</p>
        </div>
        <a href="/admin/run-history" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
          View run history →
        </a>
      </div>

      {/* ── URL Input + Mode ───────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://company.com"
            className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-600 flex-1 font-mono text-sm"
            disabled={running}
            onKeyDown={(e) => e.key === 'Enter' && run('analysis')}
          />

          {/* Mode toggle */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded-md px-1">
            <button
              onClick={() => setMode('lightweight')}
              disabled={running}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${
                mode === 'lightweight'
                  ? 'bg-zinc-700 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              ⚡ Lightweight
              <span className="text-zinc-600 ml-1">3k</span>
            </button>
            <button
              onClick={() => setMode('full')}
              disabled={running}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${
                mode === 'full'
                  ? 'bg-zinc-700 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              🔬 Full
              <span className="text-zinc-600 ml-1">15k</span>
            </button>
          </div>
        </div>

        {/* ── Scrape Status ──────────────────────────────────── */}
        {cacheIsValidForUrl ? (
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-xs">
            <span className="text-emerald-400 font-medium">✓ Cached</span>
            <span className="text-zinc-400">
              {scrapeCache!.pagesScraped} pages · quality {scrapeCache!.quality.score}/100 · {timeAgo(scrapeCache!.cachedAt)}
            </span>
            <span className="text-zinc-600">Analyze will reuse this scrape.</span>
            <button
              onClick={async () => {
                const u = urlNormalized
                if (!u) return
                await fetch(`/api/admin/scrape-cache?url=${encodeURIComponent(u)}`, { method: 'DELETE' })
                setScrapeCache(null)
              }}
              className="ml-auto text-zinc-500 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded border border-zinc-700 hover:border-red-800"
              title="Delete cache — next Analyze will scrape fresh"
            >
              Clear cache
            </button>
          </div>
        ) : scrapeCache && scrapeCache.url !== urlNormalized ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-950/30 border border-yellow-800/40 text-xs">
            <span className="text-yellow-500">⚠ URL changed — no scrape for this site yet</span>
          </div>
        ) : null}

        {/* ── Action Buttons ─────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Analyze — uses cached scrape if available, scrapes fresh if not */}
          <Button
            onClick={() => run('analysis')}
            disabled={running || !url.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {running && (activeOp === 'analysis' || activeOp === 'pipeline')
              ? <><Spinner /> Analyzing…</>
              : cacheIsValidForUrl ? 'Analyze (cached scrape)' : 'Analyze'}
          </Button>

          {/* Scrape only — loads from cache if available, scrapes fresh if not */}
          <Button
            onClick={() => run('scraper')}
            disabled={running || !url.trim()}
            variant="outline"
            className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white"
          >
            {running && activeOp === 'scraper'
              ? <><Spinner /> Scraping…</>
              : cacheIsValidForUrl ? 'Scrape (cached)' : 'Scrape'}
          </Button>

          {/* Re-Scrape — always force fresh, bypasses + overwrites cache */}
          <Button
            onClick={() => run('rescrape')}
            disabled={running || !url.trim()}
            variant="outline"
            className="border-amber-800/60 bg-zinc-900 text-amber-400 hover:bg-amber-950/40 hover:text-amber-300"
          >
            {running && activeOp === 'rescrape'
              ? <><Spinner /> Re-scraping…</>
              : '↻ Re-Scrape (force fresh)'}
          </Button>
        </div>

        <p className="text-xs text-zinc-600">
          {mode === 'lightweight'
            ? '⚡ Lightweight: sends up to 3,000 chars to AI — faster, lower cost.'
            : '🔬 Full: sends up to 15,000 chars — thorough analysis, higher cost.'}
          {cacheIsValidForUrl
            ? ' Analyze and Scrape will reuse the cached scrape. Use Re-Scrape or Clear Cache to force a fresh scrape.'
            : ' No cache — will scrape fresh.'}
        </p>
      </div>

      {/* ── Running indicator ───────────────────────────────── */}
      {running && (
        <div className="rounded-lg border border-blue-800 bg-blue-950/40 px-4 py-3 flex items-center gap-3">
          <Spinner className="text-blue-400" />
          <span className="text-blue-300 text-sm">
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
        <div className="rounded-lg border border-yellow-800 bg-yellow-950/30 px-4 py-2 flex items-center justify-between">
          <p className="text-yellow-400 text-xs">
            ⚠ Failed to save run to history. Run migration 002_test_runs.sql in Supabase if you haven't.
          </p>
          <span className="text-yellow-600 text-xs">(non-blocking)</span>
        </div>
      )}
      {saveStatus === 'saved' && (
        <div className="text-xs text-zinc-600 text-right">✓ Saved to run history</div>
      )}

      {/* ── Error state ─────────────────────────────────────── */}
      {result && !result.success && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3">
          <p className="text-red-300 text-sm font-medium">Error</p>
          <p className="text-red-400 text-xs mt-1 font-mono">{result.error}</p>
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────── */}
      {result && result.success && (
        <>
          {result.parseError && (
            <div className="rounded-lg border border-orange-800 bg-orange-950/30 px-4 py-3">
              <p className="text-orange-300 text-sm font-medium">AI response received but failed to parse as JSON</p>
              <p className="text-orange-400 text-xs mt-1 font-mono">{result.parseError}</p>
            </div>
          )}

          {/* ── Summary strip ──────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
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
            <div className="text-xs text-emerald-600 flex items-center gap-1.5">
              <span>✓ Used cached scrape from {timeAgo(result.cachedAt)}</span>
            </div>
          )}

          {/* ── Comparison save ─────────────────────────────── */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-600">Save for comparison:</span>
            <button onClick={() => saveToCompare('A')} className="text-xs px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors">→ Slot A</button>
            <button onClick={() => saveToCompare('B')} className="text-xs px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors">→ Slot B</button>
            {(compareA || compareB) && (
              <button onClick={() => setActiveTab('comparison')} className="text-xs px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors">View comparison →</button>
            )}
          </div>

          {/* ── Tabs ──────────────────────────────────────────── */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)}>
            <TabsList className="bg-zinc-900 border border-zinc-800">
              {hasAnalysis && (
                <TabsTrigger value="research_card" className="data-[state=active]:bg-indigo-700 data-[state=active]:text-white text-zinc-400 text-xs font-medium">
                  Research Card ✦
                </TabsTrigger>
              )}
              <TabsTrigger value="scraper" className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400 text-xs">
                Scraper
              </TabsTrigger>
              <TabsTrigger value="content" className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400 text-xs">
                Content ({successfulPages.length})
              </TabsTrigger>
              <TabsTrigger value="analysis" className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400 text-xs">
                Analysis {hasAnalysis ? '✓' : result.parseError ? '⚠' : ''}
              </TabsTrigger>
              <TabsTrigger value="intelligence" className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400 text-xs">
                Intelligence{result?.synthesisResult ? ' ✦' : ''}
              </TabsTrigger>
              <TabsTrigger value="debug" className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400 text-xs">
                Debug
              </TabsTrigger>
              <TabsTrigger value="sources" className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400 text-xs">
                Sources{result?.enrichmentMeta ? ` (${result.enrichmentMeta.sources_used})` : result?.recoveryTriggered ? ' ⚡' : ''}
              </TabsTrigger>
              <TabsTrigger value="comparison" className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white text-zinc-400 text-xs">
                Compare {(compareA || compareB) ? '●' : ''}
              </TabsTrigger>
            </TabsList>

            {/* ── Scraper Results ──────────────────────────── */}
            <TabsContent value="scraper" className="mt-4 space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm text-zinc-300">Quality Assessment</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <Progress value={result.quality?.score ?? 0} className="flex-1 h-2" />
                      <span className="text-white font-mono text-sm w-12 text-right">{result.quality?.score ?? 0}/100</span>
                    </div>
                    <p className="text-zinc-400 text-xs">{result.quality?.note}</p>
                  </CardContent>
                </Card>

                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm text-zinc-300">Timing</CardTitle>
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
                      <div className="flex justify-between pt-1 border-t border-zinc-800">
                        <span className="text-zinc-500 text-xs">Tokens used</span>
                        <span className="text-zinc-300 text-xs font-mono">{result.aiMeta.tokensUsed?.toLocaleString()}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm text-zinc-300">Successful Pages ({sr?.successfulUrls.length ?? 0})</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-1">
                  {sr?.successfulUrls.map((u, i) => (
                    <div key={`${u}-${i}`} className="flex items-center gap-2 py-0.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                      <span className="text-zinc-300 text-xs font-mono truncate">{u}</span>
                    </div>
                  ))}
                  {(sr?.successfulUrls.length ?? 0) === 0 && (
                    <p className="text-zinc-600 text-xs">No pages scraped successfully</p>
                  )}
                </CardContent>
              </Card>

              {(sr?.failedUrls.length ?? 0) > 0 && (
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm text-zinc-300">Failed / Thin Pages ({sr?.failedUrls.length ?? 0})</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    {sr?.failedUrls.map((u) => {
                      const page = sr.pages.find((p) => p.url === u)
                      return (
                        <div key={u} className="flex items-start gap-2 py-0.5">
                          <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 mt-1" />
                          <div>
                            <span className="text-zinc-400 text-xs font-mono">{u}</span>
                            {page?.error && <p className="text-zinc-600 text-xs">{page.error}</p>}
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
                      className="text-xs px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
                    >
                      ← Prev
                    </button>
                    {successfulPages.map((p, i) => (
                      <button
                        key={p.url}
                        onClick={() => setActivePageIdx(i)}
                        className={`text-xs px-2 py-1 rounded font-mono transition-colors ${i === activePageIdx ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                      >
                        {new URL(p.url).pathname || '/'}
                      </button>
                    ))}
                    <button
                      disabled={activePageIdx === successfulPages.length - 1}
                      onClick={() => setActivePageIdx((i) => Math.min(successfulPages.length - 1, i + 1))}
                      className="text-xs px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
                    >
                      Next →
                    </button>
                    <span className="text-zinc-600 text-xs ml-auto">
                      {activePage?.charCount.toLocaleString()} chars
                    </span>
                  </div>

                  {activePage && (
                    <Card className="bg-zinc-900 border-zinc-800">
                      <CardHeader className="pb-2 pt-3 px-4">
                        <CardTitle className="text-xs font-mono text-zinc-500 truncate">{activePage.url}</CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed max-h-[600px] overflow-y-auto">
                          {activePage.markdown}
                        </pre>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </TabsContent>

            {/* ── Research Card ─────────────────────────────── */}
            <TabsContent value="research_card" className="mt-4">
              <ResearchCard result={result} />
            </TabsContent>

            {/* ── Analysis ──────────────────────────────────── */}
            <TabsContent value="analysis" className="mt-4">
              {hasAnalysis ? (
                <AnalysisViewer data={result.analysisResult!} extractorResult={result.extractorResult} />
              ) : result.parseError ? (
                <div className="rounded-lg border border-orange-800 bg-orange-950/20 px-4 py-6 text-center">
                  <p className="text-orange-300 text-sm font-medium">AI responded but output was not valid JSON</p>
                  <p className="text-orange-400 text-xs mt-2 font-mono max-w-xl mx-auto">{result.parseError}</p>
                  <p className="text-zinc-500 text-xs mt-3">Check Debug tab → Raw AI Response.</p>
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
        </>
      )}

      {/* ── Empty state (no run yet) ─────────────────────────── */}
      {!result && !running && (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-16 text-center">
          <p className="text-zinc-500 text-sm">Enter a company URL and click a button to begin.</p>
          <p className="text-zinc-600 text-xs mt-1">
            Click <strong className="text-zinc-500">Analyze</strong> to scrape and run AI analysis. Use <strong className="text-zinc-500">Re-Scrape</strong> to refresh the website content before re-analyzing.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin h-4 w-4 mr-1.5 ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ── Stat / Timing helpers ─────────────────────────────────────

function StatCard({ label, value, dim = false, highlight = false }: { label: string; value: string; dim?: boolean; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${highlight ? 'bg-emerald-950/30 border-emerald-800/50' : 'bg-zinc-900 border-zinc-800'}`}>
      <p className="text-xs text-zinc-500 mb-0.5">{label}</p>
      <p className={`text-sm font-mono font-medium ${highlight ? 'text-emerald-400' : dim ? 'text-zinc-500' : 'text-white'}`}>{value}</p>
    </div>
  )
}

function TimingRow({ label, ms }: { label: string; ms?: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-500 text-xs">{label}</span>
      <span className="text-zinc-300 text-xs font-mono">{ms !== undefined ? `${(ms / 1000).toFixed(2)}s` : '—'}</span>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-6 py-12 text-center">
      <p className="text-zinc-500 text-sm">{message}</p>
    </div>
  )
}

// ── Analysis Viewer ───────────────────────────────────────────

function AnalysisViewer({ data, extractorResult }: {
  data: Record<string, unknown>
  extractorResult?: RunResult['extractorResult']
}) {
  const [showBreakdown, setShowBreakdown] = useState<'fit' | 'opp' | null>(null)
  const [showEvidence, setShowEvidence] = useState(false)

  const s = (val: unknown) => (val != null && val !== '' ? String(val) : '—')
  const n = (val: unknown): number => (typeof val === 'number' ? val : 0)

  const score    = data.company_fit as { value?: number; label?: string; rationale?: string; breakdown?: Array<{factor: string; points: number; present: boolean}> } | undefined
  const opp      = data.automation_opportunity as { value?: number; label?: string; breakdown?: Array<{factor: string; points: number; present: boolean}> } | undefined
  const whyNow   = data.why_now as { explanation?: string; score?: number; urgency_label?: string } | undefined
  const signals  = Array.isArray(data.signals) ? (data.signals as Array<Record<string, unknown>>) : []
  const opps     = Array.isArray(data.opportunities) ? (data.opportunities as Array<Record<string, unknown>>) : []
  const evidence = Array.isArray(data.evidence) ? (data.evidence as Array<Record<string, unknown>>) : []
  const painPts  = Array.isArray(data.pain_points_structured) ? (data.pain_points_structured as Array<Record<string, unknown>>) : []
  const chains   = Array.isArray(data.reasoning_chains) ? (data.reasoning_chains as Array<Record<string, unknown>>) : []
  const contacts = Array.isArray(data.recommended_contacts) ? (data.recommended_contacts as Array<Record<string, unknown>>) : []
  const warnings = Array.isArray(data.validation_warnings) ? (data.validation_warnings as string[]) : []
  const contentFlags = Array.isArray(data.content_quality_flags) ? (data.content_quality_flags as string[]) : []
  const whyDemaze = data.why_demaze as {
    reasons?: Array<string | {
      signal?: string; evidence?: string; evidence_tier?: string;
      business_implication?: string; strategic_challenge?: string;
      recommended_service?: string; target_buyer?: string; confidence?: string
    }>;
    relevant_services?: string[];
    summary?: string;
  } | undefined
  const outreachIntel = data.outreach_intelligence as { trigger?: string; problem?: string; service?: string; opening_angle?: string; why_now?: string; target_contact?: string } | undefined
  const bma = data.business_model_analysis as { model_type?: string; value_chain_position?: string; primary_customers?: string; core_operational_activities?: string[]; strategic_pressures?: string[] } | undefined
  const businessModelType = data.business_model_type as string | undefined
  const signalClusters = Array.isArray(data.signal_clusters)
    ? (data.signal_clusters as Array<{ id: string; theme: string; description: string; signals_present: string[]; confidence: string; tier: number }>)
    : []
  const strategicChallenges = Array.isArray(data.strategic_challenges)
    ? (data.strategic_challenges as Array<{ id: string; title: string; description: string; service: string; priority: string }>)
    : []
  const executiveBrief = (data.executive_brief && typeof data.executive_brief === 'object')
    ? (data.executive_brief as { what_we_observed?: string[]; what_it_means?: string[]; what_to_sell?: string; who_to_contact?: string; why_now?: string; overall_confidence?: string })
    : null
  const deterministicOpps = Array.isArray(data.deterministic_opportunities)
    ? (data.deterministic_opportunities as Array<{
        id: string; title: string; service: string; category: string
        strategic_challenge: string; relevance: string; priority: number; entry_point: string
        triggered_by_clusters?: Array<{ id: string; name: string; confidence: string }>
        priority_source?: string
      }>)
    : []

  return (
    <div className="space-y-4">

      {/* Content quality flags */}
      {contentFlags.length > 0 && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/20 px-4 py-3 space-y-1">
          <p className="text-red-400 text-xs font-medium mb-1">⚠ Content Quality Issues — Analysis may be limited</p>
          {contentFlags.map((f, i) => (
            <p key={i} className="text-red-400 text-xs font-mono">{f}</p>
          ))}
        </div>
      )}

      {/* Validation warnings */}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-yellow-800/50 bg-yellow-950/20 px-4 py-3 space-y-1">
          <p className="text-yellow-400 text-xs font-medium mb-1">⚠ Validation Notes</p>
          {warnings.map((w, i) => (
            <p key={i} className="text-yellow-500 text-xs">{w}</p>
          ))}
        </div>
      )}

      {/* Executive Brief */}
      {executiveBrief && (executiveBrief.what_to_sell || (executiveBrief.what_we_observed && executiveBrief.what_we_observed.length > 0)) && (
        <Card className="bg-zinc-900 border-violet-800/60 shadow-lg shadow-violet-950/20">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-violet-300 font-semibold tracking-wide">Executive Brief</CardTitle>
              {executiveBrief.overall_confidence && (
                <Badge className={`text-[10px] ${
                  executiveBrief.overall_confidence === 'high'   ? 'bg-emerald-900 text-emerald-300 border-emerald-700' :
                  executiveBrief.overall_confidence === 'medium' ? 'bg-yellow-900 text-yellow-300 border-yellow-700' :
                                                                   'bg-zinc-800 text-zinc-400 border-zinc-700'
                }`}>{executiveBrief.overall_confidence} confidence</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {executiveBrief.what_we_observed && executiveBrief.what_we_observed.length > 0 && (
                <div>
                  <p className="text-[10px] text-emerald-500 uppercase tracking-wide mb-1.5 font-medium">What we observed</p>
                  <ul className="space-y-1">
                    {executiveBrief.what_we_observed.map((obs, i) => (
                      <li key={i} className="flex gap-2 text-xs text-zinc-300">
                        <span className="text-emerald-500 mt-0.5 flex-shrink-0">●</span>
                        <span>{obs}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {executiveBrief.what_it_means && executiveBrief.what_it_means.length > 0 && (
                <div>
                  <p className="text-[10px] text-amber-500 uppercase tracking-wide mb-1.5 font-medium">What it means</p>
                  <ul className="space-y-1">
                    {executiveBrief.what_it_means.map((imp, i) => (
                      <li key={i} className="flex gap-2 text-xs text-zinc-400">
                        <span className="text-amber-500 mt-0.5 flex-shrink-0">→</span>
                        <span>{imp}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-zinc-800">
              {executiveBrief.what_to_sell && (
                <div>
                  <p className="text-[10px] text-violet-400 uppercase tracking-wide mb-1">What to sell</p>
                  <p className="text-violet-200 text-xs font-medium">{executiveBrief.what_to_sell}</p>
                </div>
              )}
              {executiveBrief.who_to_contact && (
                <div>
                  <p className="text-[10px] text-blue-400 uppercase tracking-wide mb-1">Who to contact</p>
                  <p className="text-blue-200 text-xs font-medium">{executiveBrief.who_to_contact}</p>
                </div>
              )}
              {executiveBrief.why_now && (
                <div>
                  <p className="text-[10px] text-orange-400 uppercase tracking-wide mb-1">Why now</p>
                  <p className="text-orange-200 text-xs">{executiveBrief.why_now}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Row 1: Overview + Scores */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Company Overview */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-zinc-300">Company Overview</CardTitle>
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
                <p className="text-[10px] text-zinc-500 mb-0.5 uppercase tracking-wide">{String(label)}</p>
                <p className="text-white text-sm">{s(value)}</p>
              </div>
            ) : null)}
            <div>
              <p className="text-[10px] text-zinc-500 mb-1 uppercase tracking-wide">Summary</p>
              <p className="text-zinc-300 text-sm leading-relaxed">{s(data.company_summary)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Scores */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-zinc-300">Scores</CardTitle>
              <Badge className={
                data.confidence_level === 'high' ? 'bg-emerald-900 text-emerald-300 text-[10px]'
                : data.confidence_level === 'medium' ? 'bg-yellow-900 text-yellow-300 text-[10px]'
                : 'bg-red-900 text-red-300 text-[10px]'
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
                label2={`${n(score.value)} — ${score.label}`}
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
                label2={`${n(opp.value)} — ${opp.label}`}
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
                label2={`${whyNow.score}/10 — ${whyNow.urgency_label ?? ''}`}
                note={s(whyNow.explanation)}
              />
            )}
            <Separator className="bg-zinc-800" />
            <div className="flex justify-between items-center">
              <span className="text-xs text-zinc-500">Outreach Priority</span>
              <span className="text-sm font-mono text-emerald-400 font-bold">
                {typeof data.outreach_priority_score === 'number'
                  ? Math.round(data.outreach_priority_score)
                  : '—'}/100
                {Boolean(data.outreach_priority_label) && (
                  <span className="text-xs font-normal text-zinc-500 ml-1.5">({s(data.outreach_priority_label)})</span>
                )}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Business Model Analysis */}
      {bma && bma.model_type && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-zinc-300">Business Model Analysis</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {bma.model_type && (
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Model Type</p>
                  <p className="text-zinc-200 text-xs font-medium">{bma.model_type}</p>
                </div>
              )}
              {bma.value_chain_position && (
                <div className="sm:col-span-2">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Value Chain Position</p>
                  <p className="text-zinc-300 text-xs">{bma.value_chain_position}</p>
                </div>
              )}
            </div>
            {bma.core_operational_activities && bma.core_operational_activities.length > 0 && (
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1.5">Core Internal Activities</p>
                <div className="flex flex-wrap gap-1.5">
                  {bma.core_operational_activities.map((a, i) => (
                    <span key={i} className="text-[10px] bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">{a}</span>
                  ))}
                </div>
              </div>
            )}
            {bma.strategic_pressures && bma.strategic_pressures.length > 0 && (
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1.5">Strategic Pressures</p>
                <div className="space-y-1">
                  {bma.strategic_pressures.map((p, i) => (
                    <p key={i} className="text-zinc-400 text-xs">• {p}</p>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Signal Clusters (code-computed) */}
      {signalClusters.length > 0 ? (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-zinc-300">Signal Clusters</CardTitle>
              {businessModelType ? (
                <Badge className="bg-zinc-800 text-zinc-400 border-zinc-700 text-[10px]">{businessModelType}</Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {signalClusters.map((cluster) => (
                <div key={cluster.id} className={`rounded-md border px-3 py-2.5 space-y-1.5 ${
                  cluster.confidence === 'high'   ? 'border-violet-800/50 bg-violet-950/20' :
                  cluster.confidence === 'medium' ? 'border-blue-800/40 bg-blue-950/15' :
                                                    'border-zinc-700/50 bg-zinc-800/30'
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-zinc-200">{cluster.theme}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                      cluster.confidence === 'high'   ? 'bg-violet-900/50 text-violet-300' :
                      cluster.confidence === 'medium' ? 'bg-blue-900/40 text-blue-300' :
                                                        'bg-zinc-700 text-zinc-400'
                    }`}>{cluster.confidence} · T{cluster.tier}</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">{cluster.description}</p>
                  {cluster.signals_present.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {cluster.signals_present.map((s, i) => (
                        <span key={i} className="text-[9px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded font-mono">{s}</span>
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
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-zinc-300">Strategic Challenges</CardTitle>
            <p className="text-[10px] text-zinc-500">Business-model-specific challenges that Demaze can address</p>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-2">
              {strategicChallenges.slice(0, 6).map((challenge) => (
                <div key={challenge.id} className="flex items-start gap-3 rounded-md bg-zinc-800/40 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-medium text-zinc-200">{challenge.title}</p>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                        challenge.priority === 'critical' ? 'bg-red-900/50 text-red-300' :
                        challenge.priority === 'high'     ? 'bg-orange-900/40 text-orange-300' :
                                                            'bg-zinc-700 text-zinc-400'
                      }`}>{challenge.priority}</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">{challenge.description}</p>
                  </div>
                  <span className="text-[10px] text-violet-400 bg-violet-950/30 border border-violet-800/40 px-2 py-0.5 rounded whitespace-nowrap flex-shrink-0">{challenge.service}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deterministic Opportunities */}
      {deterministicOpps.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-zinc-300">Opportunity Engine Output</CardTitle>
            <p className="text-[10px] text-zinc-500">Code-determined opportunities based on signal clusters</p>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {deterministicOpps.map((opp) => (
              <div key={opp.id} className="rounded-md border border-zinc-700/50 bg-zinc-800/30 px-3 py-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs font-medium text-zinc-200">{opp.title}</p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono text-zinc-500">P{opp.priority}</span>
                    <Badge className={`text-[10px] ${
                      opp.relevance === 'High'   ? 'bg-emerald-950 text-emerald-300 border-emerald-800' :
                      opp.relevance === 'Medium' ? 'bg-blue-950 text-blue-300 border-blue-800' :
                                                   'bg-zinc-800 text-zinc-400 border-zinc-700'
                    }`}>{opp.relevance}</Badge>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-400">{opp.strategic_challenge}</p>
                <p className="text-[10px] text-zinc-500 font-mono">→ {opp.entry_point}</p>
                {/* Score source — which clusters triggered this opportunity */}
                {opp.triggered_by_clusters && opp.triggered_by_clusters.length > 0 && (
                  <p className="text-[9px] text-zinc-600 pt-0.5">
                    triggered by:{' '}
                    {opp.triggered_by_clusters.map((c: { name: string; confidence: string }, i: number) => (
                      <span key={i}>
                        {i > 0 && ', '}
                        <span className="text-zinc-500">{c.name}</span>
                        <span className="text-zinc-600"> ({c.confidence})</span>
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
      {outreachIntel && outreachIntel.opening_angle && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-zinc-300">Outreach Intelligence</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            <div className="rounded-md bg-blue-950/30 border border-blue-800/40 px-4 py-3">
              <p className="text-[10px] text-blue-400 uppercase tracking-wide mb-1.5">Opening angle (use verbatim)</p>
              <p className="text-zinc-200 text-sm leading-relaxed italic">
                &ldquo;{outreachIntel.opening_angle}&rdquo;
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {outreachIntel.trigger && (
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Trigger</p>
                  <p className="text-zinc-300 text-xs">{outreachIntel.trigger}</p>
                </div>
              )}
              {outreachIntel.problem && (
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Problem to address</p>
                  <p className="text-zinc-300 text-xs">{outreachIntel.problem}</p>
                </div>
              )}
              {outreachIntel.service && (
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Lead with</p>
                  <p className="text-zinc-300 text-xs">{outreachIntel.service}</p>
                </div>
              )}
            </div>
            {outreachIntel.target_contact && (
              <div className="rounded-md bg-emerald-950/30 border border-emerald-800/40 px-3 py-2">
                <p className="text-[10px] text-emerald-400 uppercase tracking-wide mb-1">Address to</p>
                <p className="text-emerald-300 text-xs font-medium">{outreachIntel.target_contact}</p>
              </div>
            )}
            {outreachIntel.why_now && (
              <div className="rounded-md bg-zinc-800/40 px-3 py-2">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Why contact now?</p>
                <p className="text-zinc-400 text-xs">{outreachIntel.why_now}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Fallback outreach angle if no structured intel */}
      {(!outreachIntel?.opening_angle) && Boolean(data.outreach_angle) && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-zinc-300">Outreach Recommendation</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <p className="text-zinc-300 text-sm leading-relaxed">{s(data.outreach_angle)}</p>
          </CardContent>
        </Card>
      )}

      {/* Contact Prioritization */}
      {contacts.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-zinc-300">Contact Prioritization</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {contacts.map((c, i) => (
              <div key={i} className="flex items-start gap-3 rounded-md bg-zinc-800/60 px-3 py-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] font-mono text-zinc-300 mt-0.5">
                  {n(c.priority) || i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-zinc-200 text-xs font-medium">{s(c.role)}</p>
                  {Boolean(c.reason) && <p className="text-zinc-500 text-xs mt-0.5">{s(c.reason)}</p>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Fallback contact roles (v1 format) */}
      {contacts.length === 0 && Array.isArray(data.recommended_contact_roles) && (data.recommended_contact_roles as string[]).length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-zinc-300">Contact Roles</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex flex-wrap gap-2">
              {(data.recommended_contact_roles as string[]).map((r) => (
                <Badge key={r} variant="outline" className="border-zinc-700 text-zinc-300 text-xs">{r}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pain Points (structured) */}
      {painPts.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-zinc-300">Pain Points ({painPts.length})</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {painPts.map((pp, i) => (
              <div key={i} className="rounded-md bg-zinc-800/60 px-3 py-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <ConfidenceBadge confidence={s(pp.confidence)} />
                  <span className="text-zinc-200 text-xs font-medium">{s(pp.title)}</span>
                </div>
                {Boolean(pp.reasoning) && (
                  <p className="text-zinc-400 text-xs leading-relaxed">{s(pp.reasoning)}</p>
                )}
                {Boolean(pp.evidence) && (
                  <p className="text-zinc-600 text-xs italic border-l-2 border-zinc-700 pl-2">&ldquo;{s(pp.evidence)}&rdquo;</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Reasoning Chains */}
      {chains.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-zinc-300">Reasoning Chains</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {chains.map((chain, i) => (
              <div key={i} className="rounded-md bg-zinc-800/40 border border-zinc-700/50 p-3 space-y-2">
                <div className="flex flex-col gap-1.5 text-xs">
                  <ChainStep icon="⚡" label="Signal" value={s(chain.signal)} color="text-blue-400" />
                  <ChainStep icon="→" label="Implication" value={s(chain.business_implication)} color="text-zinc-400" />
                  <ChainStep icon="⚠" label="Pain Point" value={s(chain.pain_point)} color="text-orange-400" />
                  <ChainStep icon="✓" label="Opportunity" value={s(chain.opportunity)} color="text-emerald-400" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Signals */}
      {signals.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-zinc-300">Signals ({signals.length})</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {signals.map((sig, i) => (
              <div key={i} className="rounded-md bg-zinc-800/60 px-3 py-2 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="text-[10px] bg-zinc-700 text-zinc-300">{s(sig.category)}</Badge>
                  <Badge className={`text-[10px] ${sig.strength === 'strong' ? 'bg-emerald-900 text-emerald-300' : sig.strength === 'moderate' ? 'bg-yellow-900 text-yellow-300' : 'bg-zinc-700 text-zinc-400'}`}>
                    {s(sig.strength)}
                  </Badge>
                  <span className="text-zinc-300 text-xs font-medium">{s(sig.type)}</span>
                </div>
                <p className="text-zinc-600 text-xs italic">&ldquo;{s(sig.evidence)}&rdquo;</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* AI Opportunities */}
      {opps.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-zinc-300">AI Opportunities ({opps.length})</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {opps.map((o, i) => {
              const oppConf = s(o.opportunity_confidence)
              const claimType = s(o.claim_type)
              const demazefit = s(o.demaze_fit_score)
              return (
              <div key={i} className="rounded-md border border-zinc-700/60 bg-zinc-800/40 px-3 py-3 space-y-2">
                {/* Header row */}
                <div className="flex items-start gap-2 flex-wrap">
                  {/* Opportunity confidence badge */}
                  {oppConf && (
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                      oppConf === 'very_high'   ? 'bg-emerald-900 text-emerald-300 border border-emerald-700' :
                      oppConf === 'high'        ? 'bg-blue-900 text-blue-300 border border-blue-700' :
                      oppConf === 'medium'      ? 'bg-amber-900/60 text-amber-300 border border-amber-700' :
                      oppConf === 'exploratory' ? 'bg-zinc-800 text-zinc-400 border border-zinc-600' :
                                                  'bg-zinc-800 text-zinc-400'
                    }`}>
                      {oppConf === 'very_high' ? 'Very High' : oppConf === 'exploratory' ? 'Exploratory' : oppConf.charAt(0).toUpperCase() + oppConf.slice(1)}
                    </span>
                  )}
                  {/* Claim type badge */}
                  {claimType && (
                    <span className={`text-[9px] px-2 py-0.5 rounded-full border flex-shrink-0 ${
                      claimType === 'observed' ? 'bg-teal-950 text-teal-300 border-teal-800' :
                                                 'bg-orange-950 text-orange-300 border-orange-800'
                    }`}>
                      {claimType === 'observed' ? 'Observed' : 'Inferred'}
                    </span>
                  )}
                  {/* Demaze fit */}
                  {demazefit && (
                    <span className={`text-[9px] px-2 py-0.5 rounded border flex-shrink-0 ${
                      demazefit === 'high'   ? 'bg-violet-950 text-violet-300 border-violet-800' :
                      demazefit === 'medium' ? 'bg-zinc-800 text-zinc-400 border-zinc-600' :
                                              'bg-red-950 text-red-400 border-red-900'
                    }`}>Demaze fit: {demazefit}</span>
                  )}
                  <span className="text-zinc-100 text-xs font-medium leading-snug">{s(o.title)}</span>
                </div>

                {/* Description */}
                <p className="text-zinc-400 text-xs leading-relaxed">{s(o.description)}</p>

                {/* Reasoning chain: observed → inferred → opportunity */}
                {(Boolean(o.observed_basis) || Boolean(o.inferred_from)) && (
                  <div className="space-y-1 border-l-2 border-zinc-700 pl-3 mt-1">
                    {Boolean(o.observed_basis) && (
                      <div>
                        <span className="text-[9px] text-teal-500 uppercase tracking-wide">Observed </span>
                        <span className="text-[11px] text-zinc-400">{s(o.observed_basis)}</span>
                      </div>
                    )}
                    {Boolean(o.inferred_from) && (
                      <div>
                        <span className="text-[9px] text-orange-500 uppercase tracking-wide">Inferred from </span>
                        <span className="text-[11px] text-zinc-500">{s(o.inferred_from)}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Supporting evidence quote */}
                {Boolean(o.evidence) && (
                  <p className="text-zinc-600 text-[11px] italic border-l-2 border-zinc-700 pl-2">&ldquo;{s(o.evidence)}&rdquo;</p>
                )}

                {/* Impact + entry point */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                  {Boolean(o.expected_impact) && (
                    <p className="text-emerald-600 text-[11px]">Impact: {s(o.expected_impact)}</p>
                  )}
                  {Boolean(o.entry_point) && (
                    <p className="text-zinc-600 text-[11px]">Entry: {s(o.entry_point)}</p>
                  )}
                </div>
              </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Evidence Bank — extractor signals with full evidence traces */}
      {extractorResult && extractorResult.signals.length > 0 && (() => {
        // Flatten all evidence items with their parent signal context
        const allEvidence = extractorResult.signals.flatMap(sig =>
          sig.evidence.map((ev, evIdx) => ({ ...ev, sigType: sig.type, sigStrength: sig.strength, sigValidated: sig.validated, evIdx }))
        )
        const totalEvidence = allEvidence.length
        return (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
            <button
              onClick={() => setShowEvidence((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm text-zinc-400">Evidence Bank</span>
                <span className="text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-400 px-2 py-0.5 rounded-full">
                  {extractorResult.signals.length} signals · {totalEvidence} quotes
                </span>
                {extractorResult.companySubjectCount > 0 && (
                  <span className="text-[10px] bg-emerald-950/40 border border-emerald-800/50 text-emerald-400 px-2 py-0.5 rounded-full">
                    {extractorResult.companySubjectCount} company-subject
                  </span>
                )}
              </div>
              <span className="text-zinc-600 text-xs">{showEvidence ? '▲ collapse' : '▼ expand'}</span>
            </button>
            {showEvidence && (
              <div className="border-t border-zinc-800 px-4 pb-4 pt-3 space-y-4">
                {extractorResult.signals.map((sig, sIdx) => (
                  <div key={sIdx} className="space-y-1.5">
                    {/* Signal header */}
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[11px] font-semibold text-zinc-300 font-mono">{sig.type}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                        sig.strength === 'strong'   ? 'bg-emerald-950 text-emerald-400 border-emerald-800' :
                        sig.strength === 'moderate' ? 'bg-amber-950 text-amber-400 border-amber-800' :
                                                      'bg-zinc-800 text-zinc-500 border-zinc-700'
                      }`}>{sig.strength}</span>
                      {sig.validated && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-950 text-blue-400 border border-blue-800">validated</span>
                      )}
                      {!sig.is_company_subject && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-900 text-zinc-600 border border-zinc-700">not company-subject</span>
                      )}
                    </div>
                    {/* Evidence items */}
                    {sig.evidence.map((ev, eIdx) => (
                      <div key={eIdx} className="rounded-md bg-zinc-800/40 border border-zinc-700/40 px-3 py-2 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[9px] font-mono text-zinc-600">{ev.id}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                            ev.evidence_strength === 'very_high' ? 'text-emerald-400 bg-emerald-950/40' :
                            ev.evidence_strength === 'high'      ? 'text-blue-400 bg-blue-950/30' :
                            ev.evidence_strength === 'medium'    ? 'text-zinc-400 bg-zinc-800' :
                                                                   'text-zinc-600 bg-zinc-900'
                          }`}>{ev.evidence_strength.replace('_', ' ')}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                            ev.source_tier === 'tier1' ? 'bg-violet-950 text-violet-400 border-violet-800' :
                            ev.source_tier === 'tier2' ? 'bg-zinc-800 text-zinc-400 border-zinc-600' :
                                                         'bg-zinc-900 text-zinc-600 border-zinc-700'
                          }`}>{ev.source_tier}</span>
                          <span className="text-[9px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded">{ev.page_type}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                            ev.subject === 'company_operations' ? 'bg-teal-950 text-teal-400 border-teal-800' :
                            ev.subject === 'company_strategy'   ? 'bg-blue-950 text-blue-400 border-blue-800' :
                            ev.subject === 'internal_technology' ? 'bg-purple-950 text-purple-400 border-purple-800' :
                                                                   'bg-zinc-900 text-zinc-600 border-zinc-700'
                          }`}>{ev.subject.replace(/_/g, ' ')}</span>
                        </div>
                        <p className="text-zinc-400 text-xs italic leading-relaxed">&ldquo;{ev.quote}&rdquo;</p>
                        {ev.source_url && (
                          <p className="text-zinc-600 text-[10px] truncate">{ev.source_url}</p>
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
  recommended_service?: string; target_buyer?: string; confidence?: string
}

function MaybeWhyDemaze({ data }: { data: Record<string, unknown> }): ReactElement | null {
  const wd = data.why_demaze as { reasons?: WhyDemazeReason[]; relevant_services?: string[]; summary?: string } | undefined
  return wd ? <WhyDemazeCard whyDemaze={wd} /> : null
}

function WhyDemazeCard({ whyDemaze }: { whyDemaze: { reasons?: WhyDemazeReason[]; relevant_services?: string[]; summary?: string } | undefined }): ReactNode {
  if (!whyDemaze || !whyDemaze.reasons?.length) return null
  const isV4 = whyDemaze.reasons.some(r => typeof r === 'object' && r !== null)
  return (
    <Card className="bg-zinc-900 border-emerald-800/40">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm text-emerald-400">Why Demaze Should Contact This Company</CardTitle>
        {whyDemaze.summary && <p className="text-[11px] text-zinc-400 mt-1">{whyDemaze.summary}</p>}
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {isV4 ? (
          // v4: structured reasons
          <div className="space-y-3">
            {(whyDemaze.reasons ?? []).map((reason, i) => {
              if (typeof reason === 'string') {
                return (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-emerald-500 text-xs mt-0.5 flex-shrink-0">→</span>
                    <p className="text-zinc-300 text-sm">{reason}</p>
                  </div>
                )
              }
              const r = reason as Exclude<WhyDemazeReason, string>
              return (
                <div key={i} className="rounded-md border border-emerald-900/40 bg-emerald-950/10 px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-xs font-medium text-emerald-300">{r.signal}</p>
                    <div className="flex items-center gap-1.5">
                      {r.confidence && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                          r.confidence === 'high'   ? 'bg-emerald-900/50 text-emerald-400' :
                          r.confidence === 'medium' ? 'bg-blue-900/40 text-blue-400' :
                                                      'bg-zinc-700 text-zinc-400'
                        }`}>{r.confidence}</span>
                      )}
                      {r.evidence_tier && (
                        <span className="text-[9px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded font-mono">{r.evidence_tier}</span>
                      )}
                    </div>
                  </div>
                  {r.evidence && (
                    <p className="text-[11px] text-zinc-500 italic border-l-2 border-zinc-700 pl-2">
                      &ldquo;{r.evidence}&rdquo;
                    </p>
                  )}
                  {r.business_implication && (
                    <p className="text-[11px] text-zinc-300">{r.business_implication}</p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    {r.recommended_service && (
                      <span className="text-[10px] bg-violet-950/40 text-violet-300 border border-violet-800/40 px-2 py-0.5 rounded">{r.recommended_service}</span>
                    )}
                    {r.target_buyer && (
                      <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">→ {r.target_buyer}</span>
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
                <span className="text-emerald-500 text-xs mt-0.5 flex-shrink-0">→</span>
                <p className="text-zinc-300 text-sm">{String(reason)}</p>
              </div>
            ))}
          </div>
        )}
        {(whyDemaze.relevant_services?.length ?? 0) > 0 && (
          <div className="pt-2 border-t border-zinc-800">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2">Relevant Demaze Services</p>
            <div className="flex flex-wrap gap-1.5">
              {(whyDemaze.relevant_services ?? []).map((svc, i) => (
                <Badge key={i} className="bg-emerald-950 text-emerald-300 border-emerald-800 text-xs">{svc}</Badge>
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
        <span className="text-xs text-zinc-500">{label}</span>
        <span className="text-xs font-mono text-white">{label2 ?? `${value}`}</span>
      </div>
      <Progress value={value} className="h-1.5" />
      {note && <p className="text-zinc-600 text-xs mt-1">{note}</p>}
      {breakdown && breakdown.length > 0 && onToggle && (
        <button
          onClick={onToggle}
          className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-1"
        >
          {expanded ? '▲ hide breakdown' : '▼ show breakdown'}
        </button>
      )}
      {expanded && breakdown && (
        <div className="mt-2 space-y-1 border-t border-zinc-800 pt-2">
          {breakdown.map((b) => {
            // Map breakdown factor label → DetectedFactors key (e.g. "Digital Transformation Initiative" → "digital_transformation")
            const factorKey = b.factor.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
            const sources = factorSourceMap?.[factorKey] ?? factorSourceMap?.[Object.keys(factorSourceMap ?? {}).find(k => b.factor.toLowerCase().includes(k.replace(/_/g, ' ').toLowerCase())) ?? '']
            return (
              <div key={b.factor}>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] ${b.present ? 'text-zinc-300' : 'text-zinc-600'}`}>
                    {b.present ? '✓' : '○'} {b.factor}
                  </span>
                  <span className={`text-[10px] font-mono ${b.present && b.points > 0 ? 'text-emerald-500' : 'text-zinc-600'}`}>
                    {b.points > 0 ? `+${b.points}` : b.points}
                  </span>
                </div>
                {b.present && sources && sources.length > 0 && (
                  <p className="text-[9px] text-zinc-600 pl-3">← {sources.join(', ')}</p>
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
    confidence === 'high'   ? 'bg-emerald-900/50 text-emerald-300 border-emerald-800' :
    confidence === 'medium' ? 'bg-yellow-900/40 text-yellow-300 border-yellow-800' :
                              'bg-zinc-800 text-zinc-500 border-zinc-700'
  return <Badge className={`text-[10px] ${cls}`}>{confidence}</Badge>
}

function ChainStep({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  if (!value || value === '—') return null
  return (
    <div className="flex items-start gap-2">
      <span className="w-4 text-center flex-shrink-0">{icon}</span>
      <span className="text-zinc-600 w-20 flex-shrink-0">{label}</span>
      <span className={color}>{value}</span>
    </div>
  )
}



// ── Intelligence Report Panel ─────────────────────────────────

const CONF_COLOR: Record<string, string> = {
  very_high: 'text-violet-300 bg-violet-900/40 border-violet-700',
  high: 'text-emerald-300 bg-emerald-900/40 border-emerald-700',
  medium: 'text-amber-300 bg-amber-900/40 border-amber-700',
  low: 'text-zinc-400 bg-zinc-800 border-zinc-700',
}

const PRI_COLOR: Record<string, string> = {
  critical: 'text-red-300 bg-red-900/30 border-red-700',
  important: 'text-amber-300 bg-amber-900/30 border-amber-700',
  secondary: 'text-zinc-400 bg-zinc-800 border-zinc-700',
}

const URG_COLOR: Record<string, string> = {
  immediate: 'text-red-300', near_term: 'text-amber-300', emerging: 'text-blue-300',
}

const REL_COLOR: Record<string, string> = {
  very_strong: 'text-violet-300 bg-violet-900/30 border-violet-700',
  strong: 'text-emerald-300 bg-emerald-900/30 border-emerald-700',
  moderate: 'text-amber-300 bg-amber-900/30 border-amber-700',
  weak: 'text-zinc-500 bg-zinc-800 border-zinc-700',
}

function QualityBar({ score, label, note }: { score: number; label: string; note: string }) {
  const bar = score >= 70 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-zinc-500 w-44 shrink-0">{label}</span>
        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${bar}`} style={{ width: `${score}%` }} />
        </div>
        <span className="text-xs text-zinc-400 w-8 text-right font-mono">{score}</span>
      </div>
      <p className="text-[10px] text-zinc-700 ml-[11.5rem] mt-0.5 truncate">{note}</p>
    </div>
  )
}

function IntelligencePanel({ result }: { result: RunResult | null }) {
  if (!result?.synthesisResult) return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-8 text-center text-zinc-500 text-sm">
      Run an analysis to see the Intelligence Report.
    </div>
  )
  const s = result.synthesisResult
  const { intelligenceQuality: iq, strategicThemes, validatedSignals, whyNow, outreachCards } = s
  const tierColor: Record<string, string> = {
    A: 'text-emerald-300 border-emerald-700 bg-emerald-900/20',
    B: 'text-blue-300 border-blue-700 bg-blue-900/20',
    C: 'text-amber-300 border-amber-700 bg-amber-900/20',
    D: 'text-red-300 border-red-700 bg-red-900/20',
  }
  return (
    <div className="space-y-4">
      {/* Intelligence Quality */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm text-zinc-300">Intelligence Quality</CardTitle>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded border font-bold ${tierColor[iq.tier] ?? ''}`}>Tier {iq.tier}</span>
              <span className="text-sm font-bold text-zinc-200">{iq.overall}/100</span>
              <span className="text-xs text-zinc-500">{iq.overall_label}</span>
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
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-1">Strategic Themes</h3>
          <div className="space-y-3">
            {strategicThemes.map(theme => (
              <Card key={theme.id} className="bg-zinc-900 border-zinc-800">
                <CardContent className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${PRI_COLOR[theme.priority] ?? ''}`}>{theme.priority.toUpperCase()}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${CONF_COLOR[theme.confidence] ?? ''}`}>{theme.confidence.replace('_', ' ')} confidence</span>
                      </div>
                      <p className="text-sm font-semibold text-zinc-200">{theme.name}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{theme.tagline}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold text-zinc-300">{theme.priorityScore}</div>
                      <div className="text-[10px] text-zinc-600">priority</div>
                    </div>
                  </div>
                  <div className="border-t border-zinc-800 pt-2 space-y-1">
                    <p className="text-xs text-zinc-400"><span className="text-zinc-600">Impact: </span>{theme.businessImpact}</p>
                    <p className="text-xs text-violet-300"><span className="text-zinc-600">Angle: </span>{theme.demazeAngle}</p>
                  </div>
                  {theme.supportingEvidence.slice(0, 2).map((ev, i) => (
                    <div key={i} className="text-[10px] text-zinc-600 mt-1 pl-2 border-l border-zinc-700 line-clamp-1">
                      <span className="text-zinc-700">[{ev.source_label}] </span>{ev.quote}
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
        <Card className={`border ${whyNow.genericityFlag ? 'border-zinc-700 bg-zinc-900' : 'border-blue-800 bg-blue-950/20'}`}>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-zinc-300">Why Now</CardTitle>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${URG_COLOR[whyNow.urgency] ?? 'text-zinc-400'}`}>{whyNow.urgency.replace('_', ' ').toUpperCase()}</span>
                <span className="text-xs text-zinc-600 font-mono">{whyNow.urgencyScore}/100</span>
                {whyNow.genericityFlag && <span className="text-[10px] text-amber-400 border border-amber-700 bg-amber-950/30 px-1.5 py-0.5 rounded">limited evidence</span>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-sm text-zinc-300 font-medium mb-2">{whyNow.headline}</p>
            <p className="text-xs text-zinc-400 leading-relaxed mb-3">{whyNow.narrative}</p>
            <div className="space-y-1.5">
              {whyNow.triggers.slice(0, 3).map((t, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-zinc-600 font-mono w-6 shrink-0">+{t.urgency_contribution}</span>
                  <div>
                    <span className="text-zinc-400 font-medium">{t.signal_type.replace(/_/g, ' ')}</span>
                    {t.evidence_quote && <span className="text-zinc-600"> — &ldquo;{t.evidence_quote.slice(0, 100)}&rdquo;</span>}
                    <span className="text-zinc-700"> [{t.source_label}]</span>
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
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-1">Validated Signals</h3>
          <div className="space-y-2">
            {validatedSignals.slice(0, 8).map(sig => (
              <div key={sig.id} className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-zinc-300 font-medium">{sig.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${CONF_COLOR[sig.confidenceLevel] ?? ''}`}>{sig.confidenceLevel.replace('_', ' ')}</span>
                  </div>
                  <span className="text-[10px] text-zinc-600 shrink-0">{sig.sourceCount} source{sig.sourceCount !== 1 ? 's' : ''}</span>
                </div>
                {sig.supportingEvidence[0]?.quote && (
                  <p className="text-[10px] text-zinc-600 mt-1 line-clamp-1">&ldquo;{sig.supportingEvidence[0].quote}&rdquo;</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Outreach Cards */}
      {outreachCards.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-1">Outreach Intelligence</h3>
          <div className="space-y-3">
            {outreachCards.map((card, i) => (
              <Card key={i} className="bg-zinc-900 border-zinc-800">
                <CardContent className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-sm font-semibold text-zinc-200">{card.role}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 font-medium ${REL_COLOR[card.demaze_relevance] ?? ''}`}>{card.demaze_relevance.replace('_', ' ')}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-1 text-xs mb-2">
                    <div><span className="text-zinc-600">KPI: </span><span className="text-zinc-400">{card.likely_kpi}</span></div>
                    <div><span className="text-zinc-600">Pain: </span><span className="text-zinc-400">{card.likely_pain}</span></div>
                  </div>
                  <div className="border-t border-zinc-800 pt-2 text-xs">
                    <span className="text-zinc-600">Angle: </span><span className="text-violet-300">{card.message_angle}</span>
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-1">{card.why_relevant}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sources Panel ─────────────────────────────────────────────

const SRC_TYPE_COLOR: Record<string, string> = {
  annual_report: 'bg-violet-900/40 text-violet-300 border border-violet-700',
  investor_presentation: 'bg-violet-900/40 text-violet-300 border border-violet-700',
  earnings_release: 'bg-blue-900/40 text-blue-300 border border-blue-700',
  press_release: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700',
  careers_page: 'bg-amber-900/40 text-amber-300 border border-amber-700',
  news_article: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
  sustainability_report: 'bg-green-900/40 text-green-300 border border-green-700',
  other: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
}

const SRC_STR_COLOR: Record<string, string> = {
  very_high: 'text-violet-400', high: 'text-emerald-400',
  medium: 'text-amber-400', low: 'text-zinc-500',
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
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/20 px-4 py-3 flex items-start gap-3">
          <span className="text-emerald-400 text-lg mt-0.5">🔍</span>
          <div className="flex-1">
            <p className="text-emerald-300 text-sm font-semibold">External Intelligence Active</p>
            <p className="text-emerald-400/70 text-xs mt-0.5">
              {result.enrichmentMeta.sources_found} URLs discovered → {result.enrichmentMeta.sources_used} fetched → {result.enrichmentMeta.signals_extracted} signals extracted
              {result.recoveryTriggered && <span className="text-amber-400"> · Recovery mode (thin content)</span>}
            </p>
          </div>
        </div>
      ) : result.recoveryTriggered ? (
        <div className="rounded-lg border border-amber-700 bg-amber-950/30 px-4 py-3 flex items-start gap-3">
          <span className="text-amber-400 text-lg mt-0.5">⚡</span>
          <div>
            <p className="text-amber-300 text-sm font-semibold">Evidence Recovery Triggered</p>
            <p className="text-amber-400/70 text-xs mt-0.5">Content quality was below threshold — external source discovery was activated.</p>
          </div>
        </div>
      ) : null}
      {sources.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-8 text-center text-zinc-500 text-sm">
          No external sources discovered. Set TAVILY_API_KEY or SERPER_API_KEY to enable source discovery.
        </div>
      ) : (
        <>
          {fetched.length > 0 && (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
                  <span className="text-emerald-400">✓</span> Sources Fetched
                  <span className="text-xs font-normal text-zinc-500">({fetched.length} in LLM context)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {fetched.map(src => (
                  <div key={src.url} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-zinc-600 text-xs font-mono">{src.fetch_order}.</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${SRC_TYPE_COLOR[src.source_type] ?? SRC_TYPE_COLOR.other}`}>{sLabel(src.source_type)}</span>
                      <span className={`text-[10px] font-medium ${SRC_STR_COLOR[src.evidence_strength] ?? 'text-zinc-500'}`}>{src.evidence_strength.replace('_', ' ')} confidence</span>
                    </div>
                    <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 font-mono truncate block">{src.url}</a>
                    {src.snippet && <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{src.snippet}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {skipped.length > 0 && (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm text-zinc-400 flex items-center gap-2">
                  <span className="text-zinc-600">○</span> Discovered, Not Fetched
                  <span className="text-xs font-normal text-zinc-600">({skipped.length} over budget)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {skipped.slice(0, 5).map(src => (
                  <div key={src.url} className="flex items-center gap-2 text-xs">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${SRC_TYPE_COLOR[src.source_type] ?? SRC_TYPE_COLOR.other}`}>{sLabel(src.source_type)}</span>
                    <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-zinc-400 font-mono truncate">{src.url}</a>
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
  return (
    <div className="space-y-3">
      {/* AI Meta */}
      {result.aiMeta && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-zinc-300">AI Metadata</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-1 font-mono text-xs">
            {[
              ['Provider', result.aiMeta.provider],
              ['Model', result.aiMeta.model],
              ['Tokens Used', String(result.aiMeta.tokensUsed)],
              ['Latency', `${result.aiMeta.latencyMs}ms`],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <span className="text-zinc-600 w-28">{k}</span>
                <span className="text-zinc-300">{v}</span>
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
            <div key={id} className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
              <button
                onClick={() => setExpandedSection(expandedSection === id ? null : id)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
              >
                <span className="text-sm text-zinc-400">{label}</span>
                <span className="text-zinc-600 text-xs">{expandedSection === id ? '▲ collapse' : '▼ expand'}</span>
              </button>
              {expandedSection === id && (
                <div className="border-t border-zinc-800 p-4">
                  <pre className="text-[10px] text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
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
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
          <button
            onClick={() => setExpandedSection(expandedSection === 'raw' ? null : 'raw')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
          >
            <span className="text-sm text-zinc-400">Raw AI Response</span>
            <span className="text-zinc-600 text-xs">{expandedSection === 'raw' ? '▲ collapse' : '▼ expand'}</span>
          </button>
          {expandedSection === 'raw' && (
            <div className="border-t border-zinc-800 p-4">
              <pre className="text-[10px] text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                {result.aiMeta.rawResponse}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Research Card ─────────────────────────────────────────────
// Clean, SDR-focused output: what they do, challenges, opportunities,
// who to contact, outreach angle. No scoring complexity.

function ResearchCard({ result }: { result: RunResult }) {
  const a = result.analysisResult as Record<string, unknown> | undefined
  if (!a) return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-4xl mb-4">🔍</div>
      <p className="text-zinc-400 text-sm max-w-xs">Enter a company URL above and click <strong className="text-white">Analyze</strong> to generate a research brief.</p>
    </div>
  )

  const str = (v: unknown) => (v != null && v !== '' ? String(v) : null)

  const companyName   = str(a.company_name) ?? 'Unknown Company'
  const industry      = str(a.industry) ?? ''
  const subIndustry   = str(a.sub_industry) ?? ''
  const sizeEstimate  = str(a.company_size_estimate) ?? ''
  const headquarters  = str(a.headquarters_location) ?? ''
  const summary       = str(a.company_summary) ?? ''
  const confidence    = str(a.confidence_level) ?? 'low'
  const businessModel = str(a.business_model) ?? ''

  // Recent activity (new field from SDR schema)
  const recentActivity: string[] = Array.isArray(a.recent_activity)
    ? (a.recent_activity as unknown[]).map(x => str(x)).filter(Boolean) as string[]
    : []

  // Signal quality indicator (replaces 0-10 fit score)
  const signalCount = result.extractorResult?.signals?.length ?? 0
  const fitLabel = signalCount >= 4 ? 'Strong Signals' : signalCount >= 2 ? 'Some Signals' : 'Inferred'
  const fitColor = signalCount >= 4 ? 'text-emerald-400' : signalCount >= 2 ? 'text-amber-400' : 'text-blue-400'
  const fitBg    = signalCount >= 4 ? 'bg-emerald-950/40 border-emerald-900' : signalCount >= 2 ? 'bg-amber-950/40 border-amber-900' : 'bg-blue-950/40 border-blue-900'
  const confColor = confidence === 'high' ? 'text-emerald-400' : confidence === 'medium' ? 'text-amber-400' : 'text-zinc-500'

  // Pain points — can be plain strings or objects
  const rawPainPoints = Array.isArray(a.pain_points) ? a.pain_points as unknown[] : []
  const painPoints: string[] = rawPainPoints.slice(0, 5).map(p =>
    typeof p === 'string' ? p :
    typeof p === 'object' && p !== null ? (str((p as Record<string, unknown>).title) ?? '') : ''
  ).filter(Boolean)

  const opportunities = Array.isArray(a.opportunities)
    ? (a.opportunities as Array<Record<string, unknown>>).slice(0, 4)
    : []
  const contacts = Array.isArray(a.recommended_contacts)
    ? (a.recommended_contacts as Array<Record<string, unknown>>).slice(0, 3)
    : []

  const outreachIntel = a.outreach_intelligence as (Record<string, unknown> | null)
  const openingAngle  = str(outreachIntel?.opening_angle) ?? str(a.outreach_angle) ?? ''
  const whyNow        = str(outreachIntel?.why_now)
    ?? str((a.why_now as Record<string, unknown>)?.explanation)
    ?? ''
  const whatToSell    = str((a.executive_brief as Record<string, unknown>)?.what_to_sell) ?? ''
  const targetContact = str(outreachIntel?.target_contact)
    ?? str((a.executive_brief as Record<string, unknown>)?.who_to_contact)
    ?? ''

  return (
    <div className="space-y-3 max-w-3xl">

      {/* ── Company Header ───────────────────────────────────── */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-white truncate">{companyName}</h2>
              <p className="text-zinc-400 text-sm mt-0.5">
                {[industry, subIndustry && subIndustry !== industry ? subIndustry : null]
                  .filter(Boolean).join(' · ')}
              </p>
              {(headquarters || sizeEstimate) && (
                <p className="text-zinc-600 text-xs mt-0.5">
                  {[headquarters, sizeEstimate].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <div className={`text-right shrink-0 rounded-lg border px-3 py-2 min-w-[90px] ${fitBg}`}>
              <div className={`text-xs font-bold ${fitColor}`}>{fitLabel}</div>
              <div className={`text-xs mt-0.5 ${confColor}`}>{confidence} confidence</div>
              <div className="text-[10px] text-zinc-600 mt-0.5">{signalCount} signal{signalCount !== 1 ? 's' : ''}</div>
            </div>
          </div>
          {summary && (
            <p className="text-zinc-300 text-sm mt-3 leading-relaxed border-t border-zinc-800 pt-3">
              {summary}
            </p>
          )}
          {businessModel && !summary.toLowerCase().includes(businessModel.toLowerCase().slice(0, 20)) && (
            <p className="text-zinc-500 text-xs mt-2 italic">{businessModel}</p>
          )}
        </CardContent>
      </Card>

      {/* ── Recent Activity ──────────────────────────────────── */}
      {recentActivity.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-5">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Recent Activity &amp; Signals</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <ul className="space-y-1.5">
              {recentActivity.map((item, i) => (
                <li key={i} className="text-zinc-300 text-sm flex gap-2">
                  <span className="text-blue-500 shrink-0 mt-0.5">●</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Challenges + Opportunities ───────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-5">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Business Challenges</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {painPoints.length > 0 ? (
              <ul className="space-y-2">
                {painPoints.map((p, i) => (
                  <li key={i} className="text-zinc-300 text-sm flex gap-2">
                    <span className="text-red-500 shrink-0 mt-0.5">▸</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-zinc-600 text-xs italic">No challenges identified — try a fresh scrape.</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-5">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Demaze Opportunities</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {opportunities.length > 0 ? (
              <ul className="space-y-2.5">
                {opportunities.map((o, i) => (
                  <li key={i} className="text-sm flex gap-2">
                    <span className="text-emerald-500 shrink-0 mt-0.5">▸</span>
                    <div>
                      <span className="text-zinc-200 font-medium">{str(o.title)}</span>
                      {str(o.description) && (
                        <p className="text-zinc-500 text-xs mt-0.5 leading-relaxed">{str(o.description)}</p>
                      )}
                      {str(o.entry_point) && (
                        <p className="text-zinc-600 text-[10px] mt-0.5">Entry: {str(o.entry_point)}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-zinc-600 text-xs italic">No opportunities identified — try a fresh scrape.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Who to Contact ───────────────────────────────────── */}
      {contacts.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-1 pt-4 px-5">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Who to Contact</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4 space-y-2.5">
            {contacts.map((c, i) => (
              <div key={i} className="flex gap-3 text-sm items-start">
                <span className="text-indigo-400 shrink-0 mt-0.5">▸</span>
                <div>
                  <span className="text-white font-medium">{str(c.role) ?? '—'}</span>
                  {str(c.reason) && <p className="text-zinc-500 text-xs mt-0.5">{str(c.reason)}</p>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Outreach Angle ───────────────────────────────────── */}
      {(openingAngle || whatToSell) && (
        <Card className="border border-indigo-900/60 bg-indigo-950/20">
          <CardHeader className="pb-1 pt-4 px-5">
            <CardTitle className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Outreach Angle</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4 space-y-3">
            {openingAngle && (
              <p className="text-zinc-200 text-sm leading-relaxed border-l-2 border-indigo-600 pl-3">
                &ldquo;{openingAngle}&rdquo;
              </p>
            )}
            <div className="grid grid-cols-1 gap-1.5 text-xs">
              {whatToSell && (
                <div>
                  <span className="text-zinc-500 uppercase tracking-wider font-medium">Lead with: </span>
                  <span className="text-zinc-300">{whatToSell}</span>
                </div>
              )}
              {targetContact && (
                <div>
                  <span className="text-zinc-500 uppercase tracking-wider font-medium">Send to: </span>
                  <span className="text-zinc-300">{targetContact}</span>
                </div>
              )}
              {whyNow && (
                <div>
                  <span className="text-zinc-500 uppercase tracking-wider font-medium">Why now: </span>
                  <span className="text-zinc-400">{whyNow}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}


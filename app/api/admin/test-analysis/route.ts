// ============================================================
// Admin: Test Analysis — POST /api/admin/test-analysis
// ============================================================
// Pipeline v2 — Staged architecture with validation gates:
//
//   Stage 1 — SCRAPE:        website content volume + quality
//   Stage 2 — PROFILE:       CompanyProfile extraction viability
//   Stage 3 — SIGNAL:        deterministic signal extraction
//   Stage 4 — ENRICHMENT:    external intelligence (non-critical)
//   Stage 5 — LLM_PARSE:     JSON parse of AI response
//   Stage 6 — NORMALIZATION: normalizer output integrity
//   Stage 7 — SYNTHESIS:     strategic theme generation (non-critical)
//
// Gate statuses: PASS | WARN | FAIL
// FAIL on critical stages halts execution and returns structured error.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { scrapeCompanyWebsite, assessScrapeQuality, type ScrapeResult } from '@/lib/pipeline/scraper'
import { validateAndNormalizeURL, extractDomain } from '@/lib/utils/url'
import { SYSTEM_PROMPT_V2 } from '@/lib/prompts/system-v2'
import { buildNarrativePrompt, buildNarrativeInput, estimateTokenCount } from '@/lib/prompts/analyze-v2'
import { getCompletion } from '@/lib/ai/provider-factory'
import { normalizeAnalysisResult } from '@/lib/pipeline/normalize'
import { getCachedScrape, saveScrapeCache } from '@/lib/cache/scrape-cache'
import { assessContentQuality } from '@/lib/pipeline/content-quality'
import { enrichCompanyIntelligence, detectConsumerSite, type EnrichmentResult, type EnrichedSignal, type EnrichmentOptions } from '@/lib/enrichment/web-enricher'
import { extractSignals, type ExtractorResult } from '@/lib/pipeline/evidence-extractor'
import { clusterSignals } from '@/lib/pipeline/signal-clustering'
import type { PrioritizedSource } from '@/lib/enrichment/source-prioritizer'
import { synthesizeIntelligence } from '@/lib/synthesis'
import type { SynthesisResult } from '@/lib/synthesis'

// ── Content budget (website preview for LLM) ─────────────────
// extractor reads the full content; LLM only sees a 3,000-char preview
const MAX_WEBSITE_PREVIEW_CHARS = 3_000

function t(ms: number): string { return `${ms}ms` }

// ── JSON fence stripping ──────────────────────────────────────
// Some models (glm-5.2, older GPT-4) wrap JSON in ```json … ```
// even when jsonMode is requested. Strip fences before JSON.parse.
function extractJsonFromLLMResponse(raw: string): string {
  const trimmed = raw.trim()
  // Strip leading ```json or ``` fence and trailing ```
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  // Find outermost { … } as a safety net
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start !== -1 && end > start) return stripped.slice(start, end + 1)
  return stripped
}

// ── Pipeline validation gate infrastructure ───────────────────
//
// PARTIAL sits between WARN and FAIL: it means a stage could not produce
// its normal output, but a fallback source (scrape content, enrichment,
// prior stage output) still returned *something* usable, so the pipeline
// degrades and continues instead of hard-failing. Only stages that have
// a genuine content-availability fallback should use PARTIAL — stages
// that fail due to a code exception (parse/normalize/synthesis throwing)
// still hard FAIL since there is nothing safe to fall back to.

type ValidationStatus = 'PASS' | 'WARN' | 'PARTIAL' | 'FAIL'

interface ValidationGate {
  stage: string
  status: ValidationStatus
  reason?: string
  diagnostics?: Record<string, unknown>
}

/**
 * Record a gate result and emit a structured log line for every status.
 * Logs: [pipeline:GATE_PASS] | [pipeline:GATE_WARN] | [pipeline:GATE_FAIL]
 */
function gate(
  gates: ValidationGate[],
  stage: string,
  status: ValidationStatus,
  reason: string,
  diagnostics?: Record<string, unknown>,
): ValidationGate {
  const result: ValidationGate = { stage, status, reason, ...(diagnostics ? { diagnostics } : {}) }
  gates.push(result)
  if (status === 'FAIL') {
    console.error(`[pipeline:GATE_FAIL] stage=${stage} reason="${reason}"`, diagnostics ? JSON.stringify(diagnostics) : '')
  } else if (status === 'PARTIAL') {
    console.warn(`[pipeline:GATE_PARTIAL] stage=${stage} reason="${reason}"`, diagnostics ? JSON.stringify(diagnostics) : '')
  } else if (status === 'WARN') {
    console.warn(`[pipeline:GATE_WARN] stage=${stage} reason="${reason}"`)
  } else {
    console.log(`[pipeline:GATE_PASS] stage=${stage} reason="${reason}"`)
  }
  return result
}

/**
 * Build a structured FAIL response. HTTP 422 = Unprocessable — pipeline
 * received the request but the data was insufficient to produce intelligence.
 */
function failResponse(
  failedStage: string,
  reason: string,
  diagnostics: Record<string, unknown>,
  gates: ValidationGate[],
) {
  const overall: ValidationStatus =
    gates.some(g => g.status === 'FAIL') ? 'FAIL'
    : gates.some(g => g.status === 'PARTIAL') ? 'PARTIAL'
    : gates.some(g => g.status === 'WARN') ? 'WARN'
    : 'PASS'
  return NextResponse.json({
    success: false,
    failedStage,
    reason,
    validation: { overall, gates },
    diagnostics,
  }, { status: 422 })
}

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json()
  const {
    url,
    mode = 'lightweight',
    force = false,
  } = body as { url: string; mode?: 'lightweight' | 'full'; force?: boolean }

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ success: false, error: 'url is required' }, { status: 400 })
  }

  const validation = validateAndNormalizeURL(url)
  if (!validation.valid || !validation.normalizedUrl) {
    return NextResponse.json(
      { success: false, error: validation.error ?? 'Invalid URL' },
      { status: 400 }
    )
  }

  const normalizedUrl = validation.normalizedUrl
  const domain = extractDomain(new URL(normalizedUrl))
  const totalStart = Date.now()
  const timing: Record<string, number> = {}
  const pipelineGates: ValidationGate[] = []

  try {
    // ── Stage 1: SCRAPE ───────────────────────────────────────
    let scrapeResult: ScrapeResult
    let quality: { score: number; note: string }
    let scrapeSource: 'cache' | 'fresh'
    let cachedAt: string

    const scrapeStart = Date.now()
    if (!force) {
      const cached = await getCachedScrape(normalizedUrl)
      if (cached) {
        scrapeResult = cached.scrapeResult
        quality = cached.quality
        scrapeSource = 'cache'
        cachedAt = cached.cachedAt
      } else {
        scrapeResult = await scrapeCompanyWebsite(normalizedUrl)
        quality = assessScrapeQuality(scrapeResult)
        scrapeSource = 'fresh'
        cachedAt = new Date().toISOString()
        saveScrapeCache(normalizedUrl, domain, scrapeResult, quality)
      }
    } else {
      scrapeResult = await scrapeCompanyWebsite(normalizedUrl)
      quality = assessScrapeQuality(scrapeResult)
      scrapeSource = 'fresh'
      cachedAt = new Date().toISOString()
      saveScrapeCache(normalizedUrl, domain, scrapeResult, quality)
    }
    timing.scrape = Date.now() - scrapeStart
    console.log(`[Timing] Scrape/Cache: ${t(timing.scrape)} | source=${scrapeSource}`)

    // Gate S1-A: Did we get any content at all?
    // L1-E: Never hard fail — if scrape is empty, synthesize minimal stub from
    // domain name and let enrichment do the work. Pipeline always continues.
    // scrapeStubInjected is checked in Gate S2 to prevent a second hard fail.
    let scrapeStubInjected = false
    if (scrapeResult.successfulUrls.length === 0 || scrapeResult.combinedContent.length < 200) {
      gate(pipelineGates, 'SCRAPE', 'WARN',
        'Scraper returned no usable content — using domain-only stub, enrichment will be primary source',
        { successfulUrls: scrapeResult.successfulUrls.length, contentLength: scrapeResult.combinedContent.length, domain })

      // Build a minimal stub so the rest of the pipeline has something to parse
      const domainWords = domain
        .replace(/\.(com|co\.in|in|net|org|io|biz|co|ltd)$/, '')
        .replace(/[_\-]/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim()
      const companyGuess = domainWords.charAt(0).toUpperCase() + domainWords.slice(1)

      const stub = [
        `# ${companyGuess}`,
        ``,
        `Website: ${normalizedUrl}`,
        ``,
        `[Direct website scraping failed — content could not be extracted.]`,
        `[Company intelligence will be sourced from external research.]`,
      ].join('\n')

      scrapeResult = {
        ...scrapeResult,
        combinedContent: stub,
        totalCharCount: stub.length,
      }
      scrapeStubInjected = true
      console.warn(`[Scraper] Empty scrape — injected domain stub for "${companyGuess}" (enrichment will be primary)`)
    }

    // ── Stage 2: Content quality assessment ──────────────────
    const cqStart = Date.now()
    const fullContent = scrapeResult.combinedContent
    const contentQuality = assessContentQuality(fullContent)
    timing.contentQuality = Date.now() - cqStart
    console.log(`[Timing] Content Quality: ${t(timing.contentQuality)} | score=${contentQuality.score} | ${contentQuality.recommendation}`)

    // Gate S1-B: Content quality warning (non-critical, pipeline continues)
    if (contentQuality.recommendation === 'low_confidence') {
      gate(pipelineGates, 'SCRAPE', 'WARN',
        `Very low content quality (score=${contentQuality.score}/100) — intelligence may be unreliable`)
    } else if (contentQuality.recommendation === 'proceed_with_caution') {
      gate(pipelineGates, 'SCRAPE', 'WARN',
        `Thin content (score=${contentQuality.score}/100) — enrichment recovery will be triggered`)
    } else {
      gate(pipelineGates, 'SCRAPE', 'PASS',
        `Content quality acceptable (score=${contentQuality.score}/100, urls=${scrapeResult.successfulUrls.length})`)
    }

    let contentQualityWarning: string | undefined
    if (contentQuality.recommendation === 'low_confidence') {
      contentQualityWarning = `Low-quality content (score: ${contentQuality.score}/100). Flags: ${contentQuality.flags.join(', ')}.`
    } else if (contentQuality.recommendation === 'proceed_with_caution') {
      contentQualityWarning = `Thin content (score: ${contentQuality.score}/100). ${contentQuality.summary}`
    }

    // ── Step 3: Extract company name from scrape title (best-effort) ──
    const companyNameFromScrape = (() => {
      const titleMatch = scrapeResult.combinedContent.match(/^#\s+(.+?)(?:\s*[|\-\u2013\u2014].*)?$/m)
        ?? scrapeResult.combinedContent.match(/<title[^>]*>([^<]{3,60})<\/title>/i)
      if (titleMatch) {
        const candidate = titleMatch[1].trim().replace(/\s+(ltd|limited|inc|corp|pvt|private|llc|plc|technologies|solutions|group)\.?\s*$/i, '').trim()
        if (candidate.length >= 3 && candidate.length <= 60) return candidate
      }
      const prefix = domain.split('.')[0]
      return prefix.charAt(0).toUpperCase() + prefix.slice(1)
    })()

    // ── Step 3b: Launch enrichment in background (always-on) ──────────
    let enrichmentResult: EnrichmentResult | null = null
    let sourcesUsed: PrioritizedSource[] = []
    let recoveryTriggered = false
    let enrichedContent = ''
    const thinContent = contentQuality.score < 60 || contentQuality.recommendation === 'low_confidence'

    const ENRICHMENT_TIMEOUT_MS = 70_000
    const enrichStart = Date.now()
    // Track actual enrichment completion time separately from LLM wall time.
    // Promise.race resolves but doesn't cancel the losing branch — keep a
    // ref to the timeout so we can clear it if enrichment wins, preventing
    // the misleading "Timeout after 70000ms" log when enrichment finished early.
    let enrichmentActualMs: number | null = null
    let enrichmentTimeoutId: ReturnType<typeof setTimeout> | null = null

    const enrichmentPromise: Promise<EnrichmentResult | null> = Promise.race([
      (async () => {
        try {
          const result = await enrichCompanyIntelligence(domain, companyNameFromScrape, {
            recovery: thinContent,
            websiteContent: fullContent,
          } satisfies EnrichmentOptions)
          enrichmentActualMs = Date.now() - enrichStart
          return result
        } catch (e) {
          enrichmentActualMs = Date.now() - enrichStart
          console.warn('[Enrichment] Non-fatal:', e instanceof Error ? e.message : String(e))
          return null
        }
      })(),
      new Promise<null>(resolve => {
        enrichmentTimeoutId = setTimeout(() => {
          console.warn(`[Enrichment] Hard timeout after ${ENRICHMENT_TIMEOUT_MS}ms — proceeding without external intelligence`)
          enrichmentActualMs = ENRICHMENT_TIMEOUT_MS   // timed out: record the cap
          resolve(null)
        }, ENRICHMENT_TIMEOUT_MS)
      }),
    ]).then(result => {
      // Clear the timeout so it doesn't fire after enrichment already won the race
      if (enrichmentTimeoutId !== null) {
        clearTimeout(enrichmentTimeoutId)
        enrichmentTimeoutId = null
      }
      return result
    })

    if (thinContent) {
      recoveryTriggered = true
      console.log(`[Timing] RECOVERY mode — score=${contentQuality.score}`)
    }

    // ── Stage 3+2: SIGNAL + PROFILE extraction (website-only) ────────
    const extractStart = Date.now()
    let extractorResult: ExtractorResult = extractSignals(fullContent, undefined)
    timing.extraction = Date.now() - extractStart
    console.log(`[Timing] Evidence Extraction (website): ${t(timing.extraction)} | ${extractorResult.signals.length} signals | primary=${extractorResult.companyProfile.primary_type}`)

    // Gate S2: CompanyProfile viability
    const profileUnknown = extractorResult.companyProfile.primary_type === 'unknown'
    const noCompanyContent = extractorResult.companySubjectCount === 0
    if (profileUnknown && noCompanyContent) {
      if (scrapeStubInjected) {
        // Scrape was empty — stub content intentionally has no classifiable signals.
        // Downgrade to WARN: enrichment is primary source, pipeline must continue.
        gate(pipelineGates, 'PROFILE', 'WARN',
          'Stub content only — profile unknown, enrichment will be sole intelligence source',
          { primary_type: extractorResult.companyProfile.primary_type, scrapeStubInjected: true })
      } else {
        // L1-E: Never hard fail — real content was scraped (scrapeStubInjected=false,
        // so a fallback source in the scraper chain did return usable content), it just
        // didn't classify cleanly. Degrade to PARTIAL and continue rather than blocking
        // the whole report; enrichment + the LLM narrative can still recover intelligence.
        gate(pipelineGates, 'PROFILE', 'PARTIAL',
          'Could not identify company type and found zero company-subject content — proceeding with reduced confidence, enrichment and LLM narrative are primary sources',
          { primary_type: extractorResult.companyProfile.primary_type, companySubjectCount: extractorResult.companySubjectCount, confidence: 30 })
      }
    } else if (profileUnknown) {
      gate(pipelineGates, 'PROFILE', 'WARN',
        `Company type uncertain (primary_type=unknown) — profile will rely on signal patterns only`)
    } else {
      gate(pipelineGates, 'PROFILE', 'PASS',
        `Profile extracted: primary=${extractorResult.companyProfile.primary_type} | companySubjectCount=${extractorResult.companySubjectCount}`)
    }

    // Gate S3: Signal extraction viability
    if (extractorResult.signals.length === 0) {
      gate(pipelineGates, 'SIGNAL', 'WARN',
        'No deterministic signals detected from website content — LLM narrative will carry full intelligence load')
    } else if (extractorResult.companySubjectCount < 3) {
      gate(pipelineGates, 'SIGNAL', 'WARN',
        `Low company-subject evidence (companySubjectCount=${extractorResult.companySubjectCount}) — signals may reflect vendor/product content not company operations`)
    } else {
      gate(pipelineGates, 'SIGNAL', 'PASS',
        `${extractorResult.signals.length} signals detected | companySubjectCount=${extractorResult.companySubjectCount}`)
    }

    // ── Option B: Soft-timeout enrichment race ────────────────────────
    // Race enrichmentPromise against a soft deadline. If enrichment resolves
    // in time: re-extract with enriched content and build an enriched prompt.
    // If soft timeout fires first: build a website-only prompt and let
    // enrichment continue in the background — it still feeds re-extraction,
    // normalization, and synthesis via the Promise.all await below.
    const ENRICHMENT_SOFT_TIMEOUT_MS = 8_000
    let promptEnriched = false
    let enrichmentWaitMs = 0

    {
      const softTimeoutPromise = new Promise<null>(resolve =>
        setTimeout(() => resolve(null), ENRICHMENT_SOFT_TIMEOUT_MS)
      )
      const softRaceStart = Date.now()
      const softRaceWinner = await Promise.race([enrichmentPromise, softTimeoutPromise])
      enrichmentWaitMs = Date.now() - softRaceStart

      if (softRaceWinner !== null) {
        // Enrichment won — capture result and re-extract before building prompt
        enrichmentResult = softRaceWinner
        sourcesUsed = enrichmentResult.sources_used ?? []
        enrichedContent = enrichmentResult.enriched_context
        const _preRecoveryCount = enrichmentResult.recovery_paths_probed?.length ?? 0

        if (enrichedContent.length > 100) {
          const preExtractStart = Date.now()
          const websiteOnlyCount = extractorResult.signals.length
          extractorResult = extractSignals(fullContent, enrichedContent)
          timing.reextraction = Date.now() - preExtractStart
          console.log(`[Bridge] Pre-prompt re-extraction: ${websiteOnlyCount} → ${extractorResult.signals.length} signals (+${extractorResult.signals.length - websiteOnlyCount}) in ${timing.reextraction}ms`)
        }

        promptEnriched = true
        console.log(`[pipeline:PROMPT_ENRICHED] enrichment resolved in ${enrichmentWaitMs}ms — LLM prompt includes ${sourcesUsed.length} external sources + ${_preRecoveryCount} recovery paths`)
      } else {
        // Soft timeout fired — proceed with website-only prompt; enrichment runs in background
        promptEnriched = false
        console.log(`[pipeline:PROMPT_WEBSITE_ONLY] enrichment not ready within ${ENRICHMENT_SOFT_TIMEOUT_MS}ms — LLM prompt is website-only; enrichment continues in background`)
      }
    }

    // ── Step 5: Build narrative prompt ──────────────────────
    const promptStart = Date.now()
    const narrativeInput = buildNarrativeInput(
      domain,
      extractorResult,
      scrapeResult.successfulUrls,
      contentQualityWarning,
    )
    const userPrompt = buildNarrativePrompt(narrativeInput)
    const systemTokens = estimateTokenCount(SYSTEM_PROMPT_V2)
    const userTokens = estimateTokenCount(userPrompt)
    const totalTokens = systemTokens + userTokens
    timing.promptBuild = Date.now() - promptStart

    console.log(`[Timing] Prompt Build: ${t(timing.promptBuild)}`)
    console.log(`[PROMPT BREAKDOWN]`)
    console.log(`  System (v2):         ${SYSTEM_PROMPT_V2.length} chars / ${systemTokens} tokens`)
    console.log(`  User prompt:         ${userPrompt.length} chars / ${userTokens} tokens`)
    console.log(`  Signal summary:      ${extractorResult.signalSummary.length} chars`)
    console.log(`  Website preview:     ${extractorResult.websitePreview.length} chars`)
    console.log(`  TOTAL TOKENS:        ${totalTokens}`)

    // ── Stage 4+5: LLM + Enrichment in parallel ──────────────
    const aiStart = Date.now()
    const [aiResponse, enrichmentRaw] = await Promise.all([
      getCompletion({
        systemPrompt: SYSTEM_PROMPT_V2,
        userPrompt,
        maxTokens: 4096,
        temperature: 0.2,
        jsonMode: true,
      }),
      enrichmentPromise,
    ])
    timing.llmAnalysis = Date.now() - aiStart
    // timing.enrichment = actual enrichment work duration, not LLM wall time.
    // enrichmentActualMs is set inside the race branch that completes first:
    //   - enrichment finishes early → real HTTP duration
    //   - timeout fires → ENRICHMENT_TIMEOUT_MS cap
    timing.enrichment = enrichmentActualMs ?? (Date.now() - enrichStart)
    console.log(`[Timing] LLM Analysis: ${t(timing.llmAnalysis)} | provider=${aiResponse.providerName} | tokens=${aiResponse.tokensUsed}`)

    // Gate S4: Enrichment (non-critical — WARN only)
    // Three cases:
    // (A) promptEnriched=true  — enrichment won soft race; already captured pre-prompt
    // (B) enrichmentRaw!=null  — enrichment arrived late (after soft timeout, while LLM ran)
    // (C) enrichmentRaw==null  — timed out entirely
    if (promptEnriched) {
      // Case A: captured before prompt — log and gate, no re-capture needed
      const _recoveryCount = enrichmentResult!.recovery_paths_probed?.length ?? 0
      console.log(`[Timing] Enrichment: ${t(timing.enrichment)} | ${sourcesUsed.length} external + ${_recoveryCount} recovery | ${enrichedContent.length} chars context (pre-prompt)`)
      gate(pipelineGates, 'ENRICHMENT', 'PASS',
        `${sourcesUsed.length} external sources | ${enrichedContent.length} chars enriched context | reached LLM prompt`)
    } else if (enrichmentRaw) {
      // Case B: arrived late — feeds re-extraction and synthesis only
      enrichmentResult = enrichmentRaw
      sourcesUsed = enrichmentResult.sources_used ?? []
      enrichedContent = enrichmentResult.enriched_context
      const _recoveryCount = enrichmentResult.recovery_paths_probed?.length ?? 0
      console.log(`[pipeline:ENRICHMENT_LATE] enrichment resolved after LLM prompt was built — feeds re-extraction and synthesis only`)
      console.log(`[Timing] Enrichment: ${t(timing.enrichment)} | ${sourcesUsed.length} external + ${_recoveryCount} recovery | ${enrichedContent.length} chars context (late)`)
      gate(pipelineGates, 'ENRICHMENT', 'PASS',
        `${sourcesUsed.length} external sources | ${enrichedContent.length} chars enriched context | LATE — did not reach LLM prompt`)
    } else {
      // Case C: timed out entirely
      timing.enrichment = timing.enrichment || (Date.now() - enrichStart)
      console.log(`[Timing] Enrichment: ${t(timing.enrichment)} | no results`)
      gate(pipelineGates, 'ENRICHMENT', 'WARN',
        'Enrichment returned no results (timeout or all sources failed) — intelligence based on website only')
    }

    // ── Step 6b: Re-run evidence extraction with enriched content ───────
    // Skipped if promptEnriched=true — pre-prompt re-extraction already ran.
    // Runs only for Case B (late enrichment) so synthesis sees enriched signals.
    const websiteOnlySignalCount = extractorResult.signals.length
    if (!promptEnriched && enrichedContent.length > 100) {
      const reextractStart = Date.now()
      extractorResult = extractSignals(fullContent, enrichedContent)
      timing.reextraction = Date.now() - reextractStart
      console.log(`[Bridge] Re-extraction (late): website=${websiteOnlySignalCount} → enriched=${extractorResult.signals.length} signals (+${extractorResult.signals.length - websiteOnlySignalCount}) in ${timing.reextraction}ms`)
    } else if (promptEnriched) {
      console.log(`[Bridge] Re-extraction skipped — already ran pre-prompt | final signal count: ${extractorResult.signals.length}`)
    } else {
      timing.reextraction = 0
      console.log(`[Bridge] No enriched content — final signal count: ${websiteOnlySignalCount}`)
    }

    // ── Step 6c: Signal clustering + deterministic opportunities ────────
    // Clusters: used for logging + passed into synthesis. Opportunity generation happens once in normalize.ts.
    const signalClusters = clusterSignals(extractorResult.detectedFactors as Partial<Record<string, boolean>>, extractorResult.companyProfile)
    console.log(`[Clustering] ${signalClusters.length} clusters | primary=${extractorResult.companyProfile.primary_type}`)

    // ── Step 4b: Bridge extractor → pipeline inputs ──────────
    const EXTRACTOR_URGENCY_WEIGHTS: Record<string, number> = {
      capacity_expansion:              35,
      acquisition:                     30,
      new_facility:                    25,
      ai_ml_hiring:                    20,
      ai_mention:                      15,
      industry40_initiative:           15,
      digital_transformation:          15,
      automation_engineering_hiring:   10,
      automation_investment:           10,
      digital_transformation_hiring:   10,
      new_market_entry:                10,
      erp_implementation:               8,
      mes_adoption:                     8,
      iot_investment:                   8,
      multi_location_operations:        5,
      operations_hiring_surge:          5,
      leadership_hiring:                3,
      sustainability_initiative:        3,
      quality_certification_pursuit:    3,
    }
    const urgencyRaw = extractorResult.signals
      .filter(s => s.is_company_subject)
      .reduce((sum, sig) => sum + (EXTRACTOR_URGENCY_WEIGHTS[sig.type] ?? 0), 0)
    const computed_why_now_score = Math.min(10, Math.round(urgencyRaw / 8))

    const GROWTH_SIG_TYPES  = new Set(['new_facility', 'capacity_expansion', 'new_market_entry', 'revenue_milestone'])
    const HIRING_SIG_TYPES  = new Set(['digital_transformation_hiring', 'ai_ml_hiring', 'automation_engineering_hiring', 'operations_hiring_surge', 'leadership_hiring'])
    const DIGITAL_SIG_TYPES = new Set(['digital_transformation', 'industry40_initiative', 'erp_implementation', 'mes_adoption', 'automation_investment', 'iot_investment'])
    const BIZ_SIG_TYPES     = new Set(['ai_mention', 'acquisition', 'multi_location_operations', 'quality_certification_pursuit', 'sustainability_initiative'])

    const toNormSig = (sig: ExtractorResult['signals'][number]) => ({
      type:     sig.type,
      category: sig.type,
      strength: sig.strength,
      evidence: sig.best_quote,
    })

    const extractor_growth_signals  = extractorResult.signals.filter(s => GROWTH_SIG_TYPES.has(s.type)).map(toNormSig)
    const extractor_hiring_signals  = extractorResult.signals.filter(s => HIRING_SIG_TYPES.has(s.type)).map(toNormSig)
    const extractor_digital_signals = extractorResult.signals.filter(s => DIGITAL_SIG_TYPES.has(s.type)).map(toNormSig)
    const extractor_biz_signals     = extractorResult.signals.filter(s => BIZ_SIG_TYPES.has(s.type)).map(toNormSig)

    const EXTRACTOR_TO_SYNTHESIS: Record<string, string> = {
      new_facility:                   'capacity_expansion',
      capacity_expansion:             'capacity_expansion',
      new_market_entry:               'recent_news_or_event',
      revenue_milestone:              'financial_indicator',
      digital_transformation_hiring:  'hiring_signal',
      ai_ml_hiring:                   'hiring_signal',
      automation_engineering_hiring:  'hiring_signal',
      operations_hiring_surge:        'hiring_signal',
      leadership_hiring:              'hiring_signal',
      digital_transformation:         'digital_transformation',
      industry40_initiative:          'industry40_initiative',
      erp_implementation:             'digital_transformation',
      mes_adoption:                   'automation_keywords',
      automation_investment:          'automation_keywords',
      iot_investment:                 'industry40_initiative',
      ai_mention:                     'ai_mention',
      multi_location_operations:      'multi_location_operations',
      acquisition:                    'recent_news_or_event',
      quality_certification_pursuit:  'digital_transformation',
      sustainability_initiative:      'digital_transformation',
    }

    const extractorEnrichedSignals: EnrichedSignal[] = extractorResult.signals.map(sig => ({
      type:        EXTRACTOR_TO_SYNTHESIS[sig.type] ?? sig.type,
      quote:       sig.best_quote,
      source:      sig.evidence[0]?.source_url ?? '',
      source_type: sig.evidence[0]?.page_type === 'careers'       ? 'careers_page'
                 : sig.evidence[0]?.page_type === 'investor'      ? 'investor_presentation'
                 : sig.evidence[0]?.page_type === 'press'         ? 'press_release'
                 : sig.evidence[0]?.page_type === 'annual_report' ? 'annual_report'
                 : 'corporate_website',
      source_tier: sig.evidence[0]?.source_tier ?? 'tier2',
      relevance:   sig.strength === 'strong' ? 'high' : sig.strength === 'moderate' ? 'medium' : 'low',
    }))

    console.log(`[Bridge] why_now=${computed_why_now_score} | growth=${extractor_growth_signals.length} | hiring=${extractor_hiring_signals.length} | digital=${extractor_digital_signals.length} | biz=${extractor_biz_signals.length} | synthesis=${extractorEnrichedSignals.length}`)
    console.log(`[Bridge] website_signals=${websiteOnlySignalCount} | final_signals=${extractorResult.signals.length} | delta=+${extractorResult.signals.length - websiteOnlySignalCount}`)

    // ── Stage 5+6: LLM parse + normalization ─────────────────
    let analysisResult: unknown = null
    let parseError: string | null = null
    let synthesisResult: SynthesisResult | null = null

    try {
      // Gate S5: LLM parse
      let rawParsed: Record<string, unknown>
      try {
        rawParsed = JSON.parse(extractJsonFromLLMResponse(aiResponse.content))
      } catch (parseErr) {
        const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr)
        gate(pipelineGates, 'LLM_PARSE', 'FAIL',
          `JSON.parse failed: ${errMsg}`,
          { contentLength: aiResponse.content.length, preview: aiResponse.content.slice(0, 200) })
        console.error('[pipeline:LLM_PARSE_FAIL]', errMsg)
        return failResponse('LLM_PARSE', `LLM returned invalid JSON: ${errMsg}`, {
          provider: aiResponse.providerName,
          tokensUsed: aiResponse.tokensUsed,
          contentLength: aiResponse.content.length,
          rawPreview: aiResponse.content.slice(0, 300),
        }, pipelineGates)
      }

      // Warn if LLM produced no substantive output
      const _llmPainCount    = Array.isArray(rawParsed.pain_points)         ? (rawParsed.pain_points as unknown[]).length : 0
      const _llmOppCount     = Array.isArray(rawParsed.ai_opportunities)    ? (rawParsed.ai_opportunities as unknown[]).length : 0
      const _llmContactCount = Array.isArray(rawParsed.recommended_contacts) ? (rawParsed.recommended_contacts as unknown[]).length : 0
      console.log('[pipeline:LLM_OUT]', JSON.stringify({ pain_points_count: _llmPainCount, ai_opportunities_count: _llmOppCount, contacts_count: _llmContactCount }))

      if (_llmOppCount === 0 && _llmPainCount === 0) {
        gate(pipelineGates, 'LLM_PARSE', 'WARN',
          'LLM produced no pain_points or ai_opportunities — narrative may be incomplete')
      } else {
        gate(pipelineGates, 'LLM_PARSE', 'PASS',
          `LLM output: ${_llmPainCount} pain_points | ${_llmOppCount} opportunities | ${_llmContactCount} contacts`)
      }

      // ── Why Now narrative floor ──────────────────────────────
      const _llmNarrText = (() => {
        const whyNow = rawParsed.why_now
        const whyNowText = typeof whyNow === 'string' ? whyNow
          : (typeof whyNow === 'object' && whyNow !== null)
            ? String((whyNow as Record<string,unknown>).explanation ?? (whyNow as Record<string,unknown>).text ?? '')
            : ''
        return [String(rawParsed.company_summary ?? ''), whyNowText].join(' ').toLowerCase()
      })()
      const _narrativeFloor =
        /\b(?:capacity\s+expan|new\s+(?:plant|facilit)|greenfield|acqui(?:red|sition))\b/.test(_llmNarrText) ? 6
        : /\b(?:expan(?:sion|ding)\s+into|ai[\s-]powered\s+digitali)\b/.test(_llmNarrText) ? 5
        : /\b(?:industry\s*4\.0|digital\s+transformation\s+(?:initiative|journey|program|roadmap)|investing\s+in\s+(?:digital|ai|automation))\b/.test(_llmNarrText) ? 4
        : 0
      const _effectiveWhyNowScore = Math.max(computed_why_now_score, _narrativeFloor)
      if (_narrativeFloor > computed_why_now_score) {
        console.log(`[Bridge] Why Now floor applied: extractor=${computed_why_now_score} → narrative_floor=${_narrativeFloor} → effective=${_effectiveWhyNowScore}`)
      }

      const merged = {
        ...rawParsed,
        detected_factors:                extractorResult.detectedFactors,
        content_quality_flags:           extractorResult.contentFlags,
        why_now_score:                   _effectiveWhyNowScore,
        confidence_level:                (extractorResult.signals.length >= 4 ? 'high' : extractorResult.signals.length >= 2 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
        growth_signals:                  extractor_growth_signals,
        hiring_signals:                  extractor_hiring_signals,
        digital_transformation_signals:  extractor_digital_signals,
        business_signals:                extractor_biz_signals,
        _extractor: extractorResult,
      }

      // Gate S6: Normalization
      try {
        analysisResult = normalizeAnalysisResult(merged as Record<string, unknown>)
      } catch (normErr) {
        const errMsg = normErr instanceof Error ? normErr.message : String(normErr)
        gate(pipelineGates, 'NORMALIZATION', 'FAIL',
          `normalizeAnalysisResult threw: ${errMsg}`)
        console.error('[pipeline:NORMALIZATION_FAIL]', errMsg)
        return failResponse('NORMALIZATION', `Normalizer failed: ${errMsg}`, {
          signalCount: extractorResult.signals.length,
          primaryType: extractorResult.companyProfile.primary_type,
        }, pipelineGates)
      }

      // Post-normalization integrity check
      const _norm = analysisResult as Record<string, unknown>
      const _normPainCount    = Array.isArray(_norm.pain_points)           ? (_norm.pain_points as unknown[]).length : 0
      const _normOppCount     = Array.isArray(_norm.opportunities)         ? (_norm.opportunities as unknown[]).length : 0
      const _normContactCount = Array.isArray(_norm.recommended_contacts)  ? (_norm.recommended_contacts as unknown[]).length : 0
      console.log('[pipeline:NORM_OUT]', JSON.stringify({ pain_points_count: _normPainCount, opportunities_count: _normOppCount, contacts_count: _normContactCount }))

      if (_llmPainCount > 0 && _normPainCount === 0) console.warn('[pipeline:DROP] pain_points dropped by normalizer — check flattenSections')
      if (_llmOppCount > 0 && _normOppCount === 0)   console.warn('[pipeline:DROP] ai_opportunities dropped by normalizer — check flattenSections')
      if (_llmContactCount > 0 && _normContactCount === 0) console.warn('[pipeline:DROP] recommended_contacts dropped by normalizer — check flattenSections')

      if (_normOppCount === 0 && _normPainCount === 0) {
        gate(pipelineGates, 'NORMALIZATION', 'WARN',
          'Normalizer produced 0 pain_points and 0 opportunities — LLM output may have used unexpected schema keys')
      } else {
        gate(pipelineGates, 'NORMALIZATION', 'PASS',
          `Normalized: ${_normPainCount} pain_points | ${_normOppCount} opportunities | ${_normContactCount} contacts`)
      }

      console.log('[test-analysis] company_name:', (analysisResult as Record<string, unknown>).company_name)
      console.log('[test-analysis] signals detected:', extractorResult.signals.length)

      // ── Stage 7: SYNTHESIS ────────────────────────────────────
      const synthStart = Date.now()
      try {
        synthesisResult = synthesizeIntelligence({
          analysis: analysisResult as Parameters<typeof synthesizeIntelligence>[0]['analysis'],
          enrichedSignals: extractorEnrichedSignals,
          sourcesUsed,
          companyProfile: extractorResult.companyProfile,
        })
        timing.synthesis = Date.now() - synthStart
        console.log(`[Timing] Synthesis: ${t(timing.synthesis)} | themes=${synthesisResult.strategicThemes.length} | quality=${synthesisResult.intelligenceQuality.overall}/100`)

        if (synthesisResult.strategicThemes.length === 0) {
          gate(pipelineGates, 'SYNTHESIS', 'WARN',
            'Synthesis produced 0 strategic themes — signal count or confidence may be too low')
        } else {
          gate(pipelineGates, 'SYNTHESIS', 'PASS',
            `${synthesisResult.strategicThemes.length} themes | quality=${synthesisResult.intelligenceQuality.overall}/100`)
        }
      } catch (synthErr) {
        timing.synthesis = Date.now() - synthStart
        const errMsg = synthErr instanceof Error ? synthErr.message : String(synthErr)
        gate(pipelineGates, 'SYNTHESIS', 'FAIL', `Synthesis threw: ${errMsg}`)
        return failResponse('SYNTHESIS', `Synthesis failed: ${errMsg}`, {
          signalCount: extractorResult.signals.length,
          primaryType: extractorResult.companyProfile.primary_type,
        }, pipelineGates)
      }

      // ── Confidence V2 (post-synthesis, multi-factor) ─────────
      const _confSignals = extractorResult.signals
      const _totalSig = _confSignals.length
      const _t1t2Count = _confSignals.filter(s =>
        s.evidence.some(e => e.source_tier === 'tier1' || e.source_tier === 'tier2')
      ).length
      const _companySubjectCount = _confSignals.filter(s => s.is_company_subject).length
      const _uniqueTypes = new Set(_confSignals.map(s => s.type)).size
      const _clusterCount = synthesisResult?.strategicThemes.length ?? 0

      const _t1t2Ratio     = _totalSig > 0 ? Math.min(1, _t1t2Count / _totalSig) : 0
      const _relevanceRatio = _totalSig > 0 ? Math.min(1, _companySubjectCount / _totalSig) : 0
      const _diversityScore = Math.min(1, _uniqueTypes / 8)
      const _clusterScore   = Math.min(1, _clusterCount / 4)

      const _confScore = (_t1t2Ratio * 30) + (_relevanceRatio * 25) + (_diversityScore * 25) + (_clusterScore * 20)
      const confidence_v2: 'high' | 'medium' | 'low' =
        _confScore >= 70 ? 'high' : _confScore >= 40 ? 'medium' : 'low'

      console.log(`[ConfV2] t1t2=${(_t1t2Ratio*100).toFixed(0)}% rel=${(_relevanceRatio*100).toFixed(0)}% div=${(_diversityScore*100).toFixed(0)}% cls=${(_clusterScore*100).toFixed(0)}% → score=${_confScore.toFixed(1)} → ${confidence_v2}`)

      // ── Executive Brief V2 ────────────────────────────────────
      if (analysisResult) {
        const _ar = analysisResult as Record<string, unknown>
        const _existingBrief = _ar.executive_brief as Record<string, unknown> | null | undefined

        const CLUSTER_DEMAZE_ENTRY: Array<{ pattern: RegExp; entryPoint: string; valueAngle: string }> = [
          { pattern: /industry.?4|smart.?factory|iiot|digital.?twin/i,
            entryPoint: 'AI-Powered Smart Factory & IIoT',
            valueAngle: 'real-time production intelligence across lines and plants' },
          { pattern: /digital.?transform|erp|sap|oracle|mes/i,
            entryPoint: 'Digital Operations Platform',
            valueAngle: 'accelerating ERP/MES data into actionable decisions' },
          { pattern: /automat|robot/i,
            entryPoint: 'Intelligent Automation & Robotics Integration',
            valueAngle: 'end-to-end process automation with AI quality gates' },
          { pattern: /ai|machine.?learn|ml/i,
            entryPoint: 'AI Strategy & Deployment',
            valueAngle: 'production-grade AI from pilot to scale' },
          { pattern: /capac|expan|new.?plant|greenfield|facilit/i,
            entryPoint: 'Scalable Operations Intelligence',
            valueAngle: 'unified intelligence platform ready for multi-site rollout' },
          { pattern: /hir|talent|workforce/i,
            entryPoint: 'AI Workforce Enablement',
            valueAngle: 'reducing hiring pressure with intelligent process automation' },
          { pattern: /supply.?chain|procure|logistic/i,
            entryPoint: 'Supply Chain Intelligence',
            valueAngle: 'AI-driven procurement and vendor risk management' },
          { pattern: /quality|compliance|certif/i,
            entryPoint: 'AI Quality Management',
            valueAngle: 'defect detection and compliance automation at line speed' },
          { pattern: /sustain|esg|environment/i,
            entryPoint: 'Sustainability Intelligence Platform',
            valueAngle: 'AI-powered ESG tracking and carbon footprint optimization' },
        ]

        const CONF_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 }
        const _sortedClusters = [...(synthesisResult?.strategicThemes ?? [])]
          .sort((a, b) => (CONF_RANK[b.confidence] ?? 0) - (CONF_RANK[a.confidence] ?? 0))
          .slice(0, 3)

        const _companyName = (_ar.company_name as string | undefined) ?? domain

        const _strategicBullets = _sortedClusters.map(cluster => {
          const themeText = cluster.name ?? cluster.id ?? ''
          const matchedEntry = CLUSTER_DEMAZE_ENTRY.find(e => e.pattern.test(themeText))
          if (matchedEntry) {
            return `${_companyName} shows active ${themeText} — Demaze delivers ${matchedEntry.entryPoint}: ${matchedEntry.valueAngle}.`
          }
          const anchorSignal = (cluster.signalTypes?.[0] as string | undefined) ?? themeText
          return `${_companyName} has confirmed ${anchorSignal} activity — Demaze can accelerate with targeted AI/automation solutions.`
        })

        const _evidenceBullets = extractorResult.signals
          .filter(s => s.is_company_subject)
          .slice(0, 2)
          .map(sig => {
            const quote = sig.best_quote.length > 110 ? sig.best_quote.slice(0, 107) + '\u2026' : sig.best_quote
            return `Evidence: "${quote}"`
          })

        const _briefBullets = [..._strategicBullets, ..._evidenceBullets]

        const _opps = _ar.opportunities as Array<{ title?: string; source?: string }> | undefined
        const _topOppTitle =
          _opps?.find(o => o.source === 'deterministic')?.title ??
          _opps?.[0]?.title ??
          (_existingBrief?.what_to_sell as string | undefined) ??
          'AI Operations Platform'

        ;(_ar).executive_brief = {
          ...(_existingBrief ?? {}),
          what_we_observed: _briefBullets.length > 0 ? _briefBullets : (_existingBrief?.what_we_observed ?? []),
          what_to_sell: _topOppTitle,
          overall_confidence: confidence_v2,
          confidence_score: Math.round(_confScore),
        }

        ;(_ar).confidence_level = confidence_v2

        console.log(`[BriefV2] ${_strategicBullets.length} strategic bullets + ${_evidenceBullets.length} evidence quotes | top opp="${_topOppTitle}" | confidence=${confidence_v2} (score=${_confScore.toFixed(1)})`)
      }
    } catch (e) {
      parseError = `Unexpected error in parse/normalize/synthesis: ${e instanceof Error ? e.message : String(e)}`
      console.error('[test-analysis]', parseError)
    }

    timing.total = Date.now() - totalStart
    console.log('[Timing] ---------------------------------------------------')
    console.log(`[Timing] Scrape/Cache:        ${t(timing.scrape)}`)
    console.log(`[Timing] Content Quality:     ${t(timing.contentQuality)}`)
    console.log(`[Timing] Evidence Extraction: ${t(timing.extraction)} (website-only)`)
    console.log(`[Timing] Re-extraction:       ${t(timing.reextraction ?? 0)} (post-enrichment)`)
    const _enrichSummary = enrichmentResult
      ? `${enrichmentResult.sources_used.length} external + ${enrichmentResult.recovery_paths_probed?.length ?? 0} recovery paths${recoveryTriggered ? ' (thin-content recovery active)' : ''}`
      : 'no results'
    console.log(`[Timing] Enrichment:          ${t(timing.enrichment)} | ${_enrichSummary}`)
    console.log(`[Timing] Enrichment Wait:     ${t(enrichmentWaitMs)} (soft_timeout=${ENRICHMENT_SOFT_TIMEOUT_MS}ms | prompt_enriched=${promptEnriched})`)
    console.log(`[Timing] Prompt Build:        ${t(timing.promptBuild)}`)
    console.log(`[Timing] LLM Analysis:        ${t(timing.llmAnalysis)}`)
    console.log(`[Timing] Synthesis:           ${t(timing.synthesis ?? 0)}`)
    console.log(`[Timing] Total:               ${t(timing.total)}`)
    console.log('[Timing] ---------------------------------------------------')
    console.log('[pipeline:GATES]', JSON.stringify(pipelineGates.map(g => `${g.stage}:${g.status}`)))

    // Derive overall validation status from accumulated gates
    const _overallStatus: ValidationStatus =
      pipelineGates.some(g => g.status === 'FAIL') ? 'FAIL'
      : pipelineGates.some(g => g.status === 'PARTIAL') ? 'PARTIAL'
      : pipelineGates.some(g => g.status === 'WARN') ? 'WARN'
      : 'PASS'
    console.log(`[pipeline:GATE_OVERALL] overall=${_overallStatus} | gates=${pipelineGates.length}`)

    return NextResponse.json({
      success: true,
      domain,
      mode,
      executionTimeMs: timing.total,
      timing,
      validation: {
        overall: _overallStatus,
        gates: pipelineGates,
      },

      // Enrichment timing metrics
      promptEnriched,
      enrichmentWaitMs,

      // Token usage
      tokenUsage: {
        v2_total: totalTokens,
        system_tokens: systemTokens,
        user_tokens: userTokens,
        signals_detected: extractorResult.signals.length,
      },

      // Cache metadata
      scrapeSource,
      cachedAt,
      scrapeResult,
      quality,

      // Content quality
      contentQuality,

      // Evidence extraction results
      extractorResult: {
        signals: extractorResult.signals,
        detectedFactors: extractorResult.detectedFactors,
        factorSourceMap: extractorResult.factorSourceMap,
        companyProfile: extractorResult.companyProfile,
        companyProfileEvidence: extractorResult.companyProfileEvidence,
        contentFlags: extractorResult.contentFlags,
        companySubjectCount: extractorResult.companySubjectCount,
        signalSummary: extractorResult.signalSummary,
      },
      signalClusters,

      analysisResult: analysisResult ? (analysisResult as Record<string, unknown>) : undefined,
      parseError: parseError ?? null,
      synthesisResult: synthesisResult ?? undefined,
      recoveryTriggered,

      aiMeta: {
        model: aiResponse.model,
              provider: aiResponse.providerName,
        tokensUsed: aiResponse.tokensUsed,
        latencyMs: timing.llmAnalysis,
        rawResponse: aiResponse.content,
      },

      prompts: {
        systemPrompt: SYSTEM_PROMPT_V2,
        userPrompt,
        estimatedInputTokens: totalTokens,
      },

      enrichmentMeta: enrichmentResult ? {
        company_name: enrichmentResult.company_name,
        sources_found: enrichmentResult.sources_found.length,
        sources_used: sourcesUsed.length,
        signals_extracted: enrichmentResult.enriched_signals.length,
        enriched_at: new Date().toISOString(),
      } : null,

      sourcesUsed,
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[test-analysis] Fatal error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

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
import { normalizeAnalysisResult, shouldWarnEmptyPainPoints } from '@/lib/pipeline/normalize'
import { getCachedScrape, saveScrapeCache } from '@/lib/cache/scrape-cache'
import { assessContentQuality } from '@/lib/pipeline/content-quality'
import {
  discoverAndFetchExternalSources, probeRecoveryPaths, buildEnrichmentResult, detectConsumerSite,
  type EnrichmentResult, type EnrichedSignal,
} from '@/lib/enrichment/web-enricher'
import type { DiscoveredSource } from '@/lib/enrichment/discovery-engine'
import { discoverCompanyWebsite, type WebsiteDiscoveryResult } from '@/lib/enrichment/website-discovery'
import { extractSignals, type ExtractorResult } from '@/lib/pipeline/evidence-extractor'
import { clusterSignals } from '@/lib/pipeline/signal-clustering'
import type { PrioritizedSource } from '@/lib/enrichment/source-prioritizer'
import { discoverCompetitorsFromOfferings, discoverCompetitorsFromBusinessProfile, mergeCompetitorResults, type CompetitorDiscoveryResult } from '@/lib/enrichment/competitor-discovery'
import { discoverICPSegments, discoverICPSegmentsFromOfferings, discoverICPSegmentsFromBusinessProfile, mergeICPResults, type ICPDiscoveryResult } from '@/lib/enrichment/icp-generator'
import { discoverMarketIntelligence, type MarketIntelligenceResult } from '@/lib/enrichment/market-intelligence'
import { extractBusinessProfile, emptyBusinessProfile, isEmptyBusinessProfile, type CompanyBusinessProfile } from '@/lib/pipeline/business-profile'
import { matchProofPoints } from '@/lib/knowledge/proof-point-matcher'
import { synthesizeIntelligence } from '@/lib/synthesis'
import type { SynthesisResult } from '@/lib/synthesis'
import { logger } from '@/lib/logger'

function t(ms: number): string { return `${ms}ms` }

// ── Company-name guess from a bare domain ──────────────────────
// Used (a) as the pre-scrape company-name guess for kicking off enrichment
// discovery before scraping starts (item 2, 2026-07-12), and (b) as the
// empty-scrape stub-injection fallback. Word-boundary splitting on dashes/
// underscores/camelCase — same discipline as matchesKeyword()'s short-keyword
// substring-match fix, just for display quality here rather than correctness.
function guessCompanyNameFromDomain(domain: string): string {
  const words = domain
    .replace(/\.(com|co\.in|in|net|org|io|biz|co|ltd)$/, '')
    .replace(/[_\-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

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
    logger.error('pipeline', `GATE_FAIL stage=${stage} reason="${reason}"`, diagnostics)
  } else if (status === 'PARTIAL') {
    logger.warn('pipeline', `GATE_PARTIAL stage=${stage} reason="${reason}"`, diagnostics)
  } else if (status === 'WARN') {
    logger.warn('pipeline', `GATE_WARN stage=${stage} reason="${reason}"`)
  } else {
    logger.info('pipeline', `GATE_PASS stage=${stage} reason="${reason}"`)
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
    url: rawUrl,
    companyName: rawCompanyName,
    mode = 'lightweight',
    force = false,
  } = body as { url?: string; companyName?: string; mode?: 'lightweight' | 'full'; force?: boolean }

  if ((!rawUrl || typeof rawUrl !== 'string') && (!rawCompanyName || typeof rawCompanyName !== 'string')) {
    return NextResponse.json({ success: false, error: 'url or companyName is required' }, { status: 400 })
  }

  // ── Step 0: Website discovery (company-name-only input) ──────────
  // Only runs when no URL was given directly — a URL provided by the caller
  // IS the confirmed identity, no need to re-derive it. See CLAUDE.md "Core
  // reframe" — this is the first step of the company-identity pipeline.
  let websiteDiscovery: WebsiteDiscoveryResult | null = null
  let url = rawUrl

  if (!url && rawCompanyName) {
    websiteDiscovery = await discoverCompanyWebsite(rawCompanyName)
    logger.info('WebsiteDiscovery', `"${rawCompanyName}" -> status=${websiteDiscovery.status} domain=${websiteDiscovery.domain} confidence=${websiteDiscovery.confidence}`)
    if (websiteDiscovery.status === 'confirmed' && websiteDiscovery.domain) {
      url = `https://${websiteDiscovery.domain}`
    }
    // status === 'ambiguous' | 'not_found': url stays undefined on purpose —
    // never guess. Pipeline proceeds below on enrichment-only evidence via the
    // existing empty-scrape stub path, same as a site that fails to scrape.
  }

  let normalizedUrl: string | null = null
  let domain = ''

  if (url) {
    const validation = validateAndNormalizeURL(url)
    if (!validation.valid || !validation.normalizedUrl) {
      return NextResponse.json(
        { success: false, error: validation.error ?? 'Invalid URL' },
        { status: 400 }
      )
    }
    normalizedUrl = validation.normalizedUrl
    domain = extractDomain(new URL(normalizedUrl))
  }

  const totalStart = Date.now()
  const timing: Record<string, number> = {}
  const pipelineGates: ValidationGate[] = []

  // ── Item 2 (2026-07-12): kick off enrichment discovery+fetch NOW ────────
  // Discovery only needs domain + a company-name guess — both already known
  // at this point, before the website scrape even starts. Previously this
  // entire call waited until after scrape completed for no real dependency
  // reason. Not awaited here — this promise starts executing immediately per
  // normal JS semantics and runs concurrently with Stage 1 (SCRAPE) below;
  // it's awaited later, inside the existing enrichmentPromise race, by which
  // point it's often already resolved. companyGuess is a lower-precision
  // stand-in for companyNameFromScrape (computed later, post-scrape, from
  // the actual page title) — accepted trade-off, not worth re-running
  // discovery once a better name is known.
  const companyGuess = rawCompanyName?.trim() || guessCompanyNameFromDomain(domain)
  const discoveryStart = Date.now()
  let discoveryActualMs: number | null = null
  const discoveryPromise: Promise<{ discovered: DiscoveredSource[]; prioritized: PrioritizedSource[]; contextBlocks: string[] }> =
    (async () => {
      try {
        const result = await discoverAndFetchExternalSources(domain, companyGuess)
        discoveryActualMs = Date.now() - discoveryStart
        return result
      } catch (e) {
        discoveryActualMs = Date.now() - discoveryStart
        logger.warn('Enrichment', 'Discovery/fetch non-fatal', e instanceof Error ? e.message : String(e))
        return { discovered: [], prioritized: [], contextBlocks: [] }
      }
    })()

  // ── Competitor Discovery (Phase 2 item 1) — business-understanding rebuild
  // (2026-07-16): there is no pre-scrape name-based pass anymore (a real user
  // session flagged the old name-based discoverCompetitors() as fundamentally
  // wrong — it collides with unrelated same-named companies and never
  // reflects what the company actually does). Competitor discovery now
  // always waits for extraction + extractBusinessProfile() below, since it
  // needs to know the company's services/positioning before it can build a
  // meaningful query. See businessProfilePromise / offeringCompetitorPromise
  // and the Step 4b block further down for the actual kickoff+await.

  // ── ICP Generator (Phase 2 item 2) — kicked off pre-scrape, same as before
  // the business-understanding rebuild. This self-referential "we serve X"
  // base pass is NOT the pattern the user flagged (Target Segments genuinely
  // does include industries the company states it serves) so it's unchanged
  // — a business-profile-driven supplementary pass is added later (Step 4c)
  // once extractBusinessProfile() resolves, merged in alongside this base,
  // never replacing it. No soft/late-arrival split: if it's not ready in
  // time the prompt just renders an empty [ICP CANDIDATES] block.
  const icpDiscoveryPromise: Promise<ICPDiscoveryResult> =
    discoverICPSegments(companyGuess, domain).catch(e => {
      logger.warn('ICPGenerator', 'Non-fatal', e instanceof Error ? e.message : String(e))
      return {
        segments: [], candidates: [], sufficiency: 'insufficient' as const,
        reason: `discoverICPSegments threw: ${e instanceof Error ? e.message : String(e)}`,
        candidates_considered: 0,
      }
    })

  // ── Market Intelligence Layer (Phase 2 item 6) — kicked off at the same
  // point as icpDiscoveryPromise. Only needs companyName+domain (same as
  // that), not primary_type/classification
  // — search queries are anchored on the company name itself ("<name>
  // industry trends" etc.), so this doesn't need to wait for Stage 1 SCRAPE
  // or evidence extraction to know the company's industry. No LLM
  // narration step exists for this module (see market-intelligence.ts
  // header), so unlike ENRICHMENT there's nothing to "arrive late" into —
  // it's either ready by the bounded await below or it times out.
  const marketIntelPromise: Promise<MarketIntelligenceResult> =
    discoverMarketIntelligence(companyGuess, domain).catch(e => {
      logger.warn('MarketIntelligence', 'Non-fatal', e instanceof Error ? e.message : String(e))
      return {
        items: [], sufficiency: 'insufficient' as const,
        reason: `discoverMarketIntelligence threw: ${e instanceof Error ? e.message : String(e)}`,
        candidates_considered: 0,
      }
    })

  try {
    // ── Stage 1: SCRAPE ───────────────────────────────────────
    let scrapeResult: ScrapeResult
    let quality: { score: number; note: string }
    let scrapeSource: 'cache' | 'fresh' | 'none'
    let cachedAt: string

    const scrapeStart = Date.now()
    if (!normalizedUrl) {
      // No confirmed website (company-name-only input, discovery came back
      // ambiguous/not_found). Synthesize an empty result — the existing
      // stub-injection path just below treats this identically to a website
      // that failed to scrape, so no separate code path is needed.
      scrapeResult = {
        pages: [], combinedContent: '', successfulUrls: [], failedUrls: [],
        totalCharCount: 0, wasTruncated: false, discoveryMethod: 'homepage_only',
        scrapedAt: new Date().toISOString(),
        debug: {
          homepageLinksRaw: 0, homepageLinksSameDomain: 0, linkScores: [],
          urlsSelectedForScraping: [], sitemapChecked: false, sitemapUrlsFound: 0,
          discoveryMethod: 'homepage_only', isB2CSite: false, b2cPatternsHit: 0,
          corporateSeedPathsProbed: 0,
          warnings: [`No website confirmed for "${rawCompanyName}" (${websiteDiscovery?.status}) — proceeding enrichment-only`],
          errors: [],
        },
      }
      quality = { score: 0, note: 'No website confirmed' }
      scrapeSource = 'none'
      cachedAt = new Date().toISOString()
    } else if (!force) {
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
    logger.info('Timing', `Scrape/Cache: ${t(timing.scrape)} | source=${scrapeSource}`)

    // Gate S1-A: Did we get any content at all?
    // L1-E: Never hard fail — if scrape is empty, synthesize minimal stub from
    // domain name and let enrichment do the work. Pipeline always continues.
    // scrapeStubInjected is checked in Gate S2 to prevent a second hard fail.
    let scrapeStubInjected = false
    if (scrapeResult.successfulUrls.length === 0 || scrapeResult.combinedContent.length < 200) {
      gate(pipelineGates, 'SCRAPE', 'WARN',
        'Scraper returned no usable content — using domain-only stub, enrichment will be primary source',
        { successfulUrls: scrapeResult.successfulUrls.length, contentLength: scrapeResult.combinedContent.length, domain })

      // Build a minimal stub so the rest of the pipeline has something to parse.
      // Reuses the same companyGuess computed above (pre-scrape, for the
      // enrichment discovery kickoff) — same priority: caller-given name,
      // else domain-derived guess.
      const stub = [
        `# ${companyGuess}`,
        ``,
        normalizedUrl ? `Website: ${normalizedUrl}` : `Website: not found`,
        ``,
        normalizedUrl
          ? `[Direct website scraping failed — content could not be extracted.]`
          : `[No official website could be confirmed for "${companyGuess}"${websiteDiscovery ? ` (${websiteDiscovery.status})` : ''}.]`,
        `[Company intelligence will be sourced from external research.]`,
      ].join('\n')

      scrapeResult = {
        ...scrapeResult,
        combinedContent: stub,
        totalCharCount: stub.length,
      }
      scrapeStubInjected = true
      logger.warn('Scraper', `Empty scrape — injected domain stub for "${companyGuess}" (enrichment will be primary)`)
    }

    // ── Stage 2: Content quality assessment ──────────────────
    const cqStart = Date.now()
    const fullContent = scrapeResult.combinedContent
    const contentQuality = assessContentQuality(fullContent)
    timing.contentQuality = Date.now() - cqStart
    logger.info('Timing', `Content Quality: ${t(timing.contentQuality)} | score=${contentQuality.score} | ${contentQuality.recommendation}`)

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
      return guessCompanyNameFromDomain(domain)
    })()

    // ── Step 3b: Enrichment (item 2, 2026-07-12) ──────────────────────
    // discoveryPromise (stages 1-3: discover+prioritize+fetch) was already
    // kicked off before Stage 1 SCRAPE started, above — it's been running
    // concurrently with the scrape this whole time. Recovery (stage 4)
    // genuinely needs scrape output (isConsumerSite, content-quality) so it
    // can only start now. Both feed into the same outer race/timeout
    // machinery as before — that part is unchanged.
    let enrichmentResult: EnrichmentResult | null = null
    let sourcesUsed: PrioritizedSource[] = []
    let recoveryTriggered = false
    let enrichedContent = ''
    const thinContent = contentQuality.score < 60 || contentQuality.recommendation === 'low_confidence'
    const isConsumerSite = detectConsumerSite(fullContent)
    const firecrawlKey = process.env.FIRECRAWL_API_KEY

    // discoveryPromise may already be resolved (started before scrape) or still
    // in flight (slow discovery+fetch, or a very fast/cached scrape) — either
    // way, whether it was already done BY the time scrape finished is the
    // overlap signal worth logging. Logged here (not after awaiting it below)
    // specifically to capture that "already done or not yet" state accurately,
    // since awaiting it would force it to resolve before we could observe that.
    const discoveryAlreadyDoneAtScrapeEnd = discoveryActualMs !== null
    logger.info('Timing', `Discovery+Fetch: ${discoveryAlreadyDoneAtScrapeEnd ? `${t(discoveryActualMs!)} — already resolved before scrape finished (${t(timing.scrape)}), fully overlapped, zero added wait` : `still in flight after scrape finished (${t(timing.scrape)}) — will be awaited below`}`)

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
          const { discovered, prioritized, contextBlocks: externalBlocks } = await discoveryPromise
          // discoveryActualMs is always set by now — discoveryPromise's own
          // body sets it before resolving on both its success and catch paths.
          timing.discoveryFetch = discoveryActualMs ?? (Date.now() - discoveryStart)

          // Same trigger semantics as the old enrichCompanyIntelligence()'s
          // internal shouldRecover check — just evaluated here now that
          // discovery and scrape output are both in scope.
          let recoveryBlocks: string[] = []
          let recoveryPaths: string[] = []
          const shouldRecover = domain && (thinContent || isConsumerSite || discovered.length === 0)
          if (shouldRecover && firecrawlKey) {
            const maxProbe = thinContent ? 6 : 4
            const probe = await probeRecoveryPaths(domain, isConsumerSite, maxProbe)
            recoveryBlocks = probe.contextBlocks
            recoveryPaths = probe.pathsProbed
            logger.info('Enrichment', `Recovery: probed ${probe.pathsProbed.length} paths with content`)
          }

          const result = buildEnrichmentResult(companyNameFromScrape, domain, discovered, prioritized, externalBlocks, recoveryBlocks, recoveryPaths)
          enrichmentActualMs = Date.now() - enrichStart
          return result
        } catch (e) {
          enrichmentActualMs = Date.now() - enrichStart
          logger.warn('Enrichment', 'Non-fatal', e instanceof Error ? e.message : String(e))
          return null
        }
      })(),
      new Promise<null>(resolve => {
        enrichmentTimeoutId = setTimeout(() => {
          logger.warn('Enrichment', `Hard timeout after ${ENRICHMENT_TIMEOUT_MS}ms — proceeding without external intelligence`)
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
      logger.info('Timing', `RECOVERY mode — score=${contentQuality.score}`)
    }

    // ── Stage 3+2: SIGNAL + PROFILE extraction (website-only) ────────
    const extractStart = Date.now()
    let extractorResult: ExtractorResult = extractSignals(fullContent, undefined, companyNameFromScrape)
    timing.extraction = Date.now() - extractStart
    logger.info('Timing', `Evidence Extraction (website): ${t(timing.extraction)} | ${extractorResult.signals.length} signals | primary=${extractorResult.companyProfile.primary_type}`)

    // ── Business Profile + offering-grounded fallback discovery (kicked
    // off, not awaited) ──────────────────────────────────────────────
    // extractBusinessProfile() (business-profile.ts) is the primary source
    // for competitor/ICP query construction going forward — a dedicated LLM
    // call answering "what does this company actually do" (services,
    // problems solved, positioning, etc.), grounded in the just-scraped
    // fullContent. Kicked off here (right after extraction) rather than
    // awaited immediately, so it overlaps with the ENRICHMENT soft-wait
    // race below instead of adding new sequential wall-clock time.
    // extractorResult.companyOfferings (service-offerings.ts's narrower "we
    // offer X" phrase list) still feeds a fallback pass for when the
    // business-profile call is empty/times out — see Step 4b/4c below.
    const businessProfilePromise: Promise<CompanyBusinessProfile> =
      extractBusinessProfile(fullContent, companyNameFromScrape).catch(e => {
        logger.warn('BusinessProfile', 'Non-fatal', e instanceof Error ? e.message : String(e))
        return emptyBusinessProfile()
      })
    const offeringCompetitorPromise: Promise<CompetitorDiscoveryResult | null> =
      extractorResult.companyOfferings.length > 0
        ? discoverCompetitorsFromOfferings(companyNameFromScrape, domain, extractorResult.companyOfferings).catch(e => {
            logger.warn('CompetitorDiscovery', 'Offering-grounded fallback pass non-fatal', e instanceof Error ? e.message : String(e))
            return null
          })
        : Promise.resolve(null)
    const offeringIcpPromise: Promise<ICPDiscoveryResult | null> =
      extractorResult.companyOfferings.length > 0
        ? discoverICPSegmentsFromOfferings(companyNameFromScrape, domain, extractorResult.companyOfferings).catch(e => {
            logger.warn('ICPGenerator', 'Offering-grounded fallback pass non-fatal', e instanceof Error ? e.message : String(e))
            return null
          })
        : Promise.resolve(null)

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
          extractorResult = extractSignals(fullContent, enrichedContent, companyNameFromScrape)
          timing.reextraction = Date.now() - preExtractStart
          logger.info('Bridge', `Pre-prompt re-extraction: ${websiteOnlyCount} → ${extractorResult.signals.length} signals (+${extractorResult.signals.length - websiteOnlyCount}) in ${timing.reextraction}ms`)
        }

        promptEnriched = true
        logger.info('pipeline', `PROMPT_ENRICHED enrichment resolved in ${enrichmentWaitMs}ms — LLM prompt includes ${sourcesUsed.length} external sources + ${_preRecoveryCount} recovery paths`)
      } else {
        // Soft timeout fired — proceed with website-only prompt; enrichment runs in background
        promptEnriched = false
        logger.info('pipeline', `PROMPT_WEBSITE_ONLY enrichment not ready within ${ENRICHMENT_SOFT_TIMEOUT_MS}ms — LLM prompt is website-only; enrichment continues in background`)
      }
    }

    // ── Step 4a2: Await Business Profile (bounded) ──────────────────
    // Kicked off right after extraction (see businessProfilePromise above) —
    // usually overlaps with the ENRICHMENT soft-wait race just above, so this
    // rarely blocks for the full cap. Competitor/ICP business-profile-driven
    // queries below need this result before they can be built, so (unlike
    // ENRICHMENT) this genuinely is awaited before proceeding, not raced
    // against a "continue without it" path.
    // 30s, not 10s: found live 2026-07-16 running demazetech.com that the
    // NVIDIA NIM reasoning model (nemotron-3-ultra) in this repo's provider
    // chain routinely takes 18-25s for a single completion here (chain-of-
    // thought preamble before JSON) — a 10s bound discarded an eventually-
    // successful result every single time, silently defeating the whole
    // feature. 30s covers one real attempt with margin; if it still isn't
    // enough, extractBusinessProfile()'s own internal retry continues in the
    // background and the offering-grounded fallback below covers this run.
    const BUSINESS_PROFILE_TIMEOUT_MS = 30_000
    const businessProfileStart = Date.now()
    const businessProfile: CompanyBusinessProfile = await Promise.race([
      businessProfilePromise,
      new Promise<CompanyBusinessProfile>(resolve => setTimeout(() => resolve(emptyBusinessProfile()), BUSINESS_PROFILE_TIMEOUT_MS)),
    ])
    timing.businessProfile = Date.now() - businessProfileStart
    logger.info('Timing', `Business Profile: ${t(timing.businessProfile)} | services=${businessProfile.services.length} | positioning=${businessProfile.market_positioning ? 'yes' : 'no'}`)

    // ── Step 4b: Competitor Discovery ────────────────────────────────
    // Business-understanding rebuild (2026-07-16): the business-profile-
    // driven pass (services + market positioning) is now the sole PRIMARY
    // source — never the company name. When the business profile came back
    // empty (LLM call failed/timed out/found nothing), fall back to the
    // narrower offering-grounded pass instead of returning no competitors
    // at all.
    const COMPETITOR_DISCOVERY_TIMEOUT_MS = 12_000
    const OFFERING_DISCOVERY_TIMEOUT_MS = 8_000
    const competitorDiscoveryStart = Date.now()
    let competitorDiscoveryResult: CompetitorDiscoveryResult
    if (!isEmptyBusinessProfile(businessProfile)) {
      competitorDiscoveryResult = await Promise.race([
        discoverCompetitorsFromBusinessProfile(companyNameFromScrape, domain, businessProfile).catch(e => ({
          competitors: [], candidates: [], sufficiency: 'insufficient' as const,
          reason: `discoverCompetitorsFromBusinessProfile threw: ${e instanceof Error ? e.message : String(e)}`,
          candidates_considered: 0,
        })),
        new Promise<CompetitorDiscoveryResult>(resolve => setTimeout(() => resolve({
          competitors: [], candidates: [], sufficiency: 'insufficient',
          reason: `timed out after ${COMPETITOR_DISCOVERY_TIMEOUT_MS}ms`,
          candidates_considered: 0,
        }), COMPETITOR_DISCOVERY_TIMEOUT_MS)),
      ])
    } else {
      competitorDiscoveryResult = {
        competitors: [], candidates: [], sufficiency: 'insufficient',
        reason: 'no business profile available, falling back to offering-grounded pass',
        candidates_considered: 0,
      }
    }

    // Fold in the offering-grounded pass — the real fallback base when the
    // business-profile pass above was empty/insufficient, or an additional
    // supplement (still merged, base wins on duplicates) when it wasn't.
    const offeringCompetitors = await Promise.race([
      offeringCompetitorPromise,
      new Promise<null>(resolve => setTimeout(() => resolve(null), OFFERING_DISCOVERY_TIMEOUT_MS)),
    ])
    if (offeringCompetitors) {
      competitorDiscoveryResult = competitorDiscoveryResult.sufficiency === 'sufficient'
        ? mergeCompetitorResults(competitorDiscoveryResult, offeringCompetitors)
        : offeringCompetitors
    }

    // Resolve a website per surfaced competitor (reuses website-discovery.ts's
    // discoverCompanyWebsite() exactly as Company Discovery Engine already
    // does — capped list, MAX_COMPETITORS=5 in competitor-discovery.ts, only
    // set when confirmed). Set directly on the code-derived skeleton here,
    // before normalize.ts's LLM merge — website is never part of the LLM
    // narration.
    // Parallelized (2026-07-18, real latency fix): this used to be a
    // sequential `for...of` loop — each discoverCompanyWebsite() call has its
    // own internal domain-verification fetch capped at 8000ms, and there is
    // no ordering dependency between competitors, so serializing up to 5 of
    // them could cost ~40s worst-case for something fully parallelizable.
    // Promise.all (not allSettled) preserves array order and is safe here
    // because each mapped async fn already catches its own error internally
    // — same fallback behavior as the old sequential loop (a competitor with
    // no confirmed domain just keeps `website` unset; nothing ever rejects
    // out of the batch).
    await Promise.all(competitorDiscoveryResult.competitors.map(async (c) => {
      try {
        const site = await discoverCompanyWebsite(c.name)
        if (site.status === 'confirmed' && site.confidence !== 'none' && site.domain) {
          c.website = site.domain
        }
      } catch (e) {
        logger.warn('CompetitorDiscovery', `Website resolution non-fatal for "${c.name}"`, e instanceof Error ? e.message : String(e))
      }
    }))

    timing.competitorDiscovery = Date.now() - competitorDiscoveryStart
    logger.info('Timing', `Competitor Discovery: ${t(timing.competitorDiscovery)} | sufficiency=${competitorDiscoveryResult.sufficiency} | ${competitorDiscoveryResult.competitors.length} competitor(s)`)

    // Gate: COMPETITOR (non-critical — WARN only, same tier as ENRICHMENT)
    if (competitorDiscoveryResult.sufficiency === 'sufficient') {
      gate(pipelineGates, 'COMPETITOR', 'PASS',
        `${competitorDiscoveryResult.competitors.length} competitor(s) found | ${competitorDiscoveryResult.reason}`)
    } else {
      gate(pipelineGates, 'COMPETITOR', 'WARN', competitorDiscoveryResult.reason)
    }

    // ── Step 4c: Await ICP discovery (bounded) ──────────────────────
    // Base pass (self-referential "we serve X") kicked off pre-scrape, same
    // as before the business-understanding rebuild — unchanged.
    const ICP_DISCOVERY_TIMEOUT_MS = 12_000
    const icpDiscoveryStart = Date.now()
    let icpDiscoveryResult: ICPDiscoveryResult = await Promise.race([
      icpDiscoveryPromise,
      new Promise<ICPDiscoveryResult>(resolve => setTimeout(() => resolve({
        segments: [], candidates: [], sufficiency: 'insufficient',
        reason: `timed out after ${ICP_DISCOVERY_TIMEOUT_MS}ms, kicked off in parallel with scrape, still not resolved by prompt-build time`,
        candidates_considered: 0,
      }), ICP_DISCOVERY_TIMEOUT_MS)),
    ])
    timing.icpDiscovery = Date.now() - icpDiscoveryStart

    // ── Step 4c-2: fold in a supplementary pass, business-profile-driven
    // when available, offering-grounded otherwise ─────────────────────
    // Merged alongside the self-referential base above, never replacing it —
    // Target Segments genuinely includes industries the company states it
    // serves, so unlike competitors there's no "wrong primary pass" to fix
    // here, just a richer second source to add.
    const icpSupplementResult = !isEmptyBusinessProfile(businessProfile)
      ? await Promise.race([
          discoverICPSegmentsFromBusinessProfile(companyNameFromScrape, domain, businessProfile).catch(e => {
            logger.warn('ICPGenerator', 'Business-profile pass non-fatal', e instanceof Error ? e.message : String(e))
            return null
          }),
          new Promise<null>(resolve => setTimeout(() => resolve(null), OFFERING_DISCOVERY_TIMEOUT_MS)),
        ])
      : await Promise.race([
          offeringIcpPromise,
          new Promise<null>(resolve => setTimeout(() => resolve(null), OFFERING_DISCOVERY_TIMEOUT_MS)),
        ])
    if (icpSupplementResult) {
      icpDiscoveryResult = mergeICPResults(icpDiscoveryResult, icpSupplementResult)
    }
    logger.info('Timing', `ICP Discovery: ${t(timing.icpDiscovery)} | sufficiency=${icpDiscoveryResult.sufficiency} | ${icpDiscoveryResult.segments.length} segment(s)`)

    // Gate: ICP (non-critical — WARN only, same tier as COMPETITOR/ENRICHMENT)
    if (icpDiscoveryResult.sufficiency === 'sufficient') {
      gate(pipelineGates, 'ICP', 'PASS',
        `${icpDiscoveryResult.segments.length} segment(s) found | ${icpDiscoveryResult.reason}`)
    } else {
      gate(pipelineGates, 'ICP', 'WARN', icpDiscoveryResult.reason)
    }

    // ── Step 4d: Await Market Intelligence discovery (bounded) ──────
    // Same shape and reasoning as Steps 4b/4c above.
    const MARKET_INTEL_TIMEOUT_MS = 12_000
    const marketIntelStart = Date.now()
    const marketIntelResult: MarketIntelligenceResult = await Promise.race([
      marketIntelPromise,
      new Promise<MarketIntelligenceResult>(resolve => setTimeout(() => resolve({
        items: [], sufficiency: 'insufficient',
        reason: `timed out after ${MARKET_INTEL_TIMEOUT_MS}ms, kicked off in parallel with scrape, still not resolved by prompt-build time`,
        candidates_considered: 0,
      }), MARKET_INTEL_TIMEOUT_MS)),
    ])
    timing.marketIntel = Date.now() - marketIntelStart
    logger.info('Timing', `Market Intelligence: ${t(timing.marketIntel)} | sufficiency=${marketIntelResult.sufficiency} | ${marketIntelResult.items.length} item(s)`)

    // Gate: MARKET_INTEL (non-critical — WARN only, same tier as COMPETITOR/ICP/ENRICHMENT)
    if (marketIntelResult.sufficiency === 'sufficient') {
      gate(pipelineGates, 'MARKET_INTEL', 'PASS',
        `${marketIntelResult.items.length} item(s) found | ${marketIntelResult.reason}`)
    } else {
      gate(pipelineGates, 'MARKET_INTEL', 'WARN', marketIntelResult.reason)
    }

    // ── Step 4e: Match Demaze proof points (pure, zero I/O) ─────────
    // Unlike Steps 4a-4d above, this has no network call to bound/race —
    // matchProofPoints() is a pure local function over the static
    // DEMAZE_PROOF_POINTS catalog (lib/knowledge/demaze-proof-points.ts),
    // so it just runs synchronously right before the prompt is built.
    const proofPointMatches = matchProofPoints(
      enrichedContent ? `${fullContent}\n\n${enrichedContent}` : fullContent,
      extractorResult.companyProfile,
    )
    logger.info('ProofPoints', `${proofPointMatches.length} match(es): ${proofPointMatches.map(p => p.id).join(', ') || 'none'}`)

    // ── Step 5: Build narrative prompt ──────────────────────
    const promptStart = Date.now()
    const narrativeInput = buildNarrativeInput(
      domain,
      extractorResult,
      scrapeResult.successfulUrls,
      contentQualityWarning,
      competitorDiscoveryResult.candidates,
      icpDiscoveryResult.candidates,
      businessProfile,
      proofPointMatches,
    )
    const userPrompt = buildNarrativePrompt(narrativeInput)
    const systemTokens = estimateTokenCount(SYSTEM_PROMPT_V2)
    const userTokens = estimateTokenCount(userPrompt)
    const totalTokens = systemTokens + userTokens
    timing.promptBuild = Date.now() - promptStart

    logger.info('Timing', `Prompt Build: ${t(timing.promptBuild)}`)
    logger.info('PROMPT BREAKDOWN', 'breakdown', {
      systemV2: `${SYSTEM_PROMPT_V2.length} chars / ${systemTokens} tokens`,
      userPrompt: `${userPrompt.length} chars / ${userTokens} tokens`,
      signalSummary: `${extractorResult.signalSummary.length} chars`,
      websitePreview: `${extractorResult.websitePreview.length} chars`,
      totalTokens,
    })

    // ── Stage 4+5: LLM + Enrichment in parallel ──────────────
    const aiStart = Date.now()
    const [aiResponseInitial, enrichmentRaw] = await Promise.all([
      getCompletion({
        systemPrompt: SYSTEM_PROMPT_V2,
        userPrompt,
        // Was 4096 — live runs kept hitting finishReason='length' truncation
        // (reasoning models in particular spend real budget on a CoT preamble
        // before any JSON), forcing a ~20s wasted retry-with-8192 roundtrip
        // that always succeeded. Starting at 8192 removes that guaranteed
        // round-trip instead of reacting to it after the fact.
        maxTokens: 8192,
        temperature: 0.2,
        jsonMode: true,
      }),
      enrichmentPromise,
    ])
    let aiResponse = aiResponseInitial
    timing.llmAnalysis = Date.now() - aiStart
    // timing.enrichment = actual enrichment work duration, not LLM wall time.
    // enrichmentActualMs is set inside the race branch that completes first:
    //   - enrichment finishes early → real HTTP duration
    //   - timeout fires → ENRICHMENT_TIMEOUT_MS cap
    timing.enrichment = enrichmentActualMs ?? (Date.now() - enrichStart)
    logger.info('Timing', `LLM Analysis: ${t(timing.llmAnalysis)} | provider=${aiResponse.providerName} | tokens=${aiResponse.tokensUsed}`)

    // Gate S4: Enrichment (non-critical — WARN only)
    // Three cases:
    // (A) promptEnriched=true  — enrichment won soft race; already captured pre-prompt
    // (B) enrichmentRaw!=null  — enrichment arrived late (after soft timeout, while LLM ran)
    // (C) enrichmentRaw==null  — timed out entirely
    if (promptEnriched) {
      // Case A: captured before prompt — log and gate, no re-capture needed
      const _recoveryCount = enrichmentResult!.recovery_paths_probed?.length ?? 0
      logger.info('Timing', `Enrichment: ${t(timing.enrichment)} | ${sourcesUsed.length} external + ${_recoveryCount} recovery | ${enrichedContent.length} chars context (pre-prompt)`)
      gate(pipelineGates, 'ENRICHMENT', 'PASS',
        `${sourcesUsed.length} external sources | ${enrichedContent.length} chars enriched context | reached LLM prompt`)
    } else if (enrichmentRaw) {
      // Case B: arrived late — feeds re-extraction and synthesis only
      enrichmentResult = enrichmentRaw
      sourcesUsed = enrichmentResult.sources_used ?? []
      enrichedContent = enrichmentResult.enriched_context
      const _recoveryCount = enrichmentResult.recovery_paths_probed?.length ?? 0
      logger.info('pipeline', 'ENRICHMENT_LATE enrichment resolved after LLM prompt was built — feeds re-extraction and synthesis only')
      logger.info('Timing', `Enrichment: ${t(timing.enrichment)} | ${sourcesUsed.length} external + ${_recoveryCount} recovery | ${enrichedContent.length} chars context (late)`)
      gate(pipelineGates, 'ENRICHMENT', 'PASS',
        `${sourcesUsed.length} external sources | ${enrichedContent.length} chars enriched context | LATE — did not reach LLM prompt`)
    } else {
      // Case C: timed out entirely
      timing.enrichment = timing.enrichment || (Date.now() - enrichStart)
      logger.info('Timing', `Enrichment: ${t(timing.enrichment)} | no results`)
      gate(pipelineGates, 'ENRICHMENT', 'WARN',
        'Enrichment returned no results (timeout or all sources failed) — intelligence based on website only')
    }

    // ── Step 6b: Re-run evidence extraction with enriched content ───────
    // Skipped if promptEnriched=true — pre-prompt re-extraction already ran.
    // Runs only for Case B (late enrichment) so synthesis sees enriched signals.
    const websiteOnlySignalCount = extractorResult.signals.length
    if (!promptEnriched && enrichedContent.length > 100) {
      const reextractStart = Date.now()
      extractorResult = extractSignals(fullContent, enrichedContent, companyNameFromScrape)
      timing.reextraction = Date.now() - reextractStart
      logger.info('Bridge', `Re-extraction (late): website=${websiteOnlySignalCount} → enriched=${extractorResult.signals.length} signals (+${extractorResult.signals.length - websiteOnlySignalCount}) in ${timing.reextraction}ms`)
    } else if (promptEnriched) {
      logger.info('Bridge', `Re-extraction skipped — already ran pre-prompt | final signal count: ${extractorResult.signals.length}`)
    } else {
      timing.reextraction = 0
      logger.info('Bridge', `No enriched content — final signal count: ${websiteOnlySignalCount}`)
    }

    // ── Step 6c: Signal clustering + deterministic opportunities ────────
    // Clusters: used for logging + passed into synthesis. Opportunity generation happens once in normalize.ts.
    const signalClusters = clusterSignals(extractorResult.detectedFactors as Partial<Record<string, boolean>>, extractorResult.companyProfile)
    logger.info('Clustering', `${signalClusters.length} clusters | primary=${extractorResult.companyProfile.primary_type}`)

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
      named_erp_crm_tool:               8,   // same weight class as erp_implementation/mes_adoption
      external_training_engagement:     5,   // indirect signal — see EVIDENCE_SOURCE_STRATEGY.md Tier 2
      // internal_workflow_description intentionally has no urgency weight — it's
      // descriptive evidence (an internal process exists), not an urgency-driving event.
    }
    const urgencyRaw = extractorResult.signals
      .filter(s => s.is_company_subject)
      .reduce((sum, sig) => sum + (EXTRACTOR_URGENCY_WEIGHTS[sig.type] ?? 0), 0)
    const computed_why_now_score = Math.min(10, Math.round(urgencyRaw / 8))

    const GROWTH_SIG_TYPES  = new Set(['new_facility', 'capacity_expansion', 'new_market_entry', 'revenue_milestone'])
    const HIRING_SIG_TYPES  = new Set(['digital_transformation_hiring', 'ai_ml_hiring', 'automation_engineering_hiring', 'operations_hiring_surge', 'leadership_hiring'])
    const DIGITAL_SIG_TYPES = new Set(['digital_transformation', 'industry40_initiative', 'erp_implementation', 'mes_adoption', 'automation_investment', 'iot_investment', 'named_erp_crm_tool'])
    const BIZ_SIG_TYPES     = new Set(['ai_mention', 'acquisition', 'multi_location_operations', 'quality_certification_pursuit', 'sustainability_initiative', 'external_training_engagement'])

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
      named_erp_crm_tool:             'digital_transformation',
      external_training_engagement:   'recent_news_or_event',
      // internal_workflow_description intentionally unmapped — falls back to its
      // own type name (?? sig.type below), no existing synthesis category fits it.
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

    logger.info('Bridge', `why_now=${computed_why_now_score} | growth=${extractor_growth_signals.length} | hiring=${extractor_hiring_signals.length} | digital=${extractor_digital_signals.length} | biz=${extractor_biz_signals.length} | synthesis=${extractorEnrichedSignals.length}`)
    logger.info('Bridge', `website_signals=${websiteOnlySignalCount} | final_signals=${extractorResult.signals.length} | delta=+${extractorResult.signals.length - websiteOnlySignalCount}`)

    // ── Stage 5+6: LLM parse + normalization ─────────────────
    let analysisResult: unknown = null
    let parseError: string | null = null
    let synthesisResult: SynthesisResult | null = null

    // L1-E / never-hard-fail: LLM_PARSE previously hard-failed (422, nothing
    // returned) on the first bad JSON, discarding scrape/extraction/enrichment
    // work already computed above. Now: retry once (bumping maxTokens if the
    // failed attempt's finishReason was 'length', since that means the model
    // was cut off mid-output, not that it wrote malformed JSON with room to
    // spare), and if the retry also fails, degrade to deterministic-only
    // output instead of hard-failing — ai_synthesis_status flags this
    // distinctly so the report doesn't look like "found nothing" when the
    // AI narrative step is what actually broke.
    let aiSynthesisFailed = false
    let aiSynthesisFailureReason: string | undefined

    let rawParsed: Record<string, unknown> = {}
    try {
      // Gate S5: LLM parse
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          rawParsed = JSON.parse(extractJsonFromLLMResponse(aiResponse.content))
          break
        } catch (parseErr) {
          const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr)
          logger.error(
            'pipeline',
            `LLM_PARSE_FAIL attempt=${attempt} finishReason=${aiResponse.finishReason ?? 'unknown'} provider=${aiResponse.providerName}`,
            errMsg,
          )

          if (attempt === 2) {
            aiSynthesisFailed = true
            aiSynthesisFailureReason = `LLM returned invalid JSON after retry: ${errMsg} (finishReason: ${aiResponse.finishReason ?? 'unknown'})`
            gate(pipelineGates, 'LLM_PARSE', 'PARTIAL', aiSynthesisFailureReason, {
              contentLength: aiResponse.content.length,
              preview: aiResponse.content.slice(0, 200),
              finishReason: aiResponse.finishReason ?? 'unknown',
            })
            rawParsed = {}
            break
          }

          // finishReason:'length' means max_tokens cut the response off mid-string —
          // retrying with the same budget would very likely truncate at the same
          // spot, so escalate past the 8192 baseline (see the initial getCompletion
          // call above). A malformed-but-complete response just gets one retry at
          // the same baseline, since more budget wouldn't fix a real formatting bug.
          const retryMaxTokens = aiResponse.finishReason === 'length' ? 12288 : 8192
          logger.warn('pipeline', `LLM_PARSE_RETRY retrying with maxTokens=${retryMaxTokens}`)
          try {
            aiResponse = await getCompletion({
              systemPrompt: SYSTEM_PROMPT_V2,
              userPrompt,
              maxTokens: retryMaxTokens,
              temperature: 0.2,
              jsonMode: true,
            })
          } catch (retryErr) {
            aiSynthesisFailed = true
            aiSynthesisFailureReason = `LLM retry request failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`
            gate(pipelineGates, 'LLM_PARSE', 'PARTIAL', aiSynthesisFailureReason)
            rawParsed = {}
            break
          }
        }
      }

      // Warn if LLM produced no substantive output
      const _llmPainCount    = Array.isArray(rawParsed.pain_points)         ? (rawParsed.pain_points as unknown[]).length : 0
      const _llmOppCount     = Array.isArray(rawParsed.ai_opportunities)    ? (rawParsed.ai_opportunities as unknown[]).length : 0
      logger.info('pipeline', 'LLM_OUT', { pain_points_count: _llmPainCount, ai_opportunities_count: _llmOppCount })

      // aiSynthesisFailed already recorded its own PARTIAL gate above with the
      // real reason — don't also emit the generic "no output" WARN here, it
      // would bury the actual failure reason under a vaguer duplicate.
      if (!aiSynthesisFailed) {
        if (_llmOppCount === 0 && _llmPainCount === 0) {
          gate(pipelineGates, 'LLM_PARSE', 'WARN',
            'LLM produced no pain_points or ai_opportunities — narrative may be incomplete')
        } else {
          gate(pipelineGates, 'LLM_PARSE', 'PASS',
            `LLM output: ${_llmPainCount} pain_points | ${_llmOppCount} opportunities`)
        }
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
        logger.info('Bridge', `Why Now floor applied: extractor=${computed_why_now_score} → narrative_floor=${_narrativeFloor} → effective=${_effectiveWhyNowScore}`)
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
        // Full combined content for service-evidence.ts's regex-based detection
        // (opportunity-engine.ts v3) — same website+enriched combination
        // extractSignals() already builds internally, so evidence detection sees
        // exactly what signal extraction saw, not just the 3,000-char preview.
        _service_evidence_content: enrichedContent ? `${fullContent}\n\n${enrichedContent}` : fullContent,
        // Code-derived CompetitorProfile skeletons (name/confidence/source_urls/
        // website + fallback why_they_compete) from
        // discoverCompetitorsFromBusinessProfile() — normalize.ts merges the
        // LLM's `competitors` narration (rawParsed.competitors, from the
        // [COMPETITOR CANDIDATES] prompt block) onto these by name, same
        // pattern as the opportunities merge.
        _competitor_discovery: competitorDiscoveryResult,
        // Code-derived ICPSegment skeletons (name/confidence/source_urls/
        // signals + fallback reason) from discoverICPSegments() — normalize.ts
        // merges the LLM's `icp_segments` narration onto these by name, same
        // pattern as the competitors merge above.
        _icp_discovery: icpDiscoveryResult,
        // Market Intelligence Layer result from discoverMarketIntelligence() —
        // unlike the two above, normalize.ts passes this straight through
        // (no LLM narration/merge step, see market-intelligence.ts header).
        _market_intelligence: marketIntelResult,
        // Business Profile from extractBusinessProfile() (business-profile.ts)
        // — passed straight through, no LLM merge step (it IS an LLM output
        // already, there's nothing to narrate onto it).
        _business_profile: businessProfile,
        // Demaze Proof Points from matchProofPoints() (proof-point-matcher.ts)
        // — the real candidate list the LLM was given for outreach_draft.
        // normalize.ts uses this as a safety net: if rawParsed.outreach_draft
        // .matched_proof_point_id doesn't match a real id here, it's nulled
        // out rather than trusted, same belt-and-suspenders pattern as
        // research-quality.ts's self-name-collision check.
        _proof_point_candidates: proofPointMatches,
      }

      // Gate S6: Normalization
      try {
        analysisResult = normalizeAnalysisResult(merged as Record<string, unknown>)
        if (aiSynthesisFailed) {
          // Deterministic fields (signals, deterministic_opportunities, signal_clusters)
          // are still real — only the LLM-authored narrative fields are empty. Flag
          // that distinctly so the report doesn't read as "nothing was found".
          analysisResult = {
            ...(analysisResult as Record<string, unknown>),
            ai_synthesis_status: 'failed',
            ai_synthesis_failure_reason: aiSynthesisFailureReason,
          }
        }
      } catch (normErr) {
        const errMsg = normErr instanceof Error ? normErr.message : String(normErr)
        gate(pipelineGates, 'NORMALIZATION', 'FAIL',
          `normalizeAnalysisResult threw: ${errMsg}`)
        logger.error('pipeline', 'NORMALIZATION_FAIL', errMsg)
        return failResponse('NORMALIZATION', `Normalizer failed: ${errMsg}`, {
          signalCount: extractorResult.signals.length,
          primaryType: extractorResult.companyProfile.primary_type,
        }, pipelineGates)
      }

      // Post-normalization integrity check
      const _norm = analysisResult as Record<string, unknown>
      const _normPainCount    = Array.isArray(_norm.pain_points)           ? (_norm.pain_points as unknown[]).length : 0
      const _normOppCount     = Array.isArray(_norm.opportunities)         ? (_norm.opportunities as unknown[]).length : 0
      logger.info('pipeline', 'NORM_OUT', { pain_points_count: _normPainCount, opportunities_count: _normOppCount })

      if (_llmPainCount > 0 && _normPainCount === 0) logger.warn('pipeline', 'DROP pain_points dropped by normalizer — check flattenSections')
      if (_llmOppCount > 0 && _normOppCount === 0)   logger.warn('pipeline', 'DROP ai_opportunities dropped by normalizer — check flattenSections')

      if (aiSynthesisFailed) {
        // Already gated PARTIAL at LLM_PARSE with the real reason — skip the
        // generic "unexpected schema keys" WARN, which would be misleading here.
      } else if (_normOppCount === 0 && _normPainCount === 0) {
        gate(pipelineGates, 'NORMALIZATION', 'WARN',
          'Normalizer produced 0 pain_points and 0 opportunities — LLM output may have used unexpected schema keys')
      } else {
        gate(pipelineGates, 'NORMALIZATION', 'PASS',
          `Normalized: ${_normPainCount} pain_points | ${_normOppCount} opportunities`)
      }

      // Gate: PAIN_POINTS (non-critical — WARN only, same tier as
      // COMPETITOR/ICP/MARKET_INTEL). The prompt (analyze-v2.ts) instructs
      // the LLM to always generate 3-5 pain points and never return [], but
      // nothing previously enforced or even detected a violation. Only warn
      // when the company had usable evidence (evidence_sufficiency ===
      // 'sufficient') but pain_points still came back empty — that combo
      // points at an LLM/parsing gap, not thin data. See
      // shouldWarnEmptyPainPoints() in normalize.ts for the shared rule.
      if (aiSynthesisFailed) {
        // Already gated PARTIAL at LLM_PARSE with the real reason — an empty
        // pain_points here is an expected consequence of that failure, not a
        // new problem to flag separately.
      } else {
        const _evidenceSufficiency = (_norm.evidence_sufficiency as 'sufficient' | 'insufficient' | undefined) ?? 'insufficient'
        if (shouldWarnEmptyPainPoints(_normPainCount, _evidenceSufficiency)) {
          gate(pipelineGates, 'PAIN_POINTS', 'WARN',
            'pain_points came back empty (0) despite evidence_sufficiency=sufficient — likely an LLM/parsing gap, not genuinely thin data',
            { painPointsCount: _normPainCount, evidenceSufficiency: _evidenceSufficiency })
        } else {
          gate(pipelineGates, 'PAIN_POINTS', 'PASS',
            `${_normPainCount} pain_point(s) | evidence_sufficiency=${_evidenceSufficiency}`)
        }
      }

      logger.info('test-analysis', 'company_name', (analysisResult as Record<string, unknown>).company_name)
      logger.info('test-analysis', 'signals detected', extractorResult.signals.length)

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
        logger.info('Timing', `Synthesis: ${t(timing.synthesis)} | themes=${synthesisResult.strategicThemes.length} | quality=${synthesisResult.intelligenceQuality.overall}/100`)

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

      logger.info('ConfV2', `t1t2=${(_t1t2Ratio*100).toFixed(0)}% rel=${(_relevanceRatio*100).toFixed(0)}% div=${(_diversityScore*100).toFixed(0)}% cls=${(_clusterScore*100).toFixed(0)}% → score=${_confScore.toFixed(1)} → ${confidence_v2}`)

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

        logger.info('BriefV2', `${_strategicBullets.length} strategic bullets + ${_evidenceBullets.length} evidence quotes | top opp="${_topOppTitle}" | confidence=${confidence_v2} (score=${_confScore.toFixed(1)})`)
      }
    } catch (e) {
      parseError = `Unexpected error in parse/normalize/synthesis: ${e instanceof Error ? e.message : String(e)}`
      logger.error('test-analysis', parseError)
    }

    timing.total = Date.now() - totalStart
    const _enrichSummary = enrichmentResult
      ? `${enrichmentResult.sources_used.length} external + ${enrichmentResult.recovery_paths_probed?.length ?? 0} recovery paths${recoveryTriggered ? ' (thin-content recovery active)' : ''}`
      : 'no results'
    logger.info('Timing', 'Pipeline summary', {
      scrapeCache: t(timing.scrape),
      discoveryFetch: `${t(timing.discoveryFetch ?? 0)} (kicked off before scrape, item 2)`,
      contentQuality: t(timing.contentQuality),
      evidenceExtraction: `${t(timing.extraction)} (website-only)`,
      reExtraction: `${t(timing.reextraction ?? 0)} (post-enrichment)`,
      enrichment: `${t(timing.enrichment)} | ${_enrichSummary}`,
      enrichmentWait: `${t(enrichmentWaitMs)} (soft_timeout=${ENRICHMENT_SOFT_TIMEOUT_MS}ms | prompt_enriched=${promptEnriched})`,
      promptBuild: t(timing.promptBuild),
      llmAnalysis: t(timing.llmAnalysis),
      synthesis: t(timing.synthesis ?? 0),
      total: t(timing.total),
    })
    logger.info('pipeline', 'GATES', pipelineGates.map(g => `${g.stage}:${g.status}`))

    // Derive overall validation status from accumulated gates
    const _overallStatus: ValidationStatus =
      pipelineGates.some(g => g.status === 'FAIL') ? 'FAIL'
      : pipelineGates.some(g => g.status === 'PARTIAL') ? 'PARTIAL'
      : pipelineGates.some(g => g.status === 'WARN') ? 'WARN'
      : 'PASS'
    logger.info('pipeline', `GATE_OVERALL overall=${_overallStatus} | gates=${pipelineGates.length}`)

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

      // Step 0: website discovery (null when a URL was given directly)
      websiteDiscovery,

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
        leadershipContacts: extractorResult.leadershipContacts,
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
    logger.error('test-analysis', 'Fatal error', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

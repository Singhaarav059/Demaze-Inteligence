// ============================================================
// Admin: Test Scraper — POST /api/admin/test-scraper
// ============================================================
// Body:
//   url:    string  — company website URL
//   force:  boolean — bypass cache and scrape fresh (default: false)
//
// Cache behaviour (when force=false):
//   1. Check company_scrape_cache for this URL
//   2. If found and < 24h old → return cached result immediately
//   3. If expired or missing → scrape fresh, save to cache
//
// Response adds:
//   cacheHit:  boolean       — true if result came from cache
//   cachedAt:  string | null — ISO timestamp when it was cached
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { scrapeCompanyWebsite, assessScrapeQuality } from '@/lib/pipeline/scraper'
import { validateAndNormalizeURL, extractDomain } from '@/lib/utils/url'
import { estimateTokenCount } from '@/lib/prompts/scrape-utils'
import { getCachedScrape, saveScrapeCache } from '@/lib/cache/scrape-cache'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json()
  const { url, force = false } = body as { url: string; force?: boolean }

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
  const startTime = Date.now()

  // ── Check cache (unless force=true) ─────────────────────────
  if (!force) {
    const cached = await getCachedScrape(normalizedUrl)
    if (cached) {
      logger.info('test-scraper', `Returning cached result for ${domain}`)
      return NextResponse.json({
        success: true,
        domain,
        executionTimeMs: Date.now() - startTime,
        scrapeResult: cached.scrapeResult,
        quality: cached.quality,
        estimatedTokens: estimateTokenCount(cached.scrapeResult.combinedContent),
        cacheHit: true,
        cachedAt: cached.cachedAt,
      })
    }
    logger.info('test-scraper', `Cache miss for ${domain} — scraping fresh`)
  } else {
    logger.info('test-scraper', `Force refresh for ${domain} — bypassing cache`)
  }

  // ── Fresh scrape ─────────────────────────────────────────────
  try {
    const scrapeResult = await scrapeCompanyWebsite(normalizedUrl)
    const executionTimeMs = Date.now() - startTime
    const quality = assessScrapeQuality(scrapeResult)

    // Save to cache in the background (non-blocking)
    saveScrapeCache(normalizedUrl, domain, scrapeResult, quality)

    return NextResponse.json({
      success: true,
      domain,
      executionTimeMs,
      scrapeResult,
      quality,
      estimatedTokens: estimateTokenCount(scrapeResult.combinedContent),
      cacheHit: false,
      cachedAt: new Date().toISOString(),
    })
  } catch (err) {
    const executionTimeMs = Date.now() - startTime
    const message = err instanceof Error ? err.message : String(err)
    logger.error('test-scraper', 'Error', message)
    return NextResponse.json(
      { success: false, error: message, executionTimeMs },
      { status: 500 }
    )
  }
}

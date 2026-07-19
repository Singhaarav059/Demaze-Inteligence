// ============================================================
// Scrape Cache — server-side helper
// ============================================================
// Reads and writes the company_scrape_cache table in Supabase.
// Imported by API routes (test-scraper, test-analysis).
// Never imported by client components.
// ============================================================

import { createServerClient } from '@/lib/supabase/server'
import type { ScrapeResult } from '@/lib/pipeline/scraper'

// How long a cache entry is considered fresh
export const CACHE_TTL_HOURS = 24

export interface CachedScrape {
  scrapeResult: ScrapeResult
  quality: { score: number; note: string }
  pagesScraped: number
  domain: string | null
  cachedAt: string           // ISO timestamp the scrape was stored
}

// ── Read ──────────────────────────────────────────────────────

/**
 * Returns a cached scrape for the given URL if it exists and
 * is less than CACHE_TTL_HOURS old. Returns null otherwise.
 */
export async function getCachedScrape(url: string): Promise<CachedScrape | null> {
  try {
    const supabase = createServerClient()

    const { data, error } = await supabase
      .from('company_scrape_cache')
      .select('scrape_result, quality_score, quality_note, pages_scraped, domain, scraped_at')
      .eq('url', url)
      .single()

    if (error || !data) return null

    const ageMs = Date.now() - new Date(data.scraped_at).getTime()
    const ttlMs = CACHE_TTL_HOURS * 60 * 60 * 1000

    if (ageMs > ttlMs) {
      console.log(`[scrape-cache] Cache expired for ${url} (age: ${Math.round(ageMs / 3600000)}h)`)
      return null
    }

    console.log(`[scrape-cache] Cache hit for ${url} (age: ${Math.round(ageMs / 60000)}m)`)

    return {
      scrapeResult: data.scrape_result as ScrapeResult,
      quality: {
        score: data.quality_score ?? 0,
        note: data.quality_note ?? '',
      },
      pagesScraped: data.pages_scraped ?? 0,
      domain: data.domain,
      cachedAt: data.scraped_at,
    }
  } catch (err) {
    // Cache read failure is non-fatal — caller will scrape fresh
    console.error('[scrape-cache] Read error:', err)
    return null
  }
}

// ── Delete ────────────────────────────────────────────────────

/**
 * Deletes the cache entry for a URL. Used by Re-Scrape to ensure
 * a full fresh scrape rather than just bypassing read cache.
 * Returns false on failure instead of swallowing it — the DELETE route
 * (and the Clear Cache button that calls it) previously always reported
 * success regardless of whether the delete actually worked (2026-07-19 fix).
 */
export async function deleteScrapeCache(url: string): Promise<boolean> {
  try {
    const supabase = createServerClient()
    const { error } = await supabase
      .from('company_scrape_cache')
      .delete()
      .eq('url', url)
    if (error) {
      console.error('[scrape-cache] Delete error:', error.message)
      return false
    }
    console.log(`[scrape-cache] Deleted cache for ${url}`)
    return true
  } catch (err) {
    console.error('[scrape-cache] Delete threw:', err)
    return false
  }
}

// ── Write ─────────────────────────────────────────────────────

/**
 * Upserts a scrape result into the cache. If a cache entry for
 * this URL already exists, it is replaced (scraped_at updated).
 * Non-fatal: a write failure is logged but does not throw.
 */
export async function saveScrapeCache(
  url: string,
  domain: string | null,
  scrapeResult: ScrapeResult,
  quality: { score: number; note: string }
): Promise<void> {
  try {
    const supabase = createServerClient()

    const { error } = await supabase
      .from('company_scrape_cache')
      .upsert(
        {
          url,
          domain,
          scrape_result: scrapeResult as unknown as Record<string, unknown>,
          quality_score: quality.score,
          quality_note: quality.note,
          pages_scraped: scrapeResult.successfulUrls?.length ?? 0,
          scraped_at: new Date().toISOString(),
        },
        { onConflict: 'url' }
      )

    if (error) {
      console.error('[scrape-cache] Save error:', error.message)
    } else {
      console.log(`[scrape-cache] Saved cache for ${url}`)
    }
  } catch (err) {
    console.error('[scrape-cache] Save threw:', err)
  }
}

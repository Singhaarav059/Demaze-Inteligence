// ============================================================
// Search Query Cache — server-side helper
// ============================================================
// Reads and writes the search_query_cache table in Supabase.
// Wired into searchTavily()/searchSerper() (lib/enrichment/discovery-engine.ts)
// so every discovery module (Enrichment Discovery, Competitor Discovery, ICP
// Generator, Market Intelligence, Website Discovery, Company Discovery)
// benefits automatically — they all funnel through those two functions.
// Same non-fatal-on-failure discipline as lib/cache/scrape-cache.ts: a cache
// read/write failure never blocks a live search call.
// ============================================================

import { createServerClient } from '@/lib/supabase/server'

export const SEARCH_CACHE_TTL_HOURS = 24 * 30 // 30 days

export type SearchCacheProvider = 'tavily' | 'serper'

export interface CachedSearchResult {
  title: string
  url: string
  content: string
}

// ── Read ──────────────────────────────────────────────────────

/**
 * Returns cached results for this exact (provider, query, maxResults) key
 * if present and younger than SEARCH_CACHE_TTL_HOURS. Returns null otherwise
 * (including on any read failure — caller falls back to a live search).
 */
export async function getCachedSearch(
  provider: SearchCacheProvider,
  query: string,
  maxResults: number
): Promise<CachedSearchResult[] | null> {
  try {
    const supabase = createServerClient()

    const { data, error } = await supabase
      .from('search_query_cache')
      .select('results, cached_at')
      .eq('provider', provider)
      .eq('query', query)
      .eq('max_results', maxResults)
      .single()

    if (error || !data) return null

    const ageMs = Date.now() - new Date(data.cached_at).getTime()
    const ttlMs = SEARCH_CACHE_TTL_HOURS * 60 * 60 * 1000

    if (ageMs > ttlMs) return null

    return data.results as CachedSearchResult[]
  } catch (err) {
    console.error('[search-cache] Read error:', err)
    return null
  }
}

// ── Write ─────────────────────────────────────────────────────

/**
 * Upserts a search result set into the cache. Non-fatal: a write failure is
 * logged but never throws — the live search result the caller already has
 * is unaffected either way.
 */
export async function saveSearchCache(
  provider: SearchCacheProvider,
  query: string,
  maxResults: number,
  results: CachedSearchResult[]
): Promise<void> {
  try {
    const supabase = createServerClient()

    const { error } = await supabase
      .from('search_query_cache')
      .upsert(
        {
          provider,
          query,
          max_results: maxResults,
          results: results as unknown as Record<string, unknown>[],
          cached_at: new Date().toISOString(),
        },
        { onConflict: 'provider,query,max_results' }
      )

    if (error) {
      console.error('[search-cache] Save error:', error.message)
    }
  } catch (err) {
    console.error('[search-cache] Save threw:', err)
  }
}

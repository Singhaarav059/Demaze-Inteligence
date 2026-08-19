// ============================================================
// Page cache — G6 (see docs/cache-layer-design.md)
// ============================================================
// Caches G4's per-page fetch+extract result (lib/pipeline/html-extractor.ts's
// FetchAndExtractResult), keyed by URL. Distinct from the existing
// lib/cache/scrape-cache.ts, which caches an entire Firecrawl-driven
// multi-page ScrapeResult per analyzed company URL (one row per company
// scrape run) — this is finer-grained, one entry per individual page, for
// G3/G4/G5's standalone directFetch()/fetchAndExtract()/crawlWebsite()
// stack, none of which had any caching before this session.
//
// Storage: in-memory module-scope Map, NOT Supabase — see design doc for
// the full reasoning. Short version: scrape-cache.ts/search-cache.ts are
// Supabase-backed because they're already wired into the LIVE request path
// (app/api/admin/test-analysis/route.ts calls them on every real run), so
// they genuinely need to survive across requests/deploys. This module's
// only callers today are G5's smart-crawler.ts, itself still NOT wired
// into the live route (see that file's own header) — nothing in production
// calls this yet, so an in-memory cache is the correct, lower-risk choice
// per this session's own "lean toward simpler when unsure" instruction.
// Move to Supabase (mirroring scrape-cache.ts's schema) once a future G7/G8
// session actually wires the G3-G5 stack into a real request path.
import { hashContent } from './content-hash'
import { recordMetric } from '@/lib/pipeline/research-metrics'
import { fetchAndExtract, type FetchAndExtractResult } from '@/lib/pipeline/html-extractor'

// Page content is roughly as volatile as a full company scrape — same TTL
// as scrape-cache.ts's CACHE_TTL_HOURS for consistency, not an arbitrary
// re-pick.
export const PAGE_CACHE_TTL_HOURS = 24

interface PageCacheEntry {
  page: FetchAndExtractResult
  contentHash: string
  cachedAt: number
}

const store = new Map<string, PageCacheEntry>()

function isFresh(entry: PageCacheEntry, now: number): boolean {
  return now - entry.cachedAt <= PAGE_CACHE_TTL_HOURS * 60 * 60 * 1000
}

/** Returns a fresh cached entry for `url`, or null on a miss/expiry. Exported for tests. */
export function getCachedPage(url: string, now: number = Date.now()): PageCacheEntry | null {
  const entry = store.get(url)
  if (!entry || !isFresh(entry, now)) {
    recordMetric('cacheMisses')
    return null
  }
  recordMetric('cacheHits')
  return entry
}

/** Stores a successful fetch result. Exported for tests. */
export function savePageCache(url: string, page: FetchAndExtractResult, now: number = Date.now()): PageCacheEntry {
  const entry: PageCacheEntry = { page, contentHash: hashContent(page.markdown), cachedAt: now }
  store.set(url, entry)
  return entry
}

/** Test-only: reset the shared cache between test files/cases. */
export function clearPageCache(): void {
  store.clear()
}

export interface CachedFetchResult extends FetchAndExtractResult {
  fromCache: boolean
  // Only set on a live refetch (fromCache: false) when a prior (possibly
  // stale/expired) entry existed for this URL — true/false = "content hash
  // differs/matches the last cached copy", undefined = nothing to compare
  // against (first-ever fetch of this URL).
  contentChanged?: boolean
}

/**
 * Cache-first wrapper around html-extractor.ts's fetchAndExtract(). A hit
 * within TTL returns the cached page with no network call. A miss (or an
 * expired/stale entry) re-fetches; on success, compares the new content
 * hash against any prior entry to report contentChanged (the "stale
 * refresh" case — content genuinely unchanged since last cached vs. a
 * real update) before overwriting the cache. Failures are never cached —
 * a transient fetch error shouldn't be "remembered" as this page's state
 * for a full TTL window; the next call retries fresh.
 */
export async function fetchAndExtractCached(url: string, timeoutMs?: number): Promise<CachedFetchResult> {
  const cached = getCachedPage(url)
  if (cached) return { ...cached.page, fromCache: true }

  const priorStale = store.get(url) // present but expired, if any — used only for the contentChanged comparison
  const fresh = await fetchAndExtract(url, timeoutMs)
  if (!fresh.success) return { ...fresh, fromCache: false }

  const contentHash = hashContent(fresh.markdown)
  const contentChanged = priorStale ? priorStale.contentHash !== contentHash : undefined
  store.set(url, { page: fresh, contentHash, cachedAt: Date.now() })
  return { ...fresh, fromCache: false, contentChanged }
}

// content hashing is re-exported here (not just from content-hash.ts)
// purely so a caller that already imports page-cache.ts for the functions
// above doesn't need a second import line — same value, same function.
export { hashContent }

// ============================================================
// Evidence cache — G6 (see docs/cache-layer-design.md)
// ============================================================
// Caches G2's attributeQuoteToSource() result (lib/pipeline/evidence-
// ledger.ts) — the one non-trivial, repeatable-input computation in the
// evidence-ledger pipeline: it re-parses the entire content pool
// (parseContentSegments(), a full regex pass over up to ~16,000 chars) on
// every call, and within one run that content pool is IDENTICAL across
// every opportunity/pain-point evidence item being attributed (all draw
// from the same extractorData.websitePreview). Caching by
// (quote+snippet, contentPool) skips re-parsing the same pool for every
// repeat call, both within a single run (today, already live) and across
// re-runs of the same company with unchanged scraped content (once G7/G8
// wire this pipeline stage into repeat traffic).
//
// Storage: in-memory, same reasoning as page-cache.ts — nothing in the
// live route calls the CACHED wrapper yet (see evidence-ledger.ts's
// attributeQuoteToSourceCached() header), only the module-internal reuse
// this cache already gives away for free within a run's own repeated
// calls. Move to Supabase only once a session wires the cached wrapper
// into normalize.ts's live call site.
//
// Content hashing: the cache key hashes BOTH the quote/snippet and the
// full content pool (via lib/cache/content-hash.ts's hashContent(), sha256)
// rather than storing either verbatim — same key-collision-avoidance
// reasoning as page-cache.ts, and avoids holding large content strings as
// Map keys in memory.
import { hashContent } from './content-hash'
import { recordMetric } from '@/lib/pipeline/research-metrics'
import type { QuoteAttribution } from '@/lib/pipeline/evidence-ledger'

// Long TTL: classifySourceType()/parseContentSegments() are deterministic
// pure functions of their inputs — a cached attribution never goes "stale"
// on its own the way a live page fetch does. The TTL here exists only to
// bound unbounded memory growth over a long-running process, not because
// the underlying fact expires — same 30-day order-of-magnitude as
// search-cache.ts's SEARCH_CACHE_TTL_HOURS for a similarly low-volatility
// cache.
export const EVIDENCE_CACHE_TTL_HOURS = 24 * 30

// Bumping this invalidates every cached entry without a schema/migration —
// the intended lever if evidence-ledger.ts's classification logic
// (classifySourceType/segment-matching) ever changes in a way that would
// make an old cached attribution wrong. See G2.5's own design-doc note
// ("weights explicitly not tuned yet, calibrate later") for the same
// versioning need on the scoring side; this covers the attribution side.
const SCORING_VERSION = 1

interface EvidenceCacheEntry {
  attribution: QuoteAttribution
  cachedAt: number
}

const store = new Map<string, EvidenceCacheEntry>()

function cacheKey(quoteAndSnippet: string, contentPool: string): string {
  return `${SCORING_VERSION}:${hashContent(quoteAndSnippet)}:${hashContent(contentPool)}`
}

/** Exported for tests. */
export function getCachedAttribution(
  quoteAndSnippet: string,
  contentPool: string,
  now: number = Date.now(),
): QuoteAttribution | null {
  const entry = store.get(cacheKey(quoteAndSnippet, contentPool))
  if (!entry || now - entry.cachedAt > EVIDENCE_CACHE_TTL_HOURS * 60 * 60 * 1000) {
    recordMetric('cacheMisses')
    return null
  }
  recordMetric('cacheHits')
  return entry.attribution
}

/** Exported for tests. */
export function saveCachedAttribution(
  quoteAndSnippet: string,
  contentPool: string,
  attribution: QuoteAttribution,
  now: number = Date.now(),
): void {
  store.set(cacheKey(quoteAndSnippet, contentPool), { attribution, cachedAt: now })
}

/** Test-only: reset the shared cache between test files/cases. */
export function clearEvidenceCache(): void {
  store.clear()
}

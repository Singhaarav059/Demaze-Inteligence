// ============================================================
// Search Router — G7 (Master Research Optimization Plan)
// ============================================================
// New, purely ADDITIVE module — NOT wired into any of the 5 existing
// discovery-engine.ts call sites (Enrichment Discovery, Competitor
// Discovery, ICP Generator, Market Intelligence, Website Discovery,
// Company Discovery) this session. See docs/search-router-design.md for
// the full design writeup, what's deferred, and why.
//
// Priority order (per the plan): cache -> Gemini Search (grounded) ->
// Serper -> Tavily, stopping at the first tier whose results are judged
// "sufficient" (isSearchSufficient below). This intentionally differs from
// discovery-engine.ts's own current live order (Tavily first, Serper
// fallback) — that file is untouched this session; a future G8+ session
// decides whether/how to actually swap discovery-engine.ts onto this
// router, not this one.
//
// Reuses the exact { title, url, content } shape searchTavily()/
// searchSerper() already return (SearchResultItem below is structurally
// identical) so a routedSearch() result is a drop-in substitute anywhere
// that shape is already consumed — no new shape for a future wiring pass
// to reconcile.
// ============================================================

import { getCachedSearch } from '@/lib/cache/search-cache'
import { searchSerper, searchTavily } from './discovery-engine'
import { getCachedGeminiSearch, searchWithGeminiGrounding } from '@/lib/ai/providers/vertex-gemini-search'

export interface SearchResultItem {
  title: string
  url: string
  content: string
}

export type SearchTier = 'cache' | 'gemini_search' | 'serper' | 'tavily'

export interface SearchSufficiencyOptions {
  /** Minimum number of usable (non-near-empty) results required. Default 3. */
  minResults?: number
  /** Minimum content length (chars) for a result to count as "usable". Default 40. */
  minContentChars?: number
}

const DEFAULT_MIN_RESULTS = 3
const DEFAULT_MIN_CONTENT_CHARS = 40

// Pure, testable "is this enough evidence to stop searching" check. Kept
// deliberately lightweight — this runs at SEARCH time, before any content
// extraction, so it can't reuse lib/pipeline/evidence-ledger.ts's
// confidence scoring (that's a post-extraction pipeline, scoring already-
// extracted claims against source-authority/freshness/company-identity —
// there's no claim yet to score here, just raw search hits). A result
// count floor (with a minimum content length so empty/near-empty snippets
// don't count) is the same class of pre-extraction "enough raw material
// yet" heuristic G5's smart-crawler.ts early-stopping already uses for
// page count — not reusing extraction-guards.ts's mentionsTopic()/
// filterTopicallyRelevantResults() either, since those need a topic string
// derived from a specific query shape (discovery-engine.ts's own query
// templates) that a generic single-query router primitive doesn't have;
// worth layering in later if a caller wants topic-aware sufficiency, not
// needed for this router to be useful on its own.
export function isSearchSufficient(
  results: SearchResultItem[],
  options: SearchSufficiencyOptions = {},
): boolean {
  const minResults = options.minResults ?? DEFAULT_MIN_RESULTS
  const minContentChars = options.minContentChars ?? DEFAULT_MIN_CONTENT_CHARS
  const usable = results.filter(r => (r.content ?? '').trim().length >= minContentChars)
  return usable.length >= minResults
}

export interface RoutedSearchOptions {
  maxResults?: number
  sufficiency?: SearchSufficiencyOptions
  tavilyApiKey?: string
  serperApiKey?: string
  geminiApiKey?: string
}

export interface RoutedSearchResult {
  results: SearchResultItem[]
  /** Tiers actually attempted, in the order they were tried. */
  triedTiers: SearchTier[]
  /** Which tier's results were judged sufficient, or null if every configured tier was exhausted without clearing the bar. */
  sufficientAt: SearchTier | null
}

// Cache-only read across all three provider tags — a hit here means real
// evidence already exists for this exact (query, maxResults) key,
// regardless of which vendor originally produced it, so it's checked
// before spending any live call on ANY tier (including Gemini, even though
// Gemini is "tier 1" in priority order — the cache is tier 0 specifically
// because a cache hit is strictly cheaper and no worse than a fresh call
// from the highest-priority live tier).
async function readCacheOnly(query: string, maxResults: number): Promise<SearchResultItem[] | null> {
  const gemini = getCachedGeminiSearch(query, maxResults)
  if (gemini && gemini.length > 0) return gemini
  const serper = await getCachedSearch('serper', query, maxResults)
  if (serper && serper.length > 0) return serper
  const tavily = await getCachedSearch('tavily', query, maxResults)
  if (tavily && tavily.length > 0) return tavily
  return null
}

function keepBest(current: SearchResultItem[], candidate: SearchResultItem[]): SearchResultItem[] {
  return candidate.length > current.length ? candidate : current
}

/**
 * Runs the cache -> Gemini Search -> Serper -> Tavily priority chain for a
 * single query, stopping at the first tier whose results clear
 * isSearchSufficient(). A tier is skipped outright when its API key isn't
 * configured (same "absent key = not set up, not an error" discipline as
 * every other search caller in this codebase). If no tier clears the bar,
 * returns the largest result set seen across every tier that was tried
 * (never an empty result if ANY tier returned something) — same
 * "graceful degradation over a hard empty" precedent as
 * discoverEvidenceSources()'s own per-query Tavily->Serper fallback.
 */
export async function routedSearch(
  query: string,
  options: RoutedSearchOptions = {},
): Promise<RoutedSearchResult> {
  const maxResults = options.maxResults ?? 3
  const triedTiers: SearchTier[] = []
  let best: SearchResultItem[] = []

  // Tier 0 — cache
  triedTiers.push('cache')
  const cached = await readCacheOnly(query, maxResults)
  if (cached) {
    best = keepBest(best, cached)
    if (isSearchSufficient(cached, options.sufficiency)) {
      return { results: cached, triedTiers, sufficientAt: 'cache' }
    }
  }

  // Tier 1 — Gemini Search grounding
  const geminiApiKey = options.geminiApiKey ?? process.env.GEMINI_VERTEX_API_KEY
  if (geminiApiKey) {
    triedTiers.push('gemini_search')
    const geminiResults = await searchWithGeminiGrounding(query, geminiApiKey, maxResults)
    best = keepBest(best, geminiResults)
    if (isSearchSufficient(geminiResults, options.sufficiency)) {
      return { results: geminiResults, triedTiers, sufficientAt: 'gemini_search' }
    }
  }

  // Tier 2 — Serper
  const serperApiKey = options.serperApiKey ?? process.env.SERPER_API_KEY
  if (serperApiKey) {
    triedTiers.push('serper')
    const serperResults = await searchSerper(query, serperApiKey, maxResults)
    best = keepBest(best, serperResults)
    if (isSearchSufficient(serperResults, options.sufficiency)) {
      return { results: serperResults, triedTiers, sufficientAt: 'serper' }
    }
  }

  // Tier 3 — Tavily (last, per this plan's priority order — note this is
  // the OPPOSITE priority from discovery-engine.ts's current live order,
  // see header comment)
  const tavilyApiKey = options.tavilyApiKey ?? process.env.TAVILY_API_KEY
  if (tavilyApiKey) {
    triedTiers.push('tavily')
    const tavilyResults = await searchTavily(query, tavilyApiKey, maxResults)
    best = keepBest(best, tavilyResults)
    if (isSearchSufficient(tavilyResults, options.sufficiency)) {
      return { results: tavilyResults, triedTiers, sufficientAt: 'tavily' }
    }
  }

  return { results: best, triedTiers, sufficientAt: null }
}

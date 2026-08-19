// ============================================================
// Gemini Search Grounding — G7 (Master Research Optimization Plan)
// ============================================================
// A NEW capability on top of the ALREADY-approved Vertex AI Gemini vendor
// (see provider-factory.ts / vertex-gemini.ts) — this is not a new vendor
// dependency, just Gemini's native Google Search grounding tool
// (`tools: [{ googleSearch: {} }]`), which the plain-completion
// VertexGeminiProvider never attaches. Kept as a SIBLING file rather than a
// method on VertexGeminiProvider — this returns search RESULTS (a list of
// sources), not a CompletionResponse, so it doesn't fit the AIProvider
// interface shape, and a separate file means zero risk of touching the
// live text-completion chain provider-factory.ts already depends on.
//
// Deliberately NOT using jsonMode/responseMimeType here — Gemini's
// structured-output mode and Search grounding are not reliably combinable
// (unconfirmed either way without a live call, and this module is not
// live-verified this session — see docs/search-router-design.md). Instead
// this reads grounding metadata directly off the response
// (candidates[0].groundingMetadata.groundingChunks[].web.{uri,title}) — a
// real, typed field on @google/genai's response shape, not a parsed-JSON
// guess. Gemini does not return a distinct snippet per grounded source the
// way Tavily/Serper do, so `content` on every result below is the model's
// own synthesized answer text (shared across all cited sources for one
// query) — a real limitation, documented here and in the design doc, not
// hidden. Anything downstream that needs a verified per-source quote must
// still fetch and check it directly (same "quote is real, not necessarily
// the right interpretation" discipline as lib/pipeline/quote-verification.ts
// / lib/enrichment/extraction-guards.ts's adversarial-content guard).
//
// In-memory cache only, same precedent as G6's lib/cache/page-cache.ts /
// evidence-cache.ts: search_query_cache's `provider` column has a hard
// CHECK ('tavily','serper') constraint (migration 012) — widening it for a
// capability with no live caller yet would be a premature migration, per
// this plan's own "no schema changes for code nothing calls live" G6
// precedent. Revisit once this is wired into a real call site.
// ============================================================

import { GoogleGenAI, ThinkingLevel } from '@google/genai'

export interface GeminiSearchResultItem {
  title: string
  url: string
  content: string
}

const GEMINI_SEARCH_TIMEOUT_MS = 10_000
const GEMINI_SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h, matches page-cache.ts's TTL reasoning

// ponytail: module-scope Map, no eviction beyond TTL-on-read — fine for a
// not-yet-live module with no real traffic; move to the Supabase table
// (after widening its provider CHECK constraint) if this gets wired into a
// live route with real query volume.
const cache = new Map<string, { results: GeminiSearchResultItem[]; cachedAt: number }>()

function cacheKey(query: string, maxResults: number): string {
  return `${query}::${maxResults}`
}

export function getCachedGeminiSearch(query: string, maxResults: number): GeminiSearchResultItem[] | null {
  const entry = cache.get(cacheKey(query, maxResults))
  if (!entry) return null
  if (Date.now() - entry.cachedAt > GEMINI_SEARCH_CACHE_TTL_MS) return null
  return entry.results
}

function saveCachedGeminiSearch(query: string, maxResults: number, results: GeminiSearchResultItem[]): void {
  cache.set(cacheKey(query, maxResults), { results, cachedAt: Date.now() })
}

/**
 * Searches the web via Gemini's native Google Search grounding tool.
 * Never throws — returns [] on any failure (no key, network error,
 * timeout, no grounded sources), same non-fatal discipline as
 * searchTavily()/searchSerper() in lib/enrichment/discovery-engine.ts.
 */
export async function searchWithGeminiGrounding(
  query: string,
  apiKey: string,
  maxResults: number = 3,
): Promise<GeminiSearchResultItem[]> {
  const cached = getCachedGeminiSearch(query, maxResults)
  if (cached) return cached

  try {
    const client = new GoogleGenAI({ vertexai: true, apiKey })
    const response = await Promise.race([
      client.models.generateContent({
        model: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
        contents: query,
        config: {
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Gemini Search grounding timeout after ${GEMINI_SEARCH_TIMEOUT_MS}ms`)), GEMINI_SEARCH_TIMEOUT_MS)
      ),
    ])

    const text = (response.text ?? '').slice(0, 300)
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []

    const seenUrls = new Set<string>()
    const results: GeminiSearchResultItem[] = []
    for (const chunk of chunks) {
      const uri = chunk.web?.uri
      if (!uri || seenUrls.has(uri)) continue
      seenUrls.add(uri)
      results.push({ title: chunk.web?.title ?? '', url: uri, content: text })
      if (results.length >= maxResults) break
    }

    if (results.length > 0) saveCachedGeminiSearch(query, maxResults, results)
    return results
  } catch (err) {
    console.warn('[gemini-search] grounding call failed:', err instanceof Error ? err.message : String(err))
    return []
  }
}

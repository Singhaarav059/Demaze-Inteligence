// In-house direct HTTP fetcher (plan §42 G3).
//
// Consolidates the ad-hoc fetch()-with-browser-UA-and-AbortController pattern
// already duplicated across scraper.ts/web-enricher.ts/website-discovery.ts
// into one reusable function — additive only, none of those existing call
// sites are touched or replaced (plan: "Do not remove Firecrawl").
//
// Not wired into the live scrape chain yet: there is no in-house HTML→text
// extractor until G4, so raw HTML from this fetcher isn't safe to feed into
// evidence-extractor.ts today. This module exists to prove the fetch layer
// works against real sites (see docs/direct-fetcher-comparison.md) before G4
// builds extraction on top of it.
//
// robots.txt checking and duplicate-URL dedup are explicitly deferred to G5
// (smart crawler) — both are crawl-policy concerns, not raw-fetch mechanics,
// and G5's own implementation list already owns "robots"/"deduplication".
import { recordMetric } from './research-metrics'

export const DIRECT_FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ponytail: flat 8MB cap, not a streaming size guard — good enough to reject
// a runaway response (e.g. a misconfigured server streaming forever); revisit
// with a real streaming reader if a legitimate page ever needs to exceed this.
const MAX_RESPONSE_BYTES = 8_000_000

export interface DirectFetchResult {
  ok: boolean
  status: number | null
  url: string // final URL after redirects
  contentType: string | null
  isHtml: boolean
  text: string | null // raw text/HTML, null on failure or oversized
  error: string | null
}

async function attemptFetch(url: string, timeoutMs: number): Promise<DirectFetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': DIRECT_FETCH_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
    })
    const contentType = res.headers.get('content-type')
    const isHtml = !!contentType && /text\/html|application\/xhtml/i.test(contentType)
    const declaredLength = Number(res.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_RESPONSE_BYTES) {
      return { ok: false, status: res.status, url: res.url || url, contentType, isHtml, text: null, error: `response too large (${declaredLength} bytes)` }
    }
    if (!res.ok) {
      return { ok: false, status: res.status, url: res.url || url, contentType, isHtml, text: null, error: `HTTP ${res.status}` }
    }
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_RESPONSE_BYTES) {
      return { ok: false, status: res.status, url: res.url || url, contentType, isHtml, text: null, error: `response too large (${buf.byteLength} bytes)` }
    }
    return { ok: true, status: res.status, url: res.url || url, contentType, isHtml, text: new TextDecoder('utf-8').decode(buf), error: null }
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    return {
      ok: false,
      status: null,
      url,
      contentType: null,
      isHtml: false,
      text: null,
      error: isAbort ? `timed out after ${timeoutMs}ms` : String(err instanceof Error ? err.message : err),
    }
  } finally {
    clearTimeout(timer)
  }
}

// One retry on a transient failure (timeout, network error, or 5xx) — not on
// a definitive 4xx, since retrying a real 404 just wastes a second round
// trip. No backoff delay between the two attempts: that's a concurrency-level
// concern (plan G10's own "429 backoff" test), not this module's job.
export async function directFetch(url: string, timeoutMs = 10_000): Promise<DirectFetchResult> {
  recordMetric('directFetchCalls')
  const first = await attemptFetch(url, timeoutMs)
  if (first.ok) return first
  const transient = first.status === null || first.status >= 500
  if (!transient) return first
  recordMetric('directFetchCalls')
  return attemptFetch(url, timeoutMs)
}

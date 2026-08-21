// ============================================================
// Company Universe — shared provider HTTP client
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md, Section 23:
// "Every external provider must have rate limiting, retry with backoff,
// 429 handling, timeout, circuit breaker or graceful failure, quota
// awareness, logging. Respect provider policies. Never bypass rate
// limits." One shared implementation for all 5 providers rather than each
// adapter reinventing retry/backoff — the actual provider-specific parts
// (auth header shape, response parsing, endpoint URLs) stay in each
// provider's own file, matching this repo's "duplication-over-sharing for
// small per-file logic, real shared modules for genuinely systemic
// concerns" precedent (see docs/DECISIONS.md's discovery-module history).
//
// Local rate limiting reuses lib/rate-limit.ts's fixed-window counter
// directly rather than a second implementation — same in-memory,
// single-process caveat already documented there applies here too (not a
// new limitation this file introduces).
//
// Deliberately NOT a Supabase-aware module — this stays pure I/O + retry
// logic, same "pure lib, I/O/persistence at the pipeline/route layer"
// split as every other lib/enrichment module in this codebase. Callers
// that want per-call metrics recorded (for
// company_universe_ingestion_runs) pass an `onAttempt` callback; this file
// never touches the database itself.
// ============================================================

import { checkRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export interface RateLimitConfig {
  limit: number
  windowMs: number
}

export interface FetchAttemptMeta {
  attempt: number
  status?: number
  latencyMs: number
  rateLimited: boolean
  timedOut: boolean
  networkError: boolean
}

export interface ProviderFetchOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  maxRetries?: number
  // Local, in-process throttle — a distinct concern from the provider's own
  // server-side rate limit (which surfaces as a 429 this function also
  // handles). Omit to skip local throttling (e.g. a provider with no
  // documented rate limit, like SEC's ticker-map file).
  rateLimit?: { key: string; config: RateLimitConfig }
  onAttempt?: (meta: FetchAttemptMeta) => void
}

export type ProviderFetchResult<T> =
  | { ok: true; data: T; status: number; latencyMs: number; attempts: number }
  | { ok: false; error: string; status?: number; rateLimited: boolean; timedOut: boolean; attempts: number }

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RETRIES = 2
const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 8_000

function backoffMs(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Retry-After can be either a delay in seconds or an HTTP-date — only the
// seconds form is common on JSON APIs, but both are handled since nothing
// here should crash on the less common shape.
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const dateMs = Date.parse(header)
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now())
  return null
}

/**
 * Fetch + parse JSON with timeout, exponential backoff on transient
 * failures (network error, timeout, 5xx), explicit 429/Retry-After
 * handling, and an optional local rate-limit pre-check. Never throws —
 * every outcome (including "gave up after N retries") is a typed result,
 * same graceful-degradation contract as every other enrichment source in
 * this codebase (a provider being unavailable must never crash discovery).
 */
export async function fetchProviderJson<T>(
  url: string,
  scope: string,
  options: ProviderFetchOptions = {}
): Promise<ProviderFetchResult<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES

  if (options.rateLimit) {
    const rl = checkRateLimit(options.rateLimit.key, options.rateLimit.config)
    if (!rl.allowed) {
      logger.warn(scope, `local rate limit reached, not calling ${url}`, { retryAfterSeconds: rl.retryAfterSeconds })
      return { ok: false, error: `Local rate limit reached — retry after ${rl.retryAfterSeconds ?? '?'}s`, rateLimited: true, timedOut: false, attempts: 0 }
    }
  }

  let attempt = 0
  let lastError = 'unknown error'
  let lastStatus: number | undefined
  let lastRateLimited = false
  let lastTimedOut = false

  while (attempt <= maxRetries) {
    const startedAt = Date.now()
    try {
      const res = await fetch(url, {
        headers: options.headers,
        signal: AbortSignal.timeout(timeoutMs),
      })
      const latencyMs = Date.now() - startedAt

      if (res.status === 429) {
        const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'))
        options.onAttempt?.({ attempt, status: 429, latencyMs, rateLimited: true, timedOut: false, networkError: false })
        lastStatus = 429
        lastRateLimited = true
        lastError = `429 rate limited by ${scope}`
        if (attempt < maxRetries) {
          const waitMs = retryAfterMs ?? backoffMs(attempt)
          logger.warn(scope, `429 from provider, waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`)
          await sleep(waitMs)
          attempt++
          continue
        }
        break
      }

      if (!res.ok) {
        options.onAttempt?.({ attempt, status: res.status, latencyMs, rateLimited: false, timedOut: false, networkError: false })
        lastStatus = res.status
        lastError = `HTTP ${res.status} from ${scope}`
        // Only 5xx is treated as transient/retryable — a 4xx (other than
        // 429, handled above) means the request itself is wrong and
        // retrying identically will never succeed.
        if (res.status >= 500 && attempt < maxRetries) {
          const waitMs = backoffMs(attempt)
          await sleep(waitMs)
          attempt++
          continue
        }
        break
      }

      const data = (await res.json()) as T
      options.onAttempt?.({ attempt, status: res.status, latencyMs, rateLimited: false, timedOut: false, networkError: false })
      return { ok: true, data, status: res.status, latencyMs, attempts: attempt + 1 }
    } catch (e) {
      const latencyMs = Date.now() - startedAt
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
      options.onAttempt?.({ attempt, latencyMs, rateLimited: false, timedOut, networkError: !timedOut })
      lastTimedOut = timedOut
      lastError = e instanceof Error ? e.message : String(e)
      if (attempt < maxRetries) {
        const waitMs = backoffMs(attempt)
        logger.warn(scope, `fetch failed (${lastError}), retrying ${attempt + 1}/${maxRetries} after ${waitMs}ms`)
        await sleep(waitMs)
        attempt++
        continue
      }
      break
    }
  }

  return { ok: false, error: lastError, status: lastStatus, rateLimited: lastRateLimited, timedOut: lastTimedOut, attempts: attempt + 1 }
}

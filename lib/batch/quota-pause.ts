// ============================================================
// Batch Quota-Pause Detection — v1
// ============================================================
// Pulled out of app/admin/batch-upload/page.tsx so the detection logic can
// be unit-tested without a browser or real API calls. Behavior unchanged
// from the original inline version — this is a pure extraction.
//
// Known signatures observed live: Firecrawl "insufficient credits", Tavily
// HTTP 432 / "exceeds your plan", generic 429/rate-limit from the LLM
// provider chain. Scanned from scrapeResult.debug.errors and
// validation.gates reasons/diagnostics — the only place these surface in
// the API response today.
// ============================================================

export interface QuotaCheckInput {
  scrapeResult?: unknown
  validation?: { gates?: Array<{ reason?: string; diagnostics?: unknown }> }
  error?: string
}

export const QUOTA_SIGNATURES = [
  /insufficient credit/i,
  /exceeds your plan/i,
  /quota exceeded/i,
  /rate limit/i,
  /\b429\b/,
  /\b432\b/,
]

/** Returns the matched haystack text if any known quota/rate-limit signature
 * is found in the response, else null. Deliberately narrow — a generic
 * fetch/parse failure (e.g. an LLM_PARSE_FAIL retry) must NOT match here,
 * since that's a different failure class and shouldn't count toward a
 * quota-exhaustion pause. */
export function quotaSignatureIn(data: QuotaCheckInput): string | null {
  const haystacks: string[] = []

  if (data.scrapeResult && typeof data.scrapeResult === 'object' && 'debug' in data.scrapeResult) {
    const debug = (data.scrapeResult as { debug?: { errors?: string[] } }).debug
    if (debug?.errors) haystacks.push(...debug.errors)
  }

  const gates = data.validation?.gates
  if (gates) {
    for (const g of gates) {
      if (g.reason) haystacks.push(g.reason)
      if (g.diagnostics) haystacks.push(JSON.stringify(g.diagnostics))
    }
  }

  if (data.error) haystacks.push(data.error)

  for (const text of haystacks) {
    for (const sig of QUOTA_SIGNATURES) {
      if (sig.test(text)) return text
    }
  }
  return null
}

/** 3 consecutive companies hitting a quota signature pauses the batch —
 * chosen to avoid pausing on one flaky/transient error while still catching
 * a genuinely exhausted quota before it burns through the rest of the queue. */
export const QUOTA_PAUSE_THRESHOLD = 3

/** Reducer for the consecutive-hit counter: increments on a hit, resets to
 * zero on anything else (a single non-quota result between two quota hits
 * breaks the streak — this is intentional, not a bug). */
export function nextConsecutiveHits(current: number, quotaMsg: string | null): number {
  return quotaMsg ? current + 1 : 0
}

export function shouldPauseBatch(consecutiveHits: number): boolean {
  return consecutiveHits >= QUOTA_PAUSE_THRESHOLD
}

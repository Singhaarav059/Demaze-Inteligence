// ============================================================
// Bright Data client — SERP search + LinkedIn company enrichment
// ============================================================
// Added 2026-08-19 per explicit user instruction: benchmark Bright Data
// (5,000 free monthly credits) as an ADDITIONAL discovery/enrichment
// source, NOT a mandatory replacement for Firecrawl/Tavily/Serper/the
// in-house crawler. This file is a thin client only — nothing here is
// wired into any default/live pipeline path. See
// benchmarks/brightdata-comparison.ts for the controlled benchmark that
// actually spends credits, and company-discovery.ts's `searchOverride`
// option for how a caller opts a specific run into Bright Data.
//
// Two Bright Data products, two different call shapes:
// 1. SERP API — POST https://api.brightdata.com/request with
//    { zone, url, format: 'raw', data_format: 'html' } (this exact body
//    shape confirmed against a real zone's dashboard-generated example,
//    2026-08-19) + `brd_json=1` appended to the target URL — this is the
//    SERP-API-specific override (independent of format/data_format, which
//    govern the generic Web Unlocker raw/markdown passthrough) that makes
//    Bright Data return its own already-parsed SERP JSON (an `organic`
//    array) instead of a raw Google results page. Maps directly onto the
//    { title, url, content } shape searchTavily()/searchSerper() already
//    return (see search-router.ts's SearchResultItem).
// 2. LinkedIn Company dataset — async trigger+poll: POST .../datasets/v3/
//    trigger?dataset_id=<id> with [{url: <linkedin company url>}] returns
//    a snapshot_id; GET .../datasets/v3/snapshot/<id> until status is no
//    longer running/building. dataset_id is a Bright Data account-wide
//    constant for "LinkedIn Company Information", not a secret.
//
// Credential resolution follows edgar-client.ts's precedent (flat env
// var, no DB row — this is an always-available enrichment/discovery
// SOURCE, not a per-capability outbound vendor with a DB-backed
// integrations toggle).
// ============================================================

export function getBrightDataApiKey(): string | null {
  return process.env.BRIGHTDATA_API_KEY?.trim() || null
}

// The SERP API is billed per "zone" (a named proxy/API config created in
// the Bright Data dashboard) — there is no default zone, unlike the API
// key itself.
export function getBrightDataSerpZone(): string | null {
  return process.env.BRIGHTDATA_SERP_ZONE?.trim() || null
}

const REQUEST_TIMEOUT_MS = 20_000
const LINKEDIN_COMPANY_DATASET_ID = 'gd_l1vikfnt1wgvvqz95w'
const SNAPSHOT_POLL_INTERVAL_MS = 3_000
const SNAPSHOT_POLL_MAX_ATTEMPTS = 40 // ~2 minutes, Bright Data's own docs say typical jobs finish within 5 min but this is a benchmark, not a production wait

// ── Usage counters ─────────────────────────────────────────────────
// Plain module-scope counters, not lib/pipeline/research-metrics.ts's
// AsyncLocalStorage-based store — that store only exists inside a live
// pipeline request; the benchmark script that's the actual reason this
// file exists runs standalone (npx tsx), with no request context to hang
// a store off. Good enough for "how many credits did this run cost."
export const brightDataUsage = { serpRequests: 0, datasetTriggers: 0, datasetPolls: 0 }

export function resetBrightDataUsage(): void {
  brightDataUsage.serpRequests = 0
  brightDataUsage.datasetTriggers = 0
  brightDataUsage.datasetPolls = 0
}

// ── SERP search ──────────────────────────────────────────────────

export interface SearchResultItem {
  title: string
  url: string
  content: string
}

interface SerpJsonOrganicResult {
  title?: string
  link?: string
  description?: string
  snippet?: string
}

// Bright Data's own documented behavior (confirmed live 2026-08-19, error
// body: "This query recently failed and cannot be attempted at this time.
// Please try again later, after a minimum of 15 seconds." — see
// https://docs.brightdata.com/scraping-automation/serp-api/debugging):
// repeating the IDENTICAL query string within 15s of a prior attempt
// (especially a failed one) is rejected with a 200 + empty/non-JSON body,
// not a clean error status. RETRY_DELAY_MS is set safely above that floor.
// In the real discovery pipeline this rarely matters (each query in a
// batch is distinct), but two back-to-back calls with the same query
// string (e.g. a naive smoke test) will reliably hit it.
const RETRY_DELAY_MS = 16_000

// Never throws either way — same graceful-degradation contract as every
// other search source in this codebase (searchTavily/searchSerper).
export async function searchBrightDataSerp(query: string, maxResults = 10): Promise<SearchResultItem[]> {
  const apiKey = getBrightDataApiKey()
  const zone = getBrightDataSerpZone()
  if (!apiKey || !zone) return []

  const targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&brd_json=1`

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
    try {
      brightDataUsage.serpRequests += 1
      const res = await fetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ zone, url: targetUrl, format: 'raw', data_format: 'html' }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!res.ok) continue
      const data = await res.json().catch(() => null) as { organic?: SerpJsonOrganicResult[] } | null
      const organic = Array.isArray(data?.organic) ? data.organic : []
      if (organic.length === 0) continue // empty/malformed — retry once before giving up
      return organic
        .slice(0, maxResults)
        .filter(r => r.link)
        .map(r => ({
          title: r.title ?? '',
          url: r.link as string,
          content: r.description ?? r.snippet ?? '',
        }))
    } catch {
      continue
    }
  }
  return []
}

// ── LinkedIn company URL lookup ──────────────────────────────────
// Bright Data's LinkedIn dataset needs a company URL as input, not a
// name — reuses the SERP search above (one more request) rather than a
// separate name-search product.

export async function findLinkedInCompanyUrl(companyName: string): Promise<string | null> {
  const results = await searchBrightDataSerp(`site:linkedin.com/company "${companyName}"`, 5)
  const hit = results.find(r => /linkedin\.com\/company\//i.test(r.url))
  if (!hit) return null
  const match = hit.url.match(/https?:\/\/[a-z]{2,3}\.linkedin\.com\/company\/[^/?#]+/i)
  return match ? match[0] : hit.url
}

// ── LinkedIn company enrichment (dataset trigger + poll) ──────────

export interface BrightDataCompanyProfile {
  name?: string
  about?: string
  industry?: string
  companySize?: string
  headquarters?: string
  followers?: number
  specialties?: string[]
  website?: string
  raw: Record<string, unknown>
}

interface TriggerResponse {
  snapshot_id?: string
}

async function triggerLinkedInCompanySnapshot(linkedinUrl: string, apiKey: string): Promise<string | null> {
  try {
    brightDataUsage.datasetTriggers += 1
    const res = await fetch(
      `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${LINKEDIN_COMPANY_DATASET_ID}&format=json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{ url: linkedinUrl }]),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    )
    if (!res.ok) return null
    const data = await res.json() as TriggerResponse
    return data.snapshot_id ?? null
  } catch {
    return null
  }
}

async function pollSnapshot(snapshotId: string, apiKey: string): Promise<Record<string, unknown>[] | null> {
  for (let attempt = 0; attempt < SNAPSHOT_POLL_MAX_ATTEMPTS; attempt++) {
    try {
      brightDataUsage.datasetPolls += 1
      const res = await fetch(
        `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
        { headers: { 'Authorization': `Bearer ${apiKey}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
      )
      if (res.status === 202) {
        // still running/building — Bright Data returns 202 while a
        // snapshot isn't ready yet.
        await new Promise(r => setTimeout(r, SNAPSHOT_POLL_INTERVAL_MS))
        continue
      }
      if (!res.ok) return null
      const data = await res.json()
      return Array.isArray(data) ? data as Record<string, unknown>[] : null
    } catch {
      return null
    }
  }
  return null // gave up — caller treats as "no data", same as any other miss
}

// Fails soft at every stage (no LinkedIn URL found, trigger fails, poll
// times out) — never throws, mirrors edgar-client.ts's fetchEdgarFilings()
// contract. This is a SLOW, credit-costly call (1 SERP + 1 trigger + up to
// ~40 polls) — only ever call this for a small, deliberate sample, never
// in a loop over every discovered company.
export async function fetchBrightDataCompanyProfile(companyNameOrLinkedInUrl: string): Promise<BrightDataCompanyProfile | null> {
  const apiKey = getBrightDataApiKey()
  if (!apiKey) return null

  const linkedinUrl = /linkedin\.com\/company\//i.test(companyNameOrLinkedInUrl)
    ? companyNameOrLinkedInUrl
    : await findLinkedInCompanyUrl(companyNameOrLinkedInUrl)
  if (!linkedinUrl) return null

  const snapshotId = await triggerLinkedInCompanySnapshot(linkedinUrl, apiKey)
  if (!snapshotId) return null

  const records = await pollSnapshot(snapshotId, apiKey)
  const record = records?.[0]
  if (!record) return null

  return {
    name: typeof record.name === 'string' ? record.name : undefined,
    about: typeof record.about === 'string' ? record.about : undefined,
    industry: typeof record.industries === 'string' ? record.industries : undefined,
    companySize: typeof record.company_size === 'string' ? record.company_size : undefined,
    headquarters: typeof record.headquarters === 'string' ? record.headquarters : undefined,
    followers: typeof record.followers === 'number' ? record.followers : undefined,
    specialties: Array.isArray(record.specialties) ? record.specialties.filter((s): s is string => typeof s === 'string') : undefined,
    website: typeof record.website === 'string' ? record.website : undefined,
    raw: record,
  }
}

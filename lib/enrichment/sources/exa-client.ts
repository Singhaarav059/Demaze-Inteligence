// ============================================================
// Exa client — Search / Contents / Answer / Websets
// ============================================================
// Thin, faithful wrappers around Exa's REST API (https://api.exa.ai),
// verified against Exa's own current documentation (docs.exa.ai coding-agent
// reference pages, fetched live, not recalled from training data) before
// writing a line of this file. Same flat-env-var, no-DB-credential-row
// pattern as explee-client.ts/edgar-client.ts — this is a discovery/research
// SOURCE, not an outbound-capability provider, so callers that DO need
// per-capability DB-backed credential selection (decision-maker discovery,
// email finder, enrichment) resolve their own key via
// lib/outbound/settings/provider-selection.ts and pass it into these
// functions, falling back to getExaApiKey() when no DB override exists.
//
// This file intentionally does NOT build query-construction or
// business-logic wrappers (e.g. "discover decision makers at company X") —
// that's each feature's own adapter (lib/outbound/*/providers/exa.ts,
// company-discovery's Exa provider, etc.), same split Demaze already uses
// for Prospeo/Explee. This file only owns: auth, request shaping, response
// typing, error handling, and (for Websets) async polling.
//
// Deliberately NOT implemented yet — no current caller needs them, and
// CRITICAL RULE 18 says don't reach for the expensive/complex capability
// speculatively:
//   - Agent/Research API (POST /agent/runs) — add when Search+Contents+
//     Answer prove insufficient for a specific research task.
//   - Monitors API — Phase 0 confirmed Demaze has no monitoring/change-
//     detection capability at all today; add only once a real "watch this
//     company" feature is being built.
// ============================================================

const BASE_URL = process.env.EXA_API_BASE_URL || 'https://api.exa.ai'
// Websets lives under its own /websets path prefix, not the plain API
// root — confirmed live (POST {BASE_URL}/v0/websets 404'd; Exa's own
// example curl calls use {BASE_URL}/websets/v0/websets).
const WEBSETS_BASE_URL = `${BASE_URL}/websets`
const DEFAULT_TIMEOUT_MS = 60_000

export function getExaApiKey(): string | null {
  return process.env.EXA_API_KEY || null
}

export class ExaApiError extends Error {
  constructor(public status: number, public detail: string, public tag?: string) {
    super(`Exa API ${status}${tag ? ` (${tag})` : ''}: ${detail}`)
  }
}

// ── Shared content-options shape (Search, Contents, and Websets searches
// all embed some form of this) ────────────────────────────────────────────

export interface ExaContentsOptions {
  text?: boolean | {
    maxCharacters?: number
    includeHtmlTags?: boolean
    verbosity?: 'compact' | 'standard' | 'full'
    includeSections?: string[]
    excludeSections?: string[]
  }
  highlights?: boolean | { query?: string; dynamic?: boolean; maxCharacters?: number }
  summary?: boolean | { query?: string; schema?: Record<string, unknown> }
  livecrawlTimeout?: number
  maxAgeHours?: number
  subpages?: number
  subpageTarget?: string | string[]
  extras?: { links?: number; imageLinks?: number }
}

export interface ExaGroundingCitation {
  field: string
  citations: { url: string; title?: string }[]
  confidence?: string
}

// Populated live for category:'company'/'people' searches — a directly
// extracted structured record (not LLM-synthesized), separate from and
// often richer than an outputSchema-synthesized field for the same result.
// Confirmed live (2026-09-01): a company entity's `properties` included
// name/foundedYear/description/workforce.total/headquarters{address,city,
// postalCode,country}/financials{revenueAnnual,fundingTotal,
// fundingLatestRound}/webTraffic/research — but notably NOT an "industry"
// field, so outputSchema synthesis is still worth requesting alongside this
// for fields the native entity doesn't carry. Shape is unconfirmed for
// other categories/entity types — treat as an open record.
export interface ExaEntity {
  id: string
  type: string
  version?: number
  properties: Record<string, unknown>
}

export interface ExaResultItem {
  id: string
  url: string
  title: string | null
  publishedDate: string | null
  author: string | null
  image: string | null
  favicon: string | null
  text?: string
  highlights?: string[]
  summary?: string
  subpages?: ExaResultItem[]
  extras?: { links?: string[]; imageLinks?: string[] }
  entities?: ExaEntity[]
}

export interface ExaCostDollars {
  total: number
  search?: number
  summary?: number
  contents?: number
}

// ── Search ──────────────────────────────────────────────────────────────

export interface ExaSearchParams {
  query: string
  type?: 'auto' | 'fast' | 'instant' | 'deep-lite' | 'deep' | 'deep-reasoning'
  numResults?: number
  category?: 'company' | 'people' | 'publication' | 'news' | 'personal site' | 'financial report'
  userLocation?: string
  includeDomains?: string[]
  excludeDomains?: string[]
  startPublishedDate?: string
  endPublishedDate?: string
  systemPrompt?: string
  outputSchema?: Record<string, unknown>
  contents?: ExaContentsOptions
}

export interface ExaSearchResponse {
  requestId: string
  results: ExaResultItem[]
  output?: { content: unknown; grounding?: ExaGroundingCitation[] }
  costDollars?: ExaCostDollars
}

export async function exaSearch(params: ExaSearchParams, apiKey?: string): Promise<ExaSearchResponse> {
  return exaFetch<ExaSearchResponse>('/search', params, apiKey)
}

// ── Contents ────────────────────────────────────────────────────────────

export interface ExaContentsParams extends ExaContentsOptions {
  urls?: string[]
  ids?: string[]
}

export interface ExaContentsStatus {
  id: string
  status: string
  error?: { tag?: string; httpStatusCode?: number }
}

export interface ExaContentsResponse {
  requestId: string
  results: ExaResultItem[]
  statuses: ExaContentsStatus[]
  costDollars?: ExaCostDollars
}

export async function exaGetContents(params: ExaContentsParams, apiKey?: string): Promise<ExaContentsResponse> {
  if (!params.urls?.length && !params.ids?.length) {
    throw new Error('exaGetContents requires at least one url or id')
  }
  return exaFetch<ExaContentsResponse>('/contents', params, apiKey)
}

// ── Answer ──────────────────────────────────────────────────────────────

export interface ExaAnswerParams {
  query: string
  stream?: boolean
  text?: boolean
  model?: 'exa' | 'exa-pro' | 'exa-research' | 'exa-fast'
  systemPrompt?: string
  userLocation?: string
  outputSchema?: Record<string, unknown>
}

export interface ExaAnswerCitation {
  title: string
  url: string
  publishedDate?: string | null
  author?: string | null
  id: string
  image?: string | null
  favicon?: string | null
  text?: string
}

export interface ExaAnswerResponse {
  requestId: string
  answer: string | Record<string, unknown>
  citations: ExaAnswerCitation[]
  costDollars?: ExaCostDollars
}

export async function exaAnswer(params: ExaAnswerParams, apiKey?: string): Promise<ExaAnswerResponse> {
  return exaFetch<ExaAnswerResponse>('/answer', { ...params, stream: false }, apiKey)
}

// ── Websets ─────────────────────────────────────────────────────────────
// Async: a Webset is created (pending), Exa searches+verifies+enriches it
// in the background, and items are read back once processing settles.
// Confirmed against Exa's own docs: no endpoint exists to synchronously
// retrieve items in the create response — polling (exaWaitForWebsetIdle)
// or a webhook (not implemented here — no callback URL infra in this app
// yet) are the two supported paths.

export interface ExaWebsetCriterion {
  description: string
}

export interface ExaWebsetSearchSpec {
  query: string
  count?: number
  entity?: { type: 'company' | 'person' | 'article' | 'research_paper' | 'custom' }
  criteria?: ExaWebsetCriterion[]
  maxPeoplePerCompany?: number
  recall?: boolean
}

// Docs describe `options` as "1-150 selectable choices" without specifying
// the item shape in the fetched reference — treated as string[] (label
// only) until confirmed against a real response. If Exa rejects this shape
// live, that's the first thing to check.
export interface ExaWebsetEnrichmentSpec {
  description: string
  format?: 'text' | 'email' | 'phone' | 'url' | 'date' | 'number' | 'options'
  options?: string[]
  metadata?: Record<string, string>
}

export interface ExaCreateWebsetParams {
  title?: string
  search: ExaWebsetSearchSpec
  enrichments?: ExaWebsetEnrichmentSpec[]
  externalId?: string
  metadata?: Record<string, string>
}

export interface ExaWebsetSearchProgress {
  found: number
  analyzed: number
  completion: number
  timeLeft?: number
}

export interface ExaWebsetSearchObject {
  id: string
  status: 'created' | 'pending' | 'running' | 'completed' | 'canceled'
  query: string
  entity?: { type: string }
  criteria?: ExaWebsetCriterion[]
  count: number
  progress?: ExaWebsetSearchProgress
  recall?: { total?: number; confidence?: string }
}

export interface ExaWebsetEnrichmentObject {
  id: string
  status: 'pending' | 'canceled' | 'completed'
  description: string
  format?: string
  options?: unknown
  instructions?: string
}

export interface ExaWebset {
  id: string
  status: 'idle' | 'pending' | 'running' | 'paused'
  externalId?: string | null
  title?: string
  searches: ExaWebsetSearchObject[]
  enrichments: ExaWebsetEnrichmentObject[]
  dashboardUrl?: string
  createdAt: string
  updatedAt: string
}

export async function exaCreateWebset(params: ExaCreateWebsetParams, apiKey?: string): Promise<ExaWebset> {
  return exaFetch<ExaWebset>('/v0/websets', params, apiKey, 'POST', 0, WEBSETS_BASE_URL)
}

export async function exaGetWebset(websetId: string, apiKey?: string): Promise<ExaWebset> {
  return exaFetch<ExaWebset>(`/v0/websets/${encodeURIComponent(websetId)}`, null, apiKey, 'GET', 0, WEBSETS_BASE_URL)
}

// Field names inside `properties`/`enrichments` are not fully specified in
// the fetched Exa docs (only that they vary by entity type) — treated as
// an open record rather than guessed-at concrete fields. Verify against a
// real response before assuming specific keys exist.
export interface ExaWebsetItem {
  id: string
  websetId: string
  source?: string
  properties: Record<string, unknown>
  enrichments?: Record<string, unknown>
  evaluations?: unknown
  createdAt?: string
}

export interface ExaListWebsetItemsResponse {
  data: ExaWebsetItem[]
  hasMore: boolean
  nextCursor?: string | null
}

export async function exaListWebsetItems(
  websetId: string,
  opts: { cursor?: string; limit?: number } = {},
  apiKey?: string,
): Promise<ExaListWebsetItemsResponse> {
  const qs = new URLSearchParams()
  if (opts.cursor) qs.set('cursor', opts.cursor)
  if (opts.limit) qs.set('limit', String(opts.limit))
  const path = `/v0/websets/${encodeURIComponent(websetId)}/items${qs.toString() ? `?${qs}` : ''}`
  return exaFetch<ExaListWebsetItemsResponse>(path, null, apiKey, 'GET', 0, WEBSETS_BASE_URL)
}

export async function exaCreateWebsetEnrichment(
  websetId: string,
  params: ExaWebsetEnrichmentSpec,
  apiKey?: string,
): Promise<ExaWebsetEnrichmentObject> {
  return exaFetch<ExaWebsetEnrichmentObject>(`/v0/websets/${encodeURIComponent(websetId)}/enrichments`, params, apiKey, 'POST', 0, WEBSETS_BASE_URL)
}

// ponytail: naive fixed-interval poll, no jitter/backoff — fine at the
// single-webset, human-triggered call volume this integration starts at;
// switch to exponential backoff or a webhook if this ever runs unattended
// at scale.
export async function exaWaitForWebsetIdle(
  websetId: string,
  opts: { pollIntervalMs?: number; timeoutMs?: number } = {},
  apiKey?: string,
): Promise<ExaWebset> {
  const pollIntervalMs = opts.pollIntervalMs ?? 3_000
  const timeoutMs = opts.timeoutMs ?? 120_000
  const deadline = Date.now() + timeoutMs

  let webset = await exaGetWebset(websetId, apiKey)
  while (webset.status !== 'idle' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    webset = await exaGetWebset(websetId, apiKey)
  }
  return webset
}

// ── Transport ───────────────────────────────────────────────────────────
// One retry on 429/5xx after a short fixed delay — enough to absorb a
// transient blip without building a queue/backoff system nothing here
// needs yet (single-request-at-a-time usage, not a batch job).

async function exaFetch<T>(
  path: string,
  body: unknown,
  apiKey: string | undefined,
  method: 'GET' | 'POST' = 'POST',
  attempt = 0,
  baseUrl: string = BASE_URL,
): Promise<T> {
  const key = apiKey || getExaApiKey()
  if (!key) throw new Error('EXA_API_KEY is not set')

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  })

  if ((res.status === 429 || res.status >= 500) && attempt === 0) {
    await new Promise((resolve) => setTimeout(resolve, 750))
    return exaFetch<T>(path, body, apiKey, method, attempt + 1, baseUrl)
  }

  const parsed = await res.json().catch(() => null)
  if (!res.ok) {
    // Two error envelope shapes confirmed live: {error, tag} from /search
    // and /contents (tag is the specific reason), and a NestJS-style
    // {statusCode, message, error} from Websets where `error` is just the
    // generic HTTP reason ("Unauthorized") and `message` carries the real
    // explanation ("Your team does not have access... Upgrade to Pro").
    // Prefer `message` when it's a distinct, more specific string.
    const detail =
      (typeof parsed?.message === 'string' && parsed.message !== parsed?.error ? parsed.message : null) ??
      parsed?.error ??
      res.statusText ??
      'Unknown error'
    const tag = parsed?.tag as string | undefined
    throw new ExaApiError(res.status, detail, tag)
  }
  return parsed as T
}

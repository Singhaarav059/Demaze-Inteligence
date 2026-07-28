// ============================================================
// Lemlist — shared low-level API client
// ============================================================
// Chosen 2026-07-28 as the outreach-send vendor (docs/DECISIONS.md,
// "Outreach send (Phase 2, item 9)") — a dedicated cold-outreach platform
// (built-in Lemwarm warmup, multi-mailbox rotation, native reply webhooks),
// not a bare transactional send API.
//
// Architecture note (read before changing sendEmail's shape): Lemlist has
// NO "send this exact pre-written subject/body to this address now"
// primitive — the same reason lib/outbound/shared/gmail-client.ts's header
// comment gives for ruling out Snov.io. Campaigns are created empty; the
// sequence template (subject/body) is configured once, out of band, in the
// user's real Lemlist account, using merge-tag placeholders. This client
// only ever creates/updates a LEAD in one pre-existing campaign, passing
// this pipeline's already-LLM-generated subject/body as custom variables
// (subjectLine / icebreaker) for that template to interpolate. Lemlist then
// sends on its own schedule — from our side this is an enqueue, not a send,
// hence lib/outbound/sending/providers/lemlist.ts reports SendEmailStatus
// 'queued', not 'sent'.
//
// API shape verified directly against developer.lemlist.com (2026-07-28),
// not guessed:
// - Base URL: https://api.lemlist.com/api
// - Auth is Basic ONLY (not Bearer) — empty username, API key as password:
//   base64(":API_KEY") -> "Authorization: Basic {encoded}". This is the
//   one documented gotcha (colon is mandatory).
// - Rate limit: 20 requests / 2 seconds per API key, applies to all routes,
//   signaled via Retry-After / X-RateLimit-* response headers, not a
//   dedicated status code.
// - Error responses are NOT always JSON — auth failures (400/401/403) and
//   "Campaign not found" (404) come back as plain text. callLemlist() below
//   handles both shapes; unlike prospeo-client.ts's "ok:true whenever JSON
//   comes back" contract, Lemlist's plain-text errors mean we can't rely on
//   "any parseable body = ok" — HTTP status is the primary signal here.
// ============================================================

import type { OutboundCapability } from '@/lib/outbound/settings/types'
import { getActiveCredential, getActiveConfig } from '@/lib/outbound/settings/provider-selection'

const LEMLIST_BASE_URL = 'https://api.lemlist.com/api'
const DEFAULT_TIMEOUT_MS = 15000

export interface LemlistCredential {
  apiKey: string
  campaignId: string
}

// Credential resolution mirrors prospeo-client.ts: outbound_integrations DB
// row first (api_key -> credential_encrypted, config.campaignId), then flat
// LEMLIST_API_KEY / LEMLIST_CAMPAIGN_ID env vars for local dev without
// Supabase. Both apiKey and campaignId are required — a key with no target
// campaign (or vice versa) can't do anything useful, so this resolves to
// null rather than a half-populated object.
export async function getLemlistCredential(capability: OutboundCapability): Promise<LemlistCredential | null> {
  const storedKey = await getActiveCredential(capability)
  const storedConfig = await getActiveConfig(capability)
  const apiKey = storedKey || process.env.LEMLIST_API_KEY || null
  const campaignId =
    (typeof storedConfig?.campaignId === 'string' ? storedConfig.campaignId : null) ||
    process.env.LEMLIST_CAMPAIGN_ID ||
    null

  if (!apiKey || !campaignId) return null
  return { apiKey, campaignId }
}

// Optional shared secret for verifying inbound webhook calls (see
// app/api/webhooks/lemlist/route.ts) — set once when the user manually
// registers a webhook in their Lemlist dashboard pointing at our receiver
// URL, stored alongside campaignId in the same non-secret config JSONB
// (it's a webhook verification token, not an account credential — same
// sensitivity tier as a URL, doesn't need AES-256-GCM).
export async function getLemlistWebhookSecret(capability: OutboundCapability): Promise<string | null> {
  const storedConfig = await getActiveConfig(capability)
  const secret = typeof storedConfig?.webhookSecret === 'string' ? storedConfig.webhookSecret : null
  return secret || process.env.LEMLIST_WEBHOOK_SECRET || null
}

function buildBasicAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`:${apiKey}`, 'utf8').toString('base64')}`
}

export interface LemlistCallResult<T> {
  ok: boolean
  status: number
  data: T | null
  rawText: string | null
  error: string | null
  rateLimitRemaining: number | null
  retryAfterSeconds: number | null
}

// Generic request wrapper. Never throws — network/timeout/parse failures
// all resolve to { ok: false }. Unlike Prospeo, a non-2xx status here is a
// reliable failure signal (Lemlist's soft/business-logic responses like
// "campaign not found" are still real errors, not disguised successes), so
// ok tracks res.ok directly rather than "any body came back".
export async function callLemlist<T = unknown>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; apiKey: string; body?: unknown; timeoutMs?: number }
): Promise<LemlistCallResult<T>> {
  const { method = 'GET', apiKey, body, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${LEMLIST_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: buildBasicAuthHeader(apiKey),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    const rawText = await res.text().catch(() => null)
    let data: T | null = null
    if (rawText) {
      try {
        data = JSON.parse(rawText) as T
      } catch {
        data = null // plain-text error body (e.g. "Campaign not found") — rawText still carries it
      }
    }

    const rateLimitRemaining = res.headers.get('X-RateLimit-Remaining')
    const retryAfter = res.headers.get('Retry-After')

    return {
      ok: res.ok,
      status: res.status,
      data,
      rawText,
      error: res.ok ? null : rawText || `HTTP ${res.status}`,
      rateLimitRemaining: rateLimitRemaining ? Number(rateLimitRemaining) : null,
      retryAfterSeconds: retryAfter ? Number(retryAfter) : null,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Network error calling Lemlist'
    return {
      ok: false,
      status: 0,
      data: null,
      rawText: null,
      error: controller.signal.aborted ? `Lemlist request timed out after ${timeoutMs}ms` : message,
      rateLimitRemaining: null,
      retryAfterSeconds: null,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export interface CreateLeadInCampaignParams {
  email: string
  firstName?: string
  lastName?: string
  companyName?: string
  jobTitle?: string
  // Arbitrary custom variables merge-tagged into the campaign's pre-built
  // sequence template (see header comment) — this is how this pipeline's
  // AI-generated subjectLine/body actually reaches the recipient. Per
  // Lemlist's docs, any extra key/value pair in the request body becomes a
  // lead-level custom variable automatically; no separate "variables" field.
  [customVariable: string]: string | undefined
}

export interface LemlistLead {
  _id?: string
  contactId?: string
  campaignId?: string
  campaignName?: string
  email?: string
  isPaused?: boolean
}

// POST /campaigns/{campaignId}/leads — verified response shape (2026-07-28):
// { campaignId, campaignName, email, firstName, lastName, companyName,
//   jobTitle, companyDomain, _id, isPaused, contactId } on 200.
// Known error shapes (plain text, not JSON): 404 "Campaign not found",
// 400 "No API key provided", 401 "The authentication you supplied is
// incorrect", 403 "User linked to this API key is blocked".
export async function createLeadInCampaign(
  apiKey: string,
  campaignId: string,
  params: CreateLeadInCampaignParams
): Promise<LemlistCallResult<LemlistLead>> {
  return callLemlist<LemlistLead>(`/campaigns/${encodeURIComponent(campaignId)}/leads`, {
    method: 'POST',
    apiKey,
    body: params,
  })
}

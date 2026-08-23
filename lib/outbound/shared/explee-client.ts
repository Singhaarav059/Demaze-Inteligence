// ============================================================
// Explee — shared low-level API client for outbound capabilities
// ============================================================
// Decision-Maker Discovery calls /search/people; Email Finder calls
// /enrich/email. Both live here (same vendor/auth/credential-resolution),
// same rationale as lib/outbound/shared/prospeo-client.ts — each provider
// still owns interpreting the response for its own capability.
//
// Credential resolution mirrors Prospeo exactly: outbound_integrations DB
// row (per-capability) first, then a flat EXPLEE_API_KEY env var fallback.
//
// This is a SEPARATE client from lib/enrichment/sources/explee-client.ts
// (the company-search POC — flat-env-only, no DB-row resolution, a
// discovery SOURCE feeding company-discovery.ts, not an outbound
// capability). Same vendor, different credential-resolution model and
// different endpoints, so kept as two files rather than merged.
//
// API schema verified against Explee's own OpenAPI schema
// (https://api.explee.com/public/api/openapi.json) — fields below are
// copied verbatim from SearchPeoplePayload/SearchPeopleResponse/
// EnrichEmailPayload/EnrichEmailResponse, not guessed.
// ============================================================

import type { OutboundCapability } from '@/lib/outbound/settings/types'
import { getActiveCredential } from '@/lib/outbound/settings/provider-selection'

const BASE_URL = process.env.EXPLEE_API_BASE_URL || 'https://api.explee.com/public/api/v1'
const DEFAULT_TIMEOUT_MS = 15000

export async function getExpleeApiKey(capability: OutboundCapability): Promise<string | null> {
  const stored = await getActiveCredential(capability)
  if (stored) return stored
  return process.env.EXPLEE_API_KEY || null
}

// ── Search People (POST /search/people) ─────────────────────────────────

export interface ExpleeSearchPeopleRequest {
  people_filters: { job_titles: string[] }
  company_filters?: { definition: string }
  company_linkedin_ids?: number[]
}

export interface ExpleePerson {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  job_title?: string | null
  company_name?: string | null
  company_domain?: string | null
  linkedin_url?: string | null
}

export interface ExpleeSearchPeopleResponse {
  people?: ExpleePerson[]
  meta?: { total: number; credits_charged: number }
  detail?: string
}

export type ExpleeSearchPeopleCallResult =
  | { ok: true; data: ExpleeSearchPeopleResponse }
  | { ok: false; error: string }

// Unlike Prospeo (which returns non-2xx even for soft "not found" outcomes
// — see prospeo-client.ts's comment), Explee's own existing company-search
// client (lib/enrichment/sources/explee-client.ts) already established
// that a non-2xx response IS a real error with the detail in body.detail —
// mirrored here rather than copying Prospeo's shape verbatim.
export async function callExpleeSearchPeople(
  apiKey: string,
  body: ExpleeSearchPeopleRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ExpleeSearchPeopleCallResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${BASE_URL}/search/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const json = await res.json().catch(() => null)

    if (!res.ok) {
      return { ok: false, error: json?.detail ? `Explee API ${res.status}: ${json.detail}` : `HTTP ${res.status}` }
    }
    if (!json || typeof json !== 'object') {
      return { ok: false, error: 'Empty or invalid JSON response from Explee' }
    }
    return { ok: true, data: json as ExpleeSearchPeopleResponse }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Network error calling Explee'
    return { ok: false, error: controller.signal.aborted ? `Explee request timed out after ${timeoutMs}ms` : message }
  } finally {
    clearTimeout(timeout)
  }
}

// ── Enrich Email (POST /enrich/email) ────────────────────────────────────

export interface ExpleeEnrichEmailRequest {
  first_name: string
  last_name: string
  company_domain: string
  preset?: 'basic' | 'premium'
}

export interface ExpleeEnrichEmailResponse {
  email?: string | null
  confidence_score?: number
  source?: string
  meta?: { credits_charged: number }
  detail?: string
}

export type ExpleeEnrichEmailCallResult =
  | { ok: true; data: ExpleeEnrichEmailResponse }
  | { ok: false; error: string }

export async function callExpleeEnrichEmail(
  apiKey: string,
  body: ExpleeEnrichEmailRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ExpleeEnrichEmailCallResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${BASE_URL}/enrich/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const json = await res.json().catch(() => null)

    if (!res.ok) {
      return { ok: false, error: json?.detail ? `Explee API ${res.status}: ${json.detail}` : `HTTP ${res.status}` }
    }
    if (!json || typeof json !== 'object') {
      return { ok: false, error: 'Empty or invalid JSON response from Explee' }
    }
    return { ok: true, data: json as ExpleeEnrichEmailResponse }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Network error calling Explee'
    return { ok: false, error: controller.signal.aborted ? `Explee request timed out after ${timeoutMs}ms` : message }
  } finally {
    clearTimeout(timeout)
  }
}

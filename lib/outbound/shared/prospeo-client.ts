// ============================================================
// Prospeo — shared low-level API client
// ============================================================
// The Email Finder and Contact Enrichment "prospeo" providers call the
// enrich-person endpoint; the Decision-Maker Discovery "prospeo" provider
// calls the separate search-person endpoint. Both live here rather than
// duplicated per-module (this repo's usual precedent for small helpers)
// because it's the same vendor/auth/credential-resolution, same rationale
// as discoverCompanyWebsite() being reused across modules. Each provider
// still owns interpreting the response for its own capability.
//
// API docs: https://prospeo.io/api-docs/enrich-person,
// https://prospeo.io/api-docs/search-person
// ============================================================

import type { OutboundCapability } from '@/lib/outbound/settings/types'
import { getActiveCredential } from '@/lib/outbound/settings/provider-selection'

const PROSPEO_ENRICH_PERSON_URL = 'https://api.prospeo.io/enrich-person'
const PROSPEO_SEARCH_PERSON_URL = 'https://api.prospeo.io/search-person'
const DEFAULT_TIMEOUT_MS = 15000

// Credential resolution: outbound_integrations DB row (per-capability) first,
// then a flat PROSPEO_API_KEY env var fallback for local dev without Supabase.
export async function getProspeoApiKey(capability: OutboundCapability): Promise<string | null> {
  const stored = await getActiveCredential(capability)
  if (stored) return stored
  return process.env.PROSPEO_API_KEY || null
}

export interface ProspeoEnrichPersonRequestData {
  first_name?: string
  last_name?: string
  full_name?: string
  linkedin_url?: string
  email?: string
  company_name?: string
  company_website?: string
}

export interface ProspeoEnrichPersonRequest {
  only_verified_email?: boolean
  data: ProspeoEnrichPersonRequestData
}

export interface ProspeoPersonEmail {
  status?: string
  revealed?: boolean
  email?: string
  verification_method?: string
}

export interface ProspeoJobHistoryEntry {
  title?: string
  company_name?: string
  current?: boolean
  departments?: string[]
  seniority?: string
}

export interface ProspeoPerson {
  full_name?: string
  linkedin_url?: string
  current_job_title?: string
  headline?: string
  job_history?: ProspeoJobHistoryEntry[]
  email?: ProspeoPersonEmail
  location?: { country?: string; state?: string; city?: string }
}

export interface ProspeoCompany {
  industry?: string
  employee_range?: string
}

export interface ProspeoEnrichPersonResponse {
  error?: boolean
  error_code?: string
  person?: ProspeoPerson
  company?: ProspeoCompany
}

export type ProspeoCallResult =
  | { ok: true; data: ProspeoEnrichPersonResponse }
  | { ok: false; error: string }

// Never throws — network/timeout/parse failures all resolve to { ok: false }.
//
// Confirmed via a real live call (2026-07-18): Prospeo returns a non-2xx
// HTTP status even for "soft" business-logic outcomes like NO_MATCH, with
// the actual { error, error_code } detail in the JSON body — so an HTTP
// status alone is NOT a reliable signal of a real failure. `ok: false` is
// reserved for genuine transport/parse failures (no JSON body at all);
// whenever a JSON body comes back, it's handed to the caller as `ok: true`
// so each provider's own error_code handling (NO_MATCH vs. everything
// else) decides what it means, regardless of the HTTP status that shipped it.
export async function callProspeoEnrichPerson(
  apiKey: string,
  body: ProspeoEnrichPersonRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ProspeoCallResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(PROSPEO_ENRICH_PERSON_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-KEY': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const json = await res.json().catch(() => null)

    if (!json || typeof json !== 'object') {
      return {
        ok: false,
        error: !res.ok ? `HTTP ${res.status}` : 'Empty or invalid JSON response from Prospeo',
      }
    }

    return { ok: true, data: json as ProspeoEnrichPersonResponse }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Network error calling Prospeo'
    return { ok: false, error: controller.signal.aborted ? `Prospeo request timed out after ${timeoutMs}ms` : message }
  } finally {
    clearTimeout(timeout)
  }
}

// ── Search Person (POST /search-person) ─────────────────────────────────
// Given company + job-title filters, returns candidate people (name, title,
// seniority, department, LinkedIn URL) — no email/mobile (those require a
// follow-up enrich-person call keyed on the returned linkedin_url, not done
// here). 1 credit is spent only for a search that returns at least one result.

export interface ProspeoSearchPersonFilters {
  company?: {
    websites?: { include: string[] }
    names?: { include: string[] }
  }
  person_job_title?: { include: string[] }
}

export interface ProspeoSearchPersonRequest {
  page?: number
  filters: ProspeoSearchPersonFilters
}

export interface ProspeoSearchPersonResult {
  person?: ProspeoPerson
  company?: ProspeoCompany
}

export interface ProspeoSearchPersonResponse {
  error?: boolean
  error_code?: string
  results?: ProspeoSearchPersonResult[]
  pagination?: { current_page: number; per_page: number; total_page: number; total_count: number }
}

export type ProspeoSearchCallResult =
  | { ok: true; data: ProspeoSearchPersonResponse }
  | { ok: false; error: string }

// Same never-throws / "ok:true whenever JSON came back" contract as
// callProspeoEnrichPerson — see that function's comment for why.
export async function callProspeoSearchPerson(
  apiKey: string,
  body: ProspeoSearchPersonRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ProspeoSearchCallResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(PROSPEO_SEARCH_PERSON_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-KEY': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const json = await res.json().catch(() => null)

    if (!json || typeof json !== 'object') {
      return {
        ok: false,
        error: !res.ok ? `HTTP ${res.status}` : 'Empty or invalid JSON response from Prospeo',
      }
    }

    return { ok: true, data: json as ProspeoSearchPersonResponse }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Network error calling Prospeo'
    return { ok: false, error: controller.signal.aborted ? `Prospeo request timed out after ${timeoutMs}ms` : message }
  } finally {
    clearTimeout(timeout)
  }
}

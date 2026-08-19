// ============================================================
// Company Registry — shared identity resolution + lifecycle helpers
// ============================================================
// The one shared identity-key module used by every entry point that can
// surface a company (automatic discovery, Excel/CSV upload, outreach
// send) — a genuinely new cross-cutting invariant (one row per real-world
// company across the whole app), so centralizing it here is correct even
// though this codebase's usual convention is to duplicate small per-file
// normalizers (website-discovery.ts/competitor-discovery.ts/icp-
// generator.ts/company-discovery.ts/company-dedup.ts each keep their own
// copy of normalizeName-shaped logic — this module intentionally breaks
// that pattern because a shared `company_registry` table needs exactly
// one consistent identity resolution, not four that could drift apart).
//
// Identity is resolved in confidence order: canonical domain (strongest)
// -> normalized LinkedIn company URL -> normalized company name (weakest,
// only used when nothing stronger is available). This is what makes
// "ABC Industries" / "ABC Industries Ltd" / "abcindustries.com" /
// "https://www.abcindustries.com/" resolve to one row.
//
// linkedin_url is NEVER fetched or scraped here — it is only normalized
// from a URL string that already appeared in a public search-result
// snippet or an uploaded spreadsheet row, same "observed, not automated"
// treatment outbound_contacts.linkedin_url already gets elsewhere in this
// codebase. LinkedIn scraping/automation stays excluded per CLAUDE.md.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TargetSector } from '../sector-playbook/types'

export type CompanyLifecycleStatus = 'discovered' | 'qualified' | 'disqualified' | 'researched' | 'outreached'

export type RejectionReason =
  | 'duplicate'
  | 'already_researched'
  | 'already_outreached'
  | 'wrong_sector'
  | 'outside_size_range'
  | 'insufficient_evidence'
  | 'poor_icp_fit'
  | 'inactive_company'
  | 'other'

export interface CompanyRegistryRow {
  id: string
  canonical_domain: string | null
  normalized_name: string
  display_name: string
  linkedin_url: string | null
  linkedin_url_normalized: string | null
  sector: TargetSector | null
  country: string | null
  status: CompanyLifecycleStatus
  rejection_reason: RejectionReason | null
  size_evidence: unknown
  discovery_source: string | null
  discovery_query: string | null
  source_run_id: string | null
  outreach_campaign_id: string | null
  discovered_at: string
  qualified_at: string | null
  researched_at: string | null
  outreached_at: string | null
  updated_at: string
}

// ── Normalization ────────────────────────────────────────────────

const LEGAL_SUFFIXES = /\b(?:pvt\.?|private|ltd\.?|limited|inc\.?|incorporated|llc|corp\.?|corporation|co\.?)\b/gi

export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase()
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '')
  s = s.split('/')[0].split('?')[0].split('#')[0]
  return s
}

// Unicode-aware (\p{L}/\p{N}, not ASCII-only \w) — same fix already
// proven across 6 other files in this codebase (see CLAUDE.md's
// 2026-07-24/2026-08-17 history) for accented company names.
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Only ever normalizes an already-observed URL string — never fetches it.
// Returns null for anything that isn't a linkedin.com/company/<slug> shape
// (personal profile URLs, malformed input) rather than a bad identity key.
export function normalizeLinkedInUrl(input: string | null | undefined): string | null {
  if (!input) return null
  let s = input.trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '')
  s = s.split('?')[0].split('#')[0].replace(/\/+$/, '')
  const prefix = 'linkedin.com/company/'
  if (!s.startsWith(prefix)) return null
  const slug = s.slice(prefix.length).split('/')[0]
  if (!slug) return null
  return `${prefix}${slug}`
}

export interface IdentityInput {
  domain?: string | null
  name: string
  linkedinUrl?: string | null
}

export interface IdentityKeys {
  domain: string | null
  normalizedName: string
  linkedinNormalized: string | null
}

export function buildIdentityKeys(input: IdentityInput): IdentityKeys {
  return {
    domain: input.domain ? normalizeDomain(input.domain) : null,
    normalizedName: normalizeCompanyName(input.name),
    linkedinNormalized: normalizeLinkedInUrl(input.linkedinUrl ?? null),
  }
}

// ── Read ────────────────────────────────────────────────────────

// Looks up by domain, then LinkedIn URL, then normalized name, in that
// confidence order — returns the first match, or null if genuinely new.
// The name-only fallback intentionally does NOT restrict to
// domain-IS-NULL rows: a candidate arriving without a resolved domain yet
// (the common case pre-discoverCompanyWebsite()) must still be caught as
// a duplicate against an already-domain-resolved company of the same
// name — a false negative here (missing a real duplicate) is worse than
// the small risk of a coincidental name collision at this identity stage.
export async function findExistingCompany(
  supabase: SupabaseClient,
  keys: IdentityKeys,
): Promise<CompanyRegistryRow | null> {
  if (keys.domain) {
    const { data } = await supabase
      .from('company_registry')
      .select('*')
      .eq('canonical_domain', keys.domain)
      .maybeSingle()
    if (data) return data as CompanyRegistryRow
  }
  if (keys.linkedinNormalized) {
    const { data } = await supabase
      .from('company_registry')
      .select('*')
      .eq('linkedin_url_normalized', keys.linkedinNormalized)
      .maybeSingle()
    if (data) return data as CompanyRegistryRow
  }
  if (keys.normalizedName) {
    const { data } = await supabase
      .from('company_registry')
      .select('*')
      .eq('normalized_name', keys.normalizedName)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) return data as CompanyRegistryRow
  }
  return null
}

// ── Write ───────────────────────────────────────────────────────

export interface UpsertDiscoveredInput extends IdentityInput {
  sector?: TargetSector | null
  country?: string | null
  discoverySource?: string | null
  discoveryQuery?: string | null
}

// Insert-or-fill-gaps — never downgrades an existing row's already-known
// fields/status. Used by every discovery/upload entry point as the single
// write path that creates or touches a company_registry row.
export async function upsertDiscovered(
  supabase: SupabaseClient,
  input: UpsertDiscoveredInput,
): Promise<CompanyRegistryRow> {
  const keys = buildIdentityKeys(input)
  const existing = await findExistingCompany(supabase, keys)

  if (existing) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (!existing.canonical_domain && keys.domain) patch.canonical_domain = keys.domain
    if (!existing.linkedin_url_normalized && keys.linkedinNormalized) {
      patch.linkedin_url = input.linkedinUrl
      patch.linkedin_url_normalized = keys.linkedinNormalized
    }
    if (!existing.sector && input.sector) patch.sector = input.sector
    if (!existing.country && input.country) patch.country = input.country
    if (!existing.discovery_source && input.discoverySource) patch.discovery_source = input.discoverySource
    if (!existing.discovery_query && input.discoveryQuery) patch.discovery_query = input.discoveryQuery

    const { data } = await supabase
      .from('company_registry')
      .update(patch)
      .eq('id', existing.id)
      .select('*')
      .single()
    return (data as CompanyRegistryRow | null) ?? { ...existing, ...patch }
  }

  const { data, error } = await supabase
    .from('company_registry')
    .insert({
      canonical_domain: keys.domain,
      normalized_name: keys.normalizedName,
      display_name: input.name,
      linkedin_url: input.linkedinUrl ?? null,
      linkedin_url_normalized: keys.linkedinNormalized,
      sector: input.sector ?? null,
      country: input.country ?? null,
      discovery_source: input.discoverySource ?? null,
      discovery_query: input.discoveryQuery ?? null,
      status: 'discovered',
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`Failed to insert company_registry row: ${error?.message ?? 'unknown error'}`)
  }
  return data as CompanyRegistryRow
}

function nowIso(): string {
  return new Date().toISOString()
}

export async function markQualified(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase
    .from('company_registry')
    .update({ status: 'qualified', qualified_at: nowIso(), rejection_reason: null, updated_at: nowIso() })
    .eq('id', id)
}

export async function markDisqualified(supabase: SupabaseClient, id: string, reason: RejectionReason): Promise<void> {
  await supabase
    .from('company_registry')
    .update({ status: 'disqualified', rejection_reason: reason, updated_at: nowIso() })
    .eq('id', id)
}

export async function markResearched(supabase: SupabaseClient, id: string, sourceRunId?: string | null): Promise<void> {
  await supabase
    .from('company_registry')
    .update({ status: 'researched', researched_at: nowIso(), source_run_id: sourceRunId ?? null, updated_at: nowIso() })
    .eq('id', id)
}

export async function markOutreached(supabase: SupabaseClient, id: string, campaignId?: string | null): Promise<void> {
  await supabase
    .from('company_registry')
    .update({ status: 'outreached', outreached_at: nowIso(), outreach_campaign_id: campaignId ?? null, updated_at: nowIso() })
    .eq('id', id)
}

// Read-only lookup for callers that only need to know whether a company is
// already known (and at what status) — never writes. Used by the Excel/CSV
// upload path (batch-parse), which shares this identity system per the
// governing plan but doesn't run the full discovery qualification gate
// (sector/size) against a manually-curated uploaded list.
export async function lookupExistingStatus(
  supabase: SupabaseClient,
  items: Array<IdentityInput>,
): Promise<Array<CompanyLifecycleStatus | undefined>> {
  const out: Array<CompanyLifecycleStatus | undefined> = []
  for (const item of items) {
    const keys = buildIdentityKeys(item)
    const existing = await findExistingCompany(supabase, keys)
    out.push(existing?.status)
  }
  return out
}

// Convenience for callers that only have a domain/name pair at research-
// completion time (e.g. a manually-typed URL researched directly in the
// Wizard/Intelligence Lab, never surfaced via discoverCompaniesForSector())
// — resolves or creates the identity, then marks it researched in one
// call. This is what makes "never automatically re-research" actually
// enforceable regardless of entry point: every completed full-pipeline run
// writes this, not just ones that originated from discovery.
export async function markResearchedByIdentity(
  supabase: SupabaseClient,
  input: IdentityInput,
  sourceRunId?: string | null,
): Promise<void> {
  const keys = buildIdentityKeys(input)
  let existing = await findExistingCompany(supabase, keys)
  if (!existing) {
    existing = await upsertDiscovered(supabase, { ...input, discoverySource: 'manual' })
  }
  await markResearched(supabase, existing.id, sourceRunId)
}

// Convenience for callers that only have a domain/name pair at outreach
// time (e.g. a manually-added outbound_contacts row that never went
// through discovery) — resolves or creates the identity, then marks it
// outreached in one call.
export async function markOutreachedByIdentity(
  supabase: SupabaseClient,
  input: IdentityInput,
  campaignId?: string | null,
): Promise<void> {
  const keys = buildIdentityKeys(input)
  let existing = await findExistingCompany(supabase, keys)
  if (!existing) {
    existing = await upsertDiscovered(supabase, { ...input, discoverySource: 'manual' })
  }
  await markOutreached(supabase, existing.id, campaignId)
}

// ============================================================
// Exa Company Discovery Provider
// ============================================================
// Uses Exa's Search API (category: 'company') with `outputSchema` for
// structured synthesis — the cheapest capability that can plausibly solve
// this, per this repo's own discipline (see the Websets note below and
// lib/outbound/decision-maker-discovery/providers/exa.ts, which made the
// same call for people search). Websets (exaCreateWebset/exaListWebsetItems)
// would give more thorough/bulk recall but is async, slower, and its
// per-operation cost is undocumented — not wired in here; add a distinct
// "thorough" mode later if a real gap shows up, not speculatively now.
//
// This is a discovery SOURCE (like explee-client.ts), not an outbound
// capability, so it reads EXA_API_KEY directly via getExaApiKey() — no
// outbound_integrations DB lookup (see exa-client.ts's own header comment
// on that split).
//
// Null-honesty: every field on a returned company is either a real value
// Exa's structured output gave us, or null. Nothing here backfills a
// missing industry/employee-count/revenue with the search query or any
// other guess.
// ============================================================

import { exaSearch, getExaApiKey } from './exa-client'
import type { ExaResultItem } from './exa-client'
import type { CompanyDiscoveryProvider, CompanyDiscoveryRequest, CompanyDiscoveryProviderResult, CompanyDiscoveryCompany } from '../company-discovery-provider-factory'
// Reusing this codebase's established normalizeName()/normalizeDomain()
// pair (CLAUDE.md: Unicode-aware \p{L}/\p{N} normalization, not \w) rather
// than inventing a third copy — same convention already duplicated by
// design across website-discovery.ts/competitor-discovery.ts/icp-
// generator.ts/company-dedup.ts.
import { normalizeName, normalizeDomain } from '../company-discovery'

// The PRIMARY source of company data is now Exa's native `results[].entities`
// (see exa-client.ts's ExaEntity doc comment) — directly extracted, not
// LLM-synthesized, and confirmed live to carry richer headquarters/
// workforce/financials data than outputSchema synthesis for the same
// result. outputSchema is kept ONLY for the handful of fields the native
// entity doesn't carry (industry, funding_stage, linkedin_url — confirmed
// live the entity has no such fields) and merged in by domain/name match.
// Deliberately small (well under Exa's confirmed-live 10-property cap,
// which counts cumulatively across the whole schema tree, not per-object —
// found by testing directly against the API, not assumed from docs).
const OUTPUT_SCHEMA = {
  type: 'object',
  required: ['companies'],
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          domain: { type: 'string' },
          industry: { type: 'string' },
          funding_stage: { type: 'string' },
          linkedin_url: { type: 'string' },
        },
      },
    },
  },
} as const

// Boolean/presence flags Exa's Search API has no structured field for —
// folded into the query text only, never claimed as enforced.
const HINT_ONLY_FLAGS = [
  'is_b2b', 'is_saas', 'is_startup', 'is_tech', 'is_digital', 'is_ai', 'is_merchant',
  'has_public_emails', 'has_company_phone', 'has_linkedin_page', 'has_employees_on_linkedin',
] as const

function describeRange(range: { min?: number; max?: number } | undefined, unit: string): string | null {
  if (!range || (range.min === undefined && range.max === undefined)) return null
  if (range.min !== undefined && range.max !== undefined) return `${range.min}-${range.max} ${unit}`.trim()
  if (range.min !== undefined) return `at least ${range.min} ${unit}`.trim()
  return `at most ${range.max} ${unit}`.trim()
}

function buildQuery(request: CompanyDiscoveryRequest): string {
  const parts: string[] = [request.definition]
  if (request.geo_include?.length) parts.push(`headquartered in ${request.geo_include.join(', ')}`)
  const size = describeRange(request.size, 'employees')
  if (size) parts.push(size)
  const revenue = describeRange(request.revenue_annual, 'in annual revenue (USD)')
  if (revenue) parts.push(revenue)
  const founded = describeRange(request.founded, '')
  if (founded) parts.push(`founded ${founded}`.trim())
  if (request.is_b2b) parts.push('a B2B company')
  if (request.is_saas) parts.push('a SaaS company')
  if (request.is_startup) parts.push('a startup')
  if (request.is_tech) parts.push('a technology company')
  if (request.is_digital) parts.push('digital-first')
  if (request.is_ai) parts.push('an AI company')
  if (request.is_merchant) parts.push('an e-commerce merchant')
  return parts.filter(Boolean).join(', ')
}

// The outputSchema-synthesized backfill record — only the fields the
// native entity doesn't carry.
interface ExaSynthesizedCompany {
  name?: string
  domain?: string
  industry?: string
  funding_stage?: string
  linkedin_url?: string
}

// Native entity.properties shape confirmed live (see exa-client.ts) — an
// open record in the type system, read defensively here.
interface ExaCompanyEntityProperties {
  name?: string
  description?: string
  foundedYear?: number
  workforce?: { total?: number }
  headquarters?: { city?: string; country?: string }
  financials?: { revenueAnnual?: number; fundingTotal?: number; fundingLatestRound?: string | null }
}

function readSynthesized(content: unknown): ExaSynthesizedCompany[] {
  if (!content || typeof content !== 'object') return []
  const companies = (content as Record<string, unknown>).companies
  if (!Array.isArray(companies)) return []
  return companies.filter((c): c is ExaSynthesizedCompany => typeof c === 'object' && c !== null)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function hostnameOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

function normalizeNameKey(name: string | null | undefined): string | null {
  if (!name?.trim()) return null
  return name.trim().toLowerCase()
}

// Builds domain- and name-keyed lookup maps once per response, so merging
// synthesis data into each entity-derived company is O(1) per company
// rather than re-scanning the synthesis array for every result.
function indexSynthesized(records: ExaSynthesizedCompany[]) {
  const byDomain = new Map<string, ExaSynthesizedCompany>()
  const byName = new Map<string, ExaSynthesizedCompany>()
  for (const r of records) {
    const domain = r.domain?.trim().toLowerCase()
    if (domain) byDomain.set(domain, r)
    const nameKey = normalizeNameKey(r.name)
    if (nameKey) byName.set(nameKey, r)
  }
  return { byDomain, byName }
}

function normalizeFromResult(
  result: ExaResultItem,
  entityProps: ExaCompanyEntityProperties,
  synthIndex: ReturnType<typeof indexSynthesized>,
): CompanyDiscoveryCompany {
  const domain = hostnameOf(result.url)
  const nameKey = normalizeNameKey(entityProps.name ?? result.title)
  const synthesized = (domain && synthIndex.byDomain.get(domain)) || (nameKey && synthIndex.byName.get(nameKey)) || null

  return {
    name: str(entityProps.name) ?? str(result.title),
    domain,
    url: str(result.url),
    description: str(entityProps.description),
    // Not in the native entity — only outputSchema synthesis can supply
    // this, and only when it actually did.
    industry: str(synthesized?.industry),
    geo: str(entityProps.headquarters?.country),
    geo_city: str(entityProps.headquarters?.city),
    size: num(entityProps.workforce?.total),
    founded: num(entityProps.foundedYear),
    revenue_annual: num(entityProps.financials?.revenueAnnual),
    // Exa's native financials give fundingTotal (a dollar amount) and
    // fundingLatestRound (a round label like "Series A") separately —
    // fundingLatestRound is the closer match to Explee's funding_stage
    // concept; outputSchema's funding_stage is used only when the entity
    // didn't supply a round label.
    funding_stage: str(entityProps.financials?.fundingLatestRound) ?? str(synthesized?.funding_stage),
    linkedin_id: null,
    linkedin_url: str(synthesized?.linkedin_url),
    provider: 'exa',
    source_urls: [result.url].filter((u): u is string => !!u),
  }
}

function inRange(value: number, range: { min?: number; max?: number }): boolean {
  if (range.min !== undefined && value < range.min) return false
  if (range.max !== undefined && value > range.max) return false
  return true
}

// Exa's native headquarters.country comes back as a full display name
// ("India"), not an ISO 3166-1 alpha-2 code like Explee's geo_include
// filter/geo field expects ("IN") — confirmed live: comparing the two
// directly silently dropped every real match (a real recall bug, same
// class of geo mismatch CLAUDE.md already flags for Explee's own
// geo_include history — see explee-client.ts). Intl.DisplayNames resolves
// the small requested code list to names natively, no hardcoded
// ISO-country table needed.
const REGION_DISPLAY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' })

function isoToCountryName(code: string): string | null {
  try {
    const name = REGION_DISPLAY_NAMES.of(code.toUpperCase())
    return name && name.toUpperCase() !== code.toUpperCase() ? name : null
  } catch {
    return null
  }
}

// ============================================================
// Conservative, deterministic post-processing (benchmarks/exa/REPORT.md
// sections 1-3) — Exa-only, not applied to Explee's adapter (its own
// failure modes are different — wrong-domain/wrong-category, not
// generic-name — and weren't established against this same logic).
//
// Explicit non-goal: no relevance threshold, no score, no blacklist. Every
// check here is either (a) a true, deterministic duplicate — safe to drop
// — or (b) an annotation that leaves the result in `companies[]`
// untouched. "If a check cannot confidently establish something, preserve
// the result" — the exact discipline the Explee min_relevance mistake
// violated.
// ============================================================

const PLATFORM_HOSTS = ['linkedin.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com']

function isPlatformHost(domain: string | null): boolean {
  if (!domain) return false
  return PLATFORM_HOSTS.some(host => domain === host || domain.endsWith(`.${host}`))
}

function significantWords(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean)
}

// A name is flagged (never dropped) only when it's ≤2 significant words AND
// every one of those words also appears in the query's own `definition`
// text — e.g. a company literally named "e-Commerce" for an "e-commerce
// companies" search. Deliberately narrow: a 3+ word generic-sounding name,
// or a short name whose words aren't echoed in the definition, is left
// unflagged rather than guessed at.
function isGenericName(name: string, definition: string): boolean {
  const nameWords = significantWords(normalizeName(name))
  if (nameWords.length === 0 || nameWords.length > 2) return false
  const definitionWords = new Set(significantWords(normalizeName(definition)))
  return nameWords.every(w => definitionWords.has(w))
}

// Exact-domain dedup (keep first) + exact-normalized-name dedup (keep
// first) + generic-name/no-own-domain annotation, run once over the
// entity-derived list before any structured post-filtering. Both dedup
// checks are true duplicates by this codebase's own established name/
// domain-normalization convention, so dropping is safe; the two flag
// checks never remove anything.
function applyDataQualityChecks(companies: CompanyDiscoveryCompany[], definition: string): CompanyDiscoveryCompany[] {
  const seenDomains = new Set<string>()
  const seenNames = new Set<string>()
  const out: CompanyDiscoveryCompany[] = []

  for (const c of companies) {
    const domainKey = c.domain ? normalizeDomain(c.domain) : null
    const nameKey = c.name ? normalizeName(c.name) : null

    if (domainKey && seenDomains.has(domainKey)) continue
    if (nameKey && seenNames.has(nameKey)) continue
    if (domainKey) seenDomains.add(domainKey)
    if (nameKey) seenNames.add(nameKey)

    const flags: string[] = []
    if (c.name && isGenericName(c.name, definition)) flags.push('generic_name')
    if (isPlatformHost(c.domain)) flags.push('no_own_domain')

    out.push(flags.length ? { ...c, dataQualityFlags: flags } : c)
  }

  return out
}

export const ExaCompanyDiscoveryProvider: CompanyDiscoveryProvider = {
  name: 'exa',
  displayName: 'Exa',

  async isAvailable(): Promise<boolean> {
    return !!getExaApiKey()
  },

  async discoverCompanies(request: CompanyDiscoveryRequest): Promise<CompanyDiscoveryProviderResult> {
    const page = request.page ?? 1
    const pageSize = request.pageSize ?? 20

    // Exa's Search API has no page/offset param — the whole result set is
    // re-fetched wider on each page request and sliced locally. Fine at
    // this app's call volume (one human-triggered search at a time); a true
    // cursor would need Websets.
    const numResults = Math.min(pageSize * page, 100)

    const response = await exaSearch({
      query: buildQuery(request),
      category: 'company',
      numResults,
      outputSchema: OUTPUT_SCHEMA,
    })

    const synthIndex = indexSynthesized(readSynthesized(response.output?.content))

    // One company per result that actually carries a company-typed entity —
    // a result with no entity (native extraction found nothing structured)
    // is dropped rather than falling back to a bare title/url guess.
    let companies = (response.results ?? [])
      .map((result) => {
        const entity = result.entities?.find((e) => e.type === 'company')
        if (!entity) return null
        return normalizeFromResult(result, entity.properties as ExaCompanyEntityProperties, synthIndex)
      })
      .filter((c): c is CompanyDiscoveryCompany => c !== null && !!c.name)

    companies = applyDataQualityChecks(companies, request.definition)

    const enforcedFilters: string[] = []
    const hintedFilters: string[] = ['definition']

    // Post-filter on whatever structured fields Exa actually returned —
    // never claimed as enforced for a company where the field came back
    // null (that company just wasn't excluded, not confirmed in-range).
    if (request.size) {
      companies = companies.filter(c => c.size === null || inRange(c.size, request.size!))
      enforcedFilters.push('size')
    }
    if (request.revenue_annual) {
      companies = companies.filter(c => c.revenue_annual === null || inRange(c.revenue_annual, request.revenue_annual!))
      enforcedFilters.push('revenue_annual')
    }
    if (request.founded) {
      companies = companies.filter(c => c.founded === null || inRange(c.founded, request.founded!))
      enforcedFilters.push('founded')
    }
    if (request.geo_include?.length) {
      const wantedNames = new Set(
        request.geo_include.flatMap(code => {
          const name = isoToCountryName(code)
          return [code.toLowerCase(), ...(name ? [name.toLowerCase()] : [])]
        })
      )
      companies = companies.filter(c => c.geo === null || wantedNames.has((c.geo as string).toLowerCase()))
      enforcedFilters.push('geo_include')
    }

    for (const flag of HINT_ONLY_FLAGS) {
      if (request[flag]) hintedFilters.push(flag)
    }

    const start = (page - 1) * pageSize
    const paged = companies.slice(start, start + pageSize)

    return {
      companies: paged,
      meta: { total: companies.length, results_count: paged.length },
      enforcedFilters,
      hintedFilters,
    }
  },
}

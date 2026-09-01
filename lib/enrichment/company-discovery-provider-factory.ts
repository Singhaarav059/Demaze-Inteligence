// ============================================================
// Company Discovery — Provider Factory
// ============================================================
// Company Discovery had no provider abstraction until now — Explee was
// called directly from app/api/admin/explee-discovery/route.ts. This adds a
// second, switchable source (Exa) without touching Explee's own client or
// changing the UI. Selection is a flat env var (COMPANY_DISCOVERY_PROVIDER,
// default 'explee') — this is a discovery SOURCE like explee-client.ts/
// exa-client.ts, not an outbound capability, so it deliberately does NOT
// route through outbound_integrations/provider-selection.ts the way
// lib/outbound/decision-maker-discovery/provider-factory.ts does (that file
// is the shape this mirrors, not the storage mechanism).
//
// CompanyDiscoveryRequest reuses ExpleeCompanyFilters verbatim (plus
// page/pageSize) rather than inventing a parallel field set — Explee's
// filter schema already covers everything the UI exposes. Exa can't
// enforce every one of those as a hard constraint (no numeric-range or
// boolean-flag filter in Exa's Search API) — CompanyDiscoveryProviderResult
// is explicit about which requested filters were actually enforced
// (structurally applied/post-filtered) vs merely hinted at in the
// natural-language query, so callers never mistake "asked for" for
// "guaranteed".
//
// CompanyDiscoveryCompany extends ExpleeCompany (not a parallel type) so
// Explee's provider is a pure passthrough and every existing ExpleeCompany
// field (including its `[key: string]: unknown` index signature) survives
// unchanged; Exa's extra fields (linkedin_url, provider, source_urls) ride
// on top as optional additions, never forcing Explee results to populate
// something Explee doesn't return.
// ============================================================

import {
  searchExpleeCompanies,
  getExpleeApiKey,
  type ExpleeCompany,
  type ExpleeCompanyFilters,
} from './sources/explee-client'
import { ExaCompanyDiscoveryProvider } from './sources/exa-company-discovery'

export interface CompanyDiscoveryRequest extends ExpleeCompanyFilters {
  page?: number
  pageSize?: number
}

export interface CompanyDiscoveryCompany extends ExpleeCompany {
  // Set by every provider so the UI can show/attribute which source found a
  // given row once it chooses to (no UI change made by this pass).
  provider?: 'explee' | 'exa'
  // Exa gives a direct profile URL, not Explee's numeric linkedin_id — kept
  // as a separate optional field rather than overloading linkedin_id with a
  // different type.
  linkedin_url?: string | null
  // Present when a provider can attach real supporting source URLs beyond
  // the single canonical company `url` field (Exa's underlying search
  // results). Optional — Explee's passthrough leaves this unset.
  source_urls?: string[]
  // Set only by ExaCompanyDiscoveryProvider's conservative, deterministic
  // post-processing (benchmarks/exa/REPORT.md sections 1-3) — annotation
  // only, never a reason to drop a result. Explee's adapter never sets this
  // (its benchmark failure modes — wrong domain, wrong category — are
  // different and weren't addressed here). Known values: 'generic_name'
  // (≤2-word name made entirely of generic terms echoed in the query's own
  // definition, e.g. "e-Commerce" for an "e-commerce companies" search),
  // 'no_own_domain' (the only URL found is a platform host like linkedin.com,
  // not the company's own site).
  dataQualityFlags?: string[]
}

export interface CompanyDiscoveryMeta {
  total: number
  results_count: number
  // Explee-specific billing concept — optional here since Exa has no
  // equivalent credit balance to report; never fabricated as 0 to look
  // like a real remaining-balance figure.
  credits_charged?: number
  remaining_balance?: number
}

export interface CompanyDiscoveryProviderResult {
  companies: CompanyDiscoveryCompany[]
  meta: CompanyDiscoveryMeta
  // Request keys that were actually applied as hard constraints.
  enforcedFilters: string[]
  // Request keys folded into free-text/natural-language only — requested,
  // not guaranteed applied.
  hintedFilters: string[]
}

export interface CompanyDiscoveryProvider {
  name: string
  displayName: string
  discoverCompanies(request: CompanyDiscoveryRequest): Promise<CompanyDiscoveryProviderResult>
  isAvailable(): Promise<boolean>
}

// Adapter only — searchExpleeCompanies()'s own internals are untouched.
// Explee enforces every filter it's given server-side, so every defined
// filter key is "enforced", none merely "hinted".
export const ExpleeCompanyDiscoveryProvider: CompanyDiscoveryProvider = {
  name: 'explee',
  displayName: 'Explee',

  async isAvailable(): Promise<boolean> {
    return !!getExpleeApiKey()
  },

  async discoverCompanies(request: CompanyDiscoveryRequest): Promise<CompanyDiscoveryProviderResult> {
    const { page = 1, pageSize = 20, ...filters } = request
    const result = await searchExpleeCompanies(filters, pageSize, page)
    const enforcedFilters = Object.entries(filters)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k)

    return {
      companies: result.companies.map(c => ({ ...c, provider: 'explee' as const })),
      meta: result.meta,
      enforcedFilters,
      hintedFilters: [],
    }
  },
}

const PROVIDERS: Record<string, CompanyDiscoveryProvider> = {
  explee: ExpleeCompanyDiscoveryProvider,
  exa: ExaCompanyDiscoveryProvider,
}

function resolveProvider(): CompanyDiscoveryProvider {
  // Default flipped 'explee' -> 'exa' 2026-09-01 per benchmarks/exa/REPORT.md
  // (explicit, authorized production default change — see .env.example's
  // COMPANY_DISCOVERY_PROVIDER comment for the evidence summary). Explee
  // remains fully selectable via COMPANY_DISCOVERY_PROVIDER=explee.
  const name = process.env.COMPANY_DISCOVERY_PROVIDER || 'exa'
  return PROVIDERS[name] ?? ExpleeCompanyDiscoveryProvider
}

export async function discoverCompanies(
  request: CompanyDiscoveryRequest
): Promise<CompanyDiscoveryProviderResult & { providerUsed: string }> {
  const provider = resolveProvider()
  if (!(await provider.isAvailable())) {
    throw new Error(`${provider.displayName} is not available (no API key configured).`)
  }
  const result = await provider.discoverCompanies(request)
  return { ...result, providerUsed: provider.name }
}

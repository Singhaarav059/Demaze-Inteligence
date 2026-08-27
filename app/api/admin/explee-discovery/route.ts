// ============================================================
// Admin: Company Discovery search — POST /api/admin/explee-discovery
// ============================================================
// Thin wrapper around searchExpleeCompanies() (Explee is the sole
// company-discovery data source, kept invisible to the UI/response shape
// beyond this file) plus an "already researched" annotation against
// pipeline_test_runs, reusing normalizeDomain()/normalizeName() from
// company-discovery.ts — this ANNOTATES (alreadyResearched/lastResearchedAt)
// rather than silently dropping, so the results UI can show real status per
// company (see CompanyMatchList.tsx).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { searchExpleeCompanies, ExpleeApiError, getExpleeApiKey, type ExpleeCompany } from '@/lib/enrichment/sources/explee-client'
import { normalizeDomain, normalizeName } from '@/lib/enrichment/company-discovery'
import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

function num(v: unknown): number | undefined {
  return Number.isFinite(v) ? Number(v) : undefined
}
function range(min: unknown, max: unknown): { min?: number; max?: number } | undefined {
  const r = { min: num(min), max: num(max) }
  return r.min !== undefined || r.max !== undefined ? r : undefined
}
function bool(v: unknown): boolean | undefined {
  return v === true ? true : undefined
}

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  if (!getExpleeApiKey()) {
    return NextResponse.json({ success: false, error: 'EXPLEE_API_KEY is not set' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const definition = typeof body?.definition === 'string' ? body.definition.trim() : ''
  if (!definition) {
    return NextResponse.json({ success: false, error: 'definition is required' }, { status: 400 })
  }

  const geoInclude = Array.isArray(body?.geoInclude)
    ? body.geoInclude.filter((s: unknown) => typeof s === 'string' && s.trim())
    : undefined
  const page = Number.isFinite(body?.page) ? Math.max(Number(body.page), 1) : 1
  const pageSize = Number.isFinite(body?.pageSize) ? Math.min(Math.max(Number(body.pageSize), 1), 100) : 20

  try {
    const result = await searchExpleeCompanies(
      {
        definition,
        geo_include: geoInclude && geoInclude.length > 0 ? geoInclude : undefined,
        size: range(body?.sizeMin, body?.sizeMax),
        revenue_annual: range(body?.revenueMin, body?.revenueMax),
        founded: range(body?.foundedMin, body?.foundedMax),
        is_b2b: bool(body?.isB2b),
        is_saas: bool(body?.isSaas),
        is_startup: bool(body?.isStartup),
        is_tech: bool(body?.isTech),
        is_digital: bool(body?.isDigital),
        is_ai: bool(body?.isAi),
        is_merchant: bool(body?.isMerchant),
        has_public_emails: bool(body?.hasPublicEmails),
        has_company_phone: bool(body?.hasCompanyPhone),
        has_linkedin_page: bool(body?.hasLinkedinPage),
        has_employees_on_linkedin: bool(body?.hasEmployeesOnLinkedin),
      },
      pageSize,
      page,
    )

    const companies = await annotateAlreadyResearched(result.companies)
    return NextResponse.json({ success: true, ...result, companies })
  } catch (e) {
    const message = e instanceof ExpleeApiError ? e.message : (e instanceof Error ? e.message : 'Explee search failed')
    return NextResponse.json({ success: false, error: message }, { status: 502 })
  }
}

interface HistoryEntry {
  at: string
  // True when the matched row is this page's own operation
  // ('company_signals_research') — see company-research/route.ts's GET
  // handler, which can only render that exact shape back. A company
  // previously researched via the separate deep pipeline (Auto Flow/
  // Wizard/Research) still correctly counts as "already researched" here,
  // it just has no on-demand result to fetch through this page.
  hasStoredResult: boolean
  // Pulled straight out of the stored analysis's own computed fields
  // (opportunity-engine.ts's per-opportunity evidence/fit model,
  // normalize.ts) via a JSON-path select — never re-derived here, and
  // never present for scraper_only/company_signals_research rows (their
  // final_result has no such shape, so these come back null). No UI reads
  // these yet; they ride along on the existing cross-reference so ranking
  // "already researched" results by opportunity strength is possible
  // without a second discovery-side scoring system.
  opportunityOutcomeLabel: string | null
  topOpportunityEvidenceStrength: string | null
  topOpportunityConfidenceLabel: string | null
}

// Non-fatal on DB error — an unannotated result is far cheaper than the
// whole search failing.
async function annotateAlreadyResearched(companies: ExpleeCompany[]): Promise<ExpleeCompany[]> {
  if (companies.length === 0) return companies
  try {
    const supabase = createServerClient()
    // JSON-path select (PostgREST `column->path->>key`) pulls only the
    // small scalar fields we need, not the full final_result blob — avoids
    // loading every historical run's entire analysis JSON just to annotate
    // a discovery list.
    const { data: history } = await supabase
      .from('pipeline_test_runs')
      .select('company_url, domain, created_at, operation, opportunity_outcome_label:final_result->>opportunity_outcome_label, top_evidence_strength:final_result->opportunities->0->>evidence_strength, top_confidence_label:final_result->opportunities->0->>opportunity_confidence_label')
      .order('created_at', { ascending: false })

    const byDomain = new Map<string, HistoryEntry>()
    const byName = new Map<string, HistoryEntry>()
    for (const h of (history ?? []) as unknown as Array<Record<string, unknown>>) {
      const entry: HistoryEntry = {
        at: h.created_at as string,
        hasStoredResult: h.operation === 'company_signals_research',
        opportunityOutcomeLabel: (h.opportunity_outcome_label as string) ?? null,
        topOpportunityEvidenceStrength: (h.top_evidence_strength as string) ?? null,
        topOpportunityConfidenceLabel: (h.top_confidence_label as string) ?? null,
      }
      const domain = h.domain as string | null
      const companyUrl = h.company_url as string | null
      if (domain && !byDomain.has(normalizeDomain(domain))) byDomain.set(normalizeDomain(domain), entry)
      if (companyUrl) {
        const looksLikeDomainOrUrl = /^https?:\/\//i.test(companyUrl) || companyUrl.includes('.')
        if (looksLikeDomainOrUrl) {
          const key = normalizeDomain(companyUrl)
          if (!byDomain.has(key)) byDomain.set(key, entry)
        } else {
          const key = normalizeName(companyUrl)
          if (key && !byName.has(key)) byName.set(key, entry)
        }
      }
    }

    return companies.map(c => {
      const entry = (c.domain && byDomain.get(normalizeDomain(c.domain))) || (c.name && byName.get(normalizeName(c.name))) || null
      return {
        ...c,
        alreadyResearched: !!entry,
        lastResearchedAt: entry?.at ?? null,
        hasStoredResult: entry?.hasStoredResult ?? false,
        opportunityOutcomeLabel: entry?.opportunityOutcomeLabel ?? null,
        topOpportunityEvidenceStrength: entry?.topOpportunityEvidenceStrength ?? null,
        topOpportunityConfidenceLabel: entry?.topOpportunityConfidenceLabel ?? null,
      }
    })
  } catch (e) {
    logger.warn('ExpleeDiscovery', 'already-researched annotation skipped', e instanceof Error ? e.message : String(e))
    return companies
  }
}

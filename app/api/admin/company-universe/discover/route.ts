// ============================================================
// Admin: Company Universe — POST /api/admin/company-universe/discover
// ============================================================
// Structured-sources-first company discovery (Section 14) — queries
// company_universe first, then live provider search() only for whatever
// gap remains (see lib/company-universe/discovery.ts). Distinct from, and
// does NOT replace, POST /api/admin/company-discovery (the existing
// search-grounded discoverCompanies()) — Section 15's "search enrichment,
// not the only path" means both are meant to coexist; a caller wanting the
// full Section 14 pipeline calls this route first and falls back to the
// existing route for any remaining gap, rather than either route trying to
// orchestrate the other internally (keeps each route's failure mode
// independent — a company_universe outage must not take down the existing,
// already-working search-based discovery route).
//
// Structured query only (country/countryCode/industry/sicCodes/naicsCodes/
// employeeCount range/status) — deliberately does NOT accept a free-text
// ICP segment string the way the existing route does. Mapping a free-text
// segment ("mid-size automotive component manufacturers in South Asia")
// into structured filters would need either an LLM call or new heuristics
// this session did not build (Section 31: "no user-facing UI yet," and
// guessing at that mapping without verifying it against real data would be
// exactly the kind of "implement around assumptions" Section 29 warns
// against) — left for a future session once this structured layer has real
// ingested data to test the mapping against.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { discoverCompaniesStructuredFirst } from '@/lib/company-universe/discovery'
import type { CompanySearchQuery, CompanyStatus } from '@/lib/company-universe/types'

const VALID_STATUSES: CompanyStatus[] = ['active', 'inactive', 'dissolved', 'unknown']

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ success: false, error: 'Request body must be a JSON object' }, { status: 400 })
  }

  const query: CompanySearchQuery = {
    name: typeof body.name === 'string' ? body.name.trim() || undefined : undefined,
    country: typeof body.country === 'string' ? body.country.trim() || undefined : undefined,
    countryCode: typeof body.countryCode === 'string' ? body.countryCode.trim() || undefined : undefined,
    industry: typeof body.industry === 'string' ? body.industry.trim() || undefined : undefined,
    sicCodes: Array.isArray(body.sicCodes) ? body.sicCodes.filter((s: unknown) => typeof s === 'string') : undefined,
    naicsCodes: Array.isArray(body.naicsCodes) ? body.naicsCodes.filter((s: unknown) => typeof s === 'string') : undefined,
    employeeCountMin: typeof body.employeeCountMin === 'number' ? body.employeeCountMin : undefined,
    employeeCountMax: typeof body.employeeCountMax === 'number' ? body.employeeCountMax : undefined,
    status: VALID_STATUSES.includes(body.status) ? body.status as CompanyStatus : undefined,
    limit: typeof body.limit === 'number' && body.limit > 0 && body.limit <= 100 ? body.limit : undefined,
  }

  if (!query.name && !query.countryCode && !query.industry && !query.sicCodes?.length && !query.naicsCodes?.length) {
    return NextResponse.json({ success: false, error: 'At least one of name, countryCode, industry, sicCodes, or naicsCodes is required — an unconstrained query would hit every provider with no real filter' }, { status: 400 })
  }

  const sizeRange = {
    employeeCountMax: typeof body.employeeCountMax === 'number' ? body.employeeCountMax : undefined,
    revenueMaxUsd: typeof body.revenueMaxUsd === 'number' ? body.revenueMaxUsd : undefined,
  }

  try {
    const supabase = createServerClient()
    const result = await discoverCompaniesStructuredFirst(supabase, query, sizeRange)
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Structured discovery failed' }, { status: 500 })
  }
}

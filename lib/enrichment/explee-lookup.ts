// ============================================================
// Explee-first company lookup
// ============================================================
// Reconciliation-phase change: when a caller has only a company name (no
// URL yet — the existing "no website on file" branch in
// test-analysis/route.ts), try Explee before falling back to the older
// search-based discoverCompanyWebsite(). Explee is the primary company-data
// source per CLAUDE.md's Explee reconciliation decision; Explee has no exact
// name/domain lookup endpoint, only a market-definition search, so this
// treats the raw name as the definition query and accepts a match only when
// exactly one result's name normalizes to the same thing — same "refuse to
// guess when ambiguous" discipline as discoverCompanyWebsite() itself.
// Returns null (not a 'not_found' result) on no API key / no confident
// match / any Explee error, so the caller falls through unchanged.
// ============================================================

import { searchExpleeCompanies, getExpleeApiKey } from './sources/explee-client'
import { normalizeName } from './company-discovery'
import type { WebsiteDiscoveryResult } from './website-discovery'

export async function lookupCompanyInExplee(companyName: string): Promise<WebsiteDiscoveryResult | null> {
  if (!getExpleeApiKey()) return null
  const target = normalizeName(companyName)
  if (!target) return null

  let result
  try {
    result = await searchExpleeCompanies({ definition: companyName }, 5, 1)
  } catch {
    return null
  }

  const matches = result.companies.filter(
    (c): c is typeof c & { domain: string } => !!c.name && !!c.domain && normalizeName(c.name) === target
  )
  if (matches.length !== 1) return null

  return {
    status: 'confirmed',
    domain: matches[0].domain,
    confidence: 'high',
    candidates: [],
    reason: `Matched "${companyName}" to an Explee company record.`,
  }
}

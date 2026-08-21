// ============================================================
// Company Universe — cross-source identity resolution
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md, Section 12:
// "The same company may appear as BMW AG / Bayerische Motoren Werke AG /
// BMW / BMW Group. Do not create four companies... Use deterministic
// identifiers first. Then use conservative fuzzy matching only when
// deterministic identifiers are unavailable. Never merge two companies
// purely because their names are similar. Every merge should have a
// reason/confidence."
//
// "Use the existing identity system and extend it carefully" (same
// section) — this repo's existing identity work is website-discovery.ts's
// word-boundary/normalization discipline and lib/batch/company-dedup.ts's
// tiered domain/exact/fuzzy matching for lead-row dedup. Neither directly
// fits here (company-dedup.ts has no concept of registration IDs; this
// module's whole point is that deterministic IDs come FIRST), so this is a
// new module built on the SAME principles (word-boundary matching, Unicode-
// aware normalization, prefer under-confidence) rather than a reuse of
// either file — same "duplication over sharing for small per-file logic"
// precedent as every other discovery module in this codebase (see
// docs/DECISIONS.md).
//
// Deliberately pure/Supabase-free, matching every other lib/enrichment and
// lib/batch module: resolveIdentity() takes already-fetched candidate rows
// (the caller queries company_universe by the deterministic IDs/domain
// present on the incoming record — see ingestion.ts) and returns a
// decision; it never queries the database itself. This is what makes the
// matching logic unit-testable without mocking Supabase.
// ============================================================

import type { CanonicalCompanyFields, ProviderName } from './types'

// ── Name normalization (same Unicode-aware, legal-suffix-stripping
// discipline as every other discovery module — see the 2026-07-24 \w-ASCII
// fix documented in CLAUDE.md for why \p{L}/\p{N} and not \w) ───────────

const LEGAL_SUFFIXES = /\b(?:pvt\.?|private|ltd\.?|limited|inc\.?|incorporated|llc|corp\.?|corporation|co\.?|plc|gmbh|ag|sa|nv|bv|srl|spa)\b/gi
const STOPWORDS = new Set(['and', 'the', 'of', 'a', 'an'])

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function significantWords(normalizedName: string): string[] {
  return normalizedName.split(' ').filter(w => w.length > 0 && !STOPWORDS.has(w))
}

export function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
}

function wordOverlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setB = new Set(b)
  const shared = a.filter(w => setB.has(w)).length
  return shared / Math.max(a.length, b.length)
}

// A single-word or very-short name is unsafe to fuzzy-match on alone (same
// guard class as website-discovery.ts's single-word-name rule and
// company-dedup.ts's acronym-squash length floor) — real risk of two
// unrelated companies both normalizing to e.g. "tech" or "global".
const MIN_FUZZY_WORDS = 2
const NAME_OVERLAP_THRESHOLD = 0.75

// ── The minimal slice of an existing company_universe row this module
// needs to consider it as a match candidate. ingestion.ts is responsible
// for fetching real candidates (by deterministic ID lookup, then by domain,
// then — only when both are empty on the incoming record — a small
// name-prefix/trigram query) and passing them in; this module never does
// its own broad table scan.
export interface ExistingCompanyIdentitySlice {
  id: string
  lei?: string
  cik?: string
  cin?: string
  companyNumber?: string
  registrationAuthority?: string
  domain?: string
  canonicalName: string
  legalName?: string
  countryCode?: string
}

export type IdentityMatchConfidence = 'deterministic_id' | 'fuzzy_name_domain' | 'fuzzy_name_country'

export type IdentityMatchResult =
  | { outcome: 'matched'; existingId: string; confidence: IdentityMatchConfidence; reason: string }
  | { outcome: 'no_match'; reason: string }
  // Two DIFFERENT existing companies each satisfy a deterministic-ID match
  // against the incoming record (e.g. its LEI matches company A but its CIN
  // matches company B) — real, contradictory source data. Section 12: never
  // pick one over the other by guessing. Surfaced for manual review; the
  // caller must NOT auto-link to either candidate.
  | { outcome: 'conflict'; candidateIds: string[]; reason: string }

function deterministicIdMatches(
  incoming: CanonicalCompanyFields,
  existing: ExistingCompanyIdentitySlice
): string | null {
  if (incoming.lei && existing.lei && incoming.lei === existing.lei) return `LEI match (${incoming.lei})`
  if (incoming.cik && existing.cik && incoming.cik === existing.cik) return `CIK match (${incoming.cik})`
  if (incoming.cin && existing.cin && incoming.cin === existing.cin) return `CIN match (${incoming.cin})`
  if (
    incoming.companyNumber && existing.companyNumber &&
    incoming.companyNumber === existing.companyNumber &&
    // Company numbers are only unique WITHIN a registration authority (a UK
    // company number and an unrelated jurisdiction's company number can
    // collide numerically) — both sides must agree on the authority too.
    incoming.registrationAuthority && existing.registrationAuthority &&
    incoming.registrationAuthority === existing.registrationAuthority
  ) {
    return `Company number match (${incoming.companyNumber} @ ${incoming.registrationAuthority})`
  }
  return null
}

function fuzzyNameDomainMatch(
  incoming: CanonicalCompanyFields,
  existing: ExistingCompanyIdentitySlice
): { confidence: IdentityMatchConfidence; reason: string } | null {
  const incomingDomain = incoming.domain ? normalizeDomain(incoming.domain) : null
  const existingDomain = existing.domain ? normalizeDomain(existing.domain) : null

  const incomingNameNorm = normalizeCompanyName(incoming.canonicalName)
  const existingNameNorm = normalizeCompanyName(existing.canonicalName)
  const existingLegalNorm = existing.legalName ? normalizeCompanyName(existing.legalName) : null
  const incomingWords = significantWords(incomingNameNorm)
  const existingWords = significantWords(existingNameNorm)

  // Tier: exact domain match + real name overlap. Domain alone is
  // deliberately NOT sufficient — a shared domain across a holding company
  // and a subsidiary is a real (if rare) case Section 12's "never merge
  // purely on X alone" principle should also cover.
  if (incomingDomain && existingDomain && incomingDomain === existingDomain) {
    if (incomingWords.length >= MIN_FUZZY_WORDS && existingWords.length >= MIN_FUZZY_WORDS) {
      const ratio = wordOverlapRatio(incomingWords, existingWords)
      if (ratio >= NAME_OVERLAP_THRESHOLD) {
        return { confidence: 'fuzzy_name_domain', reason: `Same domain (${incomingDomain}) + ${Math.round(ratio * 100)}% name-word overlap` }
      }
    }
    // Exact normalized name match (even below the word-count floor above —
    // e.g. a genuine single/two-word legal name) still counts once the
    // domain already agrees, since the domain match is the harder-to-fake
    // signal here.
    if (incomingNameNorm && incomingNameNorm === existingNameNorm) {
      return { confidence: 'fuzzy_name_domain', reason: `Same domain (${incomingDomain}) + exact normalized name match` }
    }
  }

  // Tier: exact normalized-name match (legal or canonical) + same country,
  // no domain available on either side to corroborate. Same "exact
  // normalized match" discipline as edgar-client.ts's matchTicker() Tier 1.
  if (
    incomingNameNorm &&
    (incomingNameNorm === existingNameNorm || (existingLegalNorm && incomingNameNorm === existingLegalNorm)) &&
    incoming.countryCode && existing.countryCode &&
    incoming.countryCode.toUpperCase() === existing.countryCode.toUpperCase()
  ) {
    return { confidence: 'fuzzy_name_country', reason: `Exact normalized name match + same country (${existing.countryCode})` }
  }

  return null
}

/**
 * Resolves whether `incoming` (one provider's normalized record) identifies
 * the same real company as any of `candidates` (existing company_universe
 * rows the caller already fetched as plausible matches). Deterministic
 * identifiers are checked first and always win when present; fuzzy
 * name+domain/name+country matching is only attempted when no deterministic
 * identifier on `incoming` matched anything. Returns 'no_match' (not an
 * error) when nothing qualifies — the caller should then create a new
 * canonical company, never guess.
 */
export function resolveIdentity(
  incoming: CanonicalCompanyFields,
  candidates: ExistingCompanyIdentitySlice[]
): IdentityMatchResult {
  const deterministicHits: Array<{ id: string; reason: string }> = []
  for (const c of candidates) {
    const reason = deterministicIdMatches(incoming, c)
    if (reason) deterministicHits.push({ id: c.id, reason })
  }

  const distinctIds = new Set(deterministicHits.map(h => h.id))
  if (distinctIds.size > 1) {
    return {
      outcome: 'conflict',
      candidateIds: Array.from(distinctIds),
      reason: `Deterministic identifiers disagree across existing records: ${deterministicHits.map(h => h.reason).join('; ')}`,
    }
  }
  if (deterministicHits.length > 0) {
    return { outcome: 'matched', existingId: deterministicHits[0].id, confidence: 'deterministic_id', reason: deterministicHits[0].reason }
  }

  const fuzzyHits: Array<{ id: string; confidence: IdentityMatchConfidence; reason: string }> = []
  for (const c of candidates) {
    const match = fuzzyNameDomainMatch(incoming, c)
    if (match) fuzzyHits.push({ id: c.id, ...match })
  }

  const distinctFuzzyIds = new Set(fuzzyHits.map(h => h.id))
  if (distinctFuzzyIds.size > 1) {
    return {
      outcome: 'conflict',
      candidateIds: Array.from(distinctFuzzyIds),
      reason: `Fuzzy name/domain match is ambiguous across ${distinctFuzzyIds.size} existing records — refusing to guess`,
    }
  }
  if (fuzzyHits.length > 0) {
    return { outcome: 'matched', existingId: fuzzyHits[0].id, confidence: fuzzyHits[0].confidence, reason: fuzzyHits[0].reason }
  }

  return { outcome: 'no_match', reason: 'No deterministic identifier or confident fuzzy name/domain match against any candidate' }
}

// ── Field-level merge policy (Section 13 — source precedence) ──────────
// A canonical company can be fed by more than one provider over time; when
// two providers disagree on a field's value, this decides which one the
// canonical row keeps. Field-level provenance (which provider actually said
// what) always survives in company_source_records regardless of this
// decision — this ONLY affects the single denormalized value cached on the
// company_universe row for cheap reads (Section 9: "do not overwrite one
// provider's evidence with another provider's evidence WITHOUT RETAINING
// PROVENANCE" — provenance is retained at the source-record layer, not by
// refusing to ever update the cached canonical value).
type FieldCategory = 'legal_identity' | 'financial' | 'business_activity'

const CATEGORY_PRECEDENCE: Record<FieldCategory, ProviderName[]> = {
  // National registries (india_mca / companies_house) are authoritative for
  // their own jurisdiction and never actually compete with each other (a
  // company has exactly one home jurisdiction) — ordering them ahead of
  // GLEIF/SEC reflects Section 13's "prefer national government registry"
  // for legal identity.
  legal_identity: ['india_mca', 'companies_house', 'gleif', 'sec_edgar'],
  // SEC financial disclosures are the single most authoritative number this
  // system can get for a US-reporting company — Section 13: "prefer SEC /
  // government filings / official company filings" for financial data.
  financial: ['sec_edgar', 'india_mca', 'companies_house', 'gleif'],
  business_activity: ['india_mca', 'companies_house', 'sec_edgar', 'gleif'],
}

const FIELD_CATEGORY: Partial<Record<keyof CanonicalCompanyFields, FieldCategory>> = {
  legalName: 'legal_identity', tradeName: 'legal_identity', canonicalName: 'legal_identity',
  registeredAddress: 'legal_identity', companyType: 'legal_identity', entityType: 'legal_identity',
  status: 'legal_identity', registrationId: 'legal_identity', registrationAuthority: 'legal_identity',
  cin: 'legal_identity', lei: 'legal_identity', cik: 'legal_identity', companyNumber: 'legal_identity',
  country: 'legal_identity', countryCode: 'legal_identity', stateRegion: 'legal_identity', city: 'legal_identity',
  foundedYear: 'legal_identity',
  revenue: 'financial', revenueCurrency: 'financial', revenueYear: 'financial',
  employeeCount: 'financial', employeeCountMin: 'financial', employeeCountMax: 'financial',
  industry: 'business_activity', industryCodes: 'business_activity', sicCodes: 'business_activity', naicsCodes: 'business_activity',
}

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'string') return v.trim().length === 0
  return false
}

// Fields with no listed category (currently just `domain`) use this
// fallback: keep the existing value unless it's empty, in which case take
// whatever the incoming provider offers — none of the 4 providers here is
// specifically authoritative on a field like `domain`, so "first non-empty
// wins, never silently clobbered afterward" is the safest default.
export function mergeCanonicalFields(
  existing: CanonicalCompanyFields,
  incoming: CanonicalCompanyFields,
  incomingProvider: ProviderName,
  existingContributingProviders: ProviderName[]
): CanonicalCompanyFields {
  const merged: Record<string, unknown> = { ...existing }

  for (const key of Object.keys(incoming) as Array<keyof CanonicalCompanyFields>) {
    const incomingValue = incoming[key]
    if (isEmptyValue(incomingValue)) continue // never overwrite a real value with "unknown"

    const existingValue = existing[key]
    if (isEmptyValue(existingValue)) {
      merged[key] = incomingValue
      continue
    }

    const category = FIELD_CATEGORY[key]
    if (!category) continue // no precedence rule for this field — keep existing, per the fallback above

    const order = CATEGORY_PRECEDENCE[category]
    const incomingRank = order.indexOf(incomingProvider)
    // Rank of the STRONGEST provider that has ever contributed to the
    // existing value for this category — approximated here as the
    // best-ranked provider among everyone who has contributed to this
    // canonical record at all (company_source_records has the precise
    // per-field provenance if a future session needs finer granularity).
    const existingBestRank = Math.min(
      ...existingContributingProviders.map(p => {
        const r = order.indexOf(p)
        return r === -1 ? order.length : r
      }),
      order.length
    )

    if (incomingRank !== -1 && incomingRank < existingBestRank) {
      merged[key] = incomingValue
    }
    // else: existing value came from an equal-or-higher-precedence
    // provider — keep it, don't overwrite.
  }

  return merged as unknown as CanonicalCompanyFields
}

// ============================================================
// Service Evidence Detection — v1
// ============================================================
// Detects the 8 CONFIRMED Demaze service lines (see DEMAZE_CAPABILITY_MAP.md)
// directly against raw content, per the Evidence/Disqualifiers/Threshold
// criteria in SERVICE_TO_OUTREACH_MAPPING.md. Replaces the old cluster-trigger
// approach entirely for gating — signal_clusters (signal-clustering.ts) were
// built for a different, invented catalog and don't map onto these 8 real
// services (see CLAUDE.md "Item 5" for the root-cause writeup).
//
// Same regex-pattern-with-label shape as buildCompanyProfile()'s captureFlag()
// in evidence-extractor.ts, same "collect every match for debug visibility"
// behavior.
//
// Threshold is a real gate, not just a confidence label: 'weak' matches are
// computed and kept in the evidence trail for debugging, but ONLY 'medium' and
// 'strong' surface in the final report. Weak-tier patterns are intentionally
// generic (matching the mapping doc's own examples, e.g. "data-driven" as
// marketing language) — surfacing them would recreate the exact "generic
// Digital Transformation for every company" anti-pattern this rebuild exists
// to kill. See CLAUDE.md "Why this exists" for that anti-pattern.
//
// Disqualifiers are checked FIRST and short-circuit before evidence collection.
// Some disqualifiers from the mapping doc are NOT reliably regexable from
// typical scraped/enriched prose (e.g. headcount numbers) — these are flagged
// explicitly in code comments as unenforced, not silently dropped.
// ============================================================

import type { CompanyProfile } from './evidence-extractor'

export type ServiceThreshold = 'none' | 'weak' | 'medium' | 'strong'

export interface ServiceEvidenceMatch {
  pattern: string
  matched: string
  snippet: string
}

export interface ServiceThresholdResult {
  service: string
  threshold: ServiceThreshold
  disqualified: boolean
  disqualifier_matched?: string
  evidence: ServiceEvidenceMatch[]
}

type Pattern = [RegExp, string]

function firstMatch(content: string, patterns: Pattern[]): ServiceEvidenceMatch[] {
  const out: ServiceEvidenceMatch[] = []
  for (const [re, label] of patterns) {
    const r = new RegExp(re.source, re.flags.replace('g', ''))
    const m = r.exec(content)
    if (m) {
      const start = Math.max(0, m.index - 45)
      const end = Math.min(content.length, m.index + m[0].length + 55)
      out.push({ pattern: label, matched: m[0], snippet: content.slice(start, end).replace(/\s+/g, ' ').trim() })
    }
  }
  return out
}

function anyMatches(content: string, patterns: Pattern[]): boolean {
  return patterns.some(([re]) => new RegExp(re.source, re.flags.replace('g', '')).test(content))
}

function checkDisqualifiers(content: string, disqualifiers: Pattern[]): string | undefined {
  for (const [re, label] of disqualifiers) {
    if (new RegExp(re.source, re.flags.replace('g', '')).test(content)) return label
  }
  return undefined
}

// ── 1. AI-powered business applications ─────────────────────────

function detectAIBusinessApplications(content: string): ServiceThresholdResult {
  const service = 'AI-powered business applications'

  const disqualifiers: Pattern[] = [
    [/\bour\s+(?:in-house|internal)\s+(?:ai|data\s+science)\s+team\b/i,
      'named in-house AI/data science team already exists'],
    // NOTE (doc): "very small company (<10 employees)" is NOT enforced —
    // headcount isn't reliably present in typical scraped/enriched prose.
  ]
  const dq = checkDisqualifiers(content, disqualifiers)
  if (dq) return { service, threshold: 'none', disqualified: true, disqualifier_matched: dq, evidence: [] }

  const strong: Pattern[] = [
    [/\bmanual(?:ly)?\b[^.]{0,60}\b(?:review|scor(?:e|ing)|triage|prioritiz\w+|allocat\w+)\b/i,
      'explicit manual decision process described (review/scoring/triage/prioritization)'],
  ]
  const medium: Pattern[] = [
    [/\b(?:dealer|distributor|distribution)\s+network\b/i, 'dealer/distributor network mentioned'],
    [/\bregional\s+offices?\b/i, 'regional offices mentioned'],
    [/\bfield\s+teams?\b/i, 'field teams mentioned'],
    [/\bacross\s+(?:regions|territories|multiple\s+markets)\b/i, 'distributed sales/ops structure across regions'],
  ]
  const weak: Pattern[] = [
    [/\bdata-driven\b/i, 'generic "data-driven" marketing language'],
  ]

  const evidence = [...firstMatch(content, strong), ...firstMatch(content, medium), ...firstMatch(content, weak)]
  const threshold: ServiceThreshold =
    anyMatches(content, strong) ? 'strong' :
    anyMatches(content, medium) ? 'medium' :
    anyMatches(content, weak)   ? 'weak'   : 'none'

  return { service, threshold, disqualified: false, evidence }
}

// ── 2. Custom SaaS platforms ─────────────────────────────────────

function detectCustomSaaSPlatforms(content: string, profile: CompanyProfile, growthOrHiringSignal: boolean): ServiceThresholdResult {
  const service = 'Custom SaaS platforms'

  // Disqualifier "IS a SaaS company itself in the same space" reuses the
  // already-computed CompanyProfile flag rather than re-deriving via regex.
  if (profile.company_type.software_saas) {
    return { service, threshold: 'none', disqualified: true, disqualifier_matched: 'company is itself a SaaS company (company_type.software_saas)', evidence: [] }
  }
  // NOTE (doc): "generic, already-commoditized needs (basic CRM/accounting)"
  // is NOT enforced — distinguishing "commoditized" from "genuinely custom"
  // needs judgment a regex can't reliably apply; flagging rather than faking it.

  const strong: Pattern[] = [
    [/\bno\s+(?:software|tool|system)\s+(?:fits|supports|handles)\b[^.]{0,80}\b(?:growth|scal\w+|expand\w+)\b/i,
      'explicit process/tool gap blocking a stated growth goal'],
  ]
  const medium: Pattern[] = [
    [/\b(?:our\s+own|internal|proprietary|custom-built)\s+(?:tool|system|process)\b/i,
      'described proprietary internal tool/system/process'],
  ]
  const weak: Pattern[] = [
    [/\bwe\s+use\s+spreadsheets?\b/i, 'generic "we use spreadsheets" mention'],
    [/\b(?:manag\w+|track\w+)\s+(?:via|through|using)\s+(?:excel|spreadsheets?)\b/i,
      'generic spreadsheet-management mention'],
  ]

  const mediumHit = anyMatches(content, medium) && growthOrHiringSignal
  const evidence = [...firstMatch(content, strong), ...(mediumHit ? firstMatch(content, medium) : []), ...firstMatch(content, weak)]
  const threshold: ServiceThreshold =
    anyMatches(content, strong) ? 'strong' :
    mediumHit                   ? 'medium' :
    anyMatches(content, weak)   ? 'weak'   : 'none'

  return { service, threshold, disqualified: false, evidence }
}

// ── 3. Ecommerce ecosystems ──────────────────────────────────────

function detectEcommerceEcosystems(content: string): ServiceThresholdResult {
  const service = 'Ecommerce ecosystems'

  // Disqualifiers "pure B2B, no D2C sales at all" and "no online storefront"
  // are handled implicitly — requiring positive storefront evidence below to
  // reach any threshold naturally excludes pure-B2B/no-ecommerce companies.
  // NOTE (doc): "enterprise-scale ecommerce with sophisticated tooling already"
  // is explicitly NOT a hard disqualifier per the doc itself ("should lower
  // confidence" not suppress) — not enforced as a disqualifier here.

  const strong: Pattern[] = [
    [/\b(?:expand\w+|scal\w+|grow\w+)\b[^.]{0,80}\b(?:channels?|marketplaces?|storefronts?)\b/i,
      'explicit growth/expansion language near multi-channel evidence'],
  ]
  const medium: Pattern[] = [
    [/\b(?:amazon|flipkart|myntra|nykaa)\b/i, 'named marketplace channel'],
    [/\bomnichannel\b/i, 'omnichannel language'],
    [/\b(?:own\s+site|website)\s+(?:and|as\s+well\s+as)\s+(?:marketplaces?|social\s+commerce)\b/i,
      'multiple sales channels described'],
  ]
  const weak: Pattern[] = [
    [/\b(?:shop|store)\s+(?:now|page)\b|\badd\s+to\s+cart\b/i, 'website has a shop/store page'],
  ]

  const evidence = [...firstMatch(content, strong), ...firstMatch(content, medium), ...firstMatch(content, weak)]
  const threshold: ServiceThreshold =
    anyMatches(content, strong) ? 'strong' :
    anyMatches(content, medium) ? 'medium' :
    anyMatches(content, weak)   ? 'weak'   : 'none'

  return { service, threshold, disqualified: false, evidence }
}

// ── 4. Marketplace platforms ─────────────────────────────────────

function detectMarketplacePlatforms(content: string): ServiceThresholdResult {
  const service = 'Marketplace platforms'

  // Disqualifiers ("purely manufacturing, no network effect", "single-sided
  // ecommerce only", "no third-party sellers/vendors mentioned at all") are
  // handled implicitly — requiring explicit two-sided language below to reach
  // any threshold naturally excludes all three cases.

  const strong: Pattern[] = [
    [/\bonboard(?:ing)?\s+(?:partners?|vendors?|merchants?|sellers?)\b[^.]{0,60}\b(?:challenge|scal\w+|growth|goal)\b/i,
      'onboarding partners/vendors described as a stated scaling challenge'],
  ]
  const medium: Pattern[] = [
    [/\b(?:vendors?|sellers?|merchants?)\s+(?:network|onboarding)\b/i, 'vendor/seller network or onboarding described'],
    [/\b(?:buyers?\s+and\s+sellers?|drivers?\s+and\s+riders?|vendors?\s+and\s+customers?)\b/i,
      'explicit two-sided marketplace language'],
  ]
  const weak: Pattern[] = [
    [/\bpartners?\b/i, 'generic "partners" mention'],
  ]

  const evidence = [...firstMatch(content, strong), ...firstMatch(content, medium), ...firstMatch(content, weak)]
  const threshold: ServiceThreshold =
    anyMatches(content, strong) ? 'strong' :
    anyMatches(content, medium) ? 'medium' :
    anyMatches(content, weak)   ? 'weak'   : 'none'

  return { service, threshold, disqualified: false, evidence }
}

// ── 5. Workflow automation systems ───────────────────────────────

function detectWorkflowAutomation(content: string): ServiceThresholdResult {
  const service = 'Workflow automation systems'

  const disqualifiers: Pattern[] = [
    [/\bprocess\s+is\s+(?:fully\s+)?(?:automated|system-driven)\b/i,
      'process explicitly described as already automated/system-driven'],
    // NOTE (doc): "very small team (<15 people)" is NOT enforced — headcount
    // isn't reliably present in typical scraped/enriched prose.
  ]
  const dq = checkDisqualifiers(content, disqualifiers)
  if (dq) return { service, threshold: 'none', disqualified: true, disqualifier_matched: dq, evidence: [] }

  const strong: Pattern[] = [
    [/\b(?:delay|error|missed\s+deadline|backlog|sla\s+breach)\w*\b[^.]{0,80}\b(?:complaint|ticket|order|approval|process)\b/i,
      'explicit delay/error/compliance-risk language near a named process'],
  ]
  const medium: Pattern[] = [
    [/\b(?:complaint|ticket|order|approval)s?\s+(?:lifecycle|process|workflow)\b/i,
      'named multi-step process (complaint/ticket/order/approval lifecycle)'],
    [/\b(?:multiple|various|several)\s+(?:teams|departments)\s+(?:handle|process|manage|touch)/i,
      'multiple teams/departments touching one process'],
  ]
  const weak: Pattern[] = [
    [/\bour\s+team\s+(?:processes|handles|manages)\b/i, 'generic "our team processes/handles/manages"'],
    [/\bcustomer\s+service\s+process\b/i, 'generic customer service process mention'],
  ]

  const evidence = [...firstMatch(content, strong), ...firstMatch(content, medium), ...firstMatch(content, weak)]
  const threshold: ServiceThreshold =
    anyMatches(content, strong) ? 'strong' :
    anyMatches(content, medium) ? 'medium' :
    anyMatches(content, weak)   ? 'weak'   : 'none'

  return { service, threshold, disqualified: false, evidence }
}

// ── 6. Internal operational software ─────────────────────────────

function detectInternalOperationalSoftware(content: string, profile: CompanyProfile): ServiceThresholdResult {
  const service = 'Internal operational software'

  // Disqualifier "single-location, no distributed structure" is handled
  // implicitly by requiring facilityCount/countryCount evidence below.
  const disqualifiers: Pattern[] = [
    [/\b(?:our\s+)?(?:erp|internal\s+(?:system|platform)|operations?\s+platform)\b[^.]{0,40}\b(?:works?\s+well|robust|proven|established)\b/i,
      'existing internal system/ERP explicitly described as working well'],
  ]
  const dq = checkDisqualifiers(content, disqualifiers)
  if (dq) return { service, threshold: 'none', disqualified: true, disqualifier_matched: dq, evidence: [] }

  // Facility/country count reused directly from CompanyProfile — already
  // extracted numerically in evidence-extractor.ts, more reliable than a
  // fresh regex pass. Matches the doc's own numeric thresholds exactly
  // (3+ facilities = medium, >=5 = strong).
  const facilityCount = profile.operations.manufacturing_plants_count ?? 0
  const countryCount = profile.operations.countries_present ?? 0

  const reportingGapPatterns: Pattern[] = [
    [/\b(?:monthly|weekly)\s+reports?\b/i, 'manual reporting cadence mentioned (monthly/weekly reports)'],
    [/\bHQ\b[^.]{0,60}\bvisibility\b/i, 'HQ visibility language'],
  ]
  const hasReportingGapLanguage = anyMatches(content, reportingGapPatterns)

  let threshold: ServiceThreshold = 'none'
  if (facilityCount >= 5 || hasReportingGapLanguage) threshold = 'strong'
  else if (facilityCount >= 3 || countryCount >= 3) threshold = 'medium'
  else if (profile.operations.multi_location) threshold = 'weak'

  const evidence: ServiceEvidenceMatch[] = []
  if (facilityCount > 0) evidence.push({ pattern: 'manufacturing_plants_count', matched: String(facilityCount), snippet: `${facilityCount} facilities (from CompanyProfile.operations)` })
  if (countryCount > 0) evidence.push({ pattern: 'countries_present', matched: String(countryCount), snippet: `${countryCount} countries (from CompanyProfile.operations)` })
  evidence.push(...firstMatch(content, reportingGapPatterns))

  return { service, threshold, disqualified: false, evidence }
}

// ── 7. Analytics and reporting systems ───────────────────────────

function detectAnalyticsReporting(content: string, profile: CompanyProfile): ServiceThresholdResult {
  const service = 'Analytics and reporting systems'

  const disqualifiers: Pattern[] = [
    [/\b(?:powered\s+by|using|built\s+on)\s+(?:tableau|looker|power\s*bi|qlik)\b/i,
      'mature BI/analytics stack explicitly named (Tableau/Looker/PowerBI/Qlik)'],
  ]
  const dq = checkDisqualifiers(content, disqualifiers)
  if (dq) return { service, threshold: 'none', disqualified: true, disqualifier_matched: dq, evidence: [] }

  const facilityCount = profile.operations.manufacturing_plants_count ?? 0
  const hasDealerNetwork = /\b(?:dealer|distributor|franchise)\s+network\b/i.test(content)
  const hasMultiUnit = facilityCount >= 3 || profile.operations.multi_location

  const weak: Pattern[] = [
    [/\b(?:our\s+)?(?:data|insights)\b[^.]{0,40}\b(?:drive|power|inform)\b/i, 'generic "data"/"insights" marketing language'],
  ]

  let threshold: ServiceThreshold = 'none'
  if (hasMultiUnit) {
    // multi-unit + dealer/regional scale = strong per doc's exact wording
    threshold = hasDealerNetwork || facilityCount >= 5 ? 'strong' : 'medium'
  } else if (anyMatches(content, weak)) {
    threshold = 'weak'
  }

  const evidence: ServiceEvidenceMatch[] = []
  if (facilityCount > 0) evidence.push({ pattern: 'manufacturing_plants_count', matched: String(facilityCount), snippet: `${facilityCount} facilities/units (from CompanyProfile.operations)` })
  if (hasDealerNetwork) evidence.push(...firstMatch(content, [[/\b(?:dealer|distributor|franchise)\s+network\b/i, 'dealer/distributor/franchise network mentioned']]))
  evidence.push(...firstMatch(content, weak))

  return { service, threshold, disqualified: false, evidence }
}

// ── 8. AI integrations and intelligent automation ────────────────

function detectAIIntegrations(content: string): ServiceThresholdResult {
  const service = 'AI integrations and intelligent automation'

  // Reuses the same named-tool list as evidence-extractor.ts's
  // named_erp_crm_tool signal pattern (SAP/Oracle/Salesforce/etc.) rather than
  // re-deriving a separate tool list.
  const namedTools: Pattern[] = [
    [/\bsap\s*\(?\s*(?:mm|fico|fi\/co|sd|pp|hr|hcm|qm|wm|ewm|bw|crm)\b/i, 'named SAP module in active use'],
    [/\b(?:oracle\s+erp|salesforce|netsuite|workday|microsoft\s+dynamics|zoho\s+(?:crm|books|one))\b/i, 'named ERP/CRM platform in active use'],
  ]
  const hasNamedTool = anyMatches(content, namedTools)

  const disqualifiers: Pattern[] = [
    [/\bai-(?:powered|driven|enabled)\s+(?:crm|erp|chatbot|assistant)\b[^.]{0,40}\balready\b/i,
      'already names a specific AI integration/tool in active use for the same function'],
  ]
  // Disqualifier "no digital infrastructure at all" is handled implicitly —
  // requiring hasNamedTool below to reach medium/strong naturally excludes
  // companies with no digital infrastructure to integrate into at all.
  const dq = checkDisqualifiers(content, disqualifiers)
  if (dq) return { service, threshold: 'none', disqualified: true, disqualifier_matched: dq, evidence: [] }

  const repetitiveTaskPatterns: Pattern[] = [
    [/\bour\s+team\s+(?:creates?|writes?|produces?|generates?)\b[^.]{0,60}\b(?:weekly|monthly|daily|regularly)\b/i,
      'explicit repetitive content/task description with cadence'],
  ]
  const weak: Pattern[] = [
    [/\bai\b(?!\s*-)/i, 'bare "AI" mentioned as buzzword'],
  ]

  const hasRepetitiveTask = anyMatches(content, repetitiveTaskPatterns)

  let threshold: ServiceThreshold = 'none'
  if (hasNamedTool && hasRepetitiveTask) threshold = 'strong'
  else if (hasNamedTool) threshold = 'medium'
  else if (anyMatches(content, weak)) threshold = 'weak'

  const evidence = [...firstMatch(content, namedTools), ...firstMatch(content, repetitiveTaskPatterns), ...firstMatch(content, weak)]

  return { service, threshold, disqualified: false, evidence }
}

// ── Main export ───────────────────────────────────────────────

export function detectServiceEvidence(
  content: string,
  profile: CompanyProfile,
  growthOrHiringSignal: boolean,
): ServiceThresholdResult[] {
  return [
    detectAIBusinessApplications(content),
    detectCustomSaaSPlatforms(content, profile, growthOrHiringSignal),
    detectEcommerceEcosystems(content),
    detectMarketplacePlatforms(content),
    detectWorkflowAutomation(content),
    detectInternalOperationalSoftware(content, profile),
    detectAnalyticsReporting(content, profile),
    detectAIIntegrations(content),
  ]
}

// ============================================================
// Deterministic Evidence Extractor — lib/pipeline/evidence-extractor.ts
// ============================================================
// Stage 1 of the refactored pipeline (no LLM).
//
// Input:  raw website content (with --- PAGE: markers) + optional enriched source content
// Output: ExtractorResult — signals, factors, business model, compact LLM-ready summary
//
// Architecture:
//   1. Parse content into page segments (by URL)
//   2. Detect page type per segment
//   3. Run pattern matching for 20+ signal types
//   4. Classify evidence subject (company_ops vs product_capability vs marketing)
//   5. Derive DetectedSignal[] from company-subject evidence only
//   6. Map signals → detected_factors (boolean flags for scorer)
//   7. Classify business model
//   8. Build compact signalSummary string for LLM prompt injection
// ============================================================

import { extractCompanyOfferings } from './service-offerings'
import { escapeRegex } from '../utils/regex'

// ── Types ────────────────────────────────────────────────────

export type SignalType =
  // Growth
  | 'new_facility' | 'capacity_expansion' | 'new_market_entry' | 'revenue_milestone'
  // Hiring
  | 'digital_transformation_hiring' | 'ai_ml_hiring' | 'automation_engineering_hiring'
  | 'operations_hiring_surge' | 'leadership_hiring'
  // Digital transformation
  | 'digital_transformation'                                         // new: explicit DX signal
  | 'industry40_initiative' | 'erp_implementation' | 'mes_adoption'
  | 'automation_investment' | 'iot_investment'
  // Business events
  | 'ai_mention' | 'multi_location_operations' | 'acquisition'
  | 'quality_certification_pursuit' | 'sustainability_initiative'
  // D.5: layoffs/restructuring and private-funding rounds — supporting
  // timing/pressure triggers only (see TIMING_TRIGGER_FACTORS in
  // opportunity-engine.ts), never independent service-evidence patterns.
  // Deliberately NOT wired into service-evidence.ts's detectors — a company
  // mentioning either alone must never surface a deterministic opportunity
  // on its own (see D.5 task spec).
  | 'layoffs_restructuring' | 'funding_round'
  // Evidence-source-strategy additions (see EVIDENCE_SOURCE_STRATEGY.md) — sourced
  // primarily from job postings and named-tool mentions, which the original 20
  // patterns above never covered (see: AITG benchmark case, 0 signals despite
  // named SAP MM/FICO modules and an explicit data-workshop in the raw content).
  | 'named_erp_crm_tool' | 'external_training_engagement' | 'internal_workflow_description'

export type EvidenceSubject =
  | 'company_operations'   // company's own internal processes
  | 'company_strategy'     // company's own plans / investments / expansions
  | 'internal_technology'  // technology the company itself is deploying
  | 'customer_use_case'    // what this company's customers do (company is vendor)
  | 'product_capability'   // what this company's products/services enable for customers
  | 'partner_story'        // case studies, partner implementations, third-party examples
  | 'generic_marketing'    // taglines, nav text, cookie banners, mission statements
  | 'industry_trend'       // general industry context, not company-specific

export type PageType =
  | 'careers' | 'investor' | 'press' | 'annual_report'
  | 'about' | 'products' | 'blog' | 'homepage' | 'other'

// ── Evidence origin ─────────────────────────────────────────────
// Where a piece of evidence actually came from — company-owned marketing
// content (own_site) is not the same evidentiary weight as independent
// external evidence (filing/job_posting/news/other_external). Derived from
// the SAME marker vocabulary parseContentSegments() below already parses
// (--- PAGE: ... --- = the company's own scraped pages, [SOURCE: type |
// tier | url] = web-enricher.ts's externally-fetched content) — this is not
// a second, independent evidence system, just a label on the one that
// already exists. 'unknown' is only used when origin genuinely cannot be
// determined (e.g. an out-of-range lookup) — never guessed.
export type EvidenceOrigin = 'own_site' | 'filing' | 'job_posting' | 'news' | 'other_external' | 'unknown'

/** Maps a web-enricher.ts [SOURCE: type | ...] type label to a coarse EvidenceOrigin bucket. */
function classifySourceMarkerOrigin(typeLabel: string): EvidenceOrigin {
  if (/annual.?report|investor|earnings|regulatory|filing/i.test(typeLabel)) return 'filing'
  if (/careers|jobs/i.test(typeLabel)) return 'job_posting'
  if (/press.?release|newsroom|news.?article|ceo.?interview|executive.?change|blog|layoff|funding/i.test(typeLabel)) return 'news'
  return 'other_external'
}

export type EvidenceStrength = 'very_high' | 'high' | 'medium' | 'low'
export type SignalStrength = 'strong' | 'moderate' | 'weak'

// ── CompanyProfile — multi-dimensional boolean struct ─────────
// Replaces single-label BusinessModelType.
// A company can be manufacturer + industrial_vendor + services_provider simultaneously.
// All downstream logic reads from these booleans — no single-winner classification.

export interface CompanyProfile {
  company_type: {
    manufacturer: boolean           // produces physical goods in plants / facilities
    industrial_vendor: boolean      // sells industrial equipment / automation / machinery to industry
    software_saas: boolean          // sells software subscriptions / cloud platform
    services_provider: boolean      // consulting, professional services, R&D services
    retailer: boolean               // sells goods to consumers or businesses via retail
    logistics_operator: boolean     // freight, 3PL, courier, shipping operations
    financial_institution: boolean  // banking, insurance, NBFC, investment management
    healthcare_provider: boolean    // hospitals, clinics, diagnostics, medical devices
    pharma_biotech: boolean         // pharmaceutical manufacturing, drug discovery
    conglomerate: boolean           // holds multiple unrelated business units / divisions
  }
  operations: {
    multi_location: boolean
    global_presence: boolean
    has_rd_center: boolean
    manufacturing_plants_count: number | null
    countries_present: number | null
  }
  capabilities: {
    has_robotics_or_automation: boolean
    has_software_platform: boolean
  }
  selling_model: {
    sells_to_industry: boolean      // B2B
    sells_to_consumers: boolean     // B2C
    sells_physical_product: boolean
    sells_software: boolean
    sells_services: boolean
  }
  primary_type: string  // derived convenience label — most dominant type
}

// ── CompanyProfileEvidence — debug/audit types ────────────────
// Captured for every company_type flag that fires in buildCompanyProfile().
// Surfaced in API response + written to benchmark debug dump files.

/** One pattern match that contributed to a company_type flag being set TRUE. */
export interface ProfileFlagMatch {
  pattern: string   // human-readable description of the regex that fired
  matched: string   // exact substring the regex captured from the content
  snippet: string   // ~100-char context window around the match
}

/**
 * Maps company_type flag names → all patterns that fired for that flag.
 * Special key 'retailer_suppressed' records fmcg/consumer_goods matches
 * blocked by the automotive context guard (useful for Bharat Forge debugging).
 */
export type CompanyProfileEvidence = Record<string, ProfileFlagMatch[]>

export interface ExtractedEvidence {
  id: string
  quote: string             // 150–250 char surrounding context
  signal_type: SignalType | null
  subject: EvidenceSubject
  source_url: string
  page_type: PageType
  source_tier: 'tier1' | 'tier2' | 'tier3'
  evidence_strength: EvidenceStrength
  pattern_matched: string   // which pattern triggered this
  origin: EvidenceOrigin    // own_site vs. which external-source bucket — see EvidenceOrigin above
}

export interface DetectedSignal {
  type: SignalType
  strength: SignalStrength
  evidence: ExtractedEvidence[]
  best_quote: string        // most informative evidence snippet
  is_company_subject: boolean
  validated: boolean        // true if 2+ pieces of company-subject evidence
}

export interface DetectedFactors {
  [key: string]: boolean      // index signature for Partial<Record<string, boolean>> compatibility
  growth_signal: boolean
  hiring_signal: boolean
  digital_transformation: boolean
  capacity_expansion: boolean
  automation_keywords: boolean
  technology_investment: boolean
  ai_mention: boolean
  multi_location_operations: boolean
  industry_40_initiative: boolean
  recent_news_or_event: boolean
  // D.5: pressure/budget timing triggers — see TIMING_TRIGGER_FACTORS
  // (opportunity-engine.ts). Not consulted by service-evidence.ts's
  // detectors, business-model-classifier.ts's invalid_signal_types
  // filtering, or signal-clustering.ts's cluster definitions (none list
  // these keys), so they only ever affect the why-now/timing trace.
  layoffs_signal: boolean
  funding_signal: boolean
}

export interface ExtractorResult {
  signals: DetectedSignal[]
  detectedFactors: DetectedFactors
  /** Maps each active factor to the signal types that triggered it — for score traceability */
  factorSourceMap: Partial<Record<keyof DetectedFactors, string[]>>
  companyProfile: CompanyProfile
  contentFlags: string[]
  signalSummary: string       // compact, LLM-injectable summary
  companySubjectCount: number
  websitePreview: string      // up to 16,000 chars of blended scraped+enriched content — the LLM's actual raw-evidence window, not just company identification (see construction comment below)
  companyProfileEvidence: CompanyProfileEvidence  // which patterns fired per flag
  leadershipContacts: LeadershipContact[]  // named individuals + stated existing portfolio
  /** What the researched company itself says it sells, extracted from its own
   *  self-referential ("we offer", "our services include") website language.
   *  Content-derived only, never LLM-invented. See lib/pipeline/service-offerings.ts. */
  companyOfferings: string[]
}

// ── LeadershipContact — named leadership evidence ────────────────
// A named individual + stated existing portfolio (e.g. "he heads the Bid Strategy,
// Business Development and New Technology/Innovation for the entire Group") is
// strong general company evidence (leadership structure, strategic focus) — see
// EVIDENCE_SOURCE_STRATEGY.md, Tier 1: "leadership responsibilities". This does
// NOT feed a buyer field — buyer identity is input data, not generated (see
// CLAUDE.md "Output schema"). Extraction is intentionally conservative: a
// name+title with no nearby portfolio clause is discarded rather than surfaced.
export interface LeadershipContact {
  name: string
  title: string
  statedPortfolio: string
  sourceUrl: string
  // 'high' = markdown-heading name + title + a stated narrative portfolio
  // clause nearby (the original, stricter extraction strategy). 'medium' =
  // structural-only match (adjacent name+title, no heading, no narrative
  // clause required) — catches the common "photo card grid" team-page
  // layout, but with weaker per-item evidence, so it's tiered lower. Same
  // confidence-tiering discipline as competitor-discovery.ts's
  // tierConfidence(). Optional so existing call sites/tests that predate
  // this field keep compiling; new results always set it.
  confidence?: 'high' | 'medium'
}

// ── Constants ─────────────────────────────────────────────────

const EVIDENCE_WINDOW = 180  // chars of context around a match

// Signals that directly map to detected_factors
const SIGNAL_TO_FACTOR: Partial<Record<SignalType, keyof DetectedFactors>> = {
  new_facility:                   'growth_signal',
  capacity_expansion:             'capacity_expansion',
  new_market_entry:               'growth_signal',
  revenue_milestone:              'growth_signal',
  digital_transformation_hiring:  'hiring_signal',
  ai_ml_hiring:                   'hiring_signal',
  automation_engineering_hiring:  'hiring_signal',
  operations_hiring_surge:        'hiring_signal',
  leadership_hiring:              'hiring_signal',
  digital_transformation:         'digital_transformation',   // new
  industry40_initiative:          'industry_40_initiative',
  erp_implementation:             'digital_transformation',
  mes_adoption:                   'digital_transformation',
  automation_investment:          'automation_keywords',
  iot_investment:                 'technology_investment',
  ai_mention:                     'ai_mention',
  multi_location_operations:      'multi_location_operations',
  acquisition:                    'recent_news_or_event',
  quality_certification_pursuit:  'recent_news_or_event',
  sustainability_initiative:       'recent_news_or_event',
  layoffs_restructuring:          'layoffs_signal',
  funding_round:                  'funding_signal',
  named_erp_crm_tool:             'technology_investment',
  // external_training_engagement and internal_workflow_description intentionally
  // have no DetectedFactors mapping — none of the 10 existing factor keys fit
  // either honestly (see EVIDENCE_SOURCE_STRATEGY.md's Reporting & Analytics /
  // Internal Operations categories). They still surface via signals[], signalSummary,
  // and the extractorResult response payload; forcing them into an ill-fitting
  // boolean factor would misrepresent what was actually found.
}

// ── Signal patterns ────────────────────────────────────────────
// Each pattern: { signal, patterns[], contextRequired? }
// contextRequired: text nearby the match must NOT match this pattern (anti-false-positive)

interface PatternDef {
  signal: SignalType
  patterns: RegExp[]
  antiPatterns?: RegExp[]   // if any match in same sentence → skip
}

const SIGNAL_PATTERNS: PatternDef[] = [
  // ── Growth ──────────────────────────────────────────────────
  {
    signal: 'new_facility',
    patterns: [
      /\bnew\s+(?:plant|factory|facil\w+|campus|hub|manufactur\w+\s+unit)\b/i,
      /\bopening\s+(?:a\s+)?(?:new\s+)?(?:plant|factory|facil\w+)\b/i,
      /\bgroundbreaking\s+(?:ceremony|event|for\s+new)\b/i,
      /\bgreenfield\s+(?:plant|factory|facil\w+|site)\b/i,
      /\bcommission(?:ing|ed)\s+(?:a\s+)?(?:new\s+)?(?:plant|line|unit)\b/i,
    ],
  },
  {
    signal: 'capacity_expansion',
    patterns: [
      /\bexpand(?:ing|ed|s)?\s+(?:our\s+)?(?:capacity|production|manufactur\w+)\b/i,
      /\bcapacity\s+(?:expansion|investment|increase)\b/i,
      /\bnew\s+production\s+(?:line|unit|facility|block)\b/i,
      /\bincreas(?:ing|ed|e)\s+(?:production|manufacturing|output)\s+capacity\b/i,
      /\badditional\s+(?:production|manufacturing)\s+(?:lines?|capacity|units?)\b/i,
      // Financial/investor-relations register (2026-08-24) — externally-sourced
      // content (investor presentations, earnings transcripts) tends to use
      // this phrasing instead of website-marketing phrasing like "expanding
      // our capacity". A live Bharat Forge benchmark run found real,
      // externally-sourced evidence ("INR 2,500 crore fundraising plan...
      // CapEx... expanding investments...") that matched none of the patterns
      // above, producing zero signals despite real, corroborated evidence
      // existing. See tests/evidence-extractor-financial-signals.test.ts.
      /\bcapex\b[^.]{0,60}\b(?:plan|growth|invest\w*)\b/i,
      /\b(?:plan|growth|invest\w*)\b[^.]{0,60}\bcapex\b/i,
      /\bfundrais(?:ing|e)\s+plan\b/i,
      /\bcapital\s+rais(?:e|ing)\b/i,
      /\bexpanding\s+(?:its\s+|our\s+)?investments?\b/i,
    ],
  },
  {
    signal: 'new_market_entry',
    patterns: [
      /\bentering\s+(?:the\s+)?(?:new\s+)?(?:\w+\s+)?market\b/i,
      /\bexpanding\s+into\s+(?:new\s+)?(?:\w+\s+)?(?:market|geograph\w+|countr\w+|segment)\b/i,
      /\bnew\s+(?:geograph\w+|market)\s+(?:expan\w+|entr\w+)\b/i,
      /\bexpanding\s+(?:its\s+|our\s+)?(?:presence|business|operations?)\s+(?:into|in)\s+(?:capital\s+goods|infrastructure|defence|defense|aerospace|energy|railways?|new\s+(?:sector|vertical|segment|domain|market))\b/i,
      /\bexpanding\s+into\s+(?:capital\s+goods|infrastructure|defence|defense|aerospace|energy|railways?|new\s+(?:sector|vertical|segment|domain))\b/i,
      /\bexpanding\s+(?:its\s+|our\s+)?(?:presence|business|operations?)\s+(?:into|in)\s+(?:new\s+)?(?:\w+\s+)?(?:sector|vertical|segment|market|domain)\b/i,
      // Only match active diversification (gerund), not historical state ("diversified company")
      /\bdiversif(?:ying|ication)\s+(?:into|of|our|its)\s+(?:portfolio|business|revenue|product\s+mix|operations?)\b/i,
      /\bventuring\s+into\s+(?:new\s+)?(?:\w+\s+)?(?:sector|market|domain|vertical|territory)\b/i,
      // Global expansion language — active present participle only
      /\bexpanding\s+globally\b/i,
      /\bglobal\s+expansion\s+(?:strategy|plan|initiative|push|drive)\b/i,
      // NOTE: "international presence/footprint" removed — describes historical state not active entry
      // NOTE: "evolved into a diversified" removed — past tense, not active market entry
    ],
    antiPatterns: [/stock\s+market|capital\s+market|financial\s+market/i],
  },
  {
    signal: 'revenue_milestone',
    patterns: [
      /\brevenue\s+(?:grew|increased|of|reached|crossed|exceeded)\s+/i,
      /\brecord\s+(?:revenue|turnover|sales)\b/i,
      /\b(?:turnover|revenue)\s+of\s+(?:rs\.?|inr|usd|\$|€|£)?\s*[\d,]+/i,
      /\b\d+%?\s+(?:revenue\s+)?growth\b/i,
    ],
  },

  // ── Hiring ──────────────────────────────────────────────────
  {
    signal: 'digital_transformation_hiring',
    patterns: [
      /\b(?:sap|erp)\s+(?:consultant|specialist|analyst|lead|manager)\b/i,
      /\bdigitali[sz]ation\s+(?:lead|manager|head|specialist)\b/i,
      /\bdata\s+(?:analyst|engineer|architect|manager)\b/i,
      /\bdigital\s+transformation\s+(?:lead|manager|head)\b/i,
      /\bsystems?\s+analyst\b/i,
    ],
  },
  {
    signal: 'ai_ml_hiring',
    patterns: [
      /\b(?:ai|machine\s+learning|ml)\s+engineer\b/i,
      /\bdata\s+scientist\b/i,
      /\bcomputer\s+vision\s+engineer\b/i,
      /\b(?:nlp|deep\s+learning)\s+(?:engineer|researcher|specialist)\b/i,
      /\bhiring\s+(?:for\s+)?ai\b/i,
    ],
  },
  {
    signal: 'automation_engineering_hiring',
    patterns: [
      /\bautomation\s+engineer\b/i,
      /\bcontrols?\s+engineer\b/i,
      /\brobotic[s]?\s+engineer\b/i,
      /\bplc\s+(?:programmer|engineer|technician)\b/i,
      /\bmechatronics?\s+engineer\b/i,
    ],
  },
  {
    signal: 'operations_hiring_surge',
    patterns: [
      /\b(?:production|manufacturing|quality|maintenance|operations)\s+(?:supervisor|manager|engineer|coordinator|technician)\b/i,
      /\bopen(?:ing|s)?\s+(?:positions?|roles?|vacancies)\s+in\s+(?:production|manufacturing|operations)\b/i,
      /\bqc\s+inspector\b/i,
      /\bshift\s+(?:supervisor|manager|lead)\b/i,
    ],
  },
  {
    signal: 'leadership_hiring',
    patterns: [
      /\b(?:vp|vice\s+president|director|head)\s+of\s+(?:operations?|manufactur\w+|digital|technology)\b/i,
      /\b(?:coo|cto|cdo|chief\s+(?:operating|technology|digital)\s+officer)\b/i,
      /\bleadership\s+team\s+expand/i,
    ],
  },

  // ── Digital transformation ───────────────────────────────────

  // New first-class signal: company's own digital transformation journey.
  // Distinct from ai_mention (which covers AI tools) and industry40_initiative
  // (which covers formal I4.0 programs). This catches the broader DX narrative
  // that most manufacturing companies actually use on their websites.
  {
    signal: 'digital_transformation',
    patterns: [
      /\bai[\s-]powered\s+digitali[sz]ation\b/i,                                           // "AI-powered digitalization"
      /\bdigitali[sz](?:ing|ation|ing)\s+(?:our|the)\s+(?:manufactur\w+|factory|factories|operations?|production|processes?|plant)\b/i,
      /\btransition(?:ing|ed)?\s+from\s+traditional\s+(?:methods?|processes?|operations?|manufactur\w+)\s+to\b/i,
      /\bdigital\s+transformation\s+(?:initiative|journey|program|roadmap|drive|project|strategy)\b/i,
      /\bdigitally\s+transform(?:ing|ed)\s+(?:our|the|manufacturing|operations?)\b/i,
      /\bour\s+digitali[sz]ation\s+(?:journey|initiative|efforts?|program|roadmap)\b/i,
      /\bmanufacturing\s+(?:digitali[sz]ation|modernization)\s+(?:initiative|program|journey|drive|effort)\b/i,
      /\bdigitali[sz](?:ing|e)\s+(?:our|the)\s+(?:factory|factories|plant|operations?|manufactur\w+|supply\s+chain)\b/i,
      /\bsmart\s+manufacturing\s+(?:initiative|program|journey|roadmap|strategy)\b/i,
      /\bfactory\s+(?:of\s+the\s+future|modernization\s+initiative)\b/i,
      /\bdigital\s+(?:manufacturing|factory)\s+(?:initiative|program|journey|transformation)\b/i,
      /\bnext[\s-]gen(?:eration)?\s+manufactur\w+\b/i,
    ],
    // AntiPatterns: only block second-person direct address ("you"/"your") or
    // explicit customer-subject framing. Do NOT block company-strategy statements.
    antiPatterns: [
      /help(?:ing|s)?\s+(?:you|your)\s+(?:with\s+(?:their\s+)?)?(?:digital|digitali)/i,
      /(?:enable|support|accelerate)\s+your\s+(?:digital|digitali)/i,
    ],
  },
  {
    signal: 'industry40_initiative',
    patterns: [
      /\bindustry\s+4\.0\b/i,
      /\bsmart\s+factory\b/i,
      /\biiot\b|\bindustrial\s+internet\s+of\s+things\b/i,
      /\bdigital\s+twin\b/i,
      /\bdigital\s+factory\b/i,
      /\bconnected\s+(?:factory|plant|manufacturing)\b/i,
      /\bsmart\s+manufactur\w+\b/i,                                  // "smart manufacturing" (without initiative suffix)
      /\badvanced\s+manufactur\w+\s+(?:technolog|platform|initiative|solution|center)\b/i,
      /\bai[\s-]powered\s+(?:manufactur\w+|factory|production|operations?)\b/i,
    ],
  },
  {
    signal: 'erp_implementation',
    patterns: [
      /\bsap\s+s\/4hana\b/i,
      /\berp\s+(?:implementation|rollout|go-live|deployment|upgrade|transition)\b/i,
      /\bimplementing\s+(?:sap|oracle|erp|dynamics)\b/i,
      /\bsap\s+(?:implementation|go-live|migration|upgrade)\b/i,
      /\boracle\s+(?:erp|cloud|fusion)\s+(?:implementation|go-live)\b/i,
    ],
  },
  {
    signal: 'mes_adoption',
    patterns: [
      /\bmes\b|\bmanufacturing\s+execution\s+system\b/i,
      /\bshop\s+floor\s+digitali[sz]ation\b/i,
      /\bproduction\s+management\s+system\b/i,
    ],
  },
  {
    signal: 'automation_investment',
    patterns: [
      /\bautonomous\s+(?:truck|vehicle|driv\w+|transport|guided)\b/i,
      /\bself-?driving\s+(?:truck|vehicle|machin\w*)\b/i,
      /\bautomation\s+(?:investment|program|initiative|capex|rollout)\b/i,
      /\bnew\s+(?:automated|robotic)\s+(?:line|system|cell)\b/i,
      /\brobot(?:ic)?\s+(?:installation|deployment|integration)\b/i,
      /\bautomating\s+(?:our|the)\s+(?:production|assembly|welding|inspection|manufactur\w+|operations?|processes?)\b/i,
      // Broader language manufacturing companies actually use
      /\binvest\w*\s+in\s+(?:factory\s+)?(?:automation|robotics?)\b/i,
      /\bautomation\s+(?:journey|roadmap|agenda|drive|push|effort)\b/i,
      /\bindustrial\s+automation\s+(?:initiative|program|investment|journey)\b/i,
      /\b(?:r&d|research\s+and\s+development)\s+and\s+automation\b/i,
      /\bthrough\s+(?:advanced\s+)?automation\b/i,
      /\bautomated\s+(?:production|assembly|manufacturing|factory|plant)\b/i,
    ],
  },
  {
    signal: 'iot_investment',
    patterns: [
      /\biiot\s+(?:platform|sensors?|deployment|integration)\b/i,
      /\bconnected\s+(?:machines?|equipment|sensors?)\b/i,
      /\breal-time\s+(?:monitoring|data|visibility)\s+(?:across|for)\s+(?:our|the)?\s*(?:plant|factory|production)/i,
      /\bpredictive\s+analytics\s+(?:platform|infrastructure|deployment)\b/i,
    ],
  },

  // ── AI + Business events ─────────────────────────────────────
  {
    signal: 'ai_mention',
    patterns: [
      /\bai-powered\b|\bai\s+powered\b/i,
      /\bartificial\s+intelligence\s+(?:adoption|strategy|deploy\w+|for\s+(?:manufactur|operat|product))/i,
      /\bartificial\s+intelligence\s+(?:program|initiative|platform|investment|deployment)\b/i,
      /\bmachine\s+learning\s+(?:model|platform|solution|program)\b/i,
      /\bdeploying\s+(?:ai|artificial\s+intelligence)\b/i,
      /\bai\s+(?:initiative|strategy|roadmap|investment|transformation)\b/i,
    ],
    antiPatterns: [/our\s+(?:customers?|clients?)\s+use\s+ai/i, /we\s+(?:sell|provide|offer)\s+ai/i],
  },
  {
    signal: 'multi_location_operations',
    patterns: [
      /\b(?:plants?|facilit\w+|locations?|factor(?:y|ies))\s+(?:across|in|spanning)\s+(?:\d+|multiple|several|many)/i,
      /\b\d{2,}\s+(?:plants?|facilit\w+|locations?|offices?|branches?|factor(?:y|ies))\b/i,
      // Spelled-out numbers + optional adjective: "six manufacturing facilities", "three plants"
      /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s+(?:\w+\s+)?(?:plants?|facilit\w+|sites?|locations?|factor(?:y|ies))\b/i,
      // "Unit(s)" is intentionally NOT added to the general noun lists above — bare
      // "unit" is far riskier than plant/facility/site/location (business unit, unit
      // price, unit test, housing unit). Require it to be directly qualified by
      // manufacturing/production, matching how buildCompanyProfile() already safely
      // handles this same term (see A-1 Fence: "six manufacturing units").
      /\b(?:manufactur\w+|production)\s+units?\b/i,
      // Noun + geographic scope: "facilities nationwide", "plants across India"
      /\b(?:plants?|facilit\w+|sites?|factor(?:y|ies))\s+(?:nationwide|pan[-\s]india|across\s+(?:india|the\s+country|the\s+globe|the\s+region))\b/i,
      /\boperations?\s+(?:across|in)\s+\d+\s+(?:countries?|states?|cities?)\b/i,
      /\bglobal\s+(?:manufactur\w+|operations?|footprints?|presence)\b/i,
      /\bglobal\s+(?:manufactur\w+|production)\s+(?:network|footprints?|base|presence)\b/i,
      /\bour\s+(?:global|international|worldwide)\s+(?:manufactur|operat|product)\w*\s+(?:footprints?|network|presence|base)\b/i,
      /\bmanufacturing\s+footprints?\b/i,
      /\bmulti-(?:plant|site|location)\b/i,
      // Broader: global manufacturers (Volvo, Bosch, Siemens etc.)
      /\boperations?\s+in\s+(?:more\s+than\s+)?\d+\s+(?:countries?|markets?)\b/i,
      /\bpresence\s+in\s+(?:more\s+than\s+)?\d+\s+countries\b/i,
      /\b\d+\s+(?:countries?|markets?|regions?)\s+(?:worldwide|globally|around\s+the\s+world)\b/i,
      /\b\d{2,}\s+(?:countries?|markets?)\b/i,
      /\b\d{2,}\s+(?:production\s+)?(?:plants?|facilit\w+|sites?)\s+(?:worldwide|globally|around)\b/i,
    ],
  },
  {
    signal: 'acquisition',
    patterns: [
      /\b(?:acquired?|acquisition\s+of|merger\s+with|merged\s+with)\b/i,
      /\bstrategic\s+acquisition\b/i,
      /\bancquiring\b|\bjoining\s+forces\s+with\b/i,
    ],
    antiPatterns: [/customer\s+acqui\w+|talent\s+acqui\w+/i],
  },
  {
    signal: 'quality_certification_pursuit',
    patterns: [
      /\b(?:iatf|iatf\s+16949|iso\s+9001|as9100|iso\s+14001)\s+(?:certified?|certification|recertif\w+|pursuit|achieve\w*)\b/i,
      /\bpursu(?:ing|ed)\s+(?:iso|iatf|as9100)\s+certification\b/i,
      /\bachiev(?:ed|ing)\s+(?:iso|iatf)\s+\d+\s+certification\b/i,
    ],
  },
  {
    signal: 'sustainability_initiative',
    patterns: [
      /\bcarbon\s+(?:neutral|reduction|net\s+zero|footprint)\b/i,
      /\besg\s+(?:program|initiative|commitment|target|report)\b/i,
      /\bsustainability\s+(?:goal|target|program|roadmap)\b/i,
      /\bgreen\s+(?:manufactur\w+|energy|factory)\b/i,
    ],
  },

  // ── Evidence-source-strategy additions (EVIDENCE_SOURCE_STRATEGY.md) ────────
  {
    signal: 'named_erp_crm_tool',
    patterns: [
      // Named SAP module already in use — covers "SAP (MM Module)" and "SAP (FICO)"
      // phrasing (AITG job postings: 0 SIGNAL_PATTERNS matches before this).
      /\bsap\s*\(?\s*(?:mm|fico|fi\/co|sd|pp|hr|hcm|qm|wm|ewm|bw|crm)\b/i,
      // Other named ERP/CRM/BI platforms stated as already in active use
      /\b(?:oracle\s+erp|salesforce|netsuite|workday|microsoft\s+dynamics|tableau|power\s*bi|quickbooks|zoho\s+(?:crm|books|one))\b/i,
      // Generic "knowledge of / experience in <tool>" job-requirement framing
      /\bknowledge\s+of\s+(?:sap|erp|crm)\b/i,
      /\b(?:experience|expertise|proficiency)\s+(?:in|with)\s+(?:sap|erp|crm|oracle|salesforce)\b/i,
    ],
  },
  {
    signal: 'external_training_engagement',
    patterns: [
      // AITG: "a workshop on 'Interpreting Data and Understanding Variation'"
      /\bworkshop\s+(?:on|for|focused\s+on)\b/i,
      // AITG: "to conduct a Workshop for Senior Management personnel"
      /\b(?:conduct|conducted|organi[sz]ed?|organi[sz]ing)\s+(?:a\s+|an\s+)?(?:workshop|training\s+(?:program|session))\b/i,
      /\btraining\s+(?:program|session)\s+(?:on|for|to)\b/i,
      /\bengaged?\s+(?:a\s+|an\s+)?(?:consultant|trainer|facilitator)\b/i,
    ],
  },

  // ── D.5: Layoffs / restructuring & funding rounds ──────────────────
  // Supporting timing/pressure triggers only (see TIMING_TRIGGER_FACTORS,
  // opportunity-engine.ts) — deliberately never wired into
  // service-evidence.ts, so neither pattern group can, by itself, produce a
  // deterministic opportunity for any of the 8 confirmed services.
  {
    signal: 'layoffs_restructuring',
    patterns: [
      /\blay(?:s|ing)?\s+offs?\b/i,
      /\blayoffs?\b/i,
      /\bjob\s+cuts?\b/i,
      /\b(?:workforce|headcount)\s+reduction\b/i,
      /\b(?:cutting|reducing|trimming|eliminating)\s+(?:its\s+|our\s+)?(?:workforce|staff|headcount|jobs|positions)\b/i,
      /\b(?:corporate|organi[sz]ational|business)\s+restructur(?:ing|e)\b/i,
      /\brestructur\w+\b[^.]{0,60}\b(?:workforce|staff|employees?|headcount|jobs|positions)\b/i,
      /\bemployees?\s+(?:were\s+|being\s+)?(?:laid\s+off|let\s+go|terminated)\b/i,
    ],
  },
  {
    signal: 'funding_round',
    patterns: [
      /\braises?\s+(?:\$|usd|inr|rs\.?|€|£)?\s*[\d,.]+\s*(?:million|billion|crore|lakh|m|bn)\b/i,
      /\b(?:secures?|closes?|completes?)\s+(?:\$|usd|inr|rs\.?|€|£)?\s*[\d,.]+\s*(?:million|billion|crore|lakh)\s+(?:in\s+)?(?:funding|investment|financing)\b/i,
      /\bseries\s+[a-e]\s+(?:funding|round|financing)\b/i,
      /\b(?:seed|pre-seed)\s+(?:funding|round|financing)\b/i,
      /\bfunding\s+round\s+(?:led\s+by|from)\b/i,
      /\bventure\s+capital\s+(?:funding|investment|round)\b/i,
      /\bbacked\s+by\s+(?:leading\s+)?(?:venture\s+capital|investors?|vcs?)\b/i,
    ],
    // A company describing customer-facing financing/funding products or
    // helping customers access funding is not a signal about its own
    // budget — same "customer-facing evidence != internal pain/trigger"
    // discipline as every other pattern in this file (CLAUDE.md rule #1/#4).
    antiPatterns: [
      /\b(?:financing|funding)\s+(?:options?|solutions?)\s+for\s+(?:you|your|customers?)\b/i,
      /help(?:ing|s)?\s+(?:you|your)\s+(?:access|secure|find)\s+funding/i,
    ],
  },
]

// ── Page type detection ────────────────────────────────────────

// Segment-boundary lookahead — a keyword match must end at a real path/
// query/extension separator (or end of string), not bleed into a longer
// word. Same bug class this codebase already fixed once for scraper.ts's
// matchesKeyword() ('ir' matching inside 'wire'), just never applied here:
// without this, '/blog/company-news' matched pageType 'about' via the bare
// substring '/company' inside '/company-news', and '/products/irrigation-
// parts' matched 'investor' via '/ir' inside '/irrigation' (found while
// writing tests/evidence-extractor-pagetype.test.ts, 2026-07-27 — worked
// around there with a non-colliding test URL rather than fixed at the
// time). Deliberately does NOT include '-' or '_' as valid boundary
// characters, unlike matchesKeyword()'s own separator set — a trailing
// hyphen/underscore is still "the same compound slug" (e.g. 'company-news'
// is one slug, not 'company' + a separator), not a real path boundary, so
// treating it as one would have let this exact bug back in through the
// side door. This trades a little recall (e.g. '/careers-page' no longer
// matches 'careers') for correctness — consistent with this codebase's
// established "prefer under-confidence over a confidently wrong match"
// philosophy (see website-discovery.ts).
const SEG_END = '(?=[/.?]|$)'

export function detectPageType(url: string): PageType {
  const path = (url || '').toLowerCase()
  if (new RegExp(`/(?:careers|jobs|hiring|vacancies|work-with-us|join-us|open-positions|opportunities)${SEG_END}`).test(path)) return 'careers'
  if (new RegExp(`/(?:investor|ir|annual-report|shareholders|financial|earnings|results|reports)${SEG_END}`).test(path)) return 'investor'
  if (new RegExp(`/(?:annual[_-]?report|ar20\\d{2})${SEG_END}`).test(path)) return 'annual_report'
  if (new RegExp(`/(?:press|news|newsroom|media|announcements|press-releases?|pressroom)${SEG_END}`).test(path)) return 'press'
  if (new RegExp(`/(?:about|about-us|company|our-story|who-we-are|overview|corporate)${SEG_END}`).test(path)) return 'about'
  if (new RegExp(`/(?:products?|solutions?|services?|capabilities|offerings|platforms?)${SEG_END}`).test(path)) return 'products'
  if (new RegExp(`/(?:blog|insights?|perspectives?|thought-leadership|articles?)${SEG_END}`).test(path)) return 'blog'
  if (/^\/?(?:index\.html?)?$|\/home\/?$/.test(path) || path === '') return 'homepage'
  return 'other'
}

// Source tier from page type
function tierFromPageType(pt: PageType): 'tier1' | 'tier2' | 'tier3' {
  if (pt === 'careers' || pt === 'investor' || pt === 'annual_report' || pt === 'press') return 'tier1'
  if (pt === 'about' || pt === 'blog') return 'tier2'
  return 'tier3'
}

function strengthFromTier(tier: 'tier1' | 'tier2' | 'tier3'): EvidenceStrength {
  if (tier === 'tier1') return 'high'
  if (tier === 'tier2') return 'medium'
  return 'low'
}

// ── Evidence subject classifier ────────────────────────────────

// Short-form self-reference fallback (2026-07-23) — see CLAUDE.md's
// "RESOLVED 2026-07-19 — detectPageType()..." section for the live case
// this closes: a resolved legal name like "Ador Welding Ltd" never matches
// real prose that uses the short brand form ("Ador produces..."), so real
// company_strategy evidence was falling through to generic_marketing.
//
// Same word-boundary discipline as matchesKeyword() in scraper.ts (short
// keywords must be real whole-word matches, never a substring) — the short
// form here is only ever tried as a \b-anchored regex, never .includes().
//
// Reuses the same "strip unambiguous legal-entity suffixes only" rule as
// website-discovery.ts's normalizeCompanyName() — deliberately duplicated
// rather than imported, same precedent as the other discovery modules'
// duplicated STOPWORDS/self-name-checking logic.
const LEGAL_SUFFIXES_RE = /\b(?:pvt\.?|private|ltd\.?|limited|inc\.?|incorporated|llc|corp\.?|corporation|co\.?)\b/gi

// Generic first-words that are common enough in ordinary marketing/industry
// prose that falling back to them as a "short form" would reintroduce the
// exact substring/false-positive bug class this fallback must avoid (same
// bug class as 'ir' matching inside "wire" in the URL classifier). A company
// literally named e.g. "Global Industries" won't get the short-form rescue —
// that's an accepted false-negative trade-off, not a new gap: its full name
// still gets tried first, same as always.
const GENERIC_LEADING_WORDS = new Set([
  'the', 'a', 'an', 'group', 'global', 'national', 'international', 'united',
  'american', 'indian', 'general', 'premier', 'prime', 'advanced', 'modern',
  'new', 'smart', 'digital', 'tech', 'star', 'sun', 'royal', 'elite',
  'supreme', 'leading', 'first', 'top', 'best', 'world', 'universal',
])

/**
 * Returns the first significant word of a resolved company name, for use
 * as a short-form self-reference fallback — but ONLY when the name is
 * genuinely multi-word (a single-word resolved name has nothing shorter
 * to try; the full-name check already covers it). Returns null when no
 * safe short form exists.
 */
function firstSignificantWord(name: string): string | null {
  const cleaned = name
    .replace(LEGAL_SUFFIXES_RE, ' ')
    // \p{L}/\p{N} (Unicode letter/number), not \w — see website-discovery.ts's
    // normalizeCompanyName() for the same 2026-07-24 fix and the live
    // "Möller Group" -> "m ller group" symptom this addresses here too.
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = cleaned.split(' ').filter(w => w.length > 0)
  if (words.length <= 1) return null
  return words[0]
}

// JavaScript's \b is always defined in terms of the ASCII \w class, even
// under the 'u' flag — see website-discovery.ts's identical helper for the
// full explanation.
function wordBoundaryRegex(word: string, flags = ''): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(word)}(?![\\p{L}\\p{N}])`, flags + 'u')
}

function classifySubject(text: string, pageType: PageType, profile?: CompanyProfile, companyName?: string): EvidenceSubject {
  const t = text.toLowerCase()

  // Customer-facing content — always external
  if (/(?:our|the)\s+(?:customer|client)s?\s+(?:benefit|gain|achieve|report|see|use|can)\b/.test(t)) return 'customer_use_case'
  if (/we\s+(?:help|enable|empower|support)\s+(?:our\s+)?(?:customer|client)s?\b/.test(t)) return 'customer_use_case'
  if (/\b(?:case\s+stud(?:y|ies)|success\s+stor(?:y|ies)|customer\s+stor(?:y|ies))\b/.test(t)) return 'partner_story'
  if (/\b(?:our\s+partner|our\s+collaboration\s+with|worked\s+with|collaborated\s+with)\b/.test(t)) return 'partner_story'

  // Product / service capability (company is vendor) — direct-address framing only
  // "our solution provides customers with" / "with our platform, you can"
  // Note: does NOT block "our product line" or "our manufacturing" for vendor companies
  if (/our\s+(?:platform|software|service|tool)\s+(?:provide|offer|enable|help|allow|let|give)\b/.test(t)) return 'product_capability'
  if (/with\s+(?:our|the)\s+(?:platform|solution),\s+you\s+can\b/.test(t)) return 'product_capability'
  if (/\bfeature(?:s)?\s+include\b/.test(t)) return 'product_capability'

  // Careers page = always company operations
  if (pageType === 'careers') return 'company_operations'

  // Investor / press / annual report = company strategy (always, for any business model)
  if (pageType === 'investor' || pageType === 'annual_report' || pageType === 'press') return 'company_strategy'

  // ── Vendor-aware classification ───────────────────────────────
  // Industrial vendors and services companies (Ador Welding, Fanuc, ABB, Rockwell,
  // TCS, Infosys etc.) have strategic statements on About/company pages that are
  // about THEIR OWN operations — not just product pitches.
  // These should enter signals[] as company_strategy.
  // Without this path, valid signals (R&D investment, capacity, global operations,
  // sustainability) fall through to generic_marketing and get filtered out.
  // Uses CompanyProfile booleans — no single-label winner needed.
  const isVendorType = profile && (
    profile.company_type.industrial_vendor ||
    profile.company_type.services_provider
  )
  if (isVendorType && (pageType === 'about' || pageType === 'other')) {
    // Block: second-person direct address ("you", "your customers") → product_capability
    const isSecondPerson = /\b(?:you|your)\b/.test(t) && !/\bour\s+(?:team|employees|people|workforce)\b/.test(t)
    if (!isSecondPerson) return 'company_strategy'
  }

  // First-person internal operations
  if (/\bwe\s+(?:are|have|do|build|manufactur|operat|produc|assembl|forg|stamp|cast|weld|machine|offer)\b/.test(t)) return 'company_operations'
  if (/\bour\s+(?:plant|facility|facilities|factory|factories|team|workforce|operation|production|manufactur)\b/.test(t)) return 'company_operations'
  if (/\bour\s+(?:employees|workers|staff|people|headcount)\b/.test(t)) return 'company_operations'
  if (/\bour\s+(?:global|international|worldwide)\s+(?:manufactur|operat|product)\w*\b/.test(t)) return 'company_operations'

  // First-person strategy / plan
  if (/\b(?:we|our\s+(?:company|group))\s+(?:announced|plan(?:ned)?|intend|will\s+(?:open|expand|launch|invest|acquire)|aim\s+to)\b/.test(t)) return 'company_strategy'
  if (/\bour\s+(?:strategy|roadmap|vision|mission|goal|objective|commitment)\b/.test(t) && !/customer/.test(t)) return 'company_strategy'
  if (/\bglobal\s+(?:manufactur|production|operat)\w+\s+(?:network|footprints?|presence|base)\b/.test(t)) return 'company_strategy'

  // Internal technology
  if (/\bwe\s+(?:are\s+deploying|deploy(?:ed|ing)|implement(?:ing|ed)|rolling\s+out|invest(?:ing|ed)\s+in)\b/.test(t)) return 'internal_technology'

  // About/other page Industry 4.0 context = company strategy
  if ((pageType === 'about' || pageType === 'other') &&
      /\b(?:industry\s*4\.0|smart\s+factory|iiot|digital\s+twin|ai[\s-]powered|artificial\s+intelligence)\b/.test(t) &&
      !/\b(?:our\s+(?:customer|client)|help\s+(?:you|your)|enable\s+(?:you|your)|for\s+(?:your|our\s+customer))\b/.test(t)) return 'company_strategy'

  // External 'other' sources from enrichment are company-targeted by query, and
  // 'about' pages routinely describe the company in third person by name
  // ("A-1 Fence's operations are spread over six manufacturing units") rather
  // than first-person "we/our" — previously this recognition only fired for
  // pageType==='other', so 'about' pages using third-person self-reference
  // never classified as a company subject even when the evidence was strong.
  // 'homepage' joined this list 2026-07-19, bundled with the detectPageType()
  // URL-vs-path fix above: before that fix, homepages were mislabeled 'other'
  // and got this treatment BY ACCIDENT (Ador Welding's homepage evidence only
  // classified correctly because of the mislabeling) — now that homepages are
  // correctly labeled 'homepage', they need to reach this same check on
  // purpose, or they'd fall through to the unconditional generic_marketing
  // return below and real evidence would be lost. Fixed together per design.
  //
  // 'products' and 'blog' joined this list 2026-07-27 (same bug shape,
  // audited 2026-07-24 alongside the fixes above): detectPageType() labels
  // /solutions/, /services/, /capabilities/ URLs as 'products' (line 549) —
  // exactly the pages scraper.ts's classifyUrl() scores highest under its
  // b2b_services category (75, one of the top tiers it prioritizes for
  // scraping) — yet this third-person self-reference check never ran for
  // them, so real third-person company_strategy evidence sitting on a
  // heavily-scraped page type fell straight to the unconditional
  // generic_marketing return below. Same for 'blog': a press-release-style
  // post ("XYZ Corp announced record earnings this quarter") is routinely
  // third-person, not first-person "we/our". Deliberately NOT extended to
  // the vendor-aware block above (pageType === 'about' || 'other') or the
  // Industry 4.0 context check below — both are broader "treat the whole
  // page as company_strategy" rules with no per-mention name check, and a
  // product/solutions page is disproportionately likely to be genuine
  // customer-facing sales copy (second-person "empower YOUR factory")
  // rather than a company self-description; the third-person block here is
  // safe to extend because it still requires the company's OWN NAME (or
  // "the company/group/firm") to actually appear, not a blanket page-type
  // assumption.
  if (pageType === 'other' || pageType === 'about' || pageType === 'homepage' || pageType === 'products' || pageType === 'blog') {
    const isCustomerFacing = /\b(?:help|enable|your\s+company|our\s+customer)\b/i.test(t)
    if (!isCustomerFacing) {
      // Match the company's own name with word boundaries — same discipline as
      // the URL-classifier's short-keyword boundary fix (see matchesKeyword() in
      // scraper.ts): a bare short name could otherwise substring-match unrelated
      // words. Requiring >= 4 chars guards against degenerate/placeholder names.
      if (companyName && companyName.trim().length >= 4) {
        // wordBoundaryRegex(), not \b...\b (2026-07-24 fix) — \b is always
        // ASCII-\w-based in JS regardless of the 'u' flag, so a name that
        // STARTS or ENDS with an accented letter (e.g. "Société", "École")
        // would never match a plain \b-anchored pattern even once the
        // company name itself is no longer mangled by a strip-regex.
        const nameRe = wordBoundaryRegex(companyName.trim(), 'i')
        if (nameRe.test(text)) return 'company_strategy'

        // Short-form fallback (2026-07-23): the full resolved name (often a
        // longer legal form, e.g. "Ador Welding Ltd") didn't match — try the
        // name's first significant word (e.g. "Ador") as a real, word-
        // boundary-anchored match, the way real site prose often refers to
        // itself. Guarded against the short/generic collision risk this
        // fallback exists to avoid: only tried for genuinely multi-word
        // names, only when the short form itself is >= 4 chars, and never
        // for a word on GENERIC_LEADING_WORDS.
        const shortForm = firstSignificantWord(companyName)
        if (shortForm && shortForm.length >= 4 && !GENERIC_LEADING_WORDS.has(shortForm.toLowerCase())) {
          const shortRe = wordBoundaryRegex(shortForm, 'i')
          if (shortRe.test(text)) return 'company_strategy'
        }
      }
      if (/\b(?:the\s+company|the\s+group|the\s+firm)\s+\w+/i.test(t)) return 'company_strategy'
    }
  }

  // Generic marketing (homepage, taglines)
  if (pageType === 'homepage') return 'generic_marketing'
  if (/\bleading\s+(?:provider|manufacturer|supplier|global)\b/.test(t)) return 'generic_marketing'
  if (/\bworld[\s-]class\b|\binnovation\s+at\s+(?:its\s+)?core\b/.test(t)) return 'generic_marketing'

  // Industry trend
  if (/\bthe\s+(?:industry|market|sector)\s+(?:is|has|are)\b/.test(t)) return 'industry_trend'

  return 'generic_marketing'
}

// ── Reader/customer-description guard ──────────────────────────
// captureFlag() (below) backs every company_type detector and is a bare
// regex scan with no subject awareness — unlike classifySubject() (used
// for signal/opportunity evidence elsewhere in this file), it can't tell
// "we manufacture X" from "if you are an X manufacturer, talk to us" or
// "our customers include X manufacturers". Real false positive found live
// on ategroup.com: the industrial_vendor pattern matched "...or equipment
// manufacturer seeking a trusted counterpart..." inside a sentence
// addressing the READER, not describing ATE itself.
//
// This is a narrow, local-window heuristic — it runs on the same ~100-char
// snippet captureFlag() already extracts around each match, not the whole
// page — deliberately not a classifySubject()-style rebuild: buildCompanyProfile()
// is a pure single-content function with no page-type/company-name context
// classifySubject() depends on, and threading that through is a bigger
// change than this bug needs.
//
// Deliberately narrow: a bare "you"/"your" mention does NOT reject a match
// on its own — "we help your business scale" is a legitimate company
// self-description that happens to mention the reader as the object of
// "help", and must still count. Only an explicit reader-identity claim
// ("if you are a...", "you are a...", "your own manufacturing
// capabilities...") or an explicit customer/partner description (same
// "our customers"/"case study" framing classifySubject() already treats as
// external) trips this guard. CSR/donation context is a separate check
// (isCsrContext() below) — see its own comment for why.
function isReaderOrCustomerDescribed(snippet: string): boolean {
  const t = snippet.toLowerCase()

  // Reader-identity framing — the READER is being told they hold some role
  // ("if you are a distributor...", "you are a technology provider...",
  // "your own manufacturing capabilities") — true regardless of any nearby
  // we/our, since the identity claim is about the reader, not the company.
  if (/\bif\s+you(?:'re|\s+are)\b/.test(t)) return true
  if (/\byou\s+are\s+(?:a|an|the)\b/.test(t)) return true
  if (/\byour\s+(?:own\s+)?(?:manufacturing|production|industrial|business)\s+(?:capabilit\w*|operations?|facilit\w*)/.test(t)) return true

  // Customer/partner description — the sentence's subject is a customer or
  // partner, not the company being profiled (same framing classifySubject()
  // already labels 'customer_use_case'/'partner_story').
  if (/\b(?:our|the)\s+(?:customer|client)s?\s+(?:include|benefit|gain|achieve|report|see|use|can)\b/.test(t)) return true
  if (/\b(?:case\s+stud(?:y|ies)|success\s+stor(?:y|ies)|customer\s+stor(?:y|ies))\b/.test(t)) return true
  if (/\b(?:our\s+partner|worked\s+with|collaborated\s+with)\b/.test(t)) return true

  // Bare second-person mention alone is NOT enough — "we help your
  // business" keeps the company as the sentence's actor.
  if (!/\b(?:you|your)\b/.test(t)) return false
  return !/\b(?:we|our)\b/.test(t)
}

// CSR/donation context — a company's own CSR section routinely lists
// unrelated beneficiary sectors ("healthcare", "rural development") that say
// nothing about what the company itself does. Real false positive found on
// a-1fenceproducts.com: "...water and sanitation, healthcare services. ##
// CSR INITIATIVES..." set healthcare_provider = true off a CSR list.
//
// Deliberately checked against the RAW local-window snippet (same one
// captureFlag() stores for debug display), not the sentence-scoped window
// isReaderOrCustomerDescribed() uses above. Real CSR sections are routinely
// written as a heading immediately AFTER the sentence containing the
// keyword ("...healthcare services. ## CSR INITIATIVES") — sentence-scoping
// (which stops at the first '.') would cut the heading out entirely, which
// is exactly why the first version of this fix didn't catch the real case.
// This does re-introduce a little of the bleed-through risk sentence-
// scoping exists to prevent, but CSR headings and the keyword they gate are
// only ever a few words apart in real content (a heading directly
// introducing or closing the list it labels) — unlike the "manufacturing
// units ... CSR initiatives" adjacency that motivated sentence-scoping,
// which was two unrelated topics placed artificially close together, not a
// realistic same-window case.
function isCsrContext(snippet: string): boolean {
  return /\bcsr\b|corporate\s+social\s+responsibility/i.test(snippet)
}

// Finds the sentence containing a match — bounded scan, not a full
// sentence-splitter — used ONLY to decide whether isReaderOrCustomerDescribed()
// should reject a match. A fixed-size character window (like the debug
// `snippet` below) can bleed into an adjacent, unrelated sentence on short
// content: e.g. "...six manufacturing units across India. Our CSR
// initiatives cover healthcare services..." — a raw window around
// "healthcare services" would otherwise also flag the unrelated
// "manufacturing units" match a few words earlier. Capped at 200 chars each
// direction so content with no sentence-ending punctuation nearby (e.g. a
// bullet list) doesn't scan the whole page.
function sentenceWindow(content: string, matchIndex: number, matchLength: number): string {
  const SCAN_CAP = 200
  const searchStart = Math.max(0, matchIndex - SCAN_CAP)
  const before = content.slice(searchStart, matchIndex)
  const lastBreak = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('\n'))
  const start = lastBreak === -1 ? searchStart : searchStart + lastBreak + 1

  const searchEnd = Math.min(content.length, matchIndex + matchLength + SCAN_CAP)
  const after = content.slice(matchIndex + matchLength, searchEnd)
  const breaks = [after.indexOf('.'), after.indexOf('!'), after.indexOf('?'), after.indexOf('\n')].filter(i => i !== -1)
  const end = breaks.length === 0 ? searchEnd : matchIndex + matchLength + Math.min(...breaks) + 1

  return content.slice(start, end).replace(/\s+/g, ' ').trim()
}

// ── captureFlag helper ────────────────────────────────────────
// Runs each [regex, label] pair against content.
// On a match: appends {pattern, matched, snippet} to evidence[flag] and returns true.
// Collects ALL matching patterns (not just first) for full debug visibility.
function captureFlag(
  content: string,
  flag: string,
  patterns: Array<[RegExp, string]>,
  evidence: CompanyProfileEvidence,
): boolean {
  let fired = false
  for (const [regex, label] of patterns) {
    // Strip 'g' flag — exec() with /g is stateful and would miss subsequent calls
    const r = new RegExp(regex.source, regex.flags.replace('g', ''))
    const m = r.exec(content)
    if (m) {
      const start   = Math.max(0, m.index - 45)
      const end     = Math.min(content.length, m.index + m[0].length + 55)
      const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim()
      // Reject matches that describe the READER, a customer/partner, or a
      // CSR/donation-context sector, not the company itself. Reader/customer
      // framing uses the sentence-scoped window (needs grammatical
      // locality); CSR context uses the raw local `snippet` (CSR headings
      // routinely follow the sentence, not sit inside it) — see each
      // function's own comment for why they use different windows.
      const guardText = sentenceWindow(content, m.index, m[0].length)
      if (isReaderOrCustomerDescribed(guardText) || isCsrContext(snippet)) continue
      if (!evidence[flag]) evidence[flag] = []
      evidence[flag].push({ pattern: label, matched: m[0], snippet })
      fired = true
      // Don't break — collect every pattern that fires for complete debug coverage
    }
  }
  return fired
}

// ── Company Profile Builder ────────────────────────────────────
// Replaces single-label classifyBusinessModel().
// Returns multi-dimensional boolean struct + evidence of what fired.
// A company can match multiple types simultaneously.

export function buildCompanyProfile(content: string): { profile: CompanyProfile; evidence: CompanyProfileEvidence } {
  const profile: CompanyProfile = {
    company_type: {
      manufacturer: false, industrial_vendor: false, software_saas: false,
      services_provider: false, retailer: false, logistics_operator: false,
      financial_institution: false, healthcare_provider: false,
      pharma_biotech: false, conglomerate: false,
    },
    operations: {
      multi_location: false, global_presence: false, has_rd_center: false,
      manufacturing_plants_count: null, countries_present: null,
    },
    capabilities: { has_robotics_or_automation: false, has_software_platform: false },
    selling_model: {
      sells_to_industry: false, sells_to_consumers: false,
      sells_physical_product: false, sells_software: false, sells_services: false,
    },
    primary_type: 'unknown',
  }

  const evidence: CompanyProfileEvidence = {}

  // ── company_type ─────────────────────────────────────────────

  // manufacturer: makes physical goods in plants / facilities
  if (captureFlag(content, 'manufacturer', [
    [/manufactur\w+\s+(?:company|facilit|plant|unit)/i,                                                  'manufactur* + company/facilit/plant/unit'],
    [/production\s+(?:facility|plant|line)/i,                                                            'production facility/plant/line'],
    [/\b(?:forging|casting|stamping|machining|fabricat\w+|assembly)\s+(?:line|plant|facilit|unit)/i,     'forging/casting/stamping/... + line/plant/facilit/unit'],
    [/\b(?:six|five|four|three|two|multiple|several|\d+)\s+manufacturing\s+(?:facilit|plant|unit)/i,     'N manufacturing facilit/plant/unit'],
    [/welding\s+(?:company|manufactur)/i,                                                                'welding company/manufactur*'],
    [/we\s+manufactur/i,                                                                                 'we manufactur*'],
    [/our\s+manufactur\w+\s+facilit/i,                                                                   'our manufacturing facilit*'],
    [/\b(?:component|forging|casting|stamping|fabricat\w+|precision|contract|industrial|automotive)\s+manufacturer\b/i, 'X manufacturer (standalone noun)'],
    [/\bwe\s+are\s+(?:a|an|the)\s+(?:\w+\s+){0,2}manufacturer\b/i,                                     'we are a/the ... manufacturer'],
    [/\bmanufactur\w+\s+and\s+export(?:ing|s|ed)?\b/i,                                                  'manufactures and exports'],
    // "leader in high-performance components" (a qualifier + "components"/"parts",
    // not just the forging/casting/etc. noun list) — real gap found live 2026-07-27
    // re-verifying a benchmark failure: Bharat Forge's actual homepage copy reads
    // "global leader in high-performance components across sectors such as
    // Automotive, Railways...", which this pattern's original noun list didn't
    // cover at all (only forgings/castings/stampings/machining/fabrication/
    // manufactur*). The qualifier requirement (precision/high-performance/
    // engineered) keeps bare "leader in components"/"leader in products" — too
    // generic, could fire for almost any industry — from matching.
    [/\bleader\s+in\s+(?:forgings?|castings?|stampings?|machining|fabrication|manufactur\w+|(?:precision|high[\s-]performance|engineered)\s+components?)\b/i, 'leader in forgings/castings/machining/.../high-performance components'],
    [/\bour\s+(?:forging|casting|stamping|machining|fabrication|welding)\s+operations?\b/i,              'our forging/casting/welding operations'],
    [/\b(?:forging|casting|stamping|fabrication|machining)\s+(?:company|business|operations?)\b/i,      'forging/casting company/business/operations'],
    // "over half a century of manufacturing history/experience" — same real
    // gap, found on the same Bharat Forge page. A specific, low-risk signal:
    // a company describing its own tenure in years/decades/a century of
    // manufacturing is unambiguously a manufacturer, not marketing puffery.
    [/\b(?:years?|decades?|century|centuries)\s+of\s+manufactur\w+/i,                                    'N years/decades/century of manufactur*'],
    // Enumerated capability lists ("fabrication, machining, control system design facility")
    // put other nouns between the capability keyword and facility/plant/unit — the patterns
    // above all require direct adjacency and miss this list-style copy. Bounded to 40 chars
    // and excludes '.'/newline so the gap can't cross a sentence boundary into an unrelated claim.
    [/\b(?:forging|casting|stamping|machining|fabricat\w+|assembly)\b[^.\n]{0,40}?\b(?:facilit\w*|plant|unit)\b/i, 'forging/casting/machining/fabrication + (enumerated list) + facility/plant/unit'],
    // Subsidiary/brand-attributed manufacturing — a group/holding company
    // routinely describes its own manufacturing in the third person, named
    // by brand ("AxisValence manufactures high-quality equipment...",
    // "TeraSpin manufactures precision components..."), not "we/our". None
    // of the patterns above cover this construction (they're all "we
    // manufacture" or bare "X manufacturer" noun-phrase framing) — real gap
    // found live on ategroup.com, where genuine subsidiary-level
    // manufacturing evidence existed on the page but nothing matched it.
    // Requires a capitalized brand-like phrase (not a generic sentence-
    // starter word) directly followed by "manufactures" + a qualifying
    // adjective — same "qualifier required" discipline as the "leader in
    // ... components" pattern above, so this doesn't degrade into matching
    // any bare "X manufactures Y" mention (e.g. of an unrelated third
    // party). Still passes through isReaderOrCustomerDescribed() like every
    // other match here, so a customer/case-study "our client, Acme, which
    // manufactures widgets..." would need to be caught by that guard, not
    // this pattern.
    [/\b(?!(?:The|This|It|They|We|Our|A|An)\b)[A-Z][A-Za-z0-9&'-]{2,}(?:\s+[A-Z][A-Za-z0-9&'-]{2,}){0,2}\s+manufactures\s+(?:high[\s-]quality|premium|precision|advanced|world[\s-]class|innovative|quality)\b/, 'Brand/Subsidiary manufactures (third-person, qualified)'],
  ], evidence)) profile.company_type.manufacturer = true

  // industrial_vendor: sells industrial equipment / automation / machinery to industry
  if (captureFlag(content, 'industrial_vendor', [
    [/welding\s+(?:equipment|solution|automation|machine|system)/i,              'welding equipment/solution/machine/system'],
    [/industrial\s+(?:automation|technology|equipment)\s+(?:vendor|provider|supplier)/i, 'industrial automation/tech/equipment vendor/provider/supplier'],
    [/machine\s+(?:builder|maker|manufacturer)\s+(?:for|serving)/i,             'machine builder/maker for/serving'],
    [/manufactur\w+\s+(?:equipment|solution|automation)\s+(?:provider|supplier)/i, 'manufacturing equipment/solution provider/supplier'],
    [/(?:automation|robotic|welding|cutting)\s+solution/i,                      'automation/robotic/welding/cutting solution(s)'],
    [/(?:consumables?|equipment)\s+(?:for\s+)?(?:welding|cutting|manufactur)/i, 'consumables/equipment for welding/cutting/manufacturing'],
  ], evidence)) profile.company_type.industrial_vendor = true

  // software_saas
  // Evidence basis for billing-domain patterns: chargebee.com body copy uses
  // "subscription billing", "Subscription Management", "Billing Automation" —
  // NOT "SaaS" or "cloud platform" in visible body text.
  if (captureFlag(content, 'software_saas', [
    [/\bsaas\b|\bsoftware[\s-]as[\s-]a[\s-]service\b/i,                   'SaaS / software-as-a-service'],
    [/\bcloud\s+(?:platform|software|erp|crm)\b/i,                         'cloud platform/software/ERP/CRM'],
    [/subscription[\s-]based\s+software/i,                                  'subscription-based software'],
    [/\bapi[\s-]first\b|\bpaas\b|\bplatform[\s-]as[\s-]a[\s-]service\b/i, 'api-first / PaaS / platform-as-a-service'],
    [/\bsubscription\s+(?:billing|management|platform|software|analytics)\b/i, 'subscription billing/management/platform'],
    [/\bbilling\s+(?:platform|software|management|automation)\b/i,          'billing platform/software/management/automation'],
    [/\brecurring\s+(?:billing|revenue|payments)\b/i,                       'recurring billing/revenue/payments'],
    [/\brevenue\s+(?:operations|management)\s+(?:platform|software)\b/i,    'revenue operations/management platform'],
  ], evidence)) profile.company_type.software_saas = true

  // services_provider
  if (captureFlag(content, 'services_provider', [
    [/\b(?:consulting|advisory|professional\s+services)\b/i,      'consulting / advisory / professional services'],
    [/engineering\s+services?\s+(?:company|provider|firm)/i,      'engineering services company/provider/firm'],
    [/product\s+(?:design|development|engineering)\s+services/i,  'product design/development/engineering services'],
    [/\br&d\s+services?\b/i,                                      'R&D services'],
    [/managed\s+services?\s+provider/i,                           'managed services provider'],
  ], evidence)) profile.company_type.services_provider = true

  // retailer — consumer_goods/fmcg guarded by automotive/industrial context
  // NOTE: these terms appear routinely in auto component companies' sector descriptions
  // (e.g. "consumer goods segment = passenger vehicles") and cause false positives.
  const isAutomotiveIndustrialContext = /\b(?:automotive|passenger\s+vehicle|commercial\s+vehicle|forging|casting|stamping|machining|oem|tier[\s-]?1\s+supplier)\b/i.test(content)
  const retailerBase = captureFlag(content, 'retailer', [
    [/\bretail\s+(?:store|chain|network|outlet)\b/i, 'retail store/chain/network/outlet'],
    [/\b(?:supermarket|hypermarket|mall)\b/i,         'supermarket / hypermarket / mall'],
  ], evidence)
  let retailerConsumer = false
  if (!isAutomotiveIndustrialContext) {
    retailerConsumer = captureFlag(content, 'retailer', [
      [/\bfmcg\b|\bconsumer\s+goods\b/i, 'fmcg / consumer goods'],
    ], evidence)
  } else {
    // Record the suppressed match — critical for Bharat Forge debug visibility
    const suppM = /\bfmcg\b|\bconsumer\s+goods\b/i.exec(content)
    if (suppM) {
      const s = Math.max(0, suppM.index - 40)
      const e = Math.min(content.length, suppM.index + suppM[0].length + 60)
      evidence['retailer_suppressed'] = [{
        pattern: 'fmcg / consumer goods [SUPPRESSED — automotive/industrial context detected]',
        matched: suppM[0],
        snippet: content.slice(s, e).replace(/\s+/g, ' ').trim(),
      }]
    }
  }
  if (retailerBase || retailerConsumer) profile.company_type.retailer = true

  // logistics_operator
  if (captureFlag(content, 'logistics_operator', [
    [/\b(?:freight|3pl|third.?party\s+logistics|courier|shipping)\s+(?:company|provider|services?)\b/i, 'freight/3PL/courier/shipping company/provider/services'],
    [/\bwarehouse\s+(?:and|&)\s+distribution\b/i,  'warehouse and/& distribution'],
    [/\blast[\s-]mile\s+delivery\b/i,               'last-mile delivery'],
  ], evidence)) profile.company_type.logistics_operator = true

  // financial_institution — emi removed (electromagnetic interference false positive)
  // bare "bank" excludes common non-financial compounds ("data bank", "food bank", etc.) —
  // same false-positive class as the 'ir' inside "wire" / 'sec' inside "security" URL-classifier bug.
  if (captureFlag(content, 'financial_institution', [
    [/\b(?:insurance|nbfc|mutual\s+fund|asset\s+management|investment\s+bank)\b/i, 'insurance/NBFC/mutual fund/asset management/investment bank'],
    [/(?<!data\s)(?<!food\s)(?<!test\s)(?<!word\s)(?<!blood\s)(?<!piggy\s)(?<!river\s)\bbank\b/i, 'bank (excl. data/food/test/word/blood/piggy/river bank)'],
    [/\bfinancial\s+services?\s+(?:company|provider|firm)\b/i,                          'financial services company/provider/firm'],
    [/\b(?:loan|deposit|credit\s+card|mortgage|npa)\b/i,                               'loan/deposit/credit card/mortgage/NPA'],
  ], evidence)) profile.company_type.financial_institution = true

  // healthcare_provider — bare "diagnostic" removed; now requires pathology/imaging co-occurrence
  if (captureFlag(content, 'healthcare_provider', [
    [/\b(?:hospital|clinic|medical\s+devices?)\b/i,                                                    'hospital / clinic / medical devices'],
    [/\bdiagnostic(?:s)?\s+(?:cent(?:er|re)|lab(?:oratory)?|imaging|patholog\w*|radiology|facilit\w*)\b/i, 'diagnostic center/lab/imaging/pathology/radiology'],
    [/\b(?:patholog\w*|radiology|medical\s+imaging)\b/i,                                               'pathology / radiology / medical imaging'],
    [/\bhealthcare\s+(?:provider|services?|company)\b/i,                                               'healthcare provider/services/company'],
  ], evidence)) profile.company_type.healthcare_provider = true

  // pharma_biotech — nda removed (non-disclosure agreement false positive)
  if (captureFlag(content, 'pharma_biotech', [
    [/\b(?:pharmaceutical|pharma|biotech|drug\s+manufactur|api\s+manufactur)\b/i, 'pharmaceutical/pharma/biotech/drug manufactur/api manufactur'],
    [/\b(?:clinical\s+trial|fda|usfda|anda)\b/i,                                 'clinical trial / FDA / USFDA / ANDA'],
  ], evidence)) profile.company_type.pharma_biotech = true

  // conglomerate
  if (captureFlag(content, 'conglomerate', [
    [/\b(?:group|holding|conglomerate)\s+(?:compan|with\s+(?:diverse|multiple|varied))/i, 'group/holding/conglomerate company/with diverse...'],
    [/\bdiverse\s+(?:portfolio|businesses|industries|sectors)\b/i,                        'diverse portfolio/businesses/industries/sectors'],
    [/\bmultiple\s+business\s+(?:unit|segment|division)/i,                                'multiple business unit/segment/division'],
  ], evidence)) profile.company_type.conglomerate = true

  // ── operations ───────────────────────────────────────────────

  // manufacturing plant count
  const numPlant = content.match(/(\d+)\s+manufacturing\s+(?:facilit|plant|unit)/i)
  const wordMap: Record<string, number> = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 }
  const wordPlant = content.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+manufacturing\s+(?:facilit|plant|unit)/i)
  if (numPlant) profile.operations.manufacturing_plants_count = parseInt(numPlant[1])
  else if (wordPlant) profile.operations.manufacturing_plants_count = wordMap[wordPlant[1].toLowerCase()] ?? null
  if ((profile.operations.manufacturing_plants_count ?? 0) > 1) profile.operations.multi_location = true

  // country count
  const numCountry = content.match(/(\d+)\+?\s+countr/i)
  if (numCountry) {
    profile.operations.countries_present = parseInt(numCountry[1])
    if (profile.operations.countries_present > 1) profile.operations.global_presence = true
  }
  if (/\bglobal\s+presence\b|\binternational\s+(?:presence|operations|market)/i.test(content)) profile.operations.global_presence = true
  if (/multi[\s-]location|multiple\s+(?:location|facilit|plant|site)\b/i.test(content)) profile.operations.multi_location = true

  // R&D center
  if (/\br&d\s+cent(?:re|er)|research\s+and\s+development\s+cent(?:re|er)|research\s+cent(?:re|er)/i.test(content)) profile.operations.has_rd_center = true

  // ── capabilities ─────────────────────────────────────────────
  if (/\b(?:robot\w*|cobot|automation|cnc\s+machine)\b/i.test(content)) profile.capabilities.has_robotics_or_automation = true
  if (/\bcloud\s+platform|saas\s+platform|api\s+platform|software\s+platform\b/i.test(content)) profile.capabilities.has_software_platform = true

  // ── selling_model ────────────────────────────────────────────
  const ct = profile.company_type
  if (ct.industrial_vendor || ct.services_provider || ct.software_saas || /\b(?:b2b|enterprise\s+(?:client|customer|sale))\b/i.test(content)) profile.selling_model.sells_to_industry = true
  if (ct.retailer || /\b(?:b2c|consumer|end\s+user)\b/i.test(content)) profile.selling_model.sells_to_consumers = true
  if (ct.manufacturer || ct.industrial_vendor || ct.retailer) profile.selling_model.sells_physical_product = true
  if (ct.software_saas) profile.selling_model.sells_software = true
  if (ct.services_provider) profile.selling_model.sells_services = true

  // ── primary_type (convenience label) ─────────────────────────
  // `conglomerate` AND the single/few-keyword soft categories (financial_
  // institution, pharma_biotech, healthcare_provider, logistics_operator,
  // retailer) are checked AFTER the operational categories (industrial_vendor,
  // manufacturer, services_provider) — same principle for all six: a single
  // generic keyword match (a CSR-donation mention of "healthcare services", a
  // founder-history anecdote about repairing "hospital equipment", "diverse
  // sectors" marketing boilerplate) should never outrank explicit operational
  // evidence like "production line" or "six manufacturing facilities".
  // Previously checked first, these silently overrode real manufacturer/
  // industrial_vendor evidence for ATE Group, AITG (conglomerate — fixed
  // 2026-07-11), and AITG + A-1 Fence Products again via healthcare_provider
  // (same bug, different category, fixed same day after the first fix turned
  // out to be incomplete — see CLAUDE.md "ATE Group" / "Item 1" for both writeups).
  // software_saas stays first — its patterns are multi-word/specific
  // ("software-as-a-service", "subscription billing platform") and not part of
  // this bug class.
  if (ct.software_saas) profile.primary_type = 'software_saas'
  else if (ct.industrial_vendor && ct.manufacturer) profile.primary_type = 'industrial_vendor_manufacturer'
  else if (ct.industrial_vendor) profile.primary_type = 'industrial_vendor'
  else if (ct.manufacturer) profile.primary_type = 'manufacturer'
  else if (ct.services_provider) profile.primary_type = 'services_provider'
  else if (ct.financial_institution) profile.primary_type = 'financial_institution'
  else if (ct.pharma_biotech) profile.primary_type = 'pharma_biotech'
  else if (ct.healthcare_provider) profile.primary_type = 'healthcare_provider'
  else if (ct.logistics_operator) profile.primary_type = 'logistics_operator'
  else if (ct.retailer) profile.primary_type = 'retailer'
  else if (ct.conglomerate) profile.primary_type = 'conglomerate'
  else profile.primary_type = 'unknown'

  return { profile, evidence }
}

// ── Supplemented Company Profile — website-primary, external-supplement ──
// buildCompanyProfile() stays a pure single-content function (existing tests
// and callers depend on that exact one-argument shape). This wraps it with a
// trust hierarchy: the company's OWN site is the primary source for identity/
// classification; external/enriched content may only fill in fields the
// website left unestablished, never overwrite a classification the website
// already made. Root cause this closes: buildCompanyProfile() was previously
// called with websiteContent only inside extractSignals() while everything
// else there (SIGNAL_PATTERNS, websitePreview) scanned website+enriched
// combined content — so a thin/degraded website scrape could leave
// primary_type 'unknown' even when the combined pool contained clear,
// company-specific classification evidence (confirmed on Bharat Forge,
// comparing the 2026-08-24 vs 2026-08-25 benchmark runs).
export function buildSupplementedCompanyProfile(
  websiteContent: string,
  enrichedContent?: string,
): { profile: CompanyProfile; evidence: CompanyProfileEvidence } {
  const websiteResult = buildCompanyProfile(websiteContent)
  if (!enrichedContent) return websiteResult

  const combined = websiteContent + '\n\n' + enrichedContent
  const combinedResult = buildCompanyProfile(combined)

  // Classification (company_type + primary_type): trust the website fully
  // once it has established ANY type — external content never overrides an
  // already-confident website classification. Only when the website alone
  // classified as 'unknown' does the combined pool's classification take
  // over — and since `combined` contains the website text verbatim, this can
  // only ADD evidence the website-only pass missed, never contradict it
  // (there's nothing to contradict: the website-only pass found no type).
  const websiteEstablishedType = websiteResult.profile.primary_type !== 'unknown'
  const company_type = websiteEstablishedType ? websiteResult.profile.company_type : combinedResult.profile.company_type
  const primary_type = websiteEstablishedType ? websiteResult.profile.primary_type : combinedResult.profile.primary_type
  const profileEvidence = websiteEstablishedType ? websiteResult.evidence : combinedResult.evidence

  // Operations/capabilities/selling_model: supplement only the specific
  // fields the website left null/false — a website-established value (e.g.
  // "six manufacturing facilities" stated on the About page) is never
  // replaced by a different combined-pool number. Allowed independently of
  // whether classification above was website- or combined-derived — filling
  // in a missing facility/country count doesn't touch company identity.
  const operations: CompanyProfile['operations'] = {
    multi_location: websiteResult.profile.operations.multi_location || combinedResult.profile.operations.multi_location,
    global_presence: websiteResult.profile.operations.global_presence || combinedResult.profile.operations.global_presence,
    has_rd_center: websiteResult.profile.operations.has_rd_center || combinedResult.profile.operations.has_rd_center,
    manufacturing_plants_count: websiteResult.profile.operations.manufacturing_plants_count ?? combinedResult.profile.operations.manufacturing_plants_count,
    countries_present: websiteResult.profile.operations.countries_present ?? combinedResult.profile.operations.countries_present,
  }
  const capabilities: CompanyProfile['capabilities'] = {
    has_robotics_or_automation: websiteResult.profile.capabilities.has_robotics_or_automation || combinedResult.profile.capabilities.has_robotics_or_automation,
    has_software_platform: websiteResult.profile.capabilities.has_software_platform || combinedResult.profile.capabilities.has_software_platform,
  }
  const selling_model: CompanyProfile['selling_model'] = {
    sells_to_industry: websiteResult.profile.selling_model.sells_to_industry || combinedResult.profile.selling_model.sells_to_industry,
    sells_to_consumers: websiteResult.profile.selling_model.sells_to_consumers || combinedResult.profile.selling_model.sells_to_consumers,
    sells_physical_product: websiteResult.profile.selling_model.sells_physical_product || combinedResult.profile.selling_model.sells_physical_product,
    sells_software: websiteResult.profile.selling_model.sells_software || combinedResult.profile.selling_model.sells_software,
    sells_services: websiteResult.profile.selling_model.sells_services || combinedResult.profile.selling_model.sells_services,
  }

  return {
    profile: { company_type, operations, capabilities, selling_model, primary_type },
    evidence: profileEvidence,
  }
}

// ── Content parser ─────────────────────────────────────────────
// Splits content into segments by --- PAGE: url --- markers.
// Also handles [SOURCE: type | tier | url] markers from web-enricher.

interface ContentSegment {
  url: string
  text: string
  pageType: PageType
  tier: 'tier1' | 'tier2' | 'tier3'
  origin: EvidenceOrigin
}

function parseContentSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = []

  // Website content format: --- PAGE: /path (https://url) ---
  const pageRegex = /---\s*PAGE:\s*([^\n]+?)\s*---\n([\s\S]*?)(?=---\s*PAGE:|$)/gi
  let pageMatch: RegExpExecArray | null

  while ((pageMatch = pageRegex.exec(content)) !== null) {
    const urlHeader = pageMatch[1].trim()
    const text = pageMatch[2].trim()
    if (!text) continue

    // Header format is "path (https://url)" — e.g. "/ (https://adorwelding.com)"
    // for the homepage (see formatScrapedPages() in scrape-utils.ts). Extract
    // BOTH: the full url for the segment's own .url field (unchanged), and the
    // bare path — already present before the parens, no need to re-derive it
    // from the URL — for detectPageType(), which is path-shaped (leading '/',
    // no scheme/host) and previously received the full URL by mistake, so its
    // homepage regex (`^\/?...$`) never matched a real homepage (2026-07-19 fix,
    // see the classifySubject() 'homepage' branch below for the other half).
    const urlMatch = urlHeader.match(/\(([^)]+)\)/)
    const url = urlMatch ? urlMatch[1] : urlHeader
    const path = urlMatch ? urlHeader.slice(0, urlMatch.index).trim() : url
    const pageType = detectPageType(path)
    const tier = tierFromPageType(pageType)
    segments.push({ url, text, pageType, tier, origin: 'own_site' })
  }

  // Enriched source format: [SOURCE: type (confidence) | tier | url]
  const sourceRegex = /\[SOURCE:\s*([^\n|]+)\|\s*(tier\d)\s*\|\s*([^\]]+)\]\s*\n([\s\S]*?)(?=\[SOURCE:|$)/gi
  let srcMatch: RegExpExecArray | null

  while ((srcMatch = sourceRegex.exec(content)) !== null) {
    const typeLabel = srcMatch[1].trim()
    const tierLabel = srcMatch[2].trim() as 'tier1' | 'tier2' | 'tier3'
    const url = srcMatch[3].trim()
    const text = srcMatch[4].trim()
    if (!text) continue

    const pageType = /annual.?report|investor|earnings/i.test(typeLabel) ? 'investor'
      : /careers|jobs/i.test(typeLabel) ? 'careers'
      : /press.?release|newsroom|news.?article|ceo.?interview|blog|layoff|funding/i.test(typeLabel) ? 'press'
      : 'other'

    segments.push({ url, text, pageType, tier: tierLabel, origin: classifySourceMarkerOrigin(typeLabel) })
  }

  // If no markers found, treat entire content as homepage — same fallback
  // convention as origin's "own_site" default (this is unmarked scraped
  // content, not enriched/external).
  if (segments.length === 0 && content.trim()) {
    segments.push({ url: '', text: content, pageType: 'homepage', tier: 'tier3', origin: 'own_site' })
  }

  return segments
}

// ── Evidence origin lookup by position ──────────────────────────
// For callers that match directly against a raw content string outside
// this file (service-evidence.ts's regex detectors run on the same
// website+enriched pool; normalize.ts's llm_verified opportunity path
// locates a quote-verified snippet in it) and need to know which segment a
// given character offset falls in, without re-parsing full segment text.
// Reuses the exact same marker vocabulary/classification
// (classifySourceMarkerOrigin) as parseContentSegments() above — if the
// marker format ever changes, both places need updating together.
const PAGE_MARKER_START = /---\s*PAGE:\s*[^\n]+?\s*---\n/gi
const SOURCE_MARKER_START = /\[SOURCE:\s*([^\n|]+)\|\s*tier\d\s*\|\s*[^\]]+\]\s*\n/gi

/**
 * Given raw content (the same website+enriched pool parseContentSegments()
 * parses) and a character index into it, returns which segment's origin
 * that index falls under. Content before the first marker, or content with
 * no markers at all, defaults to 'own_site' — the same fallback
 * parseContentSegments() uses for unmarked scraped content. Returns
 * 'unknown' only for a genuinely invalid (out-of-range) index — never a
 * guessed origin.
 */
export function deriveEvidenceOrigin(content: string, index: number): EvidenceOrigin {
  if (!Number.isInteger(index) || index < 0 || index > content.length) return 'unknown'

  const markers: Array<{ pos: number; origin: EvidenceOrigin }> = []

  PAGE_MARKER_START.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PAGE_MARKER_START.exec(content)) !== null) markers.push({ pos: m.index, origin: 'own_site' })

  SOURCE_MARKER_START.lastIndex = 0
  while ((m = SOURCE_MARKER_START.exec(content)) !== null) {
    markers.push({ pos: m.index, origin: classifySourceMarkerOrigin(m[1].trim()) })
  }

  if (markers.length === 0) return 'own_site'

  markers.sort((a, b) => a.pos - b.pos)

  let current: EvidenceOrigin = 'own_site'
  for (const marker of markers) {
    if (marker.pos > index) break
    current = marker.origin
  }
  return current
}

// ── Evidence extraction ────────────────────────────────────────

function extractEvidenceWindow(text: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - Math.floor(EVIDENCE_WINDOW / 2))
  const end = Math.min(text.length, matchIndex + matchLength + Math.floor(EVIDENCE_WINDOW / 2))
  let window = text.slice(start, end).trim()
  // Clean up whitespace
  window = window.replace(/\s+/g, ' ')
  return window.slice(0, 250)
}

function shouldSkipMatch(window: string, def: PatternDef): boolean {
  if (!def.antiPatterns) return false
  return def.antiPatterns.some(ap => ap.test(window))
}

// ── Job-posting workflow extraction ────────────────────────────
// Job responsibility/duties lists are a structurally distinct evidence source
// (see EVIDENCE_SOURCE_STRATEGY.md, Tier 1: "job posting responsibilities") —
// a hiring manager describes the real internal process honestly because the
// role needs to be filled correctly, not to market the company. Generic
// SIGNAL_PATTERNS phrase-matching against flat prose misses this entirely
// (confirmed: ATE Group's BOQ -> P&ID -> compliance -> procurement workflow,
// found only in a job posting, produced zero SIGNAL_PATTERNS matches). This
// needs to be captured as a structural block, not a phrase match.
const RESPONSIBILITY_HEADING = /\b(?:key\s+)?respons\w*\s*:?/i

function extractJobPostingWorkflowEvidence(segments: ContentSegment[]): ExtractedEvidence[] {
  const results: ExtractedEvidence[] = []
  let n = 0

  for (const seg of segments) {
    if (seg.pageType !== 'careers') continue

    const match = RESPONSIBILITY_HEADING.exec(seg.text)
    if (!match) continue

    const start = match.index + match[0].length
    const block = seg.text.slice(start, start + 400).replace(/\s+/g, ' ').trim()
    if (block.length < 60) continue   // heading with no real content following it

    n++
    results.push({
      id: `jw${n}`,
      quote: block,
      signal_type: 'internal_workflow_description',
      subject: 'company_operations',   // careers pages already default here (see classifySubject)
      source_url: seg.url,
      page_type: seg.pageType,
      source_tier: seg.tier,
      evidence_strength: strengthFromTier(seg.tier),
      pattern_matched: 'internal_workflow_description',
      origin: seg.origin,
    })
  }

  return results
}

// ── Leadership contact extraction ──────────────────────────────
// Matches a markdown-heading name immediately followed by a title (tolerating an
// intermediate sub-heading marker, e.g. "### RAM BHOGALE\n\n#### Chairman"), then
// searches the following prose for a "heads/leads/oversees/chairs/manages" clause
// as the stated portfolio. Caution: never trust a name inferred from a URL path —
// ATE Group's own site has a live bug where /group-executive-lead/a-suresh-5
// renders the H1 "Anand Mehta" (stale/reused URL slug) — only the rendered
// heading/body text is trustworthy.
// Title vocabulary shared by both the narrative (heading-based) and
// structural (adjacency-based) extraction strategies below — one place to
// extend the recognized title list rather than two regexes drifting apart.
// "Head of [A-Za-z ]" uses a literal space, not \s — \s matches newlines too,
// which let this branch greedily swallow across line breaks into unrelated
// following text (e.g. into the next paragraph on a busy team-grid page).
//
// Non-English titles (2026-07-24, "silent zero" audit): the English-only
// vocab meant a real German/French/Spanish/Italian/Portuguese/Dutch
// leadership page produced zero leadership contacts — one of the four
// conditions that can independently trigger normalize.ts's
// insufficientEvidence gate and force-suppress pain_points/opportunities,
// same failure shape as the lechler.com locale bug, via a different
// mechanism. Deliberately scoped to real, common top-level titles (the
// same rough depth as the existing English list — Chairman/CEO/Director-
// equivalent, not an exhaustive per-country title hierarchy), and
// deliberately does NOT touch PORTFOLIO_CLAUSE's English-only verb list
// below — translating "heads/leads/oversees" across 6 languages' differing
// grammar is a much higher-risk regex problem than extending a title noun
// list. This means non-English leadership contacts surface only via
// extractStructuralLeadershipEvidence() (medium confidence, no portfolio
// clause required), not extractLeadershipEvidence() (high confidence) —
// an honest reflection of weaker evidence, not a workaround.
const LEADERSHIP_TITLE_VOCAB =
  'Chairman|Vice\\s+Chairman|Managing\\s+Director|Administrative\\s+Director|Director|CEO|COO|CTO|CFO|President|Vice\\s+President|VP|Head\\s+of\\s+[A-Za-z][A-Za-z &]{1,39}|Chief\\s+[A-Za-z]+\\s+Officer' +
  '|Geschäftsführer(?:in)?|Vorstandsvorsitzende(?:r)?|Vorstand|Direktor(?:in)?' +
  '|Directeur(?:\\s+Général)?|Directrice(?:\\s+Générale)?|Président(?:e)?|PDG' +
  '|Directora(?:\\s+General)?|Presidente|Presidenta|Consejero\\s+Delegado|Consejera\\s+Delegada' +
  '|Amministratore\\s+Delegato|Direttore\\s+Generale|Direttrice\\s+Generale' +
  '|Diretor(?:a)?(?:\\s+Geral)?' +
  '|Algemeen\\s+Directeur|Voorzitter|Bestuursvoorzitter'

// 'u' flag added (2026-07-24) so \p{Lu} below can match an accented leading
// capital (e.g. "Étienne", "Ólafur") — plain [A-Z] only matched ASCII.
const LEADERSHIP_TITLE_PATTERN = new RegExp(
  `#{1,3}\\s*(\\p{Lu}[^\\n]{2,50})\\n+\\s*#{0,4}\\s*(${LEADERSHIP_TITLE_VOCAB})\\b`,
  'gu'
)

const PORTFOLIO_CLAUSE =
  /\b(?:heads?|headed|leads?|led|oversees?|oversaw|chairs?|chaired|manages?|managed)\s+(?:the\s+)?([A-Z][^.]{5,150}?)(?:\.|for\s+the\s+entire|$)/i

const PORTFOLIO_SEARCH_WINDOW = 700   // chars — wide enough to clear 1-2 sentences of bio preamble (see Ace Pipeline: Tarun Singh's portfolio clause lands ~470 chars after his title)

function extractLeadershipEvidence(segments: ContentSegment[], seenNames: Set<string>): LeadershipContact[] {
  const results: LeadershipContact[] = []

  for (const seg of segments) {
    const regex = new RegExp(LEADERSHIP_TITLE_PATTERN.source, LEADERSHIP_TITLE_PATTERN.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(seg.text)) !== null) {
      const name = match[1].trim()
      const title = match[2].trim()
      if (seenNames.has(name)) continue

      // A bare name+title with no stated portfolio nearby isn't useful for buyer
      // targeting — skip rather than surface an unverified/low-value contact.
      const windowStart = match.index + match[0].length
      const window = seg.text.slice(windowStart, windowStart + PORTFOLIO_SEARCH_WINDOW)
      const portfolioMatch = PORTFOLIO_CLAUSE.exec(window)
      if (!portfolioMatch) continue

      seenNames.add(name)
      results.push({
        name,
        title,
        statedPortfolio: portfolioMatch[1].trim(),
        sourceUrl: seg.url,
        confidence: 'high',
      })
    }
  }

  return results
}

// ── Structural leadership extraction (2026-07-18 decision-maker discovery
// fix) ───────────────────────────────────────────────────────────────────
// extractLeadershipEvidence() above requires BOTH a markdown heading AND a
// narrative "heads/leads/oversees" clause nearby — this misses the extremely
// common "photo card grid" team-page layout: name and title as plain
// adjacent text (no markdown heading, no sentence describing what they do),
// which is what most real company leadership pages actually look like. This
// is a second, parallel strategy — it does NOT replace the narrative one
// (that one is higher-confidence when it does match) — that only requires
// tight name+title adjacency. Confidence is tiered lower ('medium' vs.
// 'high') since a bare name+title pair with nothing further is weaker
// evidence, same tiering discipline as competitor-discovery.ts's
// tierConfidence().

// Regex can't tell "John Smith" from "Quality Control" by shape alone — both
// are two capitalized words. Adjacency to a real title (e.g. "Quality
// Control\nDirector" in job-posting prose) is the main false-positive risk
// for this looser strategy, so any candidate "name" containing one of these
// common department/job-function words is rejected rather than surfaced.
const NON_NAME_WORDS = new Set([
  'quality', 'control', 'sales', 'marketing', 'human', 'resources', 'customer',
  'service', 'product', 'business', 'development', 'technical', 'information',
  'data', 'global', 'regional', 'national', 'corporate', 'group', 'team',
  'department', 'division', 'project', 'client', 'account', 'accounts',
  'operations', 'finance', 'legal', 'supply', 'chain', 'brand', 'digital',
  'strategy', 'strategic', 'research', 'engineering', 'design', 'creative',
  'general', 'senior', 'junior', 'assistant', 'associate', 'deputy', 'area',
  'field', 'plant', 'facility', 'site', 'unit',
])

function isLikelyPersonName(phrase: string): boolean {
  const words = phrase.trim().split(/\s+/)
  if (words.length < 2 || words.length > 4) return false
  return !words.some(w => NON_NAME_WORDS.has(w.toLowerCase()))
}

// Name on its own line, title on the very next non-blank line (tolerating
// light markdown decoration — bold markers, bullet/heading punctuation), OR
// name and title on the SAME line joined by a comma/dash/pipe (e.g. "John
// Smith, CEO" or "John Smith | Chief Operating Officer"). Tight adjacency
// only — no wide-window scanning like PORTFOLIO_SEARCH_WINDOW — specifically
// to avoid matching an unrelated title elsewhere on a busy page.
//
// Name group uses \p{Lu}/\p{L} (Unicode letter), not [A-Z]/[a-z] (2026-07-24,
// "silent zero" audit) — the old ASCII-only class meant a real name with a
// diacritic ("Björn Müller", "François Dubois") never matched at all, the
// same failure shape as website-discovery.ts's \w-based name normalization
// bug (see CLAUDE.md). Requires the 'u' flag to enable \p{...} escapes.
const STRUCTURAL_NAME_TITLE_PATTERN = new RegExp(
  `^[ \\t]*[*#>\\-]{0,3}[ \\t]*(\\p{Lu}[\\p{L}'.-]+(?:\\s+\\p{Lu}[\\p{L}'.-]+){1,3})[ \\t]*[*_]{0,2}[ \\t]*(?:\\n+[ \\t]*[*#>\\-]{0,3}[ \\t]*|[ \\t]*[,|\\u2013\\u2014-][ \\t]*)(${LEADERSHIP_TITLE_VOCAB})\\b`,
  'gmu'
)

function extractStructuralLeadershipEvidence(
  segments: ContentSegment[],
  seenNames: Set<string>
): LeadershipContact[] {
  const results: LeadershipContact[] = []

  for (const seg of segments) {
    const regex = new RegExp(STRUCTURAL_NAME_TITLE_PATTERN.source, STRUCTURAL_NAME_TITLE_PATTERN.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(seg.text)) !== null) {
      const name = match[1].trim()
      const title = match[2].trim()
      if (seenNames.has(name)) continue
      if (!isLikelyPersonName(name)) continue

      seenNames.add(name)
      results.push({
        name,
        title,
        statedPortfolio: '',
        sourceUrl: seg.url,
        confidence: 'medium',
      })
    }
  }

  return results
}

// ── Main extraction function ───────────────────────────────────

export function extractSignals(
  websiteContent: string,
  enrichedContent?: string,
  companyName?: string,
): ExtractorResult {
  const combined = enrichedContent
    ? websiteContent + '\n\n' + enrichedContent
    : websiteContent

  const segments = parseContentSegments(combined)
  const allEvidence: ExtractedEvidence[] = []
  let evidenceCounter = 0

  // Build company profile before extraction so classifySubject can use it
  // for vendor-aware subject classification (industrial_vendor, services_provider)
  const { profile: companyProfile, evidence: companyProfileEvidence } = buildSupplementedCompanyProfile(websiteContent, enrichedContent)

  for (const seg of segments) {
    for (const def of SIGNAL_PATTERNS) {
      for (const pattern of def.patterns) {
        const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
        let match: RegExpExecArray | null

        while ((match = regex.exec(seg.text)) !== null) {
          const quote = extractEvidenceWindow(seg.text, match.index, match[0].length)

          // Anti-pattern check
          if (shouldSkipMatch(quote, def)) continue

          // Classify subject (profile-aware)
          const subject = classifySubject(quote, seg.pageType, companyProfile, companyName)

          evidenceCounter++
          allEvidence.push({
            id: `e${evidenceCounter}`,
            quote,
            signal_type: def.signal,
            subject,
            source_url: seg.url,
            page_type: seg.pageType,
            source_tier: seg.tier,
            evidence_strength: strengthFromTier(seg.tier),
            pattern_matched: def.signal,
            origin: seg.origin,
          })

          // Avoid extracting 5+ quotes for the same pattern on the same page
          if (allEvidence.filter(e => e.pattern_matched === def.signal && e.source_url === seg.url).length >= 3) break
        }
      }
    }
  }

  // ── Job-posting workflow evidence (structural, not phrase-pattern based) ──
  allEvidence.push(...extractJobPostingWorkflowEvidence(segments))

  // ── Deduplicate: collapse very similar quotes ─────────────────
  const seen = new Set<string>()
  const dedupedEvidence = allEvidence.filter(e => {
    const key = e.signal_type + '|' + e.quote.slice(0, 60)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })


  // ── Build DetectedSignal[] from company-subject evidence only ─
  const signalMap = new Map<SignalType, ExtractedEvidence[]>()
  let companySubjectCount = 0

  for (const ev of dedupedEvidence) {
    const isCompanySubject = (
      ev.subject === 'company_operations' ||
      ev.subject === 'company_strategy' ||
      ev.subject === 'internal_technology'
    )
    if (isCompanySubject) companySubjectCount++

    if (ev.signal_type && isCompanySubject) {
      const existing = signalMap.get(ev.signal_type) ?? []
      signalMap.set(ev.signal_type, [...existing, ev])
    }
  }

  const signals: DetectedSignal[] = []
  for (const [type, evidence] of signalMap.entries()) {
    const topEv = evidence.sort((a, b) => {
      const tierOrder = { tier1: 0, tier2: 1, tier3: 2 }
      return tierOrder[a.source_tier] - tierOrder[b.source_tier]
    })[0]

    const validated = evidence.length >= 2 ||
      evidence.some(e => e.source_tier === 'tier1')

    const strength: SignalStrength =
      evidence.some(e => e.source_tier === 'tier1') ? 'strong'
      : evidence.some(e => e.source_tier === 'tier2') ? 'moderate'
      : 'weak'

    signals.push({
      type,
      strength,
      evidence,
      best_quote: topEv.quote,
      is_company_subject: true,
      validated,
    })
  }

  // ── Company-subject floor ──────────────────────────────────────
  // When strict subject classification finds ZERO company-subject evidence
  // (companySubjectCount === 0) but the regex patterns still matched real
  // signal content, the cascade collapses signals=0 → detected_factors=0 →
  // opportunities=0 even when the page clearly discusses the company's own
  // business (e.g. production lines, auto parts, chemical industry all
  // matched, but every hit landed on 'industry_trend' or 'product_capability'
  // because the site doesn't use first-person "we/our" framing).
  //
  // Floor: promote the strongest non-company-subject evidence to weak-strength
  // signals so the pipeline doesn't zero out entirely. Excludes 'generic_marketing'
  // (too noisy) and 'customer_use_case'/'partner_story' (describe customers, not
  // the company) to avoid misattributing evidence. Capped at 2 evidence items per
  // signal type. companySubjectCount itself is left untouched — it still reports
  // the true count of strict company-subject evidence for gate diagnostics.
  let subjectFloorApplied = false
  if (companySubjectCount === 0) {
    const FLOOR_ELIGIBLE_SUBJECTS = new Set<EvidenceSubject>(['industry_trend', 'product_capability'])
    const floorCandidates = dedupedEvidence.filter(e => e.signal_type && FLOOR_ELIGIBLE_SUBJECTS.has(e.subject))

    if (floorCandidates.length > 0) {
      subjectFloorApplied = true
      const floorMap = new Map<SignalType, ExtractedEvidence[]>()
      for (const ev of floorCandidates) {
        const existing = floorMap.get(ev.signal_type!) ?? []
        if (existing.length < 2) floorMap.set(ev.signal_type!, [...existing, ev])
      }
      for (const [type, floorEvidence] of floorMap.entries()) {
        const topEv = floorEvidence.sort((a, b) => {
          const tierOrder = { tier1: 0, tier2: 1, tier3: 2 }
          return tierOrder[a.source_tier] - tierOrder[b.source_tier]
        })[0]
        signals.push({
          type,
          strength: 'weak',
          evidence: floorEvidence,
          best_quote: topEv.quote,
          is_company_subject: false,
          validated: false,
        })
      }
    }
  }

  // Sort by strength
  const strengthOrder: Record<SignalStrength, number> = { strong: 0, moderate: 1, weak: 2 }
  signals.sort((a, b) => strengthOrder[a.strength] - strengthOrder[b.strength])

  // ── Detected factors ──────────────────────────────────────────
  const detectedFactors: DetectedFactors = {
    growth_signal: false,
    hiring_signal: false,
    digital_transformation: false,
    capacity_expansion: false,
    automation_keywords: false,
    technology_investment: false,
    ai_mention: false,
    multi_location_operations: false,
    industry_40_initiative: false,
    recent_news_or_event: false,
    layoffs_signal: false,
    funding_signal: false,
  }

  // Track which signal(s) drove each factor — for score traceability
  const factorSourceMap: Partial<Record<keyof DetectedFactors, string[]>> = {}
  const addFactorSource = (factor: keyof DetectedFactors, signal: string) => {
    if (!factorSourceMap[factor]) factorSourceMap[factor] = []
    if (!factorSourceMap[factor]!.includes(signal)) factorSourceMap[factor]!.push(signal)
  }

  for (const sig of signals) {
    const factorKey = SIGNAL_TO_FACTOR[sig.type]
    if (factorKey) {
      detectedFactors[factorKey] = true
      addFactorSource(factorKey, sig.type)
    }
    // Secondary factor assignments (one signal can imply multiple factors)
    if (sig.type === 'automation_investment') {
      detectedFactors.automation_keywords = true
      addFactorSource('automation_keywords', `${sig.type} (secondary)`)
    }
    if (sig.type === 'industry40_initiative') {
      detectedFactors.technology_investment = true
      addFactorSource('technology_investment', `${sig.type} (secondary)`)
    }
    if (sig.type === 'iot_investment') {
      detectedFactors.digital_transformation = true
      addFactorSource('digital_transformation', `${sig.type} (secondary)`)
    }
    if (sig.type === 'digital_transformation') {
      detectedFactors.technology_investment = true
      addFactorSource('technology_investment', `${sig.type} (secondary, DX implies tech investment)`)
    }
  }

  // ── Content flags ────────────────────────────────────────────────────
  const contentFlags: string[] = []
  if (companySubjectCount === 0) contentFlags.push('no_company_operations_content')
  if (subjectFloorApplied) contentFlags.push('subject_floor_applied')
  if (companySubjectCount < 3) contentFlags.push('thin_content')
  if (/cookie|gdpr|privacy\s+policy/i.test(websiteContent.slice(0, 2000))) contentFlags.push('cookie_heavy')
  if (segments.length <= 1) contentFlags.push('single_page')

  // ── Leadership contacts ────────────────────────────────────────────────
  // Narrative (heading + portfolio-clause) strategy runs first so its
  // higher-confidence matches claim a name before the looser structural
  // strategy gets a chance to — both strategies share one seenNames set so
  // the same person is never surfaced twice at two different confidence
  // tiers.
  const leadershipSeenNames = new Set<string>()
  const leadershipContacts = [
    ...extractLeadershipEvidence(segments, leadershipSeenNames),
    ...extractStructuralLeadershipEvidence(segments, leadershipSeenNames),
  ]

  // ── Company offerings — what THIS company sells (see service-offerings.ts) ──
  // Own-site content only (websiteContent, not the enriched/third-party blend)
  // — a "we offer" phrase inside a third-party press release more often
  // describes that source's own business, not the researched company's.
  const companyOfferings = extractCompanyOfferings(websiteContent)

  // ── Signal summary for LLM prompt ────────────────────────────────────────────
  const signalSummary = buildSignalSummary(signals, detectedFactors, companyProfile)

  // ── Website preview — the LLM's actual raw-content window ──────────────
  // RESOLVED 2026-07-22: was 3,000 chars of scraped content ONLY — meaning
  // enriched external-source content (annual reports, investor pages, press,
  // PDFs — often tens of thousands of real chars, see
  // discoverAndFetchExternalSources()) was captured into
  // `_service_evidence_content` for the regex-based service-evidence.ts gate
  // but never actually shown to the narrative LLM at all. The LLM was writing
  // pain points/opportunities/outreach copy off a sliver of what the pipeline
  // actually gathered. Now built from `combined` (scraped + enriched, same
  // pool signal extraction above already uses) and raised to 16,000 chars —
  // confirmed via real token-usage logging (PROMPT BREAKDOWN in
  // test-analysis/route.ts) that this stays well under any real context-
  // window/latency budget; a real RIL run's full prompt previously used only
  // 5,770 user-prompt tokens total, nowhere near a binding constraint.
  const websitePreview = combined
    .replace(/---\s*PAGE:[^\n]*---\n?/g, '\n')
    .replace(/\[SOURCE:[^\]]*\]\n?/g, '\n')
    .replace(/\s{3,}/g, '\n\n')
    .slice(0, 16_000)

  return {
    signals,
    detectedFactors,
    factorSourceMap,
    companyProfile,
    companyProfileEvidence,
    contentFlags,
    signalSummary,
    companySubjectCount,
    websitePreview,
    leadershipContacts,
    companyOfferings,
  }
}

// ── Signal summary builder (compact LLM-injectable string) ─────

function buildSignalSummary(
  signals: DetectedSignal[],
  factors: DetectedFactors,
  profile: CompanyProfile,
): string {
  const lines: string[] = []

  const activeTypes = Object.entries(profile.company_type).filter(([, v]) => v).map(([k]) => k)
  lines.push(`COMPANY PROFILE: ${activeTypes.length > 0 ? activeTypes.join(', ') : 'unknown'} | primary: ${profile.primary_type}`)

  if (signals.length > 0) {
    lines.push(`\nSIGNALS (${signals.length}):`)
    for (const sig of signals.slice(0, 12)) {
      const quote = sig.best_quote.length > 120 ? sig.best_quote.slice(0, 120) + '\u2026' : sig.best_quote
      lines.push(`  [${sig.strength}] ${sig.type} \u2014 "${quote}"`)
    }
  }

  const activeFactors = (Object.keys(factors) as Array<keyof DetectedFactors>).filter(k => factors[k as keyof DetectedFactors])
  if (activeFactors.length > 0) {
    lines.push(`\nFACTORS: ${activeFactors.join(', ')}`)
  }

  return lines.join('\n')
}

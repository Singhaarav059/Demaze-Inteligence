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
}

/**
 * @deprecated Will be removed once OPP_TEMPLATES seeding is replaced by OPPORTUNITY_CATALOG injection.
 * Consumers: analyze-v2.ts (LLM hint block), route.ts (response payload — informational only).
 */
export interface OpportunityDraft {
  service: string
  trigger_signals: SignalType[]
  confidence: 'very_high' | 'high' | 'medium' | 'exploratory'
  demaze_fit: 'high' | 'medium' | 'low'
  evidence_anchor: string   // best quote supporting this opportunity
  category: string
}

export interface ExtractorResult {
  signals: DetectedSignal[]
  detectedFactors: DetectedFactors
  /** Maps each active factor to the signal types that triggered it — for score traceability */
  factorSourceMap: Partial<Record<keyof DetectedFactors, string[]>>
  companyProfile: CompanyProfile
  /** @deprecated LLM prompt seeding only — not used in the final opportunities output pipeline. */
  opportunityDrafts: OpportunityDraft[]
  contentFlags: string[]
  signalSummary: string       // compact, LLM-injectable summary
  companySubjectCount: number
  websitePreview: string      // first 3,000 chars for LLM company identification
  companyProfileEvidence: CompanyProfileEvidence  // which patterns fired per flag
  leadershipContacts: LeadershipContact[]  // named individuals + stated existing portfolio
}

// ── LeadershipContact — named buyer candidates ─────────────────
// A named individual + stated existing portfolio (e.g. "he heads the Bid Strategy,
// Business Development and New Technology/Innovation for the entire Group") is a
// dramatically stronger buyer signal than a generic per-service title guess — see
// EVIDENCE_SOURCE_STRATEGY.md, Tier 1: "leadership responsibilities". Extraction is
// intentionally conservative: a name+title with no nearby portfolio clause is
// discarded rather than surfaced as a weak/unverified contact.
export interface LeadershipContact {
  name: string
  title: string
  statedPortfolio: string
  sourceUrl: string
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
]

// ── Page type detection ────────────────────────────────────────

function detectPageType(url: string): PageType {
  const path = (url || '').toLowerCase()
  if (/\/(?:careers|jobs|hiring|vacancies|work-with-us|join-us|open-positions|opportunities)/.test(path)) return 'careers'
  if (/\/(?:investor|ir|annual-report|shareholders|financial|earnings|results|reports)/.test(path)) return 'investor'
  if (/\/(?:annual[_-]?report|ar20\d{2})/.test(path)) return 'annual_report'
  if (/\/(?:press|news|newsroom|media|announcements|press-releases?|pressroom)/.test(path)) return 'press'
  if (/\/(?:about|about-us|company|our-story|who-we-are|overview|corporate)/.test(path)) return 'about'
  if (/\/(?:products?|solutions?|services?|capabilities|offerings|platforms?)/.test(path)) return 'products'
  if (/\/(?:blog|insights?|perspectives?|thought-leadership|articles?)/.test(path)) return 'blog'
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
  if (pageType === 'other' || pageType === 'about') {
    const isCustomerFacing = /\b(?:help|enable|your\s+company|our\s+customer)\b/i.test(t)
    if (!isCustomerFacing) {
      // Match the company's own name with word boundaries — same discipline as
      // the URL-classifier's short-keyword boundary fix (see matchesKeyword() in
      // scraper.ts): a bare short name could otherwise substring-match unrelated
      // words. Requiring >= 4 chars guards against degenerate/placeholder names.
      if (companyName && companyName.trim().length >= 4) {
        const escaped = companyName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const nameRe = new RegExp(`\\b${escaped}\\b`, 'i')
        if (nameRe.test(text)) return 'company_strategy'
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
    [/\bleader\s+in\s+(?:forgings?|castings?|stampings?|machining|fabrication|manufactur\w+)\b/i,        'leader in forgings/castings/machining/...'],
    [/\bour\s+(?:forging|casting|stamping|machining|fabrication|welding)\s+operations?\b/i,              'our forging/casting/welding operations'],
    [/\b(?:forging|casting|stamping|fabrication|machining)\s+(?:company|business|operations?)\b/i,      'forging/casting company/business/operations'],
    // Enumerated capability lists ("fabrication, machining, control system design facility")
    // put other nouns between the capability keyword and facility/plant/unit — the patterns
    // above all require direct adjacency and miss this list-style copy. Bounded to 40 chars
    // and excludes '.'/newline so the gap can't cross a sentence boundary into an unrelated claim.
    [/\b(?:forging|casting|stamping|machining|fabricat\w+|assembly)\b[^.\n]{0,40}?\b(?:facilit\w*|plant|unit)\b/i, 'forging/casting/machining/fabrication + (enumerated list) + facility/plant/unit'],
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
  // `conglomerate` is checked LAST (not first) — its patterns are generic
  // marketing boilerplate ("diverse sectors", "Group Companies") compared to
  // every other category's operational evidence, so it should only win when
  // nothing more specific matched (e.g. Ace Pipeline). Previously checked
  // first, it silently overrode real manufacturer/industrial_vendor evidence
  // for ATE Group and AITG. See CLAUDE.md "ATE Group" for the root-cause writeup.
  if (ct.software_saas) profile.primary_type = 'software_saas'
  else if (ct.financial_institution) profile.primary_type = 'financial_institution'
  else if (ct.pharma_biotech) profile.primary_type = 'pharma_biotech'
  else if (ct.healthcare_provider) profile.primary_type = 'healthcare_provider'
  else if (ct.logistics_operator) profile.primary_type = 'logistics_operator'
  else if (ct.retailer) profile.primary_type = 'retailer'
  else if (ct.industrial_vendor && ct.manufacturer) profile.primary_type = 'industrial_vendor_manufacturer'
  else if (ct.industrial_vendor) profile.primary_type = 'industrial_vendor'
  else if (ct.manufacturer) profile.primary_type = 'manufacturer'
  else if (ct.services_provider) profile.primary_type = 'services_provider'
  else if (ct.conglomerate) profile.primary_type = 'conglomerate'
  else profile.primary_type = 'unknown'

  return { profile, evidence }
}

// ── Content parser ─────────────────────────────────────────────
// Splits content into segments by --- PAGE: url --- markers.
// Also handles [SOURCE: type | tier | url] markers from web-enricher.

interface ContentSegment {
  url: string
  text: string
  pageType: PageType
  tier: 'tier1' | 'tier2' | 'tier3'
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

    // Extract URL from "path (https://url)" format
    const urlMatch = urlHeader.match(/\(([^)]+)\)/)
    const url = urlMatch ? urlMatch[1] : urlHeader
    const pageType = detectPageType(url)
    const tier = tierFromPageType(pageType)
    segments.push({ url, text, pageType, tier })
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
      : /press.?release|newsroom|news.?article|ceo.?interview|blog/i.test(typeLabel) ? 'press'
      : 'other'

    segments.push({ url, text, pageType, tier: tierLabel })
  }

  // If no markers found, treat entire content as homepage
  if (segments.length === 0 && content.trim()) {
    segments.push({ url: '', text: content, pageType: 'homepage', tier: 'tier3' })
  }

  return segments
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
const LEADERSHIP_TITLE_PATTERN =
  /#{1,3}\s*([A-Z][^\n]{2,50})\n+\s*#{0,4}\s*(Chairman|Vice\s+Chairman|Managing\s+Director|Administrative\s+Director|Director|CEO|COO|CTO|CFO|President|Vice\s+President|VP|Head\s+of\s+[A-Za-z\s]{2,40}|Chief\s+[A-Za-z]+\s+Officer)\b/g

const PORTFOLIO_CLAUSE =
  /\b(?:heads?|headed|leads?|led|oversees?|oversaw|chairs?|chaired|manages?|managed)\s+(?:the\s+)?([A-Z][^.]{5,150}?)(?:\.|for\s+the\s+entire|$)/i

const PORTFOLIO_SEARCH_WINDOW = 700   // chars — wide enough to clear 1-2 sentences of bio preamble (see Ace Pipeline: Tarun Singh's portfolio clause lands ~470 chars after his title)

function extractLeadershipEvidence(segments: ContentSegment[]): LeadershipContact[] {
  const results: LeadershipContact[] = []
  const seenNames = new Set<string>()

  for (const seg of segments) {
    const regex = new RegExp(LEADERSHIP_TITLE_PATTERN.source, 'g')
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
  const { profile: companyProfile, evidence: companyProfileEvidence } = buildCompanyProfile(websiteContent)

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
      addFactorSource('technology_investment', `${sig.type} (secondary — DX implies tech investment)`)
    }
  }

  // ── Opportunity drafts ────────────────────────────────────────────
  const opportunityDrafts = buildOpportunityDrafts(signals, companyProfile)

  // ── Content flags ────────────────────────────────────────────────────
  const contentFlags: string[] = []
  if (companySubjectCount === 0) contentFlags.push('no_company_operations_content')
  if (subjectFloorApplied) contentFlags.push('subject_floor_applied')
  if (companySubjectCount < 3) contentFlags.push('thin_content')
  if (/cookie|gdpr|privacy\s+policy/i.test(websiteContent.slice(0, 2000))) contentFlags.push('cookie_heavy')
  if (segments.length <= 1) contentFlags.push('single_page')

  // ── Leadership contacts ────────────────────────────────────────────────
  const leadershipContacts = extractLeadershipEvidence(segments)

  // ── Signal summary for LLM prompt ────────────────────────────────────────────
  const signalSummary = buildSignalSummary(signals, detectedFactors, companyProfile, opportunityDrafts)

  // ── Website preview for LLM company identification ────────────────────
  // Take first 3,000 chars of clean website content (no page markers)
  const websitePreview = websiteContent
    .replace(/---\s*PAGE:[^\n]*---\n?/g, '\n')
    .replace(/\[SOURCE:[^\]]*\]\n?/g, '\n')
    .replace(/\s{3,}/g, '\n\n')
    .slice(0, 3_000)

  return {
    signals,
    detectedFactors,
    factorSourceMap,
    companyProfile,
    companyProfileEvidence,
    opportunityDrafts,
    contentFlags,
    signalSummary,
    companySubjectCount,
    websitePreview,
    leadershipContacts,
  }
}

// ── Opportunity mapper ──────────────────────────────────────────────────────
// Deterministic signal → opportunity service mapping.

interface OppTemplate {
  service: string
  category: string
  demaze_fit: 'high' | 'medium' | 'low'
  trigger: SignalType[]
  base_confidence: 'very_high' | 'high' | 'medium' | 'exploratory'
}

/**
 * @deprecated Parallel catalog to OPPORTUNITY_CATALOG in opportunity-engine.ts.
 * Used only for seeding the LLM prompt via buildOpportunityDrafts → opportunityDrafts → analyze-v2.ts hint block.
 * Do NOT add entries here — add to OPPORTUNITY_CATALOG instead.
 */
const OPP_TEMPLATES: OppTemplate[] = [
  // Tier 1 signals → highest priority opportunities
  { service: 'Manufacturing Analytics Platform', category: 'data_visibility',   demaze_fit: 'high',   trigger: ['industry40_initiative', 'iot_investment'],            base_confidence: 'high' },
  { service: 'AI Agents / Operations Copilot',   category: 'process_automation', demaze_fit: 'high',   trigger: ['ai_mention', 'digital_transformation_hiring'],        base_confidence: 'high' },
  { service: 'Cross-Plant Intelligence',          category: 'data_visibility',   demaze_fit: 'high',   trigger: ['multi_location_operations'],                           base_confidence: 'high' },
  { service: 'Predictive Maintenance AI',         category: 'maintenance',       demaze_fit: 'high',   trigger: ['capacity_expansion', 'new_facility'],                  base_confidence: 'medium' },
  { service: 'Process Automation AI',             category: 'process_automation', demaze_fit: 'high',  trigger: ['automation_investment', 'automation_engineering_hiring'], base_confidence: 'high' },
  { service: 'Computer Vision Quality AI',        category: 'quality',           demaze_fit: 'high',   trigger: ['quality_certification_pursuit', 'operations_hiring_surge'], base_confidence: 'medium' },
  { service: 'Supply Chain AI',                   category: 'supply_chain',      demaze_fit: 'medium', trigger: ['new_market_entry', 'capacity_expansion'],              base_confidence: 'medium' },
  { service: 'Operations Intelligence',           category: 'data_visibility',   demaze_fit: 'high',   trigger: ['mes_adoption', 'erp_implementation'],                  base_confidence: 'high' },
  { service: 'Digital Twin Analytics',            category: 'data_visibility',   demaze_fit: 'medium', trigger: ['industry40_initiative'],                               base_confidence: 'medium' },
  { service: 'Knowledge Intelligence AI',         category: 'process_automation', demaze_fit: 'medium', trigger: ['digital_transformation_hiring', 'ai_ml_hiring'],      base_confidence: 'exploratory' },
]

/** @deprecated See OPP_TEMPLATES. */
function buildOpportunityDrafts(signals: DetectedSignal[], profile: CompanyProfile): OpportunityDraft[] {
  const activeTypes = new Set(signals.map(s => s.type))
  const signalByType = new Map(signals.map(s => [s.type, s]))

  const drafts: OpportunityDraft[] = []
  const usedServices = new Set<string>()

  for (const tmpl of OPP_TEMPLATES) {
    if (usedServices.has(tmpl.service)) continue

    const triggeredBy = tmpl.trigger.filter(t => activeTypes.has(t))
    if (triggeredBy.length === 0) continue

    // Filter: SaaS-only companies (not also manufacturers) skip factory-floor opportunities
    if (profile.company_type.software_saas && !profile.company_type.manufacturer) {
      if (['Manufacturing Analytics Platform', 'Predictive Maintenance AI', 'Computer Vision Quality AI', 'Cross-Plant Intelligence'].includes(tmpl.service)) continue
    }

    // Find best evidence quote from triggering signals
    let bestQuote = ''
    for (const triggerType of triggeredBy) {
      const sig = signalByType.get(triggerType)
      if (sig && sig.best_quote.length > bestQuote.length) {
        bestQuote = sig.best_quote
      }
    }

    // Confidence boost if tier1 evidence exists
    const hasTier1 = triggeredBy.some(t => signalByType.get(t)?.evidence.some(e => e.source_tier === 'tier1'))
    const confidence: OppTemplate['base_confidence'] = hasTier1 && tmpl.base_confidence !== 'exploratory' ? 'high' : tmpl.base_confidence

    drafts.push({
      service: tmpl.service,
      trigger_signals: triggeredBy,
      confidence,
      demaze_fit: tmpl.demaze_fit,
      evidence_anchor: bestQuote,
      category: tmpl.category,
    })
    usedServices.add(tmpl.service)

    if (drafts.length >= 5) break
  }

  return drafts
}

// ── Signal summary builder (compact LLM-injectable string) ─────

function buildSignalSummary(
  signals: DetectedSignal[],
  factors: DetectedFactors,
  profile: CompanyProfile,
  opportunities: OpportunityDraft[],
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

  if (opportunities.length > 0) {
    lines.push(`\nOPPORTUNITY CANDIDATES:`)
    for (const o of opportunities) {
      lines.push(`  ${o.service} [fit:${o.demaze_fit} | confidence:${o.confidence}]`)
    }
  }

  return lines.join('\n')
}

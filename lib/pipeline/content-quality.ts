// ============================================================
// Content Quality Analyzer
// ============================================================
// Runs on raw scraped text BEFORE the LLM call.
// Detects low-quality content (cookie banners, nav-only, boilerplate)
// so we can reduce confidence and warn the user early.
//
// Also exports the EVIDENCE_TIER_GUIDE used by both the system
// prompt and the normalizer for classifying evidence strength.
// ============================================================

export type ContentQualityFlag =
  | 'cookie_heavy'
  | 'navigation_only'
  | 'marketing_boilerplate'
  | 'customer_stories_only'
  | 'no_operational_content'

export type ContentQualityRecommendation = 'proceed' | 'proceed_with_caution' | 'low_confidence'

export interface ContentQualityResult {
  score: number                           // 0–100; lower = worse
  flags: ContentQualityFlag[]
  recommendation: ContentQualityRecommendation
  operational_content_ratio: number       // 0–1: fraction of lines that look substantive
  cookie_line_ratio: number               // 0–1: fraction of lines that are cookie/consent text
  summary: string
}

// ── Detection patterns ─────────────────────────────────────────

const COOKIE_PATTERNS = [
  /\bcookies?\b/i,
  /\bconsent\b/i,
  /\bprivacy\s+policy\b/i,
  /\baccept\s+cookies?\b/i,
  /\bperformance\s+cookies?\b/i,
  /\banalytics\s+cookies?\b/i,
  /\bfunctional\s+cookies?\b/i,
  /\bthird[- ]party\s+cookies?\b/i,
  /\bcookie\s+preferences?\b/i,
  /\bcookie\s+settings?\b/i,
  /\bgdpr\b/i,
  /\bccpa\b/i,
  /\bopting\s+out\b/i,
  /\bpersonal\s+data\b/i,
  /\bdata\s+protection\b/i,
]

const NAV_PATTERNS = [
  /^(home|about|contact|careers|news|blog|products?|services?|solutions?|resources?|support|login|sign\s*in|sign\s*up|get\s+started|learn\s+more|read\s+more|view\s+all|see\s+all|click\s+here)$/i,
  /^\s*(>|\||-|·|•|◦)\s*\w+\s*$/,  // nav separators
]

const BOILERPLATE_PATTERNS = [
  /all\s+rights\s+reserved/i,
  /copyright\s+©?\s*\d{4}/i,
  /terms\s+(of\s+)?(service|use)/i,
  /\bsitemap\b/i,
  /powered\s+by/i,
  /back\s+to\s+top/i,
  /skip\s+to\s+(main\s+)?content/i,
  /toggle\s+navigation/i,
  /\bclose\b.*\bmenu\b/i,
  /search\s+\.\.\.?$/i,
  /loading\.\.\./i,
]

// Lines with ≥ this many words are considered potentially substantive
const MIN_WORDS_FOR_SUBSTANTIVE = 8

// Keywords that indicate operational content
const OPERATIONAL_KEYWORDS = [
  /manufactur/i, /produc[ti]/i, /assembly/i, /plant/i, /facilit/i,
  /automat/i, /digital/i, /transform/i, /strateg/i, /invest/i,
  /employ/i, /expan[sd]/i, /acqui/i, /partner/i, /supply/i,
  /customer/i, /revenue/i, /market/i, /launch/i, /deploy/i,
  /implement/i, /operat/i, /engineer/i, /technolog/i, /innovat/i,
  /software/i, /platform/i, /solution/i, /service/i, /capabilit/i,
  /quality/i, /maintenance/i, /schedul/i, /forecast/i, /analytic/i,
]

// ── Main function ──────────────────────────────────────────────

export function assessContentQuality(rawContent: string): ContentQualityResult {
  const lines = rawContent
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)

  if (lines.length === 0) {
    return {
      score: 0,
      flags: ['no_operational_content'],
      recommendation: 'low_confidence',
      operational_content_ratio: 0,
      cookie_line_ratio: 0,
      summary: 'No content extracted from website.',
    }
  }

  let cookieLines = 0
  let navLines = 0
  let boilerplateLines = 0
  let substantiveLines = 0
  let operationalLines = 0

  for (const line of lines) {
    const wordCount = line.split(/\s+/).length

    // Check cookie patterns
    if (COOKIE_PATTERNS.some(p => p.test(line))) {
      cookieLines++
      continue
    }

    // Check boilerplate
    if (BOILERPLATE_PATTERNS.some(p => p.test(line))) {
      boilerplateLines++
      continue
    }

    // Check nav-only (short lines that match nav patterns)
    if (wordCount <= 4 && NAV_PATTERNS.some(p => p.test(line))) {
      navLines++
      continue
    }

    // Count substantive lines
    if (wordCount >= MIN_WORDS_FOR_SUBSTANTIVE) {
      substantiveLines++
      // Check if operationally relevant
      if (OPERATIONAL_KEYWORDS.some(p => p.test(line))) {
        operationalLines++
      }
    }
  }

  const total = lines.length
  const cookieRatio = cookieLines / total
  const navRatio = navLines / total
  const boilerplateRatio = boilerplateLines / total
  const substantiveRatio = substantiveLines / total
  const operationalRatio = operationalLines / total

  // ── Compute quality score ──────────────────────────────────
  // Start at 100, penalize for quality issues
  let score = 100

  if (cookieRatio > 0.10) score -= Math.min(40, cookieRatio * 200)
  if (navRatio > 0.20)    score -= Math.min(20, navRatio * 60)
  if (boilerplateRatio > 0.20) score -= Math.min(20, boilerplateRatio * 60)

  // Reward for operational content
  if (operationalRatio > 0.30) score += 10
  else if (operationalRatio < 0.10) score -= 20

  score = Math.max(0, Math.min(100, Math.round(score)))

  // ── Determine flags ────────────────────────────────────────
  const flags: ContentQualityFlag[] = []

  if (cookieRatio > 0.15) flags.push('cookie_heavy')
  if (navRatio > 0.40 && substantiveRatio < 0.20) flags.push('navigation_only')
  if (boilerplateRatio > 0.30 && substantiveRatio < 0.20) flags.push('marketing_boilerplate')
  if (operationalRatio < 0.05 && substantiveRatio > 0.15) flags.push('customer_stories_only')
  if (substantiveRatio < 0.10 && operationalLines === 0) flags.push('no_operational_content')

  // ── Recommendation ──────────────────────────────────────────
  let recommendation: ContentQualityRecommendation
  if (score >= 60 && flags.length === 0) {
    recommendation = 'proceed'
  } else if (score >= 35 || (flags.length <= 1 && !flags.includes('no_operational_content'))) {
    recommendation = 'proceed_with_caution'
  } else {
    recommendation = 'low_confidence'
  }

  // ── Summary ────────────────────────────────────────────────
  const parts: string[] = []
  if (cookieRatio > 0.15) parts.push(`${Math.round(cookieRatio * 100)}% cookie/consent text`)
  if (navRatio > 0.25)    parts.push(`${Math.round(navRatio * 100)}% navigation menus`)
  if (boilerplateRatio > 0.25) parts.push(`${Math.round(boilerplateRatio * 100)}% boilerplate`)
  if (substantiveLines < 5) parts.push('very few substantive paragraphs found')

  const summary = parts.length > 0
    ? `Content quality issues detected: ${parts.join('; ')}.`
    : `Content quality acceptable (${substantiveLines} substantive lines, ${Math.round(operationalRatio * 100)}% operationally relevant).`

  return {
    score,
    flags,
    recommendation,
    operational_content_ratio: operationalRatio,
    cookie_line_ratio: cookieRatio,
    summary,
  }
}

// ── Evidence Tier Definitions ──────────────────────────────────
// Used by both the system prompt and the normalizer.
// Tier 1 = highest trust (investor-grade, official)
// Tier 2 = secondary (published but less official)
// Tier 3 = lowest trust (marketing, generic copy)

export type EvidenceTier = 'tier1' | 'tier2' | 'tier3'

export const EVIDENCE_TIER_GUIDE = {
  tier1: {
    label: 'Tier 1 — Highest Trust',
    sources: [
      'annual_report', 'investor_presentation', 'earnings_call',
      'official_press_release', 'careers_page', 'leadership_statement',
      'regulatory_filing', 'investor_relations',
    ],
    weight: 1.0,
    description: 'Annual reports, investor presentations, press releases, careers pages, leadership statements',
  },
  tier2: {
    label: 'Tier 2 — Secondary',
    sources: [
      'official_blog', 'case_study', 'product_documentation',
      'about_page', 'company_history', 'news_section',
    ],
    weight: 0.65,
    description: 'Official blog, case studies, About page, product documentation',
  },
  tier3: {
    label: 'Tier 3 — Marketing',
    sources: [
      'homepage_marketing', 'generic_marketing', 'tagline',
      'mission_statement', 'generic_copy',
    ],
    weight: 0.30,
    description: 'Homepage marketing, taglines, generic value propositions',
  },
} as const

/**
 * Infer evidence tier from the source_page path.
 * The LLM provides this classification but we can also derive it
 * as a fallback from known page URL patterns.
 */
export function inferEvidenceTier(sourcePage: string): EvidenceTier {
  const p = (sourcePage ?? '').toLowerCase()

  // Tier 1 indicators
  if (/investor|annual.?report|earnings|press.?release|ir\/|careers?|jobs?|leadership|board|executive/.test(p)) {
    return 'tier1'
  }

  // Tier 2 indicators
  if (/blog|news|about|history|case.?stud|product|solution|documentation|docs\//.test(p)) {
    return 'tier2'
  }

  // Default: Tier 3 for homepage and generic pages
  return 'tier3'
}

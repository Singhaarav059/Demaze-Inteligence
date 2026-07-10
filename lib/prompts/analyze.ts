// ============================================================
// Demaze AI Outbound Intelligence Platform
// User Prompt Builder — v4
// ============================================================
// Builds the final user prompt sent to the AI model alongside
// the system prompt.
//
// v4 additions:
//   - enrichedContext: web enrichment signals injected pre-LLM
//   - contentQualityWarning: pre-LLM quality gate flag
//   - deterministicOpportunities: pre-computed opportunity list
// ============================================================

import { getSchemaPromptString } from './schema'

// Maximum characters of scraped content to include in the prompt.
// ~15,000 characters ≈ ~3,750 tokens — leaves room for the schema
// and system prompt within a 8k–16k context window.
const MAX_CONTENT_CHARS = 15_000

// DEPRECATED — no longer used by the scraper.
// The scraper now uses intelligent page discovery.
// Kept only for reference; not imported anywhere.
export const PAGES_TO_SCRAPE = [
  '/',
  '/about',
  '/about-us',
  '/company',
  '/products',
  '/services',
  '/solutions',
  '/capabilities',
  '/careers',
  '/jobs',
  '/news',
  '/press',
  '/newsroom',
]

// ── Input type for the prompt builder ───────────────────────

export interface PromptInput {
  domain: string              // e.g. "hartmannstamping.com"
  scrapedContent: string      // Concatenated page content from Firecrawl
  pagesAnalyzed: string[]     // URLs of pages successfully scraped
  analyzedAt: string          // ISO 8601 timestamp e.g. "2026-07-07T10:00:00.000Z"
  // Optional: v4 additions
  enrichedContext?: string    // Extra intelligence from web enrichment (Tavily/Serper)
  deterministicOpportunities?: string  // Pre-computed opportunity list for LLM to explain
  contentQualityWarning?: string       // Pre-LLM content quality flag
}

// ── Main export: builds the user prompt string ───────────────

export function buildAnalyzePrompt(input: PromptInput): string {
  const {
    domain,
    scrapedContent,
    pagesAnalyzed,
    analyzedAt,
    enrichedContext,
    deterministicOpportunities,
    contentQualityWarning,
  } = input

  // Truncate content if it exceeds the token budget.
  const truncatedContent = truncateAtWordBoundary(scrapedContent, MAX_CONTENT_CHARS)
  const wasTruncated = scrapedContent.length > MAX_CONTENT_CHARS

  const schemaBlock = getSchemaPromptString(deterministicOpportunities)

  return `
Analyze the following company website content and produce a complete intelligence report for Demaze Technologies' sales team.

[COMPANY DOMAIN]
${domain}

[PAGES ANALYZED]
${pagesAnalyzed.length > 0 ? pagesAnalyzed.join('\n') : 'Homepage only'}

[ANALYZED AT]
${analyzedAt}

[CONTENT NOTES]
${wasTruncated
    ? `Content was truncated to ${MAX_CONTENT_CHARS.toLocaleString()} characters due to length. Analyze what is provided.`
    : `Full content provided (${scrapedContent.length.toLocaleString()} characters).`
  }
Pages scraped: ${pagesAnalyzed.length}
${pagesAnalyzed.length <= 1
    ? 'WARNING: Only 1 page was scraped. Content may be limited. Set confidence_level to "low" unless the homepage is unusually detailed.'
    : ''
  }
${contentQualityWarning ? `\nCONTENT QUALITY WARNING: ${contentQualityWarning}` : ''}
${enrichedContext ? `\n[EXTERNAL INTELLIGENCE — use to supplement website content]\n${enrichedContext}` : ''}

[OUTPUT SCHEMA]
${schemaBlock}

[CRITICAL REMINDERS BEFORE YOU ANALYZE]
1. Read ALL the content below before forming any conclusions.
2. Every signal requires a direct quote or close paraphrase from the content. No signal without quoted evidence.
3. Every AI opportunity requires an evidence_anchor field naming the specific pain point or signal from this company. No opportunity without an anchor.
4. company_size_estimate must be explicitly stated in the content. Do not infer from facility count, certifications, or product complexity.
5. Scores are capped by confidence: confidence_level "low" → all scores ≤ 50, why_now_score ≤ 5. confidence_level "medium" → scores above 75 require justification.
6. If content is thin: set confidence_level "low", data_quality_score < 40, and cap scores accordingly — do not inflate.
7. The outreach_angle must reference something SPECIFIC to this company, not generic manufacturing challenges.
8. Compute outreach_priority_score using the formula: (company_fit.value × 0.30) + (automation_opportunity.value × 0.30) + (why_now_score × 10 × 0.40).
9. Return ONLY the JSON object. No explanation. No markdown. No code fences.

[WEBSITE CONTENT START]
${truncatedContent}
[WEBSITE CONTENT END]
`.trim()
}

// ── Helper: truncate content at a word boundary ──────────────

function truncateAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text

  const truncated = text.slice(0, maxChars)
  const lastSpace = truncated.lastIndexOf(' ')

  return lastSpace > 0
    ? truncated.slice(0, lastSpace) + '\n\n[Content truncated for length]'
    : truncated + '\n\n[Content truncated for length]'
}

// ── Helper: prepare scraped content from multiple pages ──────

export function formatScrapedPages(pages: Array<{
  url: string
  markdown: string
  success: boolean
}>): string {
  const successfulPages = pages.filter(p => p.success && p.markdown.trim().length > 0)

  if (successfulPages.length === 0) {
    return '[No content could be extracted from this website]'
  }

  return successfulPages
    .map(page => {
      const label = new URL(page.url).pathname || '/'
      return `--- PAGE: ${label} (${page.url}) ---\n${page.markdown.trim()}`
    })
    .join('\n\n')
}

// ── Utility: estimate token count (rough approximation) ──────
// 1 token ≈ 4 characters for English text.

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

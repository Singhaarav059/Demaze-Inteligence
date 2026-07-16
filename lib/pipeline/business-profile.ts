// ============================================================
// Business Profile Extractor — lib/pipeline/business-profile.ts
// ============================================================
// Answers the question competitor-discovery.ts and icp-generator.ts need
// answered BEFORE they search for anything: what does the researched
// company actually do? Company-name-based competitor search and shallow
// "we offer X" phrase extraction were both found to be poor proxies for
// this — a company's own name search collides with unrelated same-named
// companies, and a narrow offerings regex misses most real sites. This
// module replaces both as the query-building foundation with a single,
// dedicated, structured LLM call answering 8 concrete questions: services,
// problems solved, ideal customers, industries served, target company
// size, market positioning, technical capabilities, business outcomes
// delivered.
//
// Deliberately its own small prompt/call, separate from the big narrative
// prompt in analyze-v2.ts — the narrative call happens AFTER competitor/ICP
// search already needs this profile to build queries, so folding this into
// that call would create a circular dependency. A second LLM call is the
// honest cost of getting business understanding before search, not after.
//
// Same discipline as every other module in this codebase: grounded only in
// the passed website content, never the model's own general knowledge of
// the company. Empty fields (never invented ones) when the content doesn't
// support an answer. Non-fatal — a failure here degrades query quality for
// the callers (they fall back to extractCompanyOfferings()), it must never
// throw or halt the pipeline.
// ============================================================

import { getCompletion } from '@/lib/ai/provider-factory'

export interface CompanyBusinessProfile {
  services: string[]
  problems_solved: string[]
  ideal_customers: string
  industries_served: string[]
  target_company_size: string
  market_positioning: string
  technical_capabilities: string[]
  business_outcomes: string[]
}

export function emptyBusinessProfile(): CompanyBusinessProfile {
  return {
    services: [],
    problems_solved: [],
    ideal_customers: '',
    industries_served: [],
    target_company_size: '',
    market_positioning: '',
    technical_capabilities: [],
    business_outcomes: [],
  }
}

export function isEmptyBusinessProfile(profile: CompanyBusinessProfile): boolean {
  return (
    profile.services.length === 0 &&
    profile.problems_solved.length === 0 &&
    profile.ideal_customers.trim().length === 0 &&
    profile.industries_served.length === 0 &&
    profile.target_company_size.trim().length === 0 &&
    profile.market_positioning.trim().length === 0 &&
    profile.technical_capabilities.length === 0 &&
    profile.business_outcomes.length === 0
  )
}

const MAX_CONTENT_CHARS = 8_000

const SYSTEM_PROMPT = `You extract a factual business profile from a company's own website content. You never invent facts not supported by the content. Empty string/array when the content doesn't state something — never guess or use general industry knowledge about the company.`

function buildUserPrompt(websiteContent: string, companyName: string): string {
  const truncated = websiteContent.length > MAX_CONTENT_CHARS
    ? websiteContent.slice(0, MAX_CONTENT_CHARS)
    : websiteContent

  return `
Company: ${companyName}

Read the website content below and answer these 8 questions about what THIS company does, based only on what the content states or clearly implies. Do not describe competitors, partners, or customers mentioned in the content — only the researched company itself.

1. What services does the company provide?
2. What problems does it solve for its customers?
3. Who are its ideal customers (describe in 1 sentence)?
4. What industries does it serve?
5. What company size does it target (e.g. SMB, mid-market, enterprise)?
6. What is its market positioning (e.g. budget/premium, generalist/specialist, regional/global)?
7. What technical capabilities does it have?
8. What business outcomes does it deliver for customers?

Return ONLY this JSON object, no other text:
{
  "services": ["service 1", "service 2"],
  "problems_solved": ["problem 1", "problem 2"],
  "ideal_customers": "1 sentence description, or empty string if not determinable",
  "industries_served": ["industry 1", "industry 2"],
  "target_company_size": "e.g. 'SMB and mid-market' or empty string if not stated/implied",
  "market_positioning": "e.g. 'premium specialist provider' or empty string if not stated/implied",
  "technical_capabilities": ["capability 1", "capability 2"],
  "business_outcomes": ["outcome 1", "outcome 2"]
}

Rules:
- Every array can be empty ([]) if the content doesn't support it. Never invent entries to fill a quota.
- Each array item should be short (a few words to one short phrase), not a full sentence.
- Base every answer only on the website content below, never on what you already know about this company.

[WEBSITE CONTENT]
${truncated}
[END CONTENT]
`.trim()
}

// Same fence-stripping shape as route.ts's extractJsonFromLLMResponse —
// kept as its own copy rather than a shared import, matching this
// codebase's existing precedent for small per-module duplicated helpers
// (see market-intelligence.ts's searchWithFallback header comment).
function extractJsonFromResponse(raw: string): string {
  const trimmed = raw.trim()
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start !== -1 && end > start) return stripped.slice(start, end + 1)
  return stripped
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim())
}

function toStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Extracts a structured business profile from the researched company's own
 * website content. Never throws — returns emptyBusinessProfile() on any
 * failure (no API key, network error, unparseable response), same
 * non-fatal discipline as every other enrichment/discovery module here.
 */
export async function extractBusinessProfile(
  websiteContent: string,
  companyName: string,
): Promise<CompanyBusinessProfile> {
  if (!websiteContent || websiteContent.trim().length === 0) {
    return emptyBusinessProfile()
  }

  const userPrompt = buildUserPrompt(websiteContent, companyName)

  // Some providers (reasoning models in particular, e.g. nemotron-3-ultra)
  // emit a chain-of-thought preamble before the JSON even with jsonMode
  // requested — found live 2026-07-16 running demazetech.com: a 1024-token
  // budget let the preamble consume the entire response, truncating before
  // any JSON was emitted at all ("Unexpected token 'T', \"The user w\"...").
  // A follow-up live run found even 2048 wasn't enough (truncated mid-string
  // at position 334 — still inside the thinking preamble's token cost) and
  // cost ~18s to fail before falling through to a 4096 retry that succeeded
  // ~23s later — by which point route.ts's bounded race had already timed
  // out and discarded the result. Starting straight at 4096 (skipping the
  // near-guaranteed-to-fail small first attempt) cuts that wasted latency
  // roughly in half; one retry at 6144 remains for safety.
  let lastError: unknown
  for (const maxTokens of [4096, 6144]) {
    try {
      const response = await getCompletion({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        maxTokens,
        temperature: 0.1,
        jsonMode: true,
      })

      const parsed = JSON.parse(extractJsonFromResponse(response.content)) as Record<string, unknown>

      return {
        services: toStringArray(parsed.services),
        problems_solved: toStringArray(parsed.problems_solved),
        ideal_customers: toStr(parsed.ideal_customers),
        industries_served: toStringArray(parsed.industries_served),
        target_company_size: toStr(parsed.target_company_size),
        market_positioning: toStr(parsed.market_positioning),
        technical_capabilities: toStringArray(parsed.technical_capabilities),
        business_outcomes: toStringArray(parsed.business_outcomes),
      }
    } catch (e) {
      lastError = e
      console.warn(`[BusinessProfile] attempt with maxTokens=${maxTokens} failed:`, e instanceof Error ? e.message : String(e))
    }
  }

  console.warn('[BusinessProfile] extractBusinessProfile failed after retry, returning empty profile:', lastError instanceof Error ? lastError.message : String(lastError))
  return emptyBusinessProfile()
}

// ============================================================
// Demaze Outbound Research Agent — Prompt Builder
// ============================================================
// Builds the LLM prompt for company research.
//
// Input:  Pre-extracted signals from website + enrichment
// Output: SDR research brief (challenges, opportunities,
//         outreach angle)
// ============================================================

import type { ExtractorResult, OpportunityDraft } from '@/lib/pipeline/evidence-extractor'

export interface NarrativePromptInput {
  domain: string
  websitePreview: string          // first 3,000 chars for company ID
  signalSummary: string           // compact code-extracted signal block
  /** @deprecated OPP_TEMPLATES seeding. Will be replaced by OPPORTUNITY_CATALOG titles injected directly. */
  opportunityDrafts: OpportunityDraft[]
  analyzedAt: string
  contentQualityWarning?: string
  pagesAnalyzed: string[]
}

// ── SDR Research Output Schema ─────────────────────────────────
// This is what the LLM must output. Every field is required.
// pain_points and ai_opportunities must always have 3-5 items.

const NARRATIVE_SCHEMA = `
OUTPUT FORMAT — Return ONE flat JSON object with exactly these fields:

{
  "company_name": "Company trading name",
  "company_summary": "3 to 4 sentence summary: what they do, who they serve, where they operate, approximate scale. Use the website content. If content is sparse, use what is available. No dashes as connectors.",
  "industry": "Primary industry (e.g. Welding Equipment Manufacturing, Automotive Components)",
  "sub_industry": "Maximum precision (e.g. Welding Consumables & Robotic Welding Systems)",
  "business_model": "B2B — one sentence. Who they sell to and what they sell.",
  "company_size_estimate": "Verbatim from content (e.g. '3,200 employees across 6 plants'), or best estimate if not stated (e.g. 'Mid-size Indian manufacturer, ~500-2000 employees estimated from facility count')",
  "headquarters_location": "City, Country — or 'Not stated'",

  "recent_activity": [
    "Bullet describing a specific observed or inferred signal, such as an expansion, automation investment, digital initiative, hiring, certification, or acquisition.",
    "Another specific activity. Use content evidence where available. Infer from industry context where not stated.",
    "(3 to 5 bullets total)"
  ],

  "pain_points": [
    "Operational challenge 1, specific to their business model. Mark as (observed) or (inferred).",
    "Operational challenge 2",
    "Operational challenge 3",
    "(3 to 5 items total. NEVER return an empty array. Infer from business model if no direct evidence.)"
  ],

  "ai_opportunities": [
    {
      "title": "Specific Demaze opportunity title — name the service and the company use-case",
      "description": "2 sentences: what this is and why it matters specifically for this company's operations.",
      "confidence": "high | medium | low",
      "evidence": "Quote from the content that supports this, OR describe the inference basis if inferred",
      "expected_impact": "Specific measurable outcome for this company type (e.g. '30-50% reduction in weld defect rate')",
      "entry_point": "Where to start — which department or initiative to attach to",
      "claim_type": "observed | inferred",
      "inferred_from": "If inferred: what observed fact implies this opportunity (e.g. 'multi-plant operations + robotic welding investment')"
    }
  ],

  "outreach_intelligence": {
    "trigger": "The strongest single signal — what specifically makes this company a prospect right now",
    "problem": "The operational implication this signal creates for their business",
    "service": "The ONE Demaze service best matched to their situation",
    "opening_angle": "2–3 sentences a sales rep could use verbatim as a cold email opener. Start with the company signal. No 'I hope this finds you well.' No generic openers.",
    "why_now": "ONE specific reason urgency is real — a company event, a scaling challenge, a market pressure. Not an industry trend."
  },

  "executive_brief": {
    "what_we_observed": [
      "Source type + fact (e.g. 'Website confirms 3 manufacturing plants in India')",
      "Another observed fact",
      "(Max 3 bullets — only directly stated things)"
    ],
    "what_it_means": [
      "What this observation implies operationally for this company",
      "(Max 2 bullets — reasonable inferences only)"
    ],
    "what_to_sell": "ONE specific Demaze service — e.g. 'AI Quality Control for Welding Lines'",
    "why_now": "ONE specific company-level reason — not 'industry trends'",
    "overall_confidence": "high | medium | low"
  },

  "why_demaze": {
    "reasons": [
      "Signal — 'evidence quote or inference basis' — operational implication → Demaze service"
    ],
    "outreach_angle": "2–3 sentences a rep could use verbatim. Same as opening_angle above.",
    "relevant_services": ["Service 1", "Service 2"]
  },

  "signal_summary": "1–2 sentence narrative of the most important signals detected, or what was inferred.",
  "competitive_context": "Brief industry context relevant to Demaze's pitch. Prefix 'Industry context:' if not from website.",
  "confidence_level": "high | medium | low",
  "data_quality_notes": "Brief note on what was available and any key limitations.",
  "why_now": "ONE specific recent company signal or activity that creates outreach urgency — not a trend.",
  "score_explanations": {
    "company_fit": "Why this company fits or does not fit Demaze's ICP",
    "automation_opportunity": "What automation potential exists given their industry and signals",
    "why_now": "Why the timing is or is not urgent",
    "outreach_priority": "Overall recommendation for prioritization"
  }
}

RULES:
- pain_points: ALWAYS generate 3-5. Mark each as (observed) if directly stated, (inferred) if based on business model/industry reasoning. NEVER return [].
- ai_opportunities: ALWAYS generate 3-5. Use pre-extracted signals if available. Use inference if not. NEVER return [].
- opening_angle: Must be usable verbatim. Test: would a rep send this without editing? If yes, good.
- why_now: Must be company-specific. "Digital transformation is accelerating in manufacturing" = REJECTED. "Ador Welding is scaling robotic welding across 3 plants" = VALID.
- For thin-content sites: use what you have, infer what you can, state your confidence level honestly.

WRITING STYLE (applies to every text field above):
- Write like a human SDR, not an AI. Direct, specific, confident.
- NEVER use em dashes (—) or en dashes (–), and never " -- " as a connector. Use commas, periods, or two shorter sentences instead.
- No filler openers ("It's worth noting", "In today's fast-paced world", "Furthermore", "Moreover", "In conclusion") and no "I hope this finds you well".
- Plain verbs: "use" not "leverage/utilize". Contractions are fine.
`

// ── Main export ────────────────────────────────────────────────

export function buildNarrativePrompt(input: NarrativePromptInput): string {
  const {
    domain,
    websitePreview,
    signalSummary,
    opportunityDrafts,
    analyzedAt,
    contentQualityWarning,
    pagesAnalyzed,
  } = input

  // Pre-detected signals as context hints (not constraints)
  const signalHints = opportunityDrafts.length > 0
    ? `PRE-DETECTED OPPORTUNITY HINTS (use as starting points, not constraints):\n` +
      opportunityDrafts.map((o, i) =>
        `  ${i + 1}. ${o.service} — evidence hint: "${o.evidence_anchor.slice(0, 120)}"`
      ).join('\n')
    : `PRE-DETECTED SIGNALS: None detected deterministically. Use business model inference to generate challenges and opportunities.`

  return `
Research this company for Demaze Technologies outbound prospecting.

[DOMAIN]
${domain}

[ANALYZED AT]
${analyzedAt}

[PAGES ANALYZED]
${pagesAnalyzed.length > 0 ? pagesAnalyzed.slice(0, 15).join('\n') : 'Homepage only'}
${pagesAnalyzed.length <= 1 ? '\nNOTE: Only 1 page available. Use inference from business model for challenges and opportunities.' : ''}
${contentQualityWarning ? `\nCONTENT NOTE: ${contentQualityWarning}` : ''}

[PRE-EXTRACTED INTELLIGENCE -- produced by pattern analysis of the website content]
${signalSummary || 'No deterministic signals extracted. Rely on website content and business model inference.'}

[${signalHints}]

[REQUIRED OUTPUT -- See schema below]
${NARRATIVE_SCHEMA}

[WEBSITE CONTENT -- primary source for company identification and evidence]
${websitePreview}
[END CONTENT]
`.trim()
}

// -- Helper: build NarrativePromptInput from ExtractorResult ---

export function buildNarrativeInput(
  domain: string,
  extractorResult: ExtractorResult,
  pagesAnalyzed: string[],
  contentQualityWarning?: string,
): NarrativePromptInput {
  return {
    domain,
    websitePreview: extractorResult.websitePreview,
    signalSummary: extractorResult.signalSummary,
    opportunityDrafts: extractorResult.opportunityDrafts,
    analyzedAt: new Date().toISOString(),
    contentQualityWarning,
    pagesAnalyzed,
  }
}

// -- Token estimator (shared utility) --------------
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

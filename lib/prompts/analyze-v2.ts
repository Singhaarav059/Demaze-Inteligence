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
import type { CompetitorCandidate } from '@/lib/enrichment/competitor-discovery'
import type { ICPCandidate } from '@/lib/enrichment/icp-generator'

export interface NarrativePromptInput {
  domain: string
  websitePreview: string          // first 3,000 chars for company ID
  signalSummary: string           // compact code-extracted signal block
  /** @deprecated OPP_TEMPLATES seeding. Will be replaced by OPPORTUNITY_CATALOG titles injected directly. */
  opportunityDrafts: OpportunityDraft[]
  analyzedAt: string
  contentQualityWarning?: string
  pagesAnalyzed: string[]
  // Competitor Discovery (Phase 2 item 1) — code-derived, already filtered
  // and confidence-tiered (cap ~5, see competitor-discovery.ts architecture
  // decision 4). The LLM only narrates why_they_compete/market_position/
  // differentiator for names already in this list; it never introduces a
  // new name. Same discard-LLM-only-misses discipline as
  // generateDeterministicOpportunities() (opportunity-engine.ts). Defaults
  // to [] via buildNarrativeInput until discoverCompetitors() exists.
  competitorCandidates: CompetitorCandidate[]
  // ICP Generator (Phase 2 item 2) — code-derived, already filtered and
  // confidence-tiered (cap ~5, see icp-generator.ts). The LLM only narrates
  // reason/criteria/buying_indicators/example_companies for segment names
  // already in this list; it never introduces a new segment. Same
  // discard-LLM-only-misses discipline as competitorCandidates above.
  // Defaults to [] via buildNarrativeInput until discoverICPSegments() is wired.
  icpCandidates: ICPCandidate[]
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

  "competitors": [
    {
      "name": "Must be copied EXACTLY (same spelling/casing) from a name listed in [COMPETITOR CANDIDATES]. Never invent, guess, or add a competitor not in that list.",
      "why_they_compete": "1-2 sentences: what the candidate's snippets show that makes them a competitor (same product/service category, same target market, named directly as an alternative). Base this ONLY on the snippets given for that name.",
      "market_position": "Only if a snippet explicitly states this (e.g. 'market leader', 'budget alternative', 'largest player in India'). Empty string if not explicitly stated. Never guess.",
      "differentiator": "Only if a snippet explicitly states a concrete difference between them and the researched company. Empty string if not explicitly stated. Never guess."
    }
  ],
  "icp_segments": [
    {
      "name": "Must be copied EXACTLY (same spelling/casing) from a name listed in [ICP CANDIDATES]. Never invent, guess, or add a segment not in that list.",
      "reason": "1-2 sentences: what the candidate's snippets show that makes this a customer segment the researched company sells to. Base this ONLY on the snippets given for that name.",
      "criteria": "Only if a snippet explicitly states qualifying criteria (e.g. 'multi-location', 'revenue $10M+'). Empty string if not explicitly stated. Never guess.",
      "buying_indicators": "Only if a snippet explicitly states what triggers this segment's purchase interest. Empty string if not explicitly stated. Never guess.",
      "example_companies": ["Only named companies explicitly mentioned in the snippets as belonging to this segment. Empty array if none named. Never invent example companies."]
    }
  ],
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
- competitors: ONE entry per name in [COMPETITOR CANDIDATES], same order, nothing added or dropped. If [COMPETITOR CANDIDATES] says "None found", return "competitors": []. Do NOT populate competitors from general industry knowledge, do NOT list companies you personally know compete in this space if they aren't in the candidate list — only the search-derived list, never the model's own knowledge of the market.
- icp_segments: ONE entry per name in [ICP CANDIDATES], same order, nothing added or dropped. If [ICP CANDIDATES] says "None found", return "icp_segments": []. Do NOT populate segments from general industry knowledge of who a company like this "probably" sells to — only the search-derived list, never the model's own guess.

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
    competitorCandidates,
    icpCandidates,
  } = input

  // Pre-detected signals as context hints (not constraints)
  const signalHints = opportunityDrafts.length > 0
    ? `PRE-DETECTED OPPORTUNITY HINTS (use as starting points, not constraints):\n` +
      opportunityDrafts.map((o, i) =>
        `  ${i + 1}. ${o.service} — evidence hint: "${o.evidence_anchor.slice(0, 120)}"`
      ).join('\n')
    : `PRE-DETECTED SIGNALS: None detected deterministically. Use business model inference to generate challenges and opportunities.`

  // [COMPETITOR CANDIDATES] — code-derived, already filtered by
  // discoverCompetitors() (self-name/customer/supplier/certifying-body/
  // news-outlet/association rejected before this point). Defensive
  // slice(0, 5) mirrors the confidence-tiering cap from the architecture
  // decision even though the upstream producer should already enforce it —
  // same belt-and-suspenders pattern as pagesAnalyzed.slice(0, 15) above.
  // The LLM narrates these names only; it never introduces a new one
  // (enforced in NARRATIVE_SCHEMA's "competitors" field + RULES).
  const candidates = competitorCandidates.slice(0, 5)
  const competitorBlock = candidates.length > 0
    ? candidates.map((c, i) => {
        const snippets = c.snippets.slice(0, 2).map(s => `"${s.slice(0, 150)}"`).join(' / ')
        return `  ${i + 1}. ${c.name} (${c.mention_count} mention${c.mention_count === 1 ? '' : 's'}, ` +
          `${c.explicit_vs_framing ? 'named directly as an alternative' : 'inferred from framing'})\n` +
          `     evidence: ${snippets || '(no snippet captured)'}`
      }).join('\n')
    : '  None found. Return "competitors": [] — do not invent competitors from general knowledge of this industry.'

  // [ICP CANDIDATES] — code-derived, already filtered by discoverICPSegments()
  // (self-name/generic-term rejected before this point). Same defensive
  // slice(0, 5) as competitorBlock above.
  const icpCands = icpCandidates.slice(0, 5)
  const icpBlock = icpCands.length > 0
    ? icpCands.map((c, i) => {
        const snippets = c.snippets.slice(0, 2).map(s => `"${s.slice(0, 150)}"`).join(' / ')
        return `  ${i + 1}. ${c.name} (${c.mention_count} mention${c.mention_count === 1 ? '' : 's'}, ` +
          `${c.explicit_serve_framing ? 'named directly as a served segment' : 'inferred from framing'})\n` +
          `     evidence: ${snippets || '(no snippet captured)'}`
      }).join('\n')
    : '  None found. Return "icp_segments": [] — do not invent segments from general knowledge of this industry.'

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

[COMPETITOR CANDIDATES -- search-derived, already filtered. Narrate ONLY these names in the "competitors" output field, never add or omit one]
${competitorBlock}

[ICP CANDIDATES -- search-derived, already filtered. Narrate ONLY these names in the "icp_segments" output field, never add or omit one]
${icpBlock}

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
  // Optional + defaulted: no discoverCompetitors() producer exists yet
  // (Implementation session, not this one). Once it does, route.ts passes
  // its filtered/tiered candidates here — no other call-site change needed.
  competitorCandidates: CompetitorCandidate[] = [],
  // Optional + defaulted, same reasoning as competitorCandidates — route.ts
  // passes discoverICPSegments()'s filtered/tiered candidates here.
  icpCandidates: ICPCandidate[] = [],
): NarrativePromptInput {
  return {
    domain,
    websitePreview: extractorResult.websitePreview,
    signalSummary: extractorResult.signalSummary,
    opportunityDrafts: extractorResult.opportunityDrafts,
    analyzedAt: new Date().toISOString(),
    contentQualityWarning,
    pagesAnalyzed,
    competitorCandidates,
    icpCandidates,
  }
}

// -- Token estimator (shared utility) --------------
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

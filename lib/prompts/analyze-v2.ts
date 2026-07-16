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
import type { CompanyBusinessProfile } from '@/lib/pipeline/business-profile'
import type { ProofPoint } from '@/lib/knowledge/demaze-proof-points'

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
  // Business-understanding rebuild (2026-07-16, business-profile.ts) — gives
  // the LLM the researched company's own services/positioning/capabilities
  // context so its competitor category/similarities/relative_size and
  // segment use_cases/market_attractiveness/priority judgments are grounded
  // in something more specific than the raw candidate snippets alone. null
  // when the business-profile call failed/timed out — the LLM still narrates
  // from candidate snippets in that case, just without this extra context.
  businessProfile: CompanyBusinessProfile | null
  // Demaze Proof Points (lib/knowledge/demaze-proof-points.ts) — code-
  // derived, matched by proof-point-matcher.ts's pure industry-tag overlap
  // against the researched company (no network call, computed synchronously
  // in route.ts before this prompt is built). The LLM only cites
  // matched_proof_point_id + drafts outreach text grounded in these; it
  // never invents a Demaze client, case study, or stat not in this list.
  // Defaults to [] via buildNarrativeInput for callers that don't pass it.
  proofPointCandidates: ProofPoint[]
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
      "differentiator": "Only if a snippet explicitly states a concrete difference between them and the researched company. Empty string if not explicitly stated. Never guess.",
      "category": "One of: direct, growing, established, unclear. 'direct' = similar services/target customers/positioning to the researched company (use [BUSINESS PROFILE] to judge this). 'growing' = the snippets describe them as a smaller/newer/rapidly-growing entrant. 'established' = the snippets describe them as a larger, mature, industry-leading, or enterprise-focused player. 'unclear' if the snippets don't support any of these. Never guess beyond what the snippets say.",
      "similarities": "1 sentence on concrete overlap with the researched company's own services/positioning (from [BUSINESS PROFILE]), only if the candidate's snippets support it. Empty string if not supportable.",
      "relative_size": "Only if a snippet explicitly indicates relative size/scale (e.g. 'larger', 'smaller', 'similar size', employee/revenue figures). Empty string if not explicitly stated. Never guess."
    }
  ],
  "icp_segments": [
    {
      "name": "Must be copied EXACTLY (same spelling/casing) from a name listed in [ICP CANDIDATES]. Never invent, guess, or add a segment not in that list.",
      "reason": "1-2 sentences: what the candidate's snippets show that makes this a customer segment the researched company sells to. Base this ONLY on the snippets given for that name.",
      "criteria": "Only if a snippet explicitly states qualifying criteria (e.g. 'multi-location', 'revenue $10M+'). Empty string if not explicitly stated. Never guess.",
      "buying_indicators": "Only if a snippet explicitly states what triggers this segment's purchase interest. Empty string if not explicitly stated. Never guess.",
      "example_companies": ["Only named companies explicitly mentioned in the snippets as belonging to this segment. Empty array if none named. Never invent example companies."],
      "use_cases": "1 sentence: a concrete way this segment would use the researched company's services (ground this in [BUSINESS PROFILE]'s services/business_outcomes, not general industry knowledge). Empty string if not supportable.",
      "market_attractiveness": "high | medium | low — how well this segment's evidenced needs (snippets) fit the researched company's actual services/capabilities from [BUSINESS PROFILE]. Justify from evidence, never an arbitrary guess.",
      "priority": "high | medium | low — combining market_attractiveness with how directly the segment's own stated needs match [BUSINESS PROFILE]'s problems_solved/business_outcomes. Justify from evidence, never an arbitrary guess."
    }
  ],
  "outreach_draft": {
    "matched_proof_point_id": "Must be copied EXACTLY from an id listed in [DEMAZE PROOF POINTS] (e.g. 'volvo-executive-intelligence'), or empty string if [DEMAZE PROOF POINTS] says none found. Never invent an id.",
    "connection_note": "A short LinkedIn connection request note, under 300 characters. Structure: personalized mention of the researched company -> one sentence citing the matched proof point's real outcome -> soft overlap statement. No CTA here, connection notes stay light.",
    "first_message": "The first message sent after the connection is accepted. Structure: brief warm opener -> reason for reaching out, tied to the researched company's industry -> cite the matched proof point's outcome again with more detail -> light CTA (offer to share case studies or a quick call). 3-5 sentences.",
    "follow_up": "A follow-up message for if the first message gets no reply. Structure: reference that case studies were shared with a similar company (using the matched proof point's client framing) -> state there could be similar opportunities for the researched company -> direct CTA (quick intro call). 2-4 sentences."
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
- competitors: ONE entry per name in [COMPETITOR CANDIDATES], same order, nothing added or dropped. If [COMPETITOR CANDIDATES] says "None found", return "competitors": []. Do NOT populate competitors from general industry knowledge, do NOT list companies you personally know compete in this space if they aren't in the candidate list — only the search-derived list, never the model's own knowledge of the market. Use [BUSINESS PROFILE] only to help judge category/similarities, never to add a competitor name.
- icp_segments: ONE entry per name in [ICP CANDIDATES], same order, nothing added or dropped. If [ICP CANDIDATES] says "None found", return "icp_segments": []. Do NOT populate segments from general industry knowledge of who a company like this "probably" sells to — only the search-derived list, never the model's own guess. Use [BUSINESS PROFILE] only to help judge use_cases/market_attractiveness/priority, never to add a segment name.
- outreach_draft: matched_proof_point_id must be copied exactly from an id in [DEMAZE PROOF POINTS], or left as "" if none found there. Never invent a Demaze client name, case study, or stat that isn't in that list. If the matched proof point's provenance is "composite/illustrative example", describe it the way the source material does (e.g. "one of Africa's largest tile manufacturers", "a mid-market manufacturer running 4 plants") — never attach a specific company name to it, since none was given. Follow the structural anatomy described in each field, but write fresh wording for this specific lead; do not copy phrasing from any other outreach example verbatim, since those were written for a different company.

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
    businessProfile,
    proofPointCandidates,
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

  // [BUSINESS PROFILE] — from business-profile.ts's structured 8-question
  // extraction, grounded only in this company's own website content. Gives
  // the LLM context for category/similarities/use_cases/scoring judgments
  // above; it is NOT a source of new competitor/segment names (see RULES).
  const businessProfileBlock = businessProfile && (
    businessProfile.services.length > 0 ||
    businessProfile.problems_solved.length > 0 ||
    businessProfile.industries_served.length > 0 ||
    businessProfile.market_positioning.trim().length > 0
  )
    ? [
        businessProfile.services.length > 0 ? `Services: ${businessProfile.services.join(', ')}` : null,
        businessProfile.problems_solved.length > 0 ? `Problems solved: ${businessProfile.problems_solved.join(', ')}` : null,
        businessProfile.ideal_customers ? `Ideal customers: ${businessProfile.ideal_customers}` : null,
        businessProfile.industries_served.length > 0 ? `Industries served: ${businessProfile.industries_served.join(', ')}` : null,
        businessProfile.target_company_size ? `Target company size: ${businessProfile.target_company_size}` : null,
        businessProfile.market_positioning ? `Market positioning: ${businessProfile.market_positioning}` : null,
        businessProfile.technical_capabilities.length > 0 ? `Technical capabilities: ${businessProfile.technical_capabilities.join(', ')}` : null,
        businessProfile.business_outcomes.length > 0 ? `Business outcomes delivered: ${businessProfile.business_outcomes.join(', ')}` : null,
      ].filter(Boolean).join('\n')
    : '  Not available for this run — judge category/similarities/use_cases/scoring from candidate snippets alone.'

  // [DEMAZE PROOF POINTS] -- code-derived, matched by
  // proof-point-matcher.ts's pure industry-tag overlap against the
  // researched company (no network call). Cite ONLY these in the
  // "outreach_draft" output field; never invent a Demaze case study,
  // client name, or stat not listed here. Already capped to maxResults
  // (2) by matchProofPoints() — no defensive slice needed here, unlike
  // competitorBlock/icpBlock's slice(0, 5) (those callers pass a raw,
  // uncapped search result; this one is already capped at the source).
  const proofPointBlock = proofPointCandidates.length > 0
    ? proofPointCandidates.map((p, i) => {
        const outcomes = p.outcomes.map(o => `${o.metric}: ${o.value}${o.window ? ` (${o.window})` : ''}`).join(' / ')
        const provenanceLabel = p.provenance === 'named_client' ? `real named client: ${p.client}` : `composite/illustrative example: ${p.client}`
        return `  ${i + 1}. [${p.id}] ${p.title} -- ${provenanceLabel}\n` +
          `     challenge: ${p.challenge}\n` +
          `     outcomes: ${outcomes}`
      }).join('\n')
    : `  None found. Return "outreach_draft.matched_proof_point_id": "" and draft from Demaze's general AI-for-operations positioning only, with no invented stats or case studies.`

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

[BUSINESS PROFILE -- what the researched company itself does, extracted from its own website content. Use this only to judge category/similarities/use_cases/scoring below, never as a source of new competitor or segment names]
${businessProfileBlock}

[COMPETITOR CANDIDATES -- search-derived, already filtered. Narrate ONLY these names in the "competitors" output field, never add or omit one]
${competitorBlock}

[ICP CANDIDATES -- search-derived, already filtered. Narrate ONLY these names in the "icp_segments" output field, never add or omit one]
${icpBlock}

[DEMAZE PROOF POINTS -- Demaze's own real delivered work, matched to this company's industry. Cite ONLY these in "outreach_draft", never invent a Demaze case study, client, or stat]
${proofPointBlock}

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
  // Optional + defaulted null, same reasoning — route.ts passes
  // extractBusinessProfile()'s result here once resolved.
  businessProfile: CompanyBusinessProfile | null = null,
  // Optional + defaulted [] — route.ts passes matchProofPoints()'s result
  // here (synchronous, no promise to await, unlike competitorCandidates/
  // icpCandidates which come from network-calling discovery modules).
  proofPointCandidates: ProofPoint[] = [],
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
    businessProfile,
    proofPointCandidates,
  }
}

// -- Token estimator (shared utility) --------------
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

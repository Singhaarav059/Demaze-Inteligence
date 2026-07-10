// ============================================================
// Demaze AI Output Schema — v4
// ============================================================
// Architecture:
//   Code → pre-determines signal clusters + candidate opportunities
//   LLM  → extracts evidence, classifies signals, EXPLAINS opportunities
//
// The LLM no longer invents opportunities.
// The LLM explains pre-determined opportunities with company-specific evidence.
// ============================================================

export function getSchemaPromptString(deterministicOpportunities?: string): string {
  const oppBlock = deterministicOpportunities
    ? `
━━━ PRE-DETERMINED OPPORTUNITY LIST ━━━
The intelligence system has already identified these candidate opportunities
based on signal analysis. Your job is to EXPLAIN each one with company-specific
evidence — not invent new ones. You may skip an opportunity if you cannot find
supporting evidence, and may add 1–2 additional if strong Tier 1 evidence demands it.

${deterministicOpportunities}

`
    : ''

  return `
CRITICAL OUTPUT RULE:
Return ONE flat JSON object. ALL fields at the TOP LEVEL.
Do NOT wrap fields inside section keys. Do NOT use markdown.

━━━ STEP 1 — EVIDENCE EXTRACTION AND CLASSIFICATION ━━━

evidence  array  — Extract 5–15 direct quotes from the scraped content.
  Schema per item:
  {
    "id": "e1",
    "subject": classify what this evidence IS ABOUT:
      "company_operations"    — the company's own internal processes, production, manufacturing
      "company_strategy"      — the company's own plans, investments, roadmap, announced expansions
      "internal_technology"   — technology the company is deploying or using internally
      "customer_use_case"     — what the company's customers do (NOT the company itself)
      "product_capability"    — what the company's products or services can do for customers
      "industry_trend"        — general industry context, not specific to this company
      "partner_story"         — describes a partner, case study, or third-party example
      "generic_marketing"     — taglines, cookie banners, nav text, footer text
    "tier": evidence quality tier:
      "tier1" — annual reports, investor presentations, press releases, careers pages, leadership statements
      "tier2" — official blog, case studies, About page, product documentation, news section
      "tier3" — homepage marketing, generic value propositions, taglines
    "category": "growth" | "digital_transformation" | "hiring" | "automation" | "ai"
                | "expansion" | "multi_location" | "technology" | "pain_point" | "news" | "product" | "general",
    "quote": "verbatim or near-verbatim text from the content",
    "source_page": "/about" or "homepage" or "/careers" etc.,
    "claim_type": "observed" | "inferred",
    "entity_scope": "group" | "business_unit" | "subsidiary" | "external",
    "evidence_strength": "very_high" | "high" | "medium" | "low"
  }
  RULE: evidence_strength — very_high = annual report / investor deck / CEO statement. high = press release / careers page. medium = official blog / about page. low = homepage copy / generic marketing.
  RULE: Quote verbatim. Do not rephrase.
  RULE: Only include quotes you will reference in signals, pain points, or opportunities.
  RULE: Subject determines whether evidence can generate signals — classify carefully.
  RULE: claim_type "observed" = stated directly in content. "inferred" = reasonably deduced but not stated.
  RULE: entity_scope for conglomerates — subsidiary signals (entity_scope "subsidiary") must NOT generate
        parent-group scores. E.g., "Tech Mahindra AI platform" is entity_scope "subsidiary", not "group".

━━━ STEP 2 — COMPANY PROFILE ━━━

company_name          string  — Company trading name
company_summary       string  — 3–4 sentences: what they do, who they serve, where they operate
industry              string  — Primary industry
sub_industry          string  — Maximum precision (e.g. "Precision Forging for Automotive & Aerospace")
business_model        string  — "B2B — [one sentence]"
company_size_estimate string  — Verbatim from content, or "Not determinable from available content"
headquarters_location string  — City, Country or "Not stated"

━━━ STEP 2.5 — BUSINESS MODEL ANALYSIS ━━━

business_model_analysis  object  — Classify the business model BEFORE generating any signals.
{
  "model_type": "Manufacturing" | "Automotive OEM" | "Automotive Supplier" | "Software/SaaS"
              | "Engineering Services" | "Conglomerate" | "Distribution/Logistics"
              | "Industrial Technology Vendor" | "Other",
  "value_chain_position": "one sentence: what role does this company play in its value chain",
  "primary_customers": "who buys from this company",
  "core_operational_activities": ["3–5 things this company DOES internally"],
  "strategic_pressures": ["3–5 operational challenges typical for this business model"]
}

━━━ STEP 3 — SIGNALS ━━━

CRITICAL SUBJECT GATE:
Signals can ONLY come from evidence where subject is:
  "company_operations" | "company_strategy" | "internal_technology"

"customer_use_case", "product_capability", "industry_trend", "partner_story", "generic_marketing"
CANNOT generate company-level signals.

For each signal, include the evidence_id (must be company-subject evidence).
Schema per signal: { "type": "code", "strength": "weak"|"moderate"|"strong", "evidence_id": "e1", "evidence": "quote", "tier": "tier1"|"tier2"|"tier3" }

growth_signals                  array  — types: new_facility | capacity_expansion | new_market_entry | new_product_launch | revenue_milestone
hiring_signals                  array  — types: operations_hiring_surge | digital_transformation_hiring | ai_ml_hiring | automation_engineering_hiring | leadership_hiring
digital_transformation_signals  array  — types: erp_implementation | mes_adoption | industry40_initiative | automation_investment | iot_investment
business_signals                array  — types: acquisition | partnership_announced | sustainability_initiative | quality_certification_pursuit | funding_round
signal_summary        string  — 1–2 sentence narrative of the most important signals, or "No significant signals detected"

━━━ STEP 4 — DETECTED FACTORS ━━━

detected_factors  object  — ALL 10 fields REQUIRED. Only set true for company-subject evidence.
{
  "growth_signal": true|false,
  "hiring_signal": true|false,
  "digital_transformation": true|false,
  "capacity_expansion": true|false,
  "automation_keywords": true|false,
  "technology_investment": true|false,
  "ai_mention": true|false,
  "multi_location_operations": true|false,
  "industry_40_initiative": true|false,
  "recent_news_or_event": true|false
}

━━━ STEP 4.5 — STRATEGIC CHALLENGES ━━━

strategic_challenges  array  — 2–5 specific operational challenges for THIS company.
  Derived from business model + confirmed signals. NOT generic industry advice.
  Schema per item:
  {
    "id": "challenge_id",
    "title": "Challenge title",
    "description": "What specific operational problem does this company face, given their business model and signals?",
    "evidence_ids": ["e1", "e2"],
    "confidence": "high" | "medium" | "low",
    "claim_type": "observed" | "inferred",
    "observed_basis": "What was directly seen that confirms this challenge exists (if observed)",
    "inferred_from":  "What was observed that IMPLIES this challenge likely exists (if inferred)"
  }
  CRITICAL: Most strategic challenges are INFERRED (the company has dealer networks → dealer data
  is likely underutilized). Mark this honestly. Only mark "observed" if the company explicitly
  stated the challenge in their content.

━━━ STEP 5 — PAIN POINTS ━━━

pain_points  array  — 2–5 items. Only from company_operations/company_strategy evidence.
  {
    "title": "Short pain point title",
    "confidence": "high" | "medium" | "low",
    "evidence_id": "e2",
    "evidence": "exact quote",
    "reasoning": "Complete sentence: [evidence] indicates [condition] which creates [pain]"
  }
  Return [] if no evidence-grounded pain points.

━━━ STEP 6 — REASONING CHAINS ━━━

reasoning_chains  array  — One per opportunity. Makes the logic chain visible.
  {
    "signal": "signal detected",
    "business_implication": "what this means for THIS company's specific business model",
    "strategic_challenge": "the operational challenge this creates",
    "opportunity": "which Demaze AI solution addresses it and why"
  }

━━━ STEP 7 — AI OPPORTUNITIES ━━━
${oppBlock}
ai_opportunities  array  — Explain the pre-determined opportunities with company-specific evidence.
  If no pre-determined list is provided, generate 4–6 from scratch using signal hierarchy.
  
  For EACH opportunity, provide:
  {
    "title": "Opportunity title — specific to THIS company",
    "description": "What it is and why it matters for this company's specific business model and challenges",
    "confidence": "high" | "medium" | "low",
    "evidence_id": "e3",
    "evidence": "exact quote — must have subject company_operations/strategy/internal_technology",
    "reasoning": "[evidence] indicates [condition] → [opportunity] addresses [specific challenge] for [business model]",
    "expected_impact": "Specific outcome for this company type",
    "entry_point": "Where to start",
    "category": "quality" | "maintenance" | "scheduling" | "supply_chain" | "process_automation" | "data_visibility",
    "pain_point_mapped": "Which pain_point this solves",
    "relevance": "High" | "Medium" | "Low",
    "claim_type": "observed" | "inferred",
    "observed_basis": "Direct evidence that confirms this opportunity exists",
    "inferred_from": "What was observed that implies this opportunity (if inferred)",
    "opportunity_confidence": "very_high" | "high" | "medium" | "exploratory",
    "demaze_fit_score": "high" | "medium" | "low"
  }
  RULE: opportunity_confidence — very_high: Tier 1 direct evidence of this specific problem. high: clear signals, some inference required. medium: reasonable inference from business model signals. exploratory: business-model-based assumption, no direct signal.
  RULE: demaze_fit_score — high: Demaze has deployed this type of solution before, strong ICP match. medium: Demaze can deliver but customization needed. low: edge of Demaze capability, deprioritize.
  RULE: claim_type "observed" requires direct evidence that this specific problem exists.
  RULE: claim_type "inferred" means: we see X (e.g., large dealer network) and conclude Y is likely
        a problem (dealer data underutilized) — this is valid reasoning, but must be labeled.
  Return [] if no company-subject evidence supports any opportunity.

competitive_context  string  — Industry dynamics. Prefix with "Industry context (not from website):" if not from content.

━━━ STEP 8 — WHY DEMAZE V2 ━━━

why_demaze  object  — Structured recommendation. This is the core output of the entire report.
  Must answer: Why this company? Why now? What to sell? Who to sell to? What evidence supports this?
{
  "reasons": [
    {
      "signal": "Which signal makes this company a Demaze prospect",
      "evidence": "Verbatim quote from content (company-subject only)",
      "evidence_tier": "tier1" | "tier2" | "tier3",
      "business_implication": "What this signal means operationally for THIS company",
      "strategic_challenge": "The specific operational challenge this creates",
      "recommended_service": "The specific Demaze service that addresses this",
      "target_buyer": "Exact job title: who owns this problem",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "relevant_services": ["service names"],
  "summary": "2–3 sentence executive summary: why Demaze should pursue this company now"
}
Generate 3–5 reasons. Rank strongest first (Tier 1 evidence > Tier 2 > Tier 3).

━━━ STEP 9 — OUTREACH INTELLIGENCE ━━━

outreach_intelligence  object:
{
  "trigger": "Company signal that creates urgency — must match top why_demaze reason",
  "problem": "Operational implication for THIS company's business model",
  "service": "Demaze service — must match top why_demaze recommended_service",
  "opening_angle": "2–3 sentence cold opener: signal → implication → Demaze capability. No generic openers.",
  "why_now": "What gets harder or more expensive if they delay 3–6 months?",
  "target_contact": "Job title to address (consistent with top why_demaze target_buyer)"
}
outreach_angle  string  — Same as outreach_intelligence.opening_angle (backward compat)

━━━ STEP 10 — CONTACT PRIORITIZATION ━━━

recommended_contacts  array  — 2–4 contacts sorted by priority:
{
  "role": "Exact job title for this company's industry and opportunities",
  "priority": 1,
  "reason": "Why this person owns this problem and which opportunity they champion"
}

━━━ STEP 11 — SCORE EXPLANATIONS ━━━

score_explanations  object:
{
  "company_fit": "What makes this company a strong/weak Demaze ICP match?",
  "automation_opportunity": "What automation potential exists from company-subject evidence?",
  "outreach_priority": "Why prioritize or deprioritize this prospect right now?"
}

━━━ STEP 12 — METADATA ━━━

why_now              string   — 2–4 sentences. Reference specific company signals.
why_now_score        integer  — 0–10. Only numeric score you provide.
                               8–10: multiple Tier 1 signals, contact immediately
                               5–7: clear movement, contact this week
                               2–4: some activity, watch list
                               0–1: static or poor content quality, deprioritize
confidence_level     string   — "high" | "medium" | "low"
data_quality_score   integer  — 0–100: actionable company-operations content available
data_quality_notes   string   — What you found, what was missing
content_quality_flags string[] — "cookie_heavy" | "navigation_only" | "marketing_boilerplate"
                                | "customer_stories_only" | "no_company_operations_content"
pages_scraped        string[] — Copy from [PAGES ANALYZED]
analyzed_at          string   — Copy from [ANALYZED AT]
validation_warnings  string[] — Any low-confidence signals or opportunities

━━━ STEP 13 — EXECUTIVE BRIEF ━━━

executive_brief  object  — 5-bullet intelligence summary for the sales team.
  Must be grounded in company-subject evidence only.
  Every field must reference specific signals, not industry generalities.
{
  "what_we_observed": ["Max 3 bullets. Directly observed facts from Tier 1/2 evidence only. Format: [Source] + observation."],
  "what_it_means": ["Max 2 bullets. What these observations IMPLY operationally for this company's business model."],
  "what_to_sell": "Single sentence. The ONE Demaze service best matched to their strongest signal.",
  "who_to_contact": "Exact job title. The single most likely buyer for the top opportunity.",
  "why_now": "Single sentence. A specific recent signal (expansion, hiring, acquisition, tech investment) — NOT a generic trend.",
  "overall_confidence": "high" | "medium" | "low"
}
RULE: what_we_observed must cite the source type (e.g., 'Annual report states...', 'Careers page shows...').
RULE: why_now must be a specific company event, not 'digital transformation is accelerating'.
RULE: overall_confidence = high only if 2+ Tier 1 evidence items support the top opportunity.
`.trim()
}


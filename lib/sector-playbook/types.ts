// ============================================================
// Sector Playbook — shared types
// ============================================================
// DRAFT, hand-written config layer for Auto Flow's three active target
// sectors (Manufacturing / Automotive / E-commerce — see CLAUDE.md's
// "SCOPE PIVOT" and the 2026-08-17 sector-playbook session). Every
// playbook's `status` is 'DRAFT' — this is NOT the official sector
// strategy document from the team. When that document arrives, replace
// the contents of playbooks.ts (or swap getSectorPlaybook's source
// entirely) and flip `status` to 'APPROVED'; nothing else in Auto Flow
// needs to change, since every consumer reads through this file's
// exported functions only, never a hardcoded literal.
//
// Distinct from lib/sales-knowledge/* (migrations 021/022) on purpose:
// that system is a general, admin-editable, DB-backed 8-industry
// knowledge base already wired end-to-end into email generation. This
// module is a narrower, richer, code-level draft scoped to exactly the
// 3 sectors Auto Flow currently targets, with fields (qualification/
// disqualification rules, evidence rules, personalization approach,
// follow-up strategy, example scenarios, prohibited claims) that the
// DB schema doesn't have. Both can coexist — see qualify.ts/classify.ts
// for how this module is consulted first, falling back to nothing (never
// to sales-knowledge) when a company is outside the 3 target sectors.
//
// relevantServices values MUST be drawn only from the 8 confirmed Demaze
// service lines in DEMAZE_CAPABILITY_MAP.md — this file does not invent
// services, per Part 5 of the sector-playbook request.
// ============================================================

export type TargetSector = 'manufacturing' | 'automotive' | 'ecommerce'

export type PlaybookStatus = 'DRAFT' | 'APPROVED'

export interface PlaybookOpportunityPattern {
  // A signal/keyword this pattern looks for in already-extracted research
  // (business profile, pain points, service-evidence). Matched, not implied.
  signal: string
  // Framed as a POSSIBLE problem, never a confirmed one — qualify.ts labels
  // the strength of the match (confirmed/inferred/none) at read time.
  possibleProblem: string
  // Must be one of the 8 confirmed Demaze service lines (see relevantServices).
  capability: string
}

export interface PlaybookExample {
  context: string
  evidence: string
  potentialProblem: string
  demazeCapability: string
  outreachAngle: string
}

export interface SectorPlaybook {
  sector: TargetSector
  status: PlaybookStatus
  label: string

  // A — sector definition
  definition: string
  // B — qualification criteria
  qualificationCriteria: string[]
  // C — disqualification criteria
  disqualificationCriteria: string[]
  // D — ideal company characteristics
  idealCompanyProfile: string[]
  // E — relevant company signals (also used by classify.ts for sector matching)
  signals: string[]
  // F/G — potential business problems mapped to Demaze capabilities
  opportunityPatterns: PlaybookOpportunityPattern[]
  // G — Demaze capabilities/services relevant to this sector (subset of the
  // 8 confirmed service lines only)
  relevantServices: string[]
  // H — relevant decision-maker roles (draft candidates only)
  decisionMakerRoles: string[]
  // I — what evidence should exist before making an outreach claim
  evidenceRules: string[]
  // J — personalization approach
  personalizationApproach: string
  // K — suggested outreach angle
  outreachAngle: string
  // L — suggested value proposition
  valueProposition: string
  // M — suggested CTA
  cta: string
  // N — follow-up logic
  followUpStrategy: string[]
  // O — example company profiles/use cases
  examples: PlaybookExample[]
  // P — confidence rules
  confidenceRules: string[]
  // Q — things the AI must NEVER claim without evidence
  prohibitedClaims: string[]
}

// ============================================================
// Decision-Maker Discovery — Shared Types
// ============================================================
// Mirrors lib/outbound/email-finder/types.ts's provider template. Given a
// company + a set of target titles (CEO/CTO/VP Operations/Plant Head, etc.),
// resolves candidate decision-makers — this is the one outbound capability
// that DOES discover who to contact (unlike Email Finder/Enrichment, which
// take a person name as input). Still never touches LinkedIn — a real
// provider is a people-data API (Prospeo Search Person or similar), never
// LinkedIn scraping. Candidates are surfaced for the user to review and
// select; nothing here writes to outbound_contacts directly.
// ============================================================

// Minimal shape of lib/pipeline/evidence-extractor.ts's LeadershipContact
// needed for grounding (see grounding.ts) — deliberately NOT importing the
// real type from lib/pipeline (a pipeline-internal module) into this
// outbound module; the API route boundary maps the real LeadershipContact[]
// into this shape when threading it through (see
// app/api/admin/outbound/decision-makers/discover/route.ts).
export interface LeadershipContactInput {
  name: string
  title: string
}

export interface DecisionMakerDiscoveryRequest {
  companyName: string
  domain: string
  // Defaults to DEFAULT_TARGET_TITLES when omitted or empty.
  targetTitles?: string[]
  // Already-extracted named leadership evidence from the company's OWN
  // scraped site (lib/pipeline/evidence-extractor.ts's leadershipContacts,
  // threaded through the API route — either from a live run's
  // extractorResult, or from a saved run's leadership_contacts field via
  // getLeadershipContacts(), see lib/pipeline/analysis-sections.ts).
  // Optional — when present, every returned candidate is cross-checked
  // against it and gets a `grounding` flag (see grounding.ts); when absent,
  // candidates are returned ungrounded exactly as before this field existed.
  leadershipContacts?: LeadershipContactInput[]
}

// Confirmed live (2026-07-19) against Ador Welding: the original Western-
// corporate-titled list alone (CEO/CTO/COO/VP Operations/Plant Head/VP Sales)
// returned zero Prospeo candidates, even though Prospeo's own index has a
// real, current Managing Director for that company — Prospeo's server-side
// person_job_title filter is a literal-ish match, not semantic, so an absent
// title string means an absent candidate regardless of seniority. "Managing
// Director"/"Chairman"/"Director" are the dominant top-executive titles at
// Indian companies (this repo's whole benchmark set) — same vocabulary
// already used by lib/pipeline/evidence-extractor.ts's LEADERSHIP_TITLE_PATTERN,
// reused here rather than re-derived.
export const DEFAULT_TARGET_TITLES = [
  'CEO', 'CTO', 'COO', 'CFO',
  'Managing Director', 'Chairman', 'Vice Chairman', 'Director',
  'VP Operations', 'VP Sales', 'Plant Head', 'General Manager',
]

export type DecisionMakerConfidence = 'high' | 'medium' | 'low'

// 'confirmed' = name+title both matched something already on the company's
// own site. 'conflict' = the name matched, but the title on-site differs
// from what the provider returned — surfaced for manual review, never
// silently resolved (same "flag, don't auto-merge" discipline as
// possibleDuplicateOf in lib/batch/company-dedup.ts). 'not_found' = the
// name isn't in the company's own extracted leadership content at all —
// this candidate is from the discovery provider only.
export type DecisionMakerGroundingStatus = 'confirmed' | 'conflict' | 'not_found'

export interface DecisionMakerGrounding {
  status: DecisionMakerGroundingStatus
  reason: string
}

export interface DecisionMakerCandidate {
  personName: string
  // The target title this candidate was matched against.
  title: string
  seniority?: string
  department?: string
  // Provider-supplied only — never scraped (LinkedIn access stays excluded).
  linkedinUrl?: string
  confidence: DecisionMakerConfidence
  // Only set when the request included leadershipContacts — see
  // DecisionMakerGrounding above.
  grounding?: DecisionMakerGrounding
}

export type DecisionMakerDiscoveryStatus = 'found' | 'not_found' | 'error'

export interface DecisionMakerDiscoveryResult {
  candidates: DecisionMakerCandidate[]
  providerUsed: string
  status: DecisionMakerDiscoveryStatus
  reason?: string
}

export interface DecisionMakerDiscoveryProvider {
  name: string
  displayName: string
  discoverDecisionMakers(request: DecisionMakerDiscoveryRequest): Promise<DecisionMakerDiscoveryResult>
  isAvailable(): Promise<boolean>
}

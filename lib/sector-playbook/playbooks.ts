// ============================================================
// DRAFT Sector Playbooks — Manufacturing / Automotive / E-commerce
// ============================================================
// See types.ts's header for what this is and how it gets replaced later.
// Every relevantServices/opportunityPatterns.capability value below is one
// of the 8 confirmed Demaze service lines from DEMAZE_CAPABILITY_MAP.md —
// nothing here invents a service. Examples are hypothetical composites, not
// real named companies (no verified Demaze case study exists yet for these
// three sectors in lib/knowledge/demaze-proof-points.ts).
// ============================================================

import type { SectorPlaybook, TargetSector } from './types'

const MANUFACTURING: SectorPlaybook = {
  sector: 'manufacturing',
  status: 'DRAFT',
  label: 'Manufacturing',

  definition:
    'Companies that make physical goods at scale: industrial manufacturers, engineering/manufacturing companies, equipment and component manufacturers, process manufacturers, and distributed manufacturing businesses operating across multiple plants, facilities, or regions.',

  qualificationCriteria: [
    'Company manufactures, fabricates, or assembles physical goods (not a pure reseller/distributor of finished goods made elsewhere)',
    'Evidence of more than one production facility, plant, or manufacturing unit, OR a single facility with clearly complex operations (large product catalog, multiple business units)',
    'Some evidence of operational or technology complexity: an ERP/CRM/enterprise system mentioned, a digital transformation or automation initiative, or a sizeable operational workforce',
  ],
  disqualificationCriteria: [
    'Company is a pure trading/distribution business with no manufacturing of its own',
    'Company is a single small workshop with no evidence of complexity (one product line, no facility/system mentions)',
    'Company\'s only online presence is a directory listing with no verifiable operational detail',
  ],
  idealCompanyProfile: [
    'Multiple manufacturing facilities or plants',
    'A complex, multi-tier supply chain',
    'Large or diversified product catalog',
    'Multiple business units or divisions',
    'Operations spanning multiple markets or geographies',
    'A named ERP/CRM or other enterprise system already in use',
  ],
  signals: [
    'manufacturer', 'manufacturing', 'factory', 'plant', 'facility', 'facilities',
    'production line', 'fabrication', 'assembly', 'industrial', 'engineering',
    'component manufacturer', 'equipment manufacturer', 'process manufacturing',
  ],
  opportunityPatterns: [
    {
      signal: 'multiple manufacturing facilities or plants mentioned',
      possibleProblem: 'Cross-location production visibility and consistency may be harder to maintain as facility count grows',
      capability: 'Internal operational software',
    },
    {
      signal: 'named ERP/CRM system mentioned with no AI layer described',
      possibleProblem: 'An existing enterprise system may lack AI-assisted decision support on top of it',
      capability: 'AI integrations and intelligent automation',
    },
    {
      signal: 'manual/delayed plant-to-HQ reporting language, or a job posting describing manual reporting tasks',
      possibleProblem: 'Plant-to-headquarters reporting may be manual and delayed rather than automated',
      capability: 'Workflow automation systems',
    },
    {
      signal: 'multiple business units or a large product catalog',
      possibleProblem: 'Operational data may be fragmented across units with no unified reporting view',
      capability: 'Analytics and reporting systems',
    },
    {
      signal: 'digital transformation or automation initiative mentioned',
      possibleProblem: 'A stated modernization goal may not yet have a concrete technical partner or roadmap',
      capability: 'AI-powered business applications',
    },
  ],
  relevantServices: [
    'Internal operational software',
    'Workflow automation systems',
    'Analytics and reporting systems',
    'AI integrations and intelligent automation',
    'AI-powered business applications',
  ],
  decisionMakerRoles: ['CIO', 'CTO', 'COO', 'Head of IT', 'Head of Digital Transformation', 'Head of Operations', 'VP Technology', 'VP Operations'],
  evidenceRules: [
    'Facility/plant count must come from the company\'s own stated content (site, filings, press) before being used as a claim, not assumed from company size alone',
    'An ERP/CRM/enterprise system must be named explicitly in the research before referencing it — never assume one exists',
    'A "manual reporting" or "operational visibility" problem is an inference unless a direct quote (job posting, interview, filing) describes the manual process',
    'A digital transformation initiative must be a stated company initiative, not inferred from industry norms',
  ],
  personalizationApproach:
    'Open with the specific, verifiable operational fact (facility count, named system, stated initiative) rather than a generic manufacturing observation. Frame the potential problem as a question or a reasonable inference, never a confirmed diagnosis.',
  outreachAngle:
    'Coordinating operations across multiple facilities or business units usually surfaces the same pattern: someone is stitching together reports by hand that could be automated.',
  valueProposition:
    'Demaze builds the internal operational software and automation layer that keeps multi-facility or multi-unit manufacturing data consistent and visible, without a rip-and-replace of existing systems.',
  cta: 'Worth 15 minutes to see how this could work across your facilities?',
  followUpStrategy: [
    'Follow-up 1 (day 3-5): surface a different confirmed fact or a relevant example pattern, not a repeat of the opener',
    'Follow-up 2 (day 7-10): a short, concrete example of the kind of automation/visibility gap this pattern usually points to',
    'Follow-up 3 (day 14+, final): a brief, low-pressure close ("should I check back later, or is this not a priority right now?"), then stop automated follow-ups',
  ],
  examples: [
    {
      context: 'Hypothetical mid-size industrial component manufacturer with 4 stated production facilities across two states.',
      evidence: 'Company website lists 4 manufacturing facilities; a recent press release mentions a new ERP rollout at one facility.',
      potentialProblem: 'Facility-level reporting may not yet be unified across all 4 sites under the new ERP.',
      demazeCapability: 'Internal operational software',
      outreachAngle: 'Rolling out a new ERP at one facility often raises the question of whether the other sites will report the same way, or fall further behind — worth a short conversation on how that\'s being handled?',
    },
    {
      context: 'Hypothetical process manufacturer with a stated multi-year digital transformation initiative.',
      evidence: 'A company press release states a "digital transformation initiative" without further technical detail.',
      potentialProblem: 'The stated initiative may not yet have a concrete AI/automation execution partner.',
      demazeCapability: 'AI-powered business applications',
      outreachAngle: 'Saw the digital transformation initiative mentioned in your recent release, curious what\'s driving it and whether the execution side is locked in yet.',
    },
    {
      context: 'Hypothetical equipment manufacturer with job postings mentioning SAP as a required skill.',
      evidence: 'Job posting explicitly requires "SAP MM" experience.',
      potentialProblem: 'An existing SAP deployment may have no AI-assisted layer built on top of it.',
      demazeCapability: 'AI integrations and intelligent automation',
      outreachAngle: 'Noticed you\'re running SAP; most teams we talk to are still doing the decision-making on top of it by hand rather than with any AI assist. Worth a quick look at what that could look like?',
    },
    {
      context: 'Hypothetical component manufacturer with 3 distinct product lines and no unified reporting mentioned anywhere.',
      evidence: 'Website describes 3 separate product divisions with no shared dashboard or reporting language.',
      potentialProblem: 'Cross-division visibility into performance may not exist today.',
      demazeCapability: 'Analytics and reporting systems',
      outreachAngle: 'Running 3 product lines usually means someone at HQ is manually combining numbers from each to get a full picture. Worth seeing how that gets automated?',
    },
  ],
  confidenceRules: [
    'CONFIRMED FACT: the exact detail (facility count, named system, stated initiative) appears verbatim in the company\'s own research',
    'OBSERVED SIGNAL: a related but not identical detail appears (e.g. "multiple locations" without an exact count)',
    'REASONABLE INFERENCE: a plausible operational consequence of a confirmed fact, clearly framed as a possibility, not a diagnosis',
    'UNVERIFIED ASSUMPTION: anything with no supporting fact at all — never used in outreach copy',
  ],
  prohibitedClaims: [
    'Never claim a specific inefficiency ("your inventory management is inefficient") without direct evidence',
    'Never claim a specific headcount, revenue figure, or financial detail unless it is directly present in the research',
    'Never name a specific competitor or vendor the company uses unless it is directly stated in the research',
    'Never claim Demaze has previously worked with this exact company unless a verified case study confirms it',
  ],
}

const AUTOMOTIVE: SectorPlaybook = {
  sector: 'automotive',
  status: 'DRAFT',
  label: 'Automotive',

  definition:
    'Automotive manufacturers, auto component manufacturers (Tier 1/Tier 2 suppliers), automotive engineering and technology companies, and large automotive service/dealership/operations businesses.',

  qualificationCriteria: [
    'Company manufactures vehicles or vehicle/auto components, or operates a significant automotive sales/service/dealership network',
    'Evidence of production scale, a supplier ecosystem, or a multi-location dealership/service network',
    'Some evidence of operational or technology complexity: quality/compliance workflows, enterprise systems, or a stated digital initiative',
  ],
  disqualificationCriteria: [
    'A single independent repair shop or single dealership with no evidence of a network or notable scale',
    'A pure auto-parts retailer with no manufacturing or service-network component',
    'Only a directory listing with no verifiable operational detail',
  ],
  idealCompanyProfile: [
    'Multiple production facilities or a multi-location dealership/service network',
    'A complex supplier ecosystem (Tier 1/Tier 2 relationships)',
    'High-volume operations with complex inventory',
    'Quality or compliance workflows referenced (a regulated, standards-heavy industry)',
    'Global or regional operations across multiple markets',
  ],
  signals: [
    'automotive', 'dealership', 'vehicle', 'auto component', 'tier 1 supplier', 'tier 2 supplier',
    'oem', 'showroom', 'auto parts', 'automotive engineering', 'car dealer', 'after-sales',
  ],
  opportunityPatterns: [
    {
      signal: 'multiple dealership or service locations mentioned',
      possibleProblem: 'Sales and service performance may not be visible at the individual-location level',
      capability: 'Analytics and reporting systems',
    },
    {
      signal: 'Tier 1/Tier 2 supplier relationships or a stated supply chain',
      possibleProblem: 'Coordinating quality and delivery data across suppliers may be manual today',
      capability: 'Workflow automation systems',
    },
    {
      signal: 'a named enterprise system with no AI layer described',
      possibleProblem: 'Existing systems may lack AI-assisted decision support (e.g. lead scoring, dealer performance ranking)',
      capability: 'AI integrations and intelligent automation',
    },
    {
      signal: 'quality/compliance workflow language',
      possibleProblem: 'Quality and compliance tracking may still be document-based rather than system-based',
      capability: 'Internal operational software',
    },
    {
      signal: 'digital transformation or dealer-network modernization initiative mentioned',
      possibleProblem: 'A stated modernization goal may not yet have a concrete execution partner',
      capability: 'AI-powered business applications',
    },
  ],
  relevantServices: [
    'AI-powered business applications',
    'Workflow automation systems',
    'Analytics and reporting systems',
    'AI integrations and intelligent automation',
    'Internal operational software',
  ],
  decisionMakerRoles: ['CIO', 'CTO', 'COO', 'Head of Digital Transformation', 'Head of Operations', 'Head of Manufacturing', 'Head of IT', 'VP Technology'],
  evidenceRules: [
    'A dealership/service network location count must come from the company\'s own stated content before being used as a claim',
    'A supplier relationship (Tier 1/Tier 2) must be explicitly described, not assumed from "automotive component manufacturer" alone',
    'A quality/compliance gap is an inference unless a direct quote describes the current process as manual/document-based',
  ],
  personalizationApproach:
    'Open with the specific, verifiable fact (dealership count, named supplier relationship, stated compliance process) rather than a generic "automotive companies need AI" framing. Frame potential problems as questions, not diagnoses.',
  outreachAngle:
    'Coordinating sales, service, and inventory data across a dealer or supplier network usually surfaces the same gap: performance visibility that only exists at the aggregate level, not per location.',
  valueProposition:
    'Demaze builds AI-powered dealer/network intelligence and workflow automation that surfaces performance and quality data at the individual-location or individual-supplier level, without replacing existing systems.',
  cta: 'Happy to share how we approached this for a similar network, worth a quick look?',
  followUpStrategy: [
    'Follow-up 1 (day 3-5): surface a different confirmed fact or a relevant example pattern, not a repeat of the opener',
    'Follow-up 2 (day 7-10): a short, concrete example of the kind of visibility/automation gap this pattern usually points to',
    'Follow-up 3 (day 14+, final): a brief, low-pressure close, then stop automated follow-ups',
  ],
  examples: [
    {
      context: 'Hypothetical multi-location dealership group with a stated network of dealerships across a region.',
      evidence: 'Website lists a network of dealership locations across multiple cities.',
      potentialProblem: 'Sales and service performance may only be visible in aggregate, not per dealership.',
      demazeCapability: 'AI-powered business applications',
      outreachAngle: 'Running a network this size usually means HQ sees the total numbers clearly, but per-dealership performance takes a lot more digging. Worth a look at how that gets surfaced automatically?',
    },
    {
      context: 'Hypothetical Tier 1 auto component supplier with a stated multi-plant production footprint.',
      evidence: 'Company describes itself as a Tier 1 supplier with production across multiple plants.',
      potentialProblem: 'Quality and delivery data across plants and downstream OEM relationships may be coordinated manually.',
      demazeCapability: 'Workflow automation systems',
      outreachAngle: 'Coordinating quality data across plants for a Tier 1 supplier relationship is usually one of the more manual parts of the operation. Worth 15 minutes to see how that could be automated?',
    },
    {
      context: 'Hypothetical automotive engineering company with job postings requiring a named enterprise system.',
      evidence: 'Job posting requires experience with a specific ERP/PLM system.',
      potentialProblem: 'The named system may have no AI-assisted layer for engineering or operational decisions.',
      demazeCapability: 'AI integrations and intelligent automation',
      outreachAngle: 'Noticed the [system] requirement in your recent job posting, curious whether the decisions built on top of it are still fully manual today.',
    },
    {
      context: 'Hypothetical automotive component manufacturer with a stated quality-compliance certification.',
      evidence: 'Website references a specific quality/compliance certification (e.g. IATF-style language) without describing the tracking system.',
      potentialProblem: 'Compliance tracking may still be document-based.',
      demazeCapability: 'Internal operational software',
      outreachAngle: 'Compliance-heavy operations like this usually have the certification nailed down but the day-to-day tracking still living in spreadsheets or documents. Worth checking how that\'s handled today?',
    },
  ],
  confidenceRules: [
    'CONFIRMED FACT: the exact detail (dealership count, named supplier tier, named system, certification) appears verbatim in the company\'s own research',
    'OBSERVED SIGNAL: a related but not identical detail appears',
    'REASONABLE INFERENCE: a plausible operational consequence of a confirmed fact, clearly framed as a possibility',
    'UNVERIFIED ASSUMPTION: anything with no supporting fact at all — never used in outreach copy',
  ],
  prohibitedClaims: [
    'Never claim a specific quality or compliance failure without direct evidence',
    'Never claim a specific sales/revenue figure unless directly present in the research',
    'Never name a specific OEM or competitor relationship unless directly stated in the research',
    'Never claim Demaze has previously worked with this exact company unless a verified case study confirms it',
  ],
}

const ECOMMERCE: SectorPlaybook = {
  sector: 'ecommerce',
  status: 'DRAFT',
  label: 'E-commerce',

  definition:
    'Large e-commerce businesses, D2C brands, online marketplaces, omnichannel retailers, and multi-brand or high-volume digital commerce companies.',

  qualificationCriteria: [
    'Company sells directly to consumers online, operates a marketplace, or runs a significant omnichannel digital commerce operation',
    'Evidence of scale: large product catalog, multiple sales channels, multiple markets, or rapid stated growth',
    'Some evidence of operational or technology complexity: multiple integrations, a stated data/analytics gap, or a digital transformation initiative',
  ],
  disqualificationCriteria: [
    'A single-product store with no evidence of scale or complexity',
    'A company using only a generic hosted storefront (e.g. a basic Shopify page) with no other operational signal',
    'Only a directory or marketplace-profile listing with no verifiable operational detail',
  ],
  idealCompanyProfile: [
    'Large product catalog',
    'High transaction volume',
    'Multiple sales channels (own site, marketplaces, social commerce)',
    'Multiple markets or regions served',
    'Customer-service or order-management complexity referenced',
    'Rapid stated growth or recent funding/expansion news',
  ],
  signals: [
    'ecommerce', 'e-commerce', 'online store', 'd2c', 'direct to consumer', 'online marketplace',
    'omnichannel', 'checkout', 'multi-brand', 'online retailer', 'digital commerce',
  ],
  opportunityPatterns: [
    {
      signal: 'multiple sales channels mentioned (own site + marketplaces + social)',
      possibleProblem: 'Revenue and inventory data may be fragmented across channels with no unified view',
      capability: 'Analytics and reporting systems',
    },
    {
      signal: 'multiple integrations or platforms mentioned',
      possibleProblem: 'Data unification across integrations may be manual or incomplete',
      capability: 'Ecommerce ecosystems',
    },
    {
      signal: 'a marketplace or two-sided platform model described',
      possibleProblem: 'Vendor onboarding and trust/matching systems may still be immature for the platform\'s scale',
      capability: 'Marketplace platforms',
    },
    {
      signal: 'rapid growth or recent funding/expansion news',
      possibleProblem: 'Internal tooling may not have scaled at the same pace as the business',
      capability: 'Custom SaaS platforms',
    },
    {
      signal: 'customer service scale or support-volume language',
      possibleProblem: 'Customer service or order-management workflows may still rely on manual triage',
      capability: 'AI integrations and intelligent automation',
    },
  ],
  relevantServices: [
    'Ecommerce ecosystems',
    'Marketplace platforms',
    'Analytics and reporting systems',
    'Custom SaaS platforms',
    'AI integrations and intelligent automation',
  ],
  decisionMakerRoles: ['CTO', 'CIO', 'COO', 'Head of Digital', 'Head of E-commerce', 'Head of Technology', 'Head of Operations', 'VP Digital Transformation'],
  evidenceRules: [
    'A channel count (own site + marketplaces + social) must be explicitly described, not assumed from "e-commerce brand" alone',
    'A stated growth/funding event must come from the company\'s own or verified third-party news, not inferred from generic industry growth',
    'A data-fragmentation problem is an inference unless a direct quote describes disconnected systems or manual reconciliation',
  ],
  personalizationApproach:
    'Open with the specific, verifiable fact (channel mix, recent growth/funding news, a named integration) rather than a generic "e-commerce companies need AI" framing. Frame potential problems as questions, not diagnoses.',
  outreachAngle:
    'Selling across multiple channels usually means the revenue and inventory picture lives in three different dashboards instead of one.',
  valueProposition:
    'Demaze builds and extends e-commerce ecosystems and unified analytics that bring multi-channel data together, without replacing the storefront or platform already in place.',
  cta: 'Worth 15 minutes to see how this could work across your channels?',
  followUpStrategy: [
    'Follow-up 1 (day 3-5): surface a different confirmed fact or a relevant example pattern, not a repeat of the opener',
    'Follow-up 2 (day 7-10): a short, concrete example of the kind of data-unification or automation gap this pattern usually points to',
    'Follow-up 3 (day 14+, final): a brief, low-pressure close, then stop automated follow-ups',
  ],
  examples: [
    {
      context: 'Hypothetical D2C brand selling on its own site plus two major marketplaces.',
      evidence: 'Company\'s own site and public listings confirm presence on two named marketplaces in addition to its own storefront.',
      potentialProblem: 'Revenue and inventory data across all three channels may not be unified in one place.',
      demazeCapability: 'Analytics and reporting systems',
      outreachAngle: 'Selling across your own site plus two marketplaces usually means three different dashboards to check every morning. Worth seeing what a unified view looks like?',
    },
    {
      context: 'Hypothetical online marketplace connecting buyers and independent sellers.',
      evidence: 'Company describes itself as a marketplace connecting independent sellers with buyers.',
      potentialProblem: 'Vendor onboarding and trust/verification systems may still be manual at the marketplace\'s current scale.',
      demazeCapability: 'Marketplace platforms',
      outreachAngle: 'Marketplaces at your stage usually hit a point where manually vetting new sellers stops scaling. Worth a look at how that gets systematized?',
    },
    {
      context: 'Hypothetical D2C brand with a recent funding announcement and stated expansion plans.',
      evidence: 'A recent, verifiable funding or expansion announcement from the company.',
      potentialProblem: 'Internal tooling may not yet be built for the scale the funding is meant to support.',
      demazeCapability: 'Custom SaaS platforms',
      outreachAngle: 'Congrats on the recent raise, curious whether the internal tooling is already built for the scale you\'re about to hit, or if that\'s still being figured out.',
    },
    {
      context: 'Hypothetical omnichannel retailer with a stated high volume of customer support tickets.',
      evidence: 'A job posting or public statement references a large customer support team or support-ticket volume.',
      potentialProblem: 'Support ticket triage may still rely on manual routing rather than AI-assisted classification.',
      demazeCapability: 'AI integrations and intelligent automation',
      outreachAngle: 'Support volume at your scale usually means a lot of manual ticket triage. Worth a quick look at how AI-assisted routing could take some of that off the team\'s plate?',
    },
  ],
  confidenceRules: [
    'CONFIRMED FACT: the exact detail (channel mix, funding event, integration, ticket volume) appears verbatim in the company\'s own research or verified third-party coverage',
    'OBSERVED SIGNAL: a related but not identical detail appears',
    'REASONABLE INFERENCE: a plausible operational consequence of a confirmed fact, clearly framed as a possibility',
    'UNVERIFIED ASSUMPTION: anything with no supporting fact at all — never used in outreach copy',
  ],
  prohibitedClaims: [
    'Never claim a specific revenue, GMV, or transaction-volume figure unless directly present in the research',
    'Never claim a specific platform/tech-stack detail (e.g. "you\'re on Shopify") unless directly confirmed',
    'Never name a specific competitor unless directly stated in the research',
    'Never claim Demaze has previously worked with this exact company unless a verified case study confirms it',
  ],
}

const PLAYBOOKS: Record<TargetSector, SectorPlaybook> = {
  manufacturing: MANUFACTURING,
  automotive: AUTOMOTIVE,
  ecommerce: ECOMMERCE,
}

// The single read path every consumer (classify.ts, qualify.ts, generation
// prompts, role-recommendation.ts, the Auto Flow UI) goes through — swapping
// the official document in later means changing this function's source,
// nothing else.
export function getSectorPlaybook(sector: TargetSector): SectorPlaybook {
  return PLAYBOOKS[sector]
}

export function getAllSectorPlaybooks(): SectorPlaybook[] {
  return [MANUFACTURING, AUTOMOTIVE, ECOMMERCE]
}

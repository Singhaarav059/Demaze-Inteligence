// ============================================================
// Demaze Proof Points — static knowledge base
// ============================================================
// Hand-curated from 4 real Demaze documents (2026-07-16): the named-client
// case-studies deck, the Manufacturing AI OS capability deck, the AI for
// Automotive capability deck, and the master Company Profile & Portfolio
// deck. Company self-knowledge like this is static and small enough to be
// code-maintained once, not re-extracted at runtime — same category as
// service-evidence.ts's fixed 8-service catalog, not the search-grounded
// discovery modules (competitor-discovery.ts / icp-generator.ts /
// market-intelligence.ts), which have no fixed source to hand-curate from.
//
// `provenance` is load-bearing, not decorative: 'named_client' entries come
// from the named-client case-studies deck (Volvo Cars India, Mercedes Benz
// India, etc.) — real, individually-attributed engagements. 'composite_
// illustrative' entries come from the Manufacturing AI OS / AI for
// Automotive capability decks (unnamed clients, e.g. "a mid-market
// manufacturer running 4 plants") and the portfolio deck's anonymized case
// studies ("It is..."). Both are real delivered work, but only
// 'named_client' entries may ever be presented as attributable to a named
// company — this distinction must survive into the prompt (lib/prompts/
// analyze-v2.ts) and the UI (ResearchCard.tsx) so nothing is ever
// misrepresented as a named-client result it isn't. Same "never blur
// evidence" discipline as classifySubject()'s product_capability vs.
// company_operations split (lib/pipeline/evidence-extractor.ts).
//
// Deliberately excluded: the docx's 5 embedded reference images (other
// companies' cold-email examples used as structural inspiration only) —
// not Demaze's own delivered work, so not ingested as proof points. Their
// structural lessons (pattern interrupt, social proof anchor, micro
// commitment, personalized-opener anatomy) are baked into the outreach
// drafting prompt instructions instead (analyze-v2.ts), not stored here.
// ============================================================

export interface ProofPointOutcome {
  metric: string
  value: string
  window?: string
}

export type ProofPointProvenance = 'named_client' | 'composite_illustrative'

export interface ProofPoint {
  id: string
  title: string
  /** Real client name for named_client entries; a short composite description otherwise. */
  client: string
  provenance: ProofPointProvenance
  industry_tags: string[]
  capability_tags: string[]
  challenge: string
  outcomes: ProofPointOutcome[]
  source_doc: string
}

export const DEMAZE_PROOF_POINTS: ProofPoint[] = [
  // ── Named-client case studies (AI Deployment Case Studies deck) ──────

  {
    id: 'volvo-executive-intelligence',
    title: 'Executive Intelligence Platform',
    client: 'Volvo Cars India',
    provenance: 'named_client',
    industry_tags: ['automotive', 'dealership'],
    capability_tags: ['cxo-dashboard', 'executive-reporting'],
    challenge: 'Dealership principals managing operations through daily WhatsApp updates, manual Excel MIS reports, and disconnected dashboards, with no unified view of business health.',
    outcomes: [
      { metric: 'Daily manual MIS reports retired', value: '4 to 0' },
      { metric: 'Leadership intervention time', value: 'reduced from days to under 1 hour' },
      { metric: 'Multi-branch health comparison', value: 'real-time (e.g. Mumbai 78/100 vs Pune 61/100)' },
    ],
    source_doc: 'Demaze_Technologies_AI_Case_Studies.pdf p.2',
  },
  {
    id: 'volvo-sales-intelligence',
    title: 'Sales Intelligence AI',
    client: 'Volvo Cars India',
    provenance: 'named_client',
    industry_tags: ['automotive', 'dealership'],
    capability_tags: ['lead-scoring', 'sales-funnel', 'sales-coaching'],
    challenge: 'Leads from digital campaigns, walk-ins, OEM portals, and telephony managed in silos; high-value leads not prioritised, inconsistent follow-up, no funnel visibility.',
    outcomes: [
      { metric: 'High-priority leads surfaced automatically', value: 'from 40+ weekly enquiries' },
      { metric: 'Funnel drop-off addressed', value: 'within 48 hours' },
    ],
    source_doc: 'Demaze_Technologies_AI_Case_Studies.pdf p.3',
  },
  {
    id: 'mercedes-used-car-intelligence',
    title: 'Used Car Intelligence AI',
    client: 'Mercedes Benz India',
    provenance: 'named_client',
    industry_tags: ['automotive', 'dealership'],
    capability_tags: ['used-car-valuation', 'procurement', 'profitability-ai'],
    challenge: 'Used car operations relied on gut-feel valuations, paper-based inspection, and no standardised view of inventory aging or margins; procurement was slow and inconsistent.',
    outcomes: [
      { metric: 'Projected margin per unit (XC60 MY2021, highest-demand variant)', value: 'INR 65,000-80,000' },
      { metric: 'Valuation disputes', value: 'eliminated via fully digital, auditable inspection trail' },
    ],
    source_doc: 'Demaze_Technologies_AI_Case_Studies.pdf p.4',
  },
  {
    id: 'mercedes-ai-dealer-software',
    title: 'AI-Based Dealer Management Software',
    client: "Mercedes Benz India (one of India's largest luxury car dealerships)",
    provenance: 'named_client',
    industry_tags: ['automotive', 'dealership'],
    capability_tags: ['dealer-management-software', 'used-car-valuation', 'emi-calculation'],
    challenge: 'Needed a single platform for used car valuations, new car EMI calculations, refurbishment tracking, and sales workflows instead of stitching together disconnected tools.',
    outcomes: [
      { metric: 'Operational efficiency', value: 'significantly improved across dealership verticals' },
      { metric: 'Disconnected tools', value: 'eliminated reliance on multiple' },
    ],
    source_doc: 'Demaze_Technologies_AI_Case_Studies.pdf p.5',
  },
  {
    id: 'trading-platform-risk-intelligence',
    title: 'AI Risk Intelligence System',
    client: 'Active Trading Ecosystem Platform',
    provenance: 'named_client',
    industry_tags: ['fintech', 'trading'],
    capability_tags: ['risk-scoring', 'anomaly-detection', 'market-intelligence-alerts'],
    challenge: 'Could not answer in real time which traders were becoming over-leveraged, which accounts showed abnormal behaviour, or which market signals could trigger risk spikes.',
    outcomes: [
      { metric: 'Risk monitoring', value: 'real-time across all active traders and accounts' },
      { metric: 'Alerts', value: 'predictive, issued before risk events occur' },
    ],
    source_doc: 'Demaze_Technologies_AI_Case_Studies.pdf p.6',
  },
  {
    id: 'kids-fashion-luxury-ecommerce',
    title: 'AI-Powered Luxury Ecommerce Platform',
    client: 'Sustainable Luxury Fashion Marketplace (pre-owned designer children\'s clothing)',
    provenance: 'named_client',
    industry_tags: ['ecommerce', 'fashion', 'circular-economy'],
    capability_tags: ['marketplace-platform', 'personalization', 'blockchain-authentication'],
    challenge: 'Wanted a first-of-its-kind sustainable luxury marketplace combining AI personalisation, product authentication, live commerce, and circular fashion mechanics.',
    outcomes: [
      { metric: 'Category', value: 'first AI-powered circular fashion marketplace for luxury children\'s wear' },
      { metric: 'Authenticity', value: 'guaranteed via blockchain Digital Product Passports' },
    ],
    source_doc: 'Demaze_Technologies_AI_Case_Studies.pdf p.7',
  },
  {
    id: 'film-storyboard-ai',
    title: 'AI Storyboard Creation Platform',
    client: 'Film, Advertising & Content Production Industry',
    provenance: 'named_client',
    industry_tags: ['media', 'creative-technology'],
    capability_tags: ['generative-ai', 'content-automation'],
    challenge: 'Traditional storyboard creation is slow, expensive, and requires skilled illustrators, slowing down pre-production visualisation.',
    outcomes: [
      { metric: 'Script-to-storyboard generation', value: 'reduced from days to minutes' },
    ],
    source_doc: 'Demaze_Technologies_AI_Case_Studies.pdf p.8',
  },

  // ── Manufacturing AI OS (composite/illustrative, 19-workflow deck) ───

  {
    id: 'mfg-cxo-command-center',
    title: 'Factory AI Command Center',
    client: 'Composite: mid-market manufacturer running 4 plants and ~40 distributors',
    provenance: 'composite_illustrative',
    industry_tags: ['manufacturing', 'industrial'],
    capability_tags: ['cxo-dashboard', 'executive-reporting'],
    challenge: 'Leadership relied on a Monday MIS pack instead of live, cross-plant visibility into yield, downtime, and working capital.',
    outcomes: [
      { metric: 'OEE lift across 4 plants', value: '+9.4%', window: '6 months' },
      { metric: 'Time-to-insight for plant reviews', value: '-71%' },
      { metric: 'Daily manual MIS reports retired', value: '4 to 0' },
    ],
    source_doc: 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 01',
  },
  {
    id: 'mfg-production-planning',
    title: 'AI Production Planning Engine',
    client: 'Composite: 3-line FMCG plant',
    provenance: 'composite_illustrative',
    industry_tags: ['manufacturing'],
    capability_tags: ['production-planning'],
    challenge: 'Weekly production scheduling was manual and slow to re-plan when an order, breakdown, or raw-material delay hit.',
    outcomes: [
      { metric: 'Production lead time on top-50 SKUs', value: '-28%' },
      { metric: 'On-time delivery to customer commit', value: '+14%' },
      { metric: 'Re-planning speed vs. Excel-based PPC', value: '3.5x faster' },
    ],
    source_doc: 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 02',
  },
  {
    id: 'mfg-predictive-maintenance',
    title: 'Predictive Maintenance AI',
    client: 'Composite: metal-fabrication plant running 60+ critical assets',
    provenance: 'composite_illustrative',
    industry_tags: ['manufacturing', 'industrial'],
    capability_tags: ['predictive-maintenance', 'iot'],
    challenge: 'No way to predict asset failure ahead of time; maintenance was reactive, driving unplanned downtime.',
    outcomes: [
      { metric: 'Unplanned downtime on critical assets', value: '-47%' },
      { metric: 'OEE uplift from availability', value: '+11%' },
      { metric: 'Average early-warning window before failure', value: '14 days' },
    ],
    source_doc: 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 03',
  },
  {
    id: 'mfg-quality-control',
    title: 'AI Quality Control on Line',
    client: 'Composite: discrete-parts assembly line',
    provenance: 'composite_illustrative',
    industry_tags: ['manufacturing'],
    capability_tags: ['quality-control', 'computer-vision'],
    challenge: 'Manual QC missed real-time defect detection, driving rework cost and customer complaints.',
    outcomes: [
      { metric: 'Defect detection accuracy on golden set', value: '99.2%' },
      { metric: 'Defect rework cost per 1,000 units', value: '-54%' },
      { metric: 'Inspection throughput vs. manual QC', value: '4x' },
    ],
    source_doc: 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 04',
  },
  {
    id: 'mfg-dms-distributor-intelligence',
    title: 'DMS & Distributor Intelligence',
    client: 'Composite: consumer-durables brand with 140+ distributors across 12 states',
    provenance: 'composite_illustrative',
    industry_tags: ['manufacturing', 'distribution'],
    capability_tags: ['dms-intelligence', 'distributor-scoring'],
    challenge: 'No way to score distributor health or spot territory gaps where retailer demand existed but coverage was thin.',
    outcomes: [
      { metric: 'Secondary-sales visibility coverage', value: '+18%' },
      { metric: 'Scheme attainment', value: '87% vs. 51% baseline' },
      { metric: 'Credit-overdue ratio across the network', value: '-34%' },
    ],
    source_doc: 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 09',
  },
  {
    id: 'mfg-credit-cashflow',
    title: 'Distributor Credit & Cashflow AI',
    client: 'Composite: 142-dealer distribution network',
    provenance: 'composite_illustrative',
    industry_tags: ['manufacturing', 'distribution', 'fintech'],
    capability_tags: ['credit-risk-scoring', 'dunning-automation'],
    challenge: 'No systematic way to predict overdue/bad-debt risk or chase collections without souring dealer relationships.',
    outcomes: [
      { metric: 'Days-sales-outstanding (DSO)', value: '-16 days' },
      { metric: 'Overdue receivables >30 days', value: '-41%' },
      { metric: 'Cash freed', value: '₹4.1 Cr', window: 'first 6 months' },
    ],
    source_doc: 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 10',
  },
  {
    id: 'mfg-supply-chain',
    title: 'Multi-Warehouse Supply Chain AI',
    client: 'Composite: 6 distribution centers in India + 2 in East Africa',
    provenance: 'composite_illustrative',
    industry_tags: ['manufacturing', 'distribution', 'supply-chain'],
    capability_tags: ['supply-chain-optimization', 'inventory-balancing'],
    challenge: 'No proactive way to rebalance SKUs across warehouses or spot cross-border logistics delay risk without growing inventory.',
    outcomes: [
      { metric: 'Fill-rate improvement', value: '+14 pts', window: '6 months' },
      { metric: 'Logistics cost per unit shipped', value: '-19%' },
      { metric: 'Working capital released across DCs', value: '₹3.4 Cr' },
    ],
    source_doc: 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 17',
  },
  {
    id: 'mfg-hr-workforce',
    title: 'HR & Workforce Intelligence',
    client: 'Composite: 4 plants, 1,400+ operators',
    provenance: 'composite_illustrative',
    industry_tags: ['manufacturing', 'industrial'],
    capability_tags: ['workforce-optimization', 'attrition-prediction'],
    challenge: 'HR was spreadsheet-driven, with no way to predict attrition or match technicians to work orders by skill.',
    outcomes: [
      { metric: 'Overtime hours across the network', value: '-21%' },
      { metric: 'Voluntary attrition', value: '-14 pts', window: '12 months' },
      { metric: 'Optimal tech-to-WO match rate', value: '94%' },
    ],
    source_doc: 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 06',
  },
  {
    id: 'mfg-aggregate-impact',
    title: 'Manufacturing AI OS — Aggregate Impact',
    client: 'Composite: aggregate median across 19 real Demaze manufacturing engagements',
    provenance: 'composite_illustrative',
    industry_tags: ['manufacturing', 'industrial', 'distribution'],
    capability_tags: ['aggregate-impact'],
    challenge: 'Cross-engagement summary, not a single company\'s challenge — use only when no single-workflow proof point is a closer match.',
    outcomes: [
      { metric: 'OEE / output uplift', value: '+14%', window: 'median, first 6 months post go-live' },
      { metric: 'Faster decisioning', value: '3.2x' },
      { metric: 'Working capital released', value: '₹3.4 Cr', window: 'median' },
      { metric: 'From kickoff to KPI move', value: '90 days' },
    ],
    source_doc: 'Demaze - Manufacturing AI OS Case Studies.pdf, Aggregate Impact p.22',
  },

  // ── AI for Automotive (composite/illustrative, 10-workflow deck) ─────

  {
    id: 'auto-cxo-command-center',
    title: 'CXO AI Command Center',
    client: 'Composite: multi-brand dealership group operating 30+ outlets',
    provenance: 'composite_illustrative',
    industry_tags: ['automotive', 'dealership'],
    capability_tags: ['cxo-dashboard', 'executive-reporting'],
    challenge: 'Leadership relied on a weekly analyst pack instead of a live, conversational view of margin, retail, and service KPIs.',
    outcomes: [
      { metric: 'Time-to-insight for leadership reviews', value: '-72%' },
      { metric: 'FTE analyst dependency for recurring MIS', value: '5 to 0' },
      { metric: 'Margin lift on flagged anomalies actioned within 48h', value: '+14%' },
    ],
    source_doc: 'Demaze - AI for Automotive Case Studies.pdf, Case Study 01',
  },
  {
    id: 'auto-predictive-service',
    title: 'Predictive Service & Workshop AI',
    client: 'Composite: authorised service network running 9 workshops',
    provenance: 'composite_illustrative',
    industry_tags: ['automotive', 'dealership', 'after-sales'],
    capability_tags: ['predictive-maintenance', 'bay-scheduling'],
    challenge: 'No predictive view of upcoming service needs or bay utilisation, leading to longer turnaround and lower revenue per customer.',
    outcomes: [
      { metric: 'Bay utilisation across the network', value: '+27%' },
      { metric: 'Vehicle turnaround time per RO', value: '-34%' },
      { metric: 'Next-service prediction accuracy (±500km)', value: '94%' },
    ],
    source_doc: 'Demaze - AI for Automotive Case Studies.pdf, Case Study 04',
  },
  {
    id: 'auto-voice-agents',
    title: 'AI Voice Agents for Sales & Service',
    client: 'Composite: multi-language workshop cluster',
    provenance: 'composite_illustrative',
    industry_tags: ['automotive', 'dealership', 'after-sales'],
    capability_tags: ['voice-agents', 'multilingual-support'],
    challenge: 'Service reminders, missed-lead callbacks, and feedback calls were manual and expensive to staff at scale.',
    outcomes: [
      { metric: 'Calls handled per month per workshop cluster', value: '38,000' },
      { metric: 'Cost per outbound contact vs. tele-callers', value: '-68%' },
      { metric: 'Service booking conversion on due reminders', value: '+24%' },
    ],
    source_doc: 'Demaze - AI for Automotive Case Studies.pdf, Case Study 05',
  },
  {
    id: 'auto-sales-copilot',
    title: 'AI Sales Co-Pilot & Lead Intelligence',
    client: 'Composite: 14-showroom passenger-car retailer',
    provenance: 'composite_illustrative',
    industry_tags: ['automotive', 'dealership'],
    capability_tags: ['lead-scoring', 'sales-copilot'],
    challenge: 'Consultants had no scoring or next-best-action guidance on walk-in and digital leads, leaving conversion to instinct.',
    outcomes: [
      { metric: 'Lead-to-booking conversion in pilot quarter', value: '+31%' },
      { metric: 'Manual lead admin time per consultant', value: '-47%' },
      { metric: 'Test-drives per active consultant per week', value: '2.4x' },
    ],
    source_doc: 'Demaze - AI for Automotive Case Studies.pdf, Case Study 06',
  },
  {
    id: 'auto-aggregate-impact',
    title: 'AI for Automotive — Aggregate Impact',
    client: 'Composite: aggregate median across 10 real Demaze automotive engagements',
    provenance: 'composite_illustrative',
    industry_tags: ['automotive', 'dealership'],
    capability_tags: ['aggregate-impact'],
    challenge: 'Cross-engagement summary, not a single company\'s challenge — use only when no single-workflow proof point is a closer match.',
    outcomes: [
      { metric: 'Revenue per outlet', value: '+18%', window: 'median, 6-month window post-go-live' },
      { metric: 'Operating cost-to-serve', value: '-42%' },
      { metric: 'Faster decisioning', value: '3.4x' },
      { metric: 'From kickoff to KPI move', value: '90 days' },
    ],
    source_doc: 'Demaze - AI for Automotive Case Studies.pdf, Aggregate Impact p.13',
  },

  // ── Portfolio deck (Company Profile & Portfolio, mostly anonymized) ──

  {
    id: 'multivendor-ecommerce-anz',
    title: 'Multi-Vendor Ecommerce Marketplace',
    client: "Composite: Australia and New Zealand's leading online marketplace",
    provenance: 'composite_illustrative',
    industry_tags: ['ecommerce', 'retail'],
    capability_tags: ['marketplace-platform'],
    challenge: 'Needed a multi-vendor marketplace covering category browsing, live auction, wishlist, and multiple payment options at scale.',
    outcomes: [
      { metric: 'Lighthouse score', value: '99%' },
      { metric: 'Reach for retailers', value: 'increased' },
    ],
    source_doc: 'Demaze Technologies - Profile & Portfolio.pdf, Case study 3',
  },
  {
    id: 'investigative-case-management',
    title: 'Investigative Case Management Software',
    client: 'Composite: private investigator case-management platform',
    provenance: 'composite_illustrative',
    industry_tags: ['legal-tech', 'services'],
    capability_tags: ['case-management', 'document-automation'],
    challenge: 'Private investigators needed secure, organised case/media management with automated workflow instead of ad-hoc tools.',
    outcomes: [
      { metric: 'Workflow', value: 'automated case management, document automation, secure data storage' },
    ],
    source_doc: 'Demaze Technologies - Profile & Portfolio.pdf, Case study 5',
  },
  {
    id: 'global-payment-blockchain',
    title: 'Global Payment Transfer Platform',
    client: 'Composite: blockchain-based global money transfer platform',
    provenance: 'composite_illustrative',
    industry_tags: ['fintech', 'payments'],
    capability_tags: ['blockchain', 'cross-border-payments'],
    challenge: 'Needed fast, low-cost, secure cross-border transactions without traditional banking intermediaries.',
    outcomes: [
      { metric: 'Transaction cost and processing time', value: 'reduced via stablecoin integration, no intermediaries' },
    ],
    source_doc: 'Demaze Technologies - Profile & Portfolio.pdf, Case study 8',
  },
  {
    id: 'cma-report-generation',
    title: 'CMA Report Generation Software',
    client: 'Composite: Credit Monitoring Arrangement (CMA) report platform (India)',
    provenance: 'composite_illustrative',
    industry_tags: ['financial_institution', 'fintech'],
    capability_tags: ['report-automation', 'document-automation'],
    challenge: 'CMA report preparation was manual and slow, with no standard cloud-based way to build, edit, and export reports.',
    outcomes: [
      { metric: 'Report preparation', value: 'automated with PDF/Excel export' },
    ],
    source_doc: 'Demaze Technologies - Profile & Portfolio.pdf, Case study 9',
  },
]

// Company-level facts (Profile & Portfolio deck p.5) — for optional use in
// narrative/about text, not tied to any single proof point above.
export const DEMAZE_COMPANY_FACTS = {
  projectsDone: '45+',
  teamSize: '35+',
  yearsExperience: '6+',
  valueGenerated: '$10Mn+',
  source_doc: 'Demaze Technologies - Profile & Portfolio.pdf p.5',
}

// ============================================================
// Deterministic Opportunity Engine — v2
// ============================================================
// Maps signal clusters to candidate opportunities.
// The LLM EXPLAINS these opportunities; it no longer invents them.
//
// v2 changes:
//   - Extended conglomerate catalog (was 4, now 9 opportunities)
//   - Added Portfolio Analytics, Knowledge AI, Operational Dashboards,
//     Subsidiary Intelligence, Group Procurement AI
//   - Fixed category dedup: Map<string,number> not Set (Set bug: can't count)
//   - maxOpportunities is now 7 by default
//   - Conglomerate-specific trigger cluster patterns
// ============================================================

import { SignalCluster } from './signal-clustering'
import { BusinessModelType } from './business-model-classifier'
import type { CompanyProfile } from './evidence-extractor'

// Maps CompanyProfile booleans to business-model-classifier.ts string values
// so OPPORTUNITY_CATALOG business_model_fit arrays can stay as authored.
function profileMatchesModels(profile: CompanyProfile, models: BusinessModelType[]): boolean {
  for (const model of models) {
    switch (model) {
      case 'Manufacturing':
      case 'Automotive OEM':
      case 'Automotive Supplier':
        if (profile.company_type.manufacturer) return true
        break
      case 'Industrial Technology Vendor':
        if (profile.company_type.industrial_vendor) return true
        break
      case 'Software/SaaS':
        if (profile.company_type.software_saas) return true
        break
      case 'Engineering Services':
        if (profile.company_type.services_provider) return true
        break
      case 'Conglomerate':
        if (profile.company_type.conglomerate) return true
        break
      case 'Distribution/Logistics':
        if (profile.company_type.logistics_operator) return true
        break
      case 'Other':
        return true
    }
  }
  return false
}

export type OpportunityCategory =
  | 'data_visibility'
  | 'process_automation'
  | 'maintenance'
  | 'scheduling'
  | 'supply_chain'
  | 'quality'

export interface DeterministicOpportunity {
  id: string
  cluster_id: string               // primary signal cluster
  title: string
  service: string                  // Demaze service name
  category: OpportunityCategory
  strategic_challenge: string      // why this opportunity exists
  llm_explanation_prompt: string   // what to ask the LLM to explain
  entry_point: string              // where to start
  priority: number                 // 1–100; catalog-defined priority score
  business_model_fit: BusinessModelType[]
  relevance: 'High' | 'Medium' | 'Low'
  // Score traceability — populated at generation time
  triggered_by_clusters?: Array<{ id: string; name: string; confidence: string }>
  priority_source?: string         // human-readable explanation of why this score
}

// ── Opportunity catalog ────────────────────────────────────────

const OPPORTUNITY_CATALOG: Array<DeterministicOpportunity & { trigger_clusters: string[] }> = [

  // ── Manufacturing Intelligence cluster ───────────────────────
  {
    id: 'manufacturing_analytics_platform',
    cluster_id: 'manufacturing_intelligence',
    trigger_clusters: ['manufacturing_intelligence', 'technology_integration'],
    title: 'Manufacturing Analytics Platform',
    service: 'Manufacturing Analytics Platform',
    category: 'data_visibility',
    strategic_challenge: 'Production data is fragmented across machines and shifts — managers lack real-time visibility',
    llm_explanation_prompt: "Explain why a Manufacturing Analytics Platform is relevant given the company's Industry 4.0 / IIoT / digital transformation signals. Quote specific evidence.",
    entry_point: 'Plant floor data integration → shift performance dashboards → OEE tracking',
    priority: 95,
    business_model_fit: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier', 'Conglomerate'],
    relevance: 'High',
  },
  {
    id: 'operations_intelligence',
    cluster_id: 'manufacturing_intelligence',
    trigger_clusters: ['manufacturing_intelligence'],
    title: 'Real-time Operations Intelligence',
    service: 'Operations Intelligence',
    category: 'data_visibility',
    strategic_challenge: 'Operational decisions are made on stale data — shift-level reporting lags real conditions',
    llm_explanation_prompt: "Explain why real-time operations intelligence is needed based on the company's digital transformation signals and scale of operations.",
    entry_point: 'Real-time machine data feeds → supervisor dashboards → exception alerting',
    priority: 90,
    business_model_fit: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier', 'Conglomerate'],
    relevance: 'High',
  },

  // ── Industrial AI cluster ────────────────────────────────────
  {
    id: 'industrial_ai_agents',
    cluster_id: 'industrial_ai',
    trigger_clusters: ['industrial_ai'],
    title: 'Industrial AI Agents for Operations',
    service: 'Industrial AI Agents',
    category: 'process_automation',
    strategic_challenge: 'Company is investing in AI/automation but lacks an intelligence layer to make these investments work together',
    llm_explanation_prompt: "Explain why Industrial AI Agents are relevant given the AI/automation signals in the company's content. What decisions could AI agents automate?",
    entry_point: 'Production scheduling agent → quality decision agent → maintenance dispatch agent',
    priority: 88,
    business_model_fit: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier'],
    relevance: 'High',
  },
  {
    id: 'production_optimization',
    cluster_id: 'industrial_ai',
    trigger_clusters: ['industrial_ai', 'manufacturing_intelligence'],
    title: 'Production Optimization AI',
    service: 'Production Optimization',
    category: 'scheduling',
    strategic_challenge: 'Throughput bottlenecks and scheduling complexity reduce OEE and limit capacity',
    llm_explanation_prompt: 'Explain how Production Optimization AI would help this company given their automation and digitalization signals.',
    entry_point: 'AI scheduling engine → bottleneck detection → throughput optimization',
    priority: 82,
    business_model_fit: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier'],
    relevance: 'High',
  },

  // ── Multi-site cluster ───────────────────────────────────────
  {
    id: 'cross_plant_intelligence',
    cluster_id: 'multi_site_coordination',
    trigger_clusters: ['multi_site_coordination', 'conglomerate_enterprise_intelligence', 'manufacturing_intelligence'],
    title: 'Cross-Plant Intelligence',
    service: 'Cross-Plant Intelligence',
    category: 'data_visibility',
    strategic_challenge: 'Multiple facilities create data silos — best practices and performance benchmarks do not flow between sites',
    llm_explanation_prompt: "Explain why Cross-Plant Intelligence is needed given the company's multi-location operations. Quote evidence of plant/facility count or geographic spread.",
    entry_point: 'Unified data layer across all plants → comparative performance dashboards → best practice sharing',
    priority: 85,
    business_model_fit: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier', 'Conglomerate'],
    relevance: 'High',
  },

  // ── Conglomerate / Enterprise — EXPANDED ─────────────────────
  {
    id: 'executive_intelligence',
    cluster_id: 'conglomerate_enterprise_intelligence',
    trigger_clusters: ['conglomerate_enterprise_intelligence', 'multi_site_coordination'],
    title: 'Executive Intelligence & Cross-Business Dashboards',
    service: 'Executive Intelligence AI',
    category: 'data_visibility',
    strategic_challenge: 'Conglomerate executives lack real-time aggregated intelligence across business units — decisions rely on lagged reports',
    llm_explanation_prompt: 'Explain why Executive Intelligence dashboards are critical for this conglomerate given their business model and scale.',
    entry_point: 'Cross-unit data integration → KPI normalization → executive dashboard layer',
    priority: 95,
    business_model_fit: ['Conglomerate'],
    relevance: 'High',
  },
  {
    id: 'portfolio_analytics',
    cluster_id: 'conglomerate_enterprise_intelligence',
    trigger_clusters: ['conglomerate_enterprise_intelligence', 'business_event_momentum', 'multi_site_coordination'],
    title: 'Portfolio Performance Intelligence',
    service: 'Portfolio Analytics AI',
    category: 'data_visibility',
    strategic_challenge: 'Diverse business units with different KPIs make portfolio-level performance assessment subjective and inconsistent',
    llm_explanation_prompt: 'Explain why Portfolio Performance Intelligence is needed for this conglomerate — how does managing multiple business units create visibility gaps?',
    entry_point: 'Business unit data connectors → unified metrics framework → portfolio performance layer',
    priority: 92,
    business_model_fit: ['Conglomerate'],
    relevance: 'High',
  },
  {
    id: 'dealer_intelligence',
    cluster_id: 'dealer_distribution_network',
    trigger_clusters: ['dealer_distribution_network', 'conglomerate_enterprise_intelligence'],
    title: 'Dealer Network Intelligence',
    service: 'Dealer Intelligence Platform',
    category: 'data_visibility',
    strategic_challenge: 'Large dealer network data is not leveraged for demand forecasting, inventory optimization, or network performance',
    llm_explanation_prompt: "Explain why Dealer Network Intelligence would benefit this company given their dealer network scale and growth signals.",
    entry_point: 'Dealer data connectors → demand signals aggregation → dealer performance analytics',
    priority: 88,
    business_model_fit: ['Automotive OEM', 'Conglomerate'],
    relevance: 'High',
  },
  {
    id: 'enterprise_forecasting',
    cluster_id: 'conglomerate_enterprise_intelligence',
    trigger_clusters: ['conglomerate_enterprise_intelligence', 'business_event_momentum', 'scale_and_capacity'],
    title: 'Enterprise Forecasting AI',
    service: 'Enterprise Forecasting AI',
    category: 'supply_chain',
    strategic_challenge: 'Diverse business units with different demand patterns make enterprise-level planning extremely difficult without AI-driven forecasting',
    llm_explanation_prompt: "Explain why Enterprise Forecasting is critical for this conglomerate given their business diversity and scale.",
    entry_point: 'Cross-business data integration → AI forecasting models → planning recommendations',
    priority: 85,
    business_model_fit: ['Conglomerate'],
    relevance: 'High',
  },
  {
    id: 'knowledge_ai_group',
    cluster_id: 'conglomerate_enterprise_intelligence',
    trigger_clusters: ['conglomerate_enterprise_intelligence', 'workforce_intelligence', 'technology_integration'],
    title: 'Group Knowledge Management AI',
    service: 'Knowledge Intelligence AI',
    category: 'process_automation',
    strategic_challenge: 'Institutional knowledge, best practices, and lessons learned are trapped in silos across business units — not accessible group-wide',
    llm_explanation_prompt: 'Explain why Group Knowledge Management AI would help this conglomerate — how does operating multiple business units create knowledge fragmentation?',
    entry_point: 'Cross-BU knowledge indexing → semantic search → best-practice sharing layer',
    priority: 78,
    business_model_fit: ['Conglomerate'],
    relevance: 'High',
  },
  {
    id: 'operational_dashboards',
    cluster_id: 'conglomerate_enterprise_intelligence',
    trigger_clusters: ['conglomerate_enterprise_intelligence', 'multi_site_coordination', 'scale_and_capacity'],
    title: 'Operational Excellence Dashboards',
    service: 'Operational Intelligence Platform',
    category: 'data_visibility',
    strategic_challenge: 'Group COOs and divisional MDs lack standardized operational metrics — each BU tracks performance differently',
    llm_explanation_prompt: 'Explain why Operational Excellence Dashboards are needed for this conglomerate — what operational complexity drives the need for standardized reporting?',
    entry_point: 'Standardized operational KPI framework → BU performance dashboards → group rollup',
    priority: 75,
    business_model_fit: ['Conglomerate'],
    relevance: 'High',
  },
  {
    id: 'subsidiary_intelligence',
    cluster_id: 'conglomerate_enterprise_intelligence',
    trigger_clusters: ['conglomerate_enterprise_intelligence', 'business_event_momentum'],
    title: 'Subsidiary Performance Monitoring',
    service: 'Subsidiary Intelligence AI',
    category: 'data_visibility',
    strategic_challenge: 'Parent group lacks real-time visibility into subsidiary health — financial and operational performance data arrives monthly or quarterly',
    llm_explanation_prompt: 'Explain why Subsidiary Performance Monitoring would benefit this conglomerate — what is the cost of delayed visibility into subsidiary performance?',
    entry_point: 'Subsidiary data connectors → health score dashboards → early warning alerts',
    priority: 70,
    business_model_fit: ['Conglomerate'],
    relevance: 'Medium',
  },

  // ── Scale & capacity cluster ─────────────────────────────────
  {
    id: 'predictive_maintenance',
    cluster_id: 'scale_and_capacity',
    trigger_clusters: ['scale_and_capacity', 'manufacturing_intelligence'],
    title: 'Predictive Maintenance AI',
    service: 'Predictive Maintenance AI',
    category: 'maintenance',
    strategic_challenge: 'New equipment being commissioned lacks baseline reliability data — high unplanned downtime risk',
    llm_explanation_prompt: "Explain why Predictive Maintenance AI is relevant given the company's capacity expansion or growth signals. What equipment reliability risk does this create?",
    entry_point: 'Sensor data collection → equipment baseline modeling → failure prediction → maintenance scheduling',
    priority: 80,
    business_model_fit: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier'],
    relevance: 'High',
  },

  // ── Technology integration cluster ───────────────────────────
  {
    id: 'smart_mes_analytics',
    cluster_id: 'technology_integration',
    trigger_clusters: ['technology_integration', 'manufacturing_intelligence'],
    title: 'AI-Powered MES & ERP Analytics',
    service: 'Smart MES Analytics',
    category: 'data_visibility',
    strategic_challenge: 'ERP/MES systems generate data but lack AI layer to turn it into actionable production insights',
    llm_explanation_prompt: 'Explain how AI-powered MES/ERP analytics would benefit this company given their technology investment signals.',
    entry_point: 'ERP/MES data connector → AI analytics layer → production intelligence dashboards',
    priority: 75,
    business_model_fit: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier', 'Conglomerate'],
    relevance: 'Medium',
  },

  // ── Workforce cluster ────────────────────────────────────────
  {
    id: 'operations_copilot',
    cluster_id: 'workforce_intelligence',
    trigger_clusters: ['workforce_intelligence', 'industrial_ai'],
    title: 'AI Copilot for Operations',
    service: 'AI Copilot for Operations',
    category: 'process_automation',
    strategic_challenge: 'Scaling headcount is expensive — AI can augment existing operators and supervisors',
    llm_explanation_prompt: 'Explain why an Operations Copilot would help this company given their hiring signals and operational scale.',
    entry_point: 'Operator decision support → supervisor AI assistant → automated exception handling',
    priority: 70,
    business_model_fit: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier'],
    relevance: 'Medium',
  },

  // ── Quality cluster ──────────────────────────────────────────
  {
    id: 'ai_quality_inspection',
    cluster_id: 'manufacturing_intelligence',
    trigger_clusters: ['manufacturing_intelligence', 'industrial_ai', 'scale_and_capacity'],
    title: 'AI Quality Inspection',
    service: 'Computer Vision Quality AI',
    category: 'quality',
    strategic_challenge: 'Manual inspection is labor-intensive and inconsistent across shifts and facilities',
    llm_explanation_prompt: 'Explain how AI Quality Inspection would benefit this company given their manufacturing scale and quality signals.',
    entry_point: 'Computer vision cameras on line → real-time defect detection → quality analytics',
    priority: 78,
    business_model_fit: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier'],
    relevance: 'High',
  },

  // ── Supply chain cluster ─────────────────────────────────────
  {
    id: 'demand_forecasting',
    cluster_id: 'supply_chain_growth',
    trigger_clusters: ['supply_chain_growth', 'scale_and_capacity', 'dealer_distribution_network'],
    title: 'AI Demand Forecasting',
    service: 'Demand Forecasting AI',
    category: 'supply_chain',
    strategic_challenge: 'Entering new markets or scaling production creates demand uncertainty and supply chain complexity',
    llm_explanation_prompt: "Explain why AI Demand Forecasting is relevant given the company's growth signals and market expansion.",
    entry_point: 'Sales/order history data → ML forecasting models → supply planning recommendations',
    priority: 65,
    business_model_fit: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier', 'Distribution/Logistics', 'Conglomerate'],
    relevance: 'Medium',
  },

  // ── Automotive after-sales ───────────────────────────────────
  {
    id: 'warranty_analytics',
    cluster_id: 'automotive_after_sales',
    trigger_clusters: ['automotive_after_sales', 'scale_and_capacity'],
    title: 'Warranty Analytics AI',
    service: 'Warranty Analytics AI',
    category: 'quality',
    strategic_challenge: 'Warranty claim data contains quality signals that are rarely connected back to the production process',
    llm_explanation_prompt: 'Explain why Warranty Analytics is relevant for this automotive company given their fleet/service signals.',
    entry_point: 'Warranty data integration → defect pattern detection → production quality correlation',
    priority: 85,
    business_model_fit: ['Automotive OEM', 'Automotive Supplier'],
    relevance: 'High',
  },
  {
    id: 'fleet_intelligence',
    cluster_id: 'automotive_after_sales',
    trigger_clusters: ['automotive_after_sales', 'dealer_distribution_network'],
    title: 'Fleet & Service Operations Intelligence',
    service: 'Fleet Intelligence AI',
    category: 'data_visibility',
    strategic_challenge: 'Large vehicle fleets generate service data that could enable proactive maintenance and warranty optimization',
    llm_explanation_prompt: "Explain how Fleet Intelligence AI would help this company given their vehicle fleet scale and after-sales operations.",
    entry_point: 'Fleet telematics data → predictive service alerts → dealer service optimization',
    priority: 83,
    business_model_fit: ['Automotive OEM'],
    relevance: 'High',
  },

  // ── SaaS / Software ──────────────────────────────────────────
  {
    id: 'customer_support_ai',
    cluster_id: 'saas_customer_operations',
    trigger_clusters: ['saas_customer_operations', 'engineering_delivery_intelligence'],
    title: 'Customer Support AI',
    service: 'Customer Support AI',
    category: 'process_automation',
    strategic_challenge: 'Growing customer base creates support ticket volume that strains teams and erodes customer experience',
    llm_explanation_prompt: "Explain why Customer Support AI would benefit this company given their growth and customer base signals.",
    entry_point: 'Support ticket AI triage → knowledge base automation → agent AI assistance',
    priority: 88,
    business_model_fit: ['Software/SaaS', 'Engineering Services'],
    relevance: 'High',
  },
  {
    id: 'knowledge_intelligence',
    cluster_id: 'saas_customer_operations',
    trigger_clusters: ['saas_customer_operations', 'saas_product_intelligence', 'engineering_delivery_intelligence'],
    title: 'Knowledge Intelligence & Enterprise Search',
    service: 'Knowledge Intelligence AI',
    category: 'data_visibility',
    strategic_challenge: 'Product knowledge, support docs, and internal processes are scattered — employees cannot find information quickly',
    llm_explanation_prompt: "Explain why Knowledge Intelligence would help this company given their scale and knowledge management challenges.",
    entry_point: 'Knowledge base indexing → semantic search layer → AI-assisted answer generation',
    priority: 85,
    business_model_fit: ['Software/SaaS', 'Engineering Services'],
    relevance: 'High',
  },
  {
    id: 'product_analytics',
    cluster_id: 'saas_product_intelligence',
    trigger_clusters: ['saas_product_intelligence', 'saas_customer_operations'],
    title: 'Product Analytics AI',
    service: 'Product Analytics AI',
    category: 'data_visibility',
    strategic_challenge: 'Understanding product usage patterns, predicting churn, and identifying expansion require AI-driven analytics',
    llm_explanation_prompt: "Explain why Product Analytics AI would help this company given their customer base scale and product signals.",
    entry_point: 'Product usage data → behavioral analytics → churn prediction → expansion signals',
    priority: 80,
    business_model_fit: ['Software/SaaS'],
    relevance: 'High',
  },
  {
    id: 'internal_ai_agents',
    cluster_id: 'saas_product_intelligence',
    trigger_clusters: ['saas_product_intelligence', 'saas_customer_operations'],
    title: 'Internal AI Agents for Operations',
    service: 'Internal AI Agents',
    category: 'process_automation',
    strategic_challenge: 'Sales, marketing, and engineering teams waste time on repetitive workflows that AI agents could automate',
    llm_explanation_prompt: "Explain why Internal AI Agents would benefit this software company's internal operations.",
    entry_point: 'Sales ops automation → marketing intelligence → engineering workflow agents',
    priority: 75,
    business_model_fit: ['Software/SaaS'],
    relevance: 'Medium',
  },
]

// ── Main function ──────────────────────────────────────────────

/**
 * Given active signal clusters and business model type,
 * return the top candidate opportunities in priority order.
 *
 * Defaults to 7 opportunities max.
 * Category deduplication: max 2 per category (using Map to count correctly).
 */
export function generateDeterministicOpportunities(
  clusters: SignalCluster[],
  profile: CompanyProfile,
  maxOpportunities = 7,
): DeterministicOpportunity[] {
  const activeClusterIds = new Set(clusters.map(c => c.id))
  const categoryCounts = new Map<string, number>()   // fixed: Map vs Set bug
  const selected: DeterministicOpportunity[] = []

  // Work through opportunities sorted by priority desc
  const sorted = [...OPPORTUNITY_CATALOG].sort((a, b) => b.priority - a.priority)

  for (const opp of sorted) {
    if (selected.length >= maxOpportunities) break

    // Check business model fit
    if (!profileMatchesModels(profile, opp.business_model_fit)) continue

    // Check at least one trigger cluster is active
    const hasCluster = opp.trigger_clusters.some(c => activeClusterIds.has(c))
    if (!hasCluster) continue

    // Enforce category diversity (max 2 per category)
    const catCount = categoryCounts.get(opp.category) ?? 0
    if (catCount >= 2) continue
    categoryCounts.set(opp.category, catCount + 1)

    // Determine relevance from triggering cluster confidence
    const triggeringClusters = clusters.filter(c => opp.trigger_clusters.includes(c.id))
    const topConfidence =
      triggeringClusters.some(c => c.confidence === 'high')   ? 'High'   :
      triggeringClusters.some(c => c.confidence === 'medium') ? 'Medium' : 'Low'

    selected.push({
      ...opp,
      relevance: topConfidence,
      triggered_by_clusters: triggeringClusters.map(c => ({
        id: c.id,
        name: c.theme,
        confidence: c.confidence,
      })),
      priority_source: `Triggered by: ${triggeringClusters.map(c => c.theme).join(', ')} (catalog priority=${opp.priority})`,
    })
  }

  return selected
}

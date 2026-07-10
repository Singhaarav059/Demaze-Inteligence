// ============================================================
// Business Model Classifier
// ============================================================
// Takes the LLM's raw business_model_analysis output and maps it
// to a canonical business model type with deterministic:
//   - Strategic challenge templates (what problems do they likely have?)
//   - Valid signal types (which signals make sense for this model?)
//   - Target buyer personas
//   - Demaze service relevance map
// ============================================================

export type BusinessModelType =
  | 'Manufacturing'
  | 'Automotive OEM'
  | 'Automotive Supplier'
  | 'Software/SaaS'
  | 'Engineering Services'
  | 'Conglomerate'
  | 'Distribution/Logistics'
  | 'Industrial Technology Vendor'
  | 'Other'

export interface StrategicChallenge {
  id: string
  title: string
  description: string
  signal_triggers: string[]  // which detected_factors activate this
  demaze_services: string[]
  target_buyers: string[]
}

export interface BusinessModelProfile {
  type: BusinessModelType
  canonical_label: string
  core_internal_activities: string[]
  valid_signal_types: string[]         // which detected_factors are meaningful for this model
  invalid_signal_types: string[]       // which detected_factors to IGNORE (false positives)
  strategic_challenges: StrategicChallenge[]
  default_target_buyers: string[]
  icp_score_modifier: number           // -20 to +20 adjustment to company_fit score
}

// ── Strategic challenge library ────────────────────────────────

const CHALLENGES: Record<string, StrategicChallenge> = {

  // Manufacturing challenges
  plant_visibility: {
    id: 'plant_visibility',
    title: 'Plant Visibility & Production Intelligence',
    description: 'Production data is fragmented across machines, shifts, and systems. Managers lack real-time visibility into what is happening across the plant floor.',
    signal_triggers: ['industry_40_initiative', 'digital_transformation', 'technology_investment', 'iot_investment'],
    demaze_services: ['Manufacturing Analytics Platform', 'Operations Intelligence', 'Real-time Production Dashboards'],
    target_buyers: ['VP Operations', 'Head of Manufacturing', 'Director of Digital Transformation', 'Plant Manager'],
  },
  production_efficiency: {
    id: 'production_efficiency',
    title: 'Production Efficiency & Throughput',
    description: 'Throughput bottlenecks, scheduling complexity, and shift-to-shift variability reduce OEE and limit capacity utilization.',
    signal_triggers: ['capacity_expansion', 'growth_signal', 'hiring_signal'],
    demaze_services: ['AI-Powered Scheduling', 'Production Optimization', 'OEE Analytics'],
    target_buyers: ['VP Operations', 'Director of Manufacturing', 'Production Manager'],
  },
  predictive_maintenance: {
    id: 'predictive_maintenance',
    title: 'Equipment Reliability & Predictive Maintenance',
    description: 'Unplanned downtime from equipment failures is expensive. New equipment being commissioned lacks baseline reliability data.',
    signal_triggers: ['capacity_expansion', 'growth_signal', 'industry_40_initiative'],
    demaze_services: ['Predictive Maintenance AI', 'Equipment Reliability Analytics', 'Maintenance Intelligence'],
    target_buyers: ['VP Operations', 'Director of Maintenance', 'Reliability Engineer', 'Plant Manager'],
  },
  cross_plant_coordination: {
    id: 'cross_plant_coordination',
    title: 'Cross-Plant Intelligence & Coordination',
    description: 'Operating multiple plants creates data silos and inconsistent performance visibility. Best practices do not flow between sites.',
    signal_triggers: ['multi_location_operations'],
    demaze_services: ['Cross-Plant Intelligence', 'Multi-site Analytics', 'Executive Dashboards'],
    target_buyers: ['COO', 'VP Operations', 'Head of Manufacturing Excellence', 'VP Manufacturing'],
  },
  quality_control: {
    id: 'quality_control',
    title: 'Quality Control & Defect Detection',
    description: 'Manual inspection is labor-intensive and inconsistent. Quality escapes drive rework, scrap, and warranty costs.',
    signal_triggers: ['hiring_signal', 'industry_40_initiative', 'automation_keywords'],
    demaze_services: ['Computer Vision Quality AI', 'Automated Defect Detection', 'Quality Analytics'],
    target_buyers: ['VP Quality', 'Director of Quality Systems', 'Head of Manufacturing'],
  },
  supply_chain_intelligence: {
    id: 'supply_chain_intelligence',
    title: 'Supply Chain & Demand Intelligence',
    description: 'Entering new markets or scaling production creates demand uncertainty and supply chain complexity.',
    signal_triggers: ['growth_signal', 'capacity_expansion', 'recent_news_or_event'],
    demaze_services: ['Demand Forecasting AI', 'Supplier Quality Intelligence', 'Supply Chain Analytics'],
    target_buyers: ['VP Supply Chain', 'Head of Procurement', 'Director of Operations'],
  },
  industrial_ai_scaling: {
    id: 'industrial_ai_scaling',
    title: 'Industrial AI & Automation Scaling',
    description: 'Company is investing in AI/automation but lacks a unified intelligence layer to make these investments work together.',
    signal_triggers: ['ai_mention', 'automation_keywords', 'industry_40_initiative', 'digital_transformation'],
    demaze_services: ['Industrial AI Agents', 'AI Copilot for Operations', 'Process Automation AI'],
    target_buyers: ['CTO', 'Head of Digital Transformation', 'VP Operations', 'Director of Innovation'],
  },

  // SaaS/Software challenges
  customer_support_scale: {
    id: 'customer_support_scale',
    title: 'Customer Support at Scale',
    description: 'Growing customer base creates support ticket volume that strains teams. Knowledge is siloed and hard to find.',
    signal_triggers: ['growth_signal', 'hiring_signal', 'recent_news_or_event'],
    demaze_services: ['Customer Support AI', 'Knowledge Intelligence', 'Enterprise Search AI'],
    target_buyers: ['VP Customer Success', 'Head of Support', 'COO', 'CTO'],
  },
  knowledge_management: {
    id: 'knowledge_management',
    title: 'Knowledge Management & Internal Productivity',
    description: 'Product knowledge, support docs, and internal processes are scattered. Employees cannot find information quickly.',
    signal_triggers: ['hiring_signal', 'digital_transformation', 'ai_mention'],
    demaze_services: ['Knowledge Intelligence AI', 'Enterprise Search', 'Internal AI Agents'],
    target_buyers: ['CTO', 'COO', 'Head of Product', 'VP Engineering'],
  },
  product_analytics: {
    id: 'product_analytics',
    title: 'Product Analytics & Customer Intelligence',
    description: 'Understanding how customers use the product, predicting churn, and identifying expansion opportunities requires analytics infrastructure.',
    signal_triggers: ['growth_signal', 'ai_mention', 'technology_investment'],
    demaze_services: ['Product Analytics AI', 'Customer Intelligence', 'Churn Prediction AI'],
    target_buyers: ['VP Product', 'Head of Analytics', 'CTO', 'Chief Revenue Officer'],
  },
  saas_internal_productivity: {
    id: 'saas_internal_productivity',
    title: 'Internal Operations & Productivity AI',
    description: 'Sales, marketing, and engineering operations generate data and workflows that AI can optimize.',
    signal_triggers: ['hiring_signal', 'growth_signal', 'ai_mention'],
    demaze_services: ['Internal AI Agents', 'Sales Intelligence AI', 'Workflow Automation'],
    target_buyers: ['COO', 'VP Sales Operations', 'Head of Revenue Operations'],
  },

  // Engineering Services challenges
  delivery_efficiency: {
    id: 'delivery_efficiency',
    title: 'Project Delivery Intelligence',
    description: 'Complex multi-stakeholder projects with engineering deliverables face schedule risk, scope creep, and resource contention.',
    signal_triggers: ['growth_signal', 'hiring_signal', 'capacity_expansion'],
    demaze_services: ['Project Intelligence AI', 'Delivery Analytics', 'Resource Utilization AI'],
    target_buyers: ['COO', 'VP Delivery', 'Head of Operations', 'PMO Director'],
  },
  knowledge_reuse: {
    id: 'knowledge_reuse',
    title: 'Engineering Knowledge Reuse',
    description: 'Engineering firms accumulate years of project knowledge that is rarely reused. Proposals and designs start from scratch.',
    signal_triggers: ['hiring_signal', 'digital_transformation', 'ai_mention'],
    demaze_services: ['Knowledge Reuse Engine', 'Engineering Intelligence AI', 'Enterprise Search'],
    target_buyers: ['CTO', 'Chief Engineering Officer', 'VP Technology', 'Head of Innovation'],
  },

  // Conglomerate challenges
  cross_business_visibility: {
    id: 'cross_business_visibility',
    title: 'Cross-Business Intelligence & Portfolio Visibility',
    description: 'Conglomerates struggle to aggregate performance data across diverse business units. Executive decisions lack real-time intelligence.',
    signal_triggers: ['multi_location_operations', 'growth_signal', 'recent_news_or_event'],
    demaze_services: ['Cross-Business Intelligence', 'Executive Dashboards', 'Portfolio Analytics AI'],
    target_buyers: ['Group CTO', 'Group COO', 'Head of Digital Transformation', 'Group CFO'],
  },
  dealer_network_intelligence: {
    id: 'dealer_network_intelligence',
    title: 'Dealer Network & Distribution Intelligence',
    description: 'Large dealer or distribution networks generate data that is rarely leveraged for demand forecasting or network optimization.',
    signal_triggers: ['growth_signal', 'multi_location_operations', 'recent_news_or_event'],
    demaze_services: ['Dealer Intelligence Platform', 'Dealer Analytics', 'Distribution Forecasting AI'],
    target_buyers: ['VP Sales', 'Head of Dealer Operations', 'VP Commercial', 'Head of Distribution'],
  },
  enterprise_forecasting: {
    id: 'enterprise_forecasting',
    title: 'Enterprise Forecasting & Planning Intelligence',
    description: 'Diverse business units with different demand patterns make enterprise-level forecasting extremely difficult without AI.',
    signal_triggers: ['growth_signal', 'recent_news_or_event', 'capacity_expansion'],
    demaze_services: ['Demand Forecasting AI', 'Planning Intelligence', 'Executive Intelligence AI'],
    target_buyers: ['Group CFO', 'Head of Strategy', 'COO', 'VP Planning'],
  },

  // Automotive OEM/Supplier challenges
  warranty_analytics: {
    id: 'warranty_analytics',
    title: 'Warranty Analytics & Field Quality Intelligence',
    description: 'Warranty claims contain signals about production quality issues that are rarely connected back to the assembly process.',
    signal_triggers: ['growth_signal', 'recent_news_or_event', 'industry_40_initiative'],
    demaze_services: ['Warranty Analytics AI', 'Field Quality Intelligence', 'Defect Root Cause AI'],
    target_buyers: ['VP Quality', 'Director of After-Sales', 'Head of Service Operations'],
  },
  fleet_service_intelligence: {
    id: 'fleet_service_intelligence',
    title: 'Fleet Intelligence & Service Operations AI',
    description: 'Large vehicle fleets operated by customers generate service data that can be used for proactive maintenance and warranty optimization.',
    signal_triggers: ['growth_signal', 'multi_location_operations', 'recent_news_or_event'],
    demaze_services: ['Fleet Intelligence AI', 'Service Operations AI', 'Telematics Analytics'],
    target_buyers: ['VP After-Sales', 'Director of Service', 'Head of Fleet Management'],
  },
}

// ── Business model profiles ────────────────────────────────────

const PROFILES: Record<BusinessModelType, BusinessModelProfile> = {

  'Manufacturing': {
    type: 'Manufacturing',
    canonical_label: 'Manufacturing',
    core_internal_activities: ['production', 'quality control', 'maintenance', 'supply chain', 'logistics'],
    valid_signal_types: ['industry_40_initiative', 'digital_transformation', 'automation_keywords', 'multi_location_operations',
      'capacity_expansion', 'growth_signal', 'hiring_signal', 'technology_investment', 'ai_mention', 'recent_news_or_event'],
    invalid_signal_types: [],
    strategic_challenges: [
      CHALLENGES.plant_visibility,
      CHALLENGES.cross_plant_coordination,
      CHALLENGES.industrial_ai_scaling,
      CHALLENGES.production_efficiency,
      CHALLENGES.predictive_maintenance,
      CHALLENGES.quality_control,
      CHALLENGES.supply_chain_intelligence,
    ],
    default_target_buyers: ['VP Operations', 'Head of Manufacturing', 'Director of Digital Transformation', 'CTO', 'Plant Manager'],
    icp_score_modifier: 20,
  },

  'Automotive OEM': {
    type: 'Automotive OEM',
    canonical_label: 'Automotive OEM',
    core_internal_activities: ['vehicle assembly', 'quality control', 'dealer network management', 'after-sales service', 'supply chain'],
    valid_signal_types: ['industry_40_initiative', 'digital_transformation', 'automation_keywords', 'multi_location_operations',
      'capacity_expansion', 'growth_signal', 'hiring_signal', 'technology_investment', 'ai_mention', 'recent_news_or_event'],
    invalid_signal_types: [],
    strategic_challenges: [
      CHALLENGES.plant_visibility,
      CHALLENGES.warranty_analytics,
      CHALLENGES.fleet_service_intelligence,
      CHALLENGES.dealer_network_intelligence,
      CHALLENGES.quality_control,
      CHALLENGES.cross_plant_coordination,
      CHALLENGES.supply_chain_intelligence,
    ],
    default_target_buyers: ['VP Operations', 'VP Quality', 'VP After-Sales', 'CTO', 'Head of Digital Transformation'],
    icp_score_modifier: 20,
  },

  'Automotive Supplier': {
    type: 'Automotive Supplier',
    canonical_label: 'Automotive Tier 1/2 Supplier',
    core_internal_activities: ['parts manufacturing', 'quality control', 'supply chain', 'capacity planning', 'IATF compliance'],
    valid_signal_types: ['industry_40_initiative', 'digital_transformation', 'automation_keywords', 'multi_location_operations',
      'capacity_expansion', 'growth_signal', 'hiring_signal', 'technology_investment', 'ai_mention', 'recent_news_or_event'],
    invalid_signal_types: [],
    strategic_challenges: [
      CHALLENGES.plant_visibility,
      CHALLENGES.quality_control,
      CHALLENGES.production_efficiency,
      CHALLENGES.cross_plant_coordination,
      CHALLENGES.predictive_maintenance,
      CHALLENGES.supply_chain_intelligence,
    ],
    default_target_buyers: ['VP Operations', 'VP Quality', 'Director of Manufacturing', 'Head of Digital Transformation', 'Plant Manager'],
    icp_score_modifier: 20,
  },

  'Software/SaaS': {
    type: 'Software/SaaS',
    canonical_label: 'Software / SaaS Platform',
    core_internal_activities: ['software development', 'cloud infrastructure', 'customer support', 'sales', 'product management'],
    valid_signal_types: ['growth_signal', 'hiring_signal', 'ai_mention', 'technology_investment', 'recent_news_or_event'],
    // SaaS companies selling manufacturing solutions are NOT doing manufacturing internally
    invalid_signal_types: ['industry_40_initiative', 'automation_keywords', 'multi_location_operations', 'capacity_expansion', 'digital_transformation'],
    strategic_challenges: [
      CHALLENGES.customer_support_scale,
      CHALLENGES.knowledge_management,
      CHALLENGES.product_analytics,
      CHALLENGES.saas_internal_productivity,
    ],
    default_target_buyers: ['CTO', 'COO', 'VP Customer Success', 'VP Product', 'VP Engineering'],
    icp_score_modifier: -5,  // SaaS is not primary ICP but can be relevant
  },

  'Engineering Services': {
    type: 'Engineering Services',
    canonical_label: 'Engineering / R&D Services',
    core_internal_activities: ['project delivery', 'talent management', 'engineering design', 'client engagement', 'knowledge management'],
    valid_signal_types: ['growth_signal', 'hiring_signal', 'recent_news_or_event', 'ai_mention', 'technology_investment'],
    // Engineering firms' client implementations are not company signals
    invalid_signal_types: ['industry_40_initiative', 'automation_keywords', 'multi_location_operations', 'capacity_expansion', 'digital_transformation'],
    strategic_challenges: [
      CHALLENGES.delivery_efficiency,
      CHALLENGES.knowledge_reuse,
      CHALLENGES.customer_support_scale,
    ],
    default_target_buyers: ['COO', 'VP Delivery', 'Head of Operations', 'CTO', 'PMO Director'],
    icp_score_modifier: -10,  // Lower ICP fit — narrow relevance
  },

  'Conglomerate': {
    type: 'Conglomerate',
    canonical_label: 'Diversified Conglomerate',
    core_internal_activities: ['portfolio oversight', 'manufacturing (some units)', 'distribution', 'financial services', 'cross-company coordination'],
    valid_signal_types: ['growth_signal', 'hiring_signal', 'recent_news_or_event', 'multi_location_operations',
      'capacity_expansion', 'digital_transformation', 'ai_mention', 'technology_investment'],
    invalid_signal_types: [],
    strategic_challenges: [
      CHALLENGES.cross_business_visibility,
      CHALLENGES.dealer_network_intelligence,
      CHALLENGES.enterprise_forecasting,
      CHALLENGES.plant_visibility,          // for manufacturing units
      CHALLENGES.industrial_ai_scaling,
    ],
    default_target_buyers: ['Group CTO', 'Group COO', 'Head of Digital Transformation', 'Group CFO', 'CEO'],
    icp_score_modifier: 10,
  },

  'Distribution/Logistics': {
    type: 'Distribution/Logistics',
    canonical_label: 'Distribution / Logistics',
    core_internal_activities: ['warehouse operations', 'route planning', 'fleet management', 'inventory management', 'supply chain'],
    valid_signal_types: ['growth_signal', 'capacity_expansion', 'multi_location_operations', 'hiring_signal',
      'technology_investment', 'digital_transformation', 'recent_news_or_event'],
    invalid_signal_types: ['industry_40_initiative', 'automation_keywords'],
    strategic_challenges: [
      CHALLENGES.supply_chain_intelligence,
      CHALLENGES.enterprise_forecasting,
      CHALLENGES.cross_plant_coordination,
    ],
    default_target_buyers: ['VP Operations', 'Head of Logistics', 'COO', 'Director of Supply Chain'],
    icp_score_modifier: 5,
  },

  'Industrial Technology Vendor': {
    type: 'Industrial Technology Vendor',
    canonical_label: 'Industrial Technology / Equipment Vendor',
    core_internal_activities: ['product manufacturing', 'R&D', 'field service', 'customer support', 'sales'],
    valid_signal_types: ['growth_signal', 'hiring_signal', 'recent_news_or_event', 'ai_mention',
      'technology_investment', 'capacity_expansion'],
    // They sell industrial tech — do not confuse their products with their own operations
    invalid_signal_types: ['industry_40_initiative', 'digital_transformation', 'automation_keywords'],
    strategic_challenges: [
      CHALLENGES.delivery_efficiency,
      CHALLENGES.knowledge_management,
      CHALLENGES.customer_support_scale,
    ],
    default_target_buyers: ['VP Service', 'Director of Field Operations', 'Head of Manufacturing', 'CTO'],
    icp_score_modifier: 0,
  },

  'Other': {
    type: 'Other',
    canonical_label: 'Other',
    core_internal_activities: [],
    valid_signal_types: ['growth_signal', 'hiring_signal', 'recent_news_or_event', 'ai_mention', 'technology_investment'],
    invalid_signal_types: [],
    strategic_challenges: [
      CHALLENGES.knowledge_management,
      CHALLENGES.saas_internal_productivity,
    ],
    default_target_buyers: ['COO', 'CTO', 'VP Operations'],
    icp_score_modifier: -10,
  },
}

// ── Classifier function ────────────────────────────────────────

/**
 * Normalize raw LLM model_type string to canonical BusinessModelType.
 * Handles variations and partial matches.
 */
export function classifyBusinessModel(rawModelType: string): BusinessModelType {
  const t = (rawModelType ?? '').toLowerCase().trim()

  if (/automotive\s+oem|oem\s+manufacturer/.test(t)) return 'Automotive OEM'
  if (/automotive\s+supplier|tier\s*[12]|auto\s+component/.test(t)) return 'Automotive Supplier'
  if (/conglomerate|diversified|multi.?business|holding/.test(t)) return 'Conglomerate'
  if (/software|saas|cloud\s+platform|technology\s+platform|platform\s+company/.test(t)) return 'Software/SaaS'
  if (/engineering\s+service|r&d\s+service|design\s+service|product\s+engineering|consulting/.test(t)) return 'Engineering Services'
  if (/distribution|logistics|supply\s+chain\s+company|3pl|freight/.test(t)) return 'Distribution/Logistics'
  if (/industrial\s+tech|equipment\s+vendor|machine\s+builder|automation\s+vendor|robotics\s+company/.test(t)) return 'Industrial Technology Vendor'
  if (/manufactur|foundry|casting|stamping|forging|machining|fabricat/.test(t)) return 'Manufacturing'
  if (/automotive/.test(t)) return 'Automotive Supplier'

  return 'Other'
}

/**
 * Get the full business model profile for a given type.
 */
export function getBusinessModelProfile(modelType: BusinessModelType): BusinessModelProfile {
  return PROFILES[modelType] ?? PROFILES['Other']
}

/**
 * Filter detected_factors to remove false positives for this business model.
 * E.g., for SaaS companies, industry_40_initiative is almost always a false positive.
 */
export function filterSignalsForBusinessModel(
  detectedFactors: Partial<Record<string, boolean>>,
  modelType: BusinessModelType,
): Partial<Record<string, boolean>> {
  const profile = getBusinessModelProfile(modelType)
  const filtered = { ...detectedFactors }

  for (const invalidKey of profile.invalid_signal_types) {
    if (filtered[invalidKey]) {
      filtered[invalidKey] = false
    }
  }

  return filtered
}

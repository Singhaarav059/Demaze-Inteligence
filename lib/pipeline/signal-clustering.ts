// ============================================================
// Signal Clustering Engine
// ============================================================
// Groups detected boolean signals into strategic themes.
// A "cluster" is a named theme that emerges when 1+ signals fire.
// Clusters are then passed to the opportunity engine.
// ============================================================

import { BusinessModelType } from './business-model-classifier'
import type { CompanyProfile } from './evidence-extractor'

// Maps CompanyProfile booleans to business-model-classifier.ts string values
// so CLUSTER_DEFS applicable_models can stay as authored.
function profileMatchesModels(profile: CompanyProfile, models: BusinessModelType[] | 'all'): boolean {
  if (models === 'all') return true
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

export interface SignalCluster {
  id: string
  theme: string                      // Human-readable theme name
  description: string                // Why this cluster matters
  signals_present: string[]          // Which detected_factors triggered this
  confidence: 'high' | 'medium' | 'low'
  applicable_models: BusinessModelType[] | 'all'
  tier: 1 | 2 | 3                   // Priority tier (1 = generate first)
}

// ── Cluster definitions ────────────────────────────────────────

const CLUSTER_DEFS: Array<{
  id: string
  theme: string
  description: string
  required_signals: string[]         // at least 1 must be true
  bonus_signals?: string[]           // additional signals strengthen confidence
  applicable_models: BusinessModelType[] | 'all'
  tier: 1 | 2 | 3
}> = [
  // ── Tier 1: Highest priority ─────────────────────────────────

  {
    id: 'manufacturing_intelligence',
    theme: 'Connected Manufacturing & Plant Intelligence',
    description: 'Company is building digital infrastructure for plant-level data capture and intelligence',
    required_signals: ['industry_40_initiative', 'digital_transformation'],
    bonus_signals: ['technology_investment', 'multi_location_operations', 'ai_mention'],
    applicable_models: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier'],
    tier: 1,
  },
  {
    id: 'industrial_ai',
    theme: 'Industrial AI & Automation Intelligence',
    description: 'Company is investing in AI and automation for its own operations',
    required_signals: ['ai_mention', 'automation_keywords'],
    bonus_signals: ['industry_40_initiative', 'digital_transformation', 'technology_investment'],
    applicable_models: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier'],
    tier: 1,
  },
  {
    id: 'saas_customer_operations',
    theme: 'Customer Operations & Support Intelligence',
    description: 'SaaS company scaling customer-facing operations needs AI to manage support and success at scale',
    required_signals: ['growth_signal', 'hiring_signal'],
    bonus_signals: ['ai_mention', 'recent_news_or_event'],
    applicable_models: ['Software/SaaS'],
    tier: 1,
  },
  {
    id: 'conglomerate_enterprise_intelligence',
    theme: 'Cross-Business Enterprise Intelligence',
    description: 'Conglomerate needs unified intelligence across diverse business units for executive visibility',
    required_signals: ['multi_location_operations'],
    bonus_signals: ['growth_signal', 'recent_news_or_event', 'digital_transformation'],
    applicable_models: ['Conglomerate'],
    tier: 1,
  },
  {
    id: 'engineering_delivery_intelligence',
    theme: 'Project Delivery & Knowledge Intelligence',
    description: 'Engineering services firm needs AI to improve project delivery and knowledge reuse',
    required_signals: ['hiring_signal', 'growth_signal'],
    bonus_signals: ['ai_mention', 'recent_news_or_event'],
    applicable_models: ['Engineering Services'],
    tier: 1,
  },

  // ── Tier 2: Strong priority ───────────────────────────────────

  {
    id: 'multi_site_coordination',
    theme: 'Multi-Site Coordination & Visibility',
    description: 'Operating across multiple plants or locations creates data silos and coordination complexity',
    required_signals: ['multi_location_operations'],
    bonus_signals: ['growth_signal', 'capacity_expansion', 'digital_transformation'],
    applicable_models: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier', 'Conglomerate'],
    tier: 2,
  },
  {
    id: 'scale_and_capacity',
    theme: 'Scale Management & Capacity Intelligence',
    description: 'Company is expanding — new equipment, new plants, or new markets require AI to manage growth',
    required_signals: ['capacity_expansion', 'growth_signal'],
    bonus_signals: ['hiring_signal', 'recent_news_or_event'],
    applicable_models: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier'],
    tier: 2,
  },
  {
    id: 'technology_integration',
    theme: 'Technology Integration & ERP/MES Intelligence',
    description: 'Company deploying ERP, MES, or IIoT platforms needs AI to unlock value from these investments',
    required_signals: ['technology_investment', 'digital_transformation'],
    bonus_signals: ['industry_40_initiative', 'ai_mention'],
    applicable_models: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier'],
    tier: 2,
  },
  {
    id: 'workforce_intelligence',
    theme: 'Workforce Scaling & Operational Productivity',
    description: 'Active hiring signals operational scaling pressure that AI can help absorb',
    required_signals: ['hiring_signal'],
    bonus_signals: ['growth_signal', 'capacity_expansion'],
    applicable_models: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier', 'Conglomerate'],
    tier: 2,
  },
  {
    id: 'dealer_distribution_network',
    theme: 'Dealer Network & Distribution Intelligence',
    description: 'Large dealer or distribution network generates data that can power demand forecasting and network analytics',
    required_signals: ['growth_signal', 'multi_location_operations'],
    bonus_signals: ['recent_news_or_event'],
    applicable_models: ['Automotive OEM', 'Conglomerate'],
    tier: 2,
  },
  {
    id: 'automotive_after_sales',
    theme: 'After-Sales, Warranty & Fleet Intelligence',
    description: 'Vehicle fleet and after-sales operations generate service data that AI can use to reduce warranty costs',
    required_signals: ['growth_signal', 'recent_news_or_event'],
    bonus_signals: ['multi_location_operations'],
    applicable_models: ['Automotive OEM', 'Automotive Supplier'],
    tier: 2,
  },
  {
    id: 'saas_product_intelligence',
    theme: 'Product Analytics & Customer Intelligence',
    description: 'SaaS company with growing product and customer base needs AI-driven product analytics',
    required_signals: ['ai_mention', 'technology_investment'],
    bonus_signals: ['growth_signal'],
    applicable_models: ['Software/SaaS'],
    tier: 2,
  },

  // ── Tier 3: Supplementary ─────────────────────────────────────

  {
    id: 'supply_chain_growth',
    theme: 'Supply Chain & Demand Intelligence',
    description: 'Growth or expansion creates supply chain complexity requiring AI-driven forecasting',
    required_signals: ['growth_signal'],
    bonus_signals: ['capacity_expansion', 'recent_news_or_event'],
    applicable_models: ['Manufacturing', 'Automotive OEM', 'Automotive Supplier', 'Distribution/Logistics'],
    tier: 3,
  },
  {
    id: 'business_event_momentum',
    theme: 'M&A / Partnership Integration Intelligence',
    description: 'Recent business event (acquisition, partnership, expansion) creates integration and analytics needs',
    required_signals: ['recent_news_or_event'],
    bonus_signals: ['growth_signal', 'multi_location_operations'],
    applicable_models: 'all',
    tier: 3,
  },
]

// ── Main function ──────────────────────────────────────────────

/**
 * Given detected signal flags and company profile,
 * return the list of active signal clusters in priority order.
 * Accepts CompanyProfile (multi-dimensional) instead of single BusinessModelType.
 */
export function clusterSignals(
  detectedFactors: Partial<Record<string, boolean>>,
  profile: CompanyProfile,
): SignalCluster[] {
  const active: SignalCluster[] = []

  for (const def of CLUSTER_DEFS) {
    // Check model applicability using profile booleans
    if (!profileMatchesModels(profile, def.applicable_models)) continue

    // Check if at least one required signal is present
    const presentRequired = def.required_signals.filter(s => Boolean(detectedFactors[s]))
    if (presentRequired.length === 0) continue

    // Compute confidence from signal count
    const presentBonus = (def.bonus_signals ?? []).filter(s => Boolean(detectedFactors[s]))
    const totalPresent = presentRequired.length + presentBonus.length
    const totalPossible = def.required_signals.length + (def.bonus_signals?.length ?? 0)

    let confidence: 'high' | 'medium' | 'low'
    const ratio = totalPresent / totalPossible
    if (ratio >= 0.66) confidence = 'high'
    else if (ratio >= 0.33) confidence = 'medium'
    else confidence = 'low'

    active.push({
      id: def.id,
      theme: def.theme,
      description: def.description,
      signals_present: [...presentRequired, ...presentBonus],
      confidence,
      applicable_models: def.applicable_models,
      tier: def.tier,
    })
  }

  // Sort by tier, then by confidence (high > medium > low)
  const confidenceOrder = { high: 0, medium: 1, low: 2 }
  active.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    return confidenceOrder[a.confidence] - confidenceOrder[b.confidence]
  })

  return active
}

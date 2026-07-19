// ============================================================
// Shared nav config — used by both the desktop Sidebar and the
// mobile drawer so the two never drift out of sync.
// ============================================================

import { ResearchIcon, HistoryIcon, DiscoveryIcon, AutoFlowIcon } from './nav-icons'

// Contacts / Campaigns / Warm-Up / Integrations were removed from nav
// (2026-07-18) once Auto Flow covered their core job inline — the pages
// themselves are untouched and still reachable directly by URL
// (/admin/outbound/contacts, /campaigns, /warmup, /integrations), e.g. for
// a campaign's pause/resume controls or changing the active provider.
export const NAV = [
  { href: '/admin/auto-gtm', label: 'Auto Flow', icon: AutoFlowIcon, hint: 'Start here: research a company, find who to contact, and prepare outreach — one guided flow' },
  { href: '/admin/wizard', label: 'Research', icon: ResearchIcon, hint: 'Research a single company, or upload a spreadsheet of many' },
  { href: '/admin/company-discovery', label: 'Discover', icon: DiscoveryIcon, hint: 'Find new companies to target, given a description of who you sell to' },
  { href: '/admin/run-history', label: 'History', icon: HistoryIcon, hint: 'Past research runs you\'ve saved' },
] as const

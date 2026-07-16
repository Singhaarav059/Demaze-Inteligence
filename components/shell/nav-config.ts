// ============================================================
// Shared nav config — used by both the desktop Sidebar and the
// mobile drawer so the two never drift out of sync.
// ============================================================

import { ResearchIcon, HistoryIcon, DiscoveryIcon } from './nav-icons'

export const NAV = [
  { href: '/admin/wizard', label: 'Research', icon: ResearchIcon, hint: 'Research a company, or upload a lead list' },
  { href: '/admin/company-discovery', label: 'Discover', icon: DiscoveryIcon, hint: 'Standalone ICP search & Demaze leads' },
  { href: '/admin/run-history', label: 'History', icon: HistoryIcon, hint: 'Saved runs' },
] as const

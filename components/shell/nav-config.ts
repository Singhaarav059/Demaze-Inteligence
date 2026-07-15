// ============================================================
// Shared nav config — used by both the desktop Sidebar and the
// mobile drawer so the two never drift out of sync.
// ============================================================

import { ResearchIcon, BatchIcon, HistoryIcon, DiscoveryIcon } from './nav-icons'

export const NAV = [
  { href: '/admin/intelligence-lab', label: 'Research', icon: ResearchIcon, hint: 'Single-company brief' },
  { href: '/admin/company-discovery', label: 'Discover', icon: DiscoveryIcon, hint: 'ICP → matching companies' },
  { href: '/admin/batch-upload', label: 'Batch', icon: BatchIcon, hint: 'Lead-list upload' },
  { href: '/admin/run-history', label: 'History', icon: HistoryIcon, hint: 'Saved runs' },
] as const

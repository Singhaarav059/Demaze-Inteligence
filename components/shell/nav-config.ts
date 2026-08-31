// ============================================================
// Shared nav config - used by the desktop Sidebar, BottomTabBar,
// TopBar's quick-jump menu, and CommandPalette so they never drift
// out of sync.
// ============================================================

import { Clock, Ban, Flame, Plug, Library, Home } from 'lucide-react'
import { HistoryIcon, DiscoveryIcon, AutoFlowIcon, OutboundToolsIcon } from './nav-icons'

//
// 2026-08-31 UX restructuring: collapsed to the 5 destinations a
// non-technical user actually needs - Home, Find Companies, Work,
// Follow-ups, More. Research/Contacts/Campaigns/Overview/Pilot Review
// are implementation-shaped duplicates of what Work already does end
// to end (see auto-gtm/page.tsx) or internal QA tooling - they keep
// their routes and keep working, they're just no longer presented as
// destinations a normal user needs to choose between. Follow-ups is
// promoted out of the old "Outbound Tools" hub into primary nav (a
// real recurring cross-company job); Warm-Up/Suppression/Integrations/
// Sales Knowledge regrouped under Settings, one level under More.
export const NAV = [
  { href: '/admin', label: 'Home', icon: Home, hint: 'Your workspace overview' },
  { href: '/admin/company-discovery', label: 'Find Companies', icon: DiscoveryIcon, hint: 'Search for companies that match a market you define' },
  { href: '/admin/auto-gtm', label: 'Work', icon: AutoFlowIcon, hint: 'Research a company, find who to contact, and send outreach' },
  { href: '/admin/followups', label: 'Follow-ups', icon: Clock, hint: "Who's due for a follow-up, and what to do about it" },
  { href: '/admin/outbound', label: 'More', icon: OutboundToolsIcon, hint: 'History and settings' },
] as const

// Sidebar renders NAV flat now (5 items needs no grouping) - kept as a
// named export in case a future addition needs sectioning again.
export const NAV_GROUPS = [
  { label: 'Workspace', hrefs: NAV.map((n) => n.href) },
] as const

// Shared active-route check for Sidebar/TopBar/BottomTabBar. A plain
// `pathname.startsWith(href + '/')` breaks for '/admin' specifically -
// it's a prefix of every other admin route, so without this special case
// "Home" would show active on every page, not just '/admin' itself.
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/admin' && pathname.startsWith(href + '/'))
}

// Quick-jump list for TopBar's "..." menu and Cmd+K - the same
// destinations reachable from the More page one click deeper, surfaced
// here for anyone who wants to skip straight there. Contacts/Campaigns/
// Overview/Pilot Review are deliberately absent - they're internal/debug
// tools, not something to advertise in a "jump to a page" list.
export const SECONDARY_NAV = [
  { href: '/admin/run-history', label: 'History', icon: HistoryIcon, hint: "Every company you've researched, saved" },
  { href: '/admin/outbound/integrations', label: 'Connected Tools', icon: Plug, hint: 'The outside tools Demaze uses to find people and send email' },
  { href: '/admin/outbound/warmup', label: 'Mailbox Health', icon: Flame, hint: 'How ready your sending mailbox is' },
  { href: '/admin/outbound/suppression', label: 'Do-not-contact List', icon: Ban, hint: "Addresses that never get emailed again" },
  { href: '/admin/outbound/sales-knowledge', label: 'Sales Playbook', icon: Library, hint: 'What Demaze sells, to whom, and the proof' },
] as const

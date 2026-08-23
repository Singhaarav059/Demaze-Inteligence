// ============================================================
// Shared nav config - used by both the desktop Sidebar and the
// mobile drawer so the two never drift out of sync.
// ============================================================

import { Users, Send, Flame, Plug, LayoutDashboard, Clock, Ban, Library, ClipboardCheck, Home } from 'lucide-react'
import { ResearchIcon, HistoryIcon, DiscoveryIcon, AutoFlowIcon, OutboundToolsIcon } from './nav-icons'

// Contacts / Campaigns / Warm-Up / Integrations were removed from nav
// (2026-07-18) once Auto Flow covered their core job inline - the pages
// themselves are untouched and still reachable directly by URL
// (/admin/outbound/contacts, /campaigns, /warmup, /integrations), e.g. for
// a campaign's pause/resume controls or changing the active provider.
//
// 2026-07-31: re-added a single "Outbound Tools" entry pointing at the new
// /admin/outbound hub (app/admin/outbound/page.tsx) - these pages were only
// reachable via a direct URL, the TopBar "More" menu, or Cmd+K, which meant
// no on-screen path into them at all from a cold start. The individual
// pages stay out of primary NAV (SECONDARY_NAV below, unchanged) - the hub
// plus its own persistent sub-nav (AdminOutboundNav) is the one-click path
// in now, same list just presented as a proper section instead of a flat
// nav slot each.
//
// 2026-08-03: reordered so "Outbound Tools" sits above "History" - History
// is a look-back/reference page (past runs), so it now sits last in the
// primary flow ordering instead of splitting Discover from Outbound Tools.
export const NAV = [
  { href: '/admin', label: 'Home', icon: Home, hint: 'Your workspace overview' },
  { href: '/admin/auto-gtm', label: 'Auto Flow', icon: AutoFlowIcon, hint: 'Start here: research a company, find who to contact, and prepare outreach, one guided flow' },
  { href: '/admin/wizard', label: 'Research', icon: ResearchIcon, hint: 'Research a single company, or upload a spreadsheet of many' },
  { href: '/admin/company-discovery', label: 'Discover', icon: DiscoveryIcon, hint: 'Define your target market and let Demaze find companies that match' },
  { href: '/admin/outbound', label: 'Outbound Tools', icon: OutboundToolsIcon, hint: 'Manual controls: contacts, campaigns, warm-up, and vendor integrations' },
  { href: '/admin/run-history', label: 'History', icon: HistoryIcon, hint: 'Past research runs you\'ve saved' },
] as const

// 2026-08-22 redesign: purely a display grouping for Sidebar (which NAV
// entries render under which section header) - does not change routes,
// order, or the flat NAV array every other consumer (TopBar, command
// palette, BottomTabBar) already relies on.
export const NAV_GROUPS = [
  { label: 'Workspace', hrefs: ['/admin', '/admin/auto-gtm', '/admin/wizard', '/admin/company-discovery'] },
  { label: 'Outbound', hrefs: ['/admin/outbound'] },
  { label: 'System', hrefs: ['/admin/run-history'] },
] as const

// Pages pulled out of primary nav on 2026-07-18 - still real, still linked
// to directly (a campaign's pause/resume controls, changing an active
// provider). Shared by the TopBar "More" menu, the Cmd+K command palette,
// and (2026-08-23) Sidebar's own "Outbound" dropdown - clicking it reveals
// this full list inline instead of requiring a click into the
// /admin/outbound hub page first. All 9 entries live under Outbound in the
// sidebar now, including Integrations (previously a separate one-off
// quick-link under System) - it's a genuinely outbound-scoped setting
// ("vendor providers for each outbound capability"), so this is a better
// home for it, not just a dedup.
// Shared active-route check for Sidebar/TopBar/BottomTabBar. A plain
// `pathname.startsWith(href + '/')` breaks for '/admin' specifically -
// it's a prefix of every other admin route, so without this special case
// "Home" would show active on every page, not just '/admin' itself.
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/admin' && pathname.startsWith(href + '/'))
}

export const SECONDARY_NAV = [
  { href: '/admin/outbound/overview', label: 'Overview', icon: LayoutDashboard, hint: 'Cross-campaign stats and every email queued or sent, in one table' },
  { href: '/admin/outbound/pilot-review', label: 'Pilot Review', icon: ClipboardCheck, hint: 'Human quality review of a researched pilot batch - approve, reject, or flag before outreach is generated' },
  { href: '/admin/outbound/contacts', label: 'Contacts', icon: Users, hint: 'Manually-entered or discovered contacts, grouped by researched company' },
  { href: '/admin/outbound/campaigns', label: 'Campaigns', icon: Send, hint: 'Outreach campaign queues and send history' },
  { href: '/admin/outbound/followups', label: 'Follow-ups', icon: Clock, hint: 'What follow-up is due for whom, send now / stop, and the follow-up cadence' },
  { href: '/admin/outbound/sales-knowledge', label: 'Sales Knowledge', icon: Library, hint: 'Industries, problems, capabilities, and case studies used to generate sales positioning' },
  { href: '/admin/outbound/suppression', label: 'Suppression', icon: Ban, hint: 'Bounced, unsubscribed, and manually excluded addresses - never sent to again' },
  { href: '/admin/outbound/warmup', label: 'Warm-Up', icon: Flame, hint: 'Mailbox warm-up status and metrics' },
  { href: '/admin/outbound/integrations', label: 'Integrations', icon: Plug, hint: 'Vendor providers for each outbound capability' },
] as const

// ============================================================
// Role category classification — pure, no I/O
// ============================================================
// Buckets a free-text job title into one of the spec's requested filter
// categories, purely for the "N found / M recommended, filter by role"
// UI (DecisionMakerFinder.tsx) — this never affects WHO is discovered or
// searched for, only how already-returned candidates are grouped/filtered
// on screen. Checked in a specific order (most senior/specific first) so
// e.g. "Founder & CEO" lands in 'ceo-founder-owner', not 'executive'.
// ============================================================

export type RoleCategory = 'ceo-founder-owner' | 'cxo-executive' | 'vp' | 'director' | 'head' | 'manager' | 'other'

export const ROLE_CATEGORY_LABELS: Record<RoleCategory, string> = {
  'ceo-founder-owner': 'CEO / Founder / Owner',
  'cxo-executive': 'CXO / Executive',
  vp: 'VP',
  director: 'Director',
  head: 'Head',
  manager: 'Manager',
  other: 'Other',
}

const PATTERNS: Array<{ category: RoleCategory; re: RegExp }> = [
  { category: 'ceo-founder-owner', re: /\b(chief executive officer|\bceo\b|founder|co-founder|owner|proprietor|managing director|\bmd\b)\b/i },
  { category: 'cxo-executive', re: /\b(chief\s+\w+\s+officer|\bc[a-z]o\b|president|chairman|chairperson|executive\s+(?:vice\s+)?president)\b/i },
  { category: 'vp', re: /\bvice\s+president\b|\bvp\b/i },
  { category: 'director', re: /\bdirector\b/i },
  { category: 'head', re: /\bhead\s+of\b|\bhead\b/i },
  { category: 'manager', re: /\bmanager\b|\blead\b/i },
]

export function classifyRoleCategory(title: string | null | undefined): RoleCategory {
  const t = (title ?? '').trim()
  if (!t) return 'other'
  for (const { category, re } of PATTERNS) {
    if (re.test(t)) return category
  }
  return 'other'
}

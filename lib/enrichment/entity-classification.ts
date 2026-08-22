// ============================================================
// Entity-type classification — the missing layer between "candidate name
// extracted from search text" and "is this a company at all"
// ============================================================
// Before this module, company-discovery.ts's classifyCompanyRejection()
// answered "should this be rejected" by walking an ever-growing pile of
// independent named lists (NON_COMPANY_NAMES, TRADE_ASSOCIATION_OR_GOV_NAMES,
// GENERIC_CATEGORY_OR_GEOGRAPHY_WORDS, ...) added one at a time every time a
// new false positive surfaced live. That works, but it's reactive — each
// fix only covers the exact name that leaked, not the underlying shape.
//
// This module answers a narrower, reusable question instead: WHAT KIND of
// entity is this name, structurally? Company-discovery.ts (and anything
// else that needs it later) can then decide what to do with a non-COMPANY
// entity type — today that's still "reject it," but the type is now a real,
// inspectable classification, not a scattered set of independent regexes
// with only a rejection-reason string to show for it.
//
// Deterministic only, same discipline as every other classifier in this
// codebase (website-discovery.ts, evidence-extractor.ts's classifySubject) —
// no LLM call. The lists below are moved here verbatim from
// company-discovery.ts (same content, same "add the exact name/keyword that
// leaked live" discipline), not reinvented — a blacklist is still allowed
// as supplementary evidence per the governing task, it's just organized
// under a real taxonomy now instead of standing alone.
//
// Deliberately NOT attempting SUBSIDIARY/PARENT_COMPANY classification here
// — recognizing "X is a subsidiary of Y" from a bare candidate name + a
// couple of search snippets needs real corporate-structure reasoning, not a
// regex, and there's no reliable structural signal for it in what this
// module receives. That's a genuine, stated gap (see this module's own
// exported UNRESOLVED_ENTITY_RELATIONSHIPS note) — identity.ts's
// domain/LinkedIn/name resolution already prevents "Noon" and "Noon.com"
// from becoming two rows; it does NOT know that a hypothetical "Noon
// Foods" is (or isn't) a Noon subsidiary. Left for a future session if a
// real subsidiary-misattribution case shows up live, same "don't guess
// ahead of a real, observed failure" discipline as everything else here.
// ============================================================

import { escapeRegex } from '../utils/regex'

export type EntityType =
  | 'COMPANY'
  | 'GOVERNMENT'
  | 'ASSOCIATION'
  | 'NONPROFIT'
  | 'MEDIA'
  | 'DIRECTORY'
  | 'GENERIC_TERM'
  | 'UNKNOWN'

export interface EntityClassification {
  type: EntityType
  /** null only for type COMPANY with nothing notable flagged. */
  reason: string | null
  /** The specific list entry / pattern that matched, for diagnostics. */
  matched?: string
  /** 'high' for an explicit list/keyword match (a positive, specific
   * signal); 'medium' for the COMPANY default (absence of a negative
   * signal, not a confirmed positive one); 'low' for UNKNOWN (genuinely
   * couldn't classify). Added 2026-08-20 for qualification provenance —
   * see company_registry.entity_confidence. */
  confidence: 'high' | 'medium' | 'low'
}

// ── DIRECTORY / MEDIA — known aggregators, review sites, social networks,
// news outlets. A search RESULT from one of these can legitimately name
// real companies in its snippet, but the site's own brand name must never
// be extracted AS a discovered company. Moved verbatim from
// company-discovery.ts's NON_COMPANY_NAMES, split into the two entity
// types the task's taxonomy actually distinguishes.
const DIRECTORY_NAMES = [
  'G2', 'Capterra', 'TrustRadius', 'Crunchbase', 'SimilarWeb', 'Gartner',
  'Glassdoor', 'Indeed', 'Clutch', 'Google', 'Yelp',
]
const MEDIA_NAMES = [
  'Wikipedia', 'LinkedIn', 'YouTube', 'Facebook', 'Twitter', 'Instagram',
  'Reuters', 'Bloomberg', 'Forbes', 'BusinessWire', 'PRNewswire', 'Medium',
  'Quora', 'Reddit',
]

// ── GOVERNMENT — government-run programs/economic zones. Moved from
// company-discovery.ts's TRADE_ASSOCIATION_OR_GOV_NAMES (the government-
// shaped subset specifically, per that list's own comment).
const GOVERNMENT_NAMES = ['Manufacturing USA', 'Eastern Economic Corridor']
// Industrial parks/estates/clusters (added 2026-08-20, live benchmark run:
// "VSIP Industrial System", "Karawang Industrial Cluster", "Jurong
// Industrial Estate" all qualified — none are companies, all are
// state-designated economic zones, same real-world category as "Eastern
// Economic Corridor" above, just a broader structural keyword pattern
// instead of one specific name) grouped into the same GOVERNMENT keyword
// regex rather than a new entity type — a real physical zone is
// overwhelmingly government-developed/-designated, not a private company.
const GOVERNMENT_KEYWORD_RE =
  /\b(?:ministry of|department of|government of|federal government|national program(?:me)?|economic corridor|industrial (?:park|estate|cluster|zone|system|area)|special economic zone|free trade zone|export processing zone)\b/i

// ── ASSOCIATION — trade associations, industry federations/consortia.
const ASSOCIATION_NAMES = ['CLEPA', 'APMA', 'EECA']
const ASSOCIATION_KEYWORD_RE =
  /\b(?:association|federation|consortium|institute|chamber of commerce|trade\s+body|industry\s+council)\b/i

// ── NONPROFIT — charitable/nonprofit orgs. No live-observed leak yet (the
// 2026-08-19 audit found association/government leaks, not nonprofit ones)
// — kept as a real, checked category rather than silently absent from the
// taxonomy, per the governing task's explicit list. Extend when a real case
// surfaces, same discipline as every other list here.
const NONPROFIT_KEYWORD_RE = /\b(?:nonprofit|non-profit|charitable trust|foundation|ngo)\b/i

// ── GENERIC_TERM — bare industry/category/geography nouns and common
// English words, single-word-scoped so a real multi-word company name
// ("Mexico Manufacturing Co", "Nova Chemicals") is never affected. Moved
// verbatim from company-discovery.ts's GENERIC_CATEGORY_OR_GEOGRAPHY_WORDS
// + COMMON_NON_COMPANY_WORDS.
const GENERIC_CATEGORY_OR_GEOGRAPHY_WORDS = new Set([
  'electronics', 'automotive', 'semiconductor', 'manufacturing', 'general',
  'mexico', 'saudi', 'nova', 'canada', 'india', 'china', 'europe', 'asia',
  'africa', 'brazil', 'america', 'usa',
])
const COMMON_NON_COMPANY_WORDS = new Set([
  'launched', 'featured', 'related', 'included', 'available', 'located',
  'based', 'certified', 'approved', 'listed', 'updated', 'released',
  'established', 'rated', 'ranked', 'reviewed', 'compared', 'recommended',
  'trusted', 'verified', 'sponsored', 'presented', 'provided', 'offered',
  'designed', 'manufactured', 'supplied', 'delivered', 'required', 'shown',
])
// Listicle section-header phrases ("The Regional Market Leaders: Ozon,
// Wildberries...") extracted as if the header itself were a company name.
const LISTICLE_HEADER_PHRASE_RE = /^the\s+.+\s+(?:giants|leaders|players|titans|pioneers)$/i
const STOPWORDS_ONLY = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'top', 'best', 'list', 'guide',
  'review', 'in', 'of', 'to', 'with', 'by', 'is', 'are', 'this', 'that',
  'these', 'those', 'you', 'your', 'other', 'others',
  'companies', 'company', 'businesses', 'firms', 'players', 'vendors',
])

function matchesAny(name: string, list: string[]): string | undefined {
  return list.find(entry => new RegExp(`\\b${escapeRegex(entry)}\\b`, 'i').test(name))
}

// Pure, deterministic. Order matters (most-specific/most-confident first),
// same discipline as classifyCompanyRejection()'s own check ordering.
export function classifyEntityType(name: string): EntityClassification {
  const trimmed = name.trim()

  const dirHit = matchesAny(trimmed, DIRECTORY_NAMES)
  if (dirHit) {
    return { type: 'DIRECTORY', reason: 'known directory/aggregator/review-site name, not a company', matched: dirHit, confidence: 'high' }
  }
  const mediaHit = matchesAny(trimmed, MEDIA_NAMES)
  if (mediaHit) {
    return { type: 'MEDIA', reason: 'known news outlet/social network name, not a company', matched: mediaHit, confidence: 'high' }
  }

  const govHit = matchesAny(trimmed, GOVERNMENT_NAMES)
  if (govHit) {
    return { type: 'GOVERNMENT', reason: 'government program/economic zone, not a company', matched: govHit, confidence: 'high' }
  }
  if (GOVERNMENT_KEYWORD_RE.test(trimmed)) {
    return { type: 'GOVERNMENT', reason: 'government program/economic zone, not a company', matched: GOVERNMENT_KEYWORD_RE.exec(trimmed)?.[0], confidence: 'high' }
  }

  const assocHit = matchesAny(trimmed, ASSOCIATION_NAMES)
  if (assocHit) {
    return { type: 'ASSOCIATION', reason: 'trade association/industry body, not a company', matched: assocHit, confidence: 'high' }
  }
  if (ASSOCIATION_KEYWORD_RE.test(trimmed)) {
    return { type: 'ASSOCIATION', reason: 'trade association/industry body, not a company', matched: ASSOCIATION_KEYWORD_RE.exec(trimmed)?.[0], confidence: 'high' }
  }

  if (NONPROFIT_KEYWORD_RE.test(trimmed)) {
    return { type: 'NONPROFIT', reason: 'nonprofit/charitable organization, not a commercial prospect', matched: NONPROFIT_KEYWORD_RE.exec(trimmed)?.[0], confidence: 'high' }
  }

  if (LISTICLE_HEADER_PHRASE_RE.test(trimmed)) {
    return { type: 'GENERIC_TERM', reason: 'listicle section-header phrase, not a company name', confidence: 'high' }
  }

  const normalized = trimmed
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) {
    return { type: 'UNKNOWN', reason: 'empty after normalization', confidence: 'low' }
  }
  const words = normalized.split(' ').filter(Boolean)
  if (words.every(w => STOPWORDS_ONLY.has(w))) {
    return { type: 'GENERIC_TERM', reason: 'generic/stopword phrase, not a company name', confidence: 'high' }
  }
  if (words.length === 1) {
    if (COMMON_NON_COMPANY_WORDS.has(words[0])) {
      return { type: 'GENERIC_TERM', reason: 'common English word (verb/adjective), not a company name', matched: words[0], confidence: 'high' }
    }
    if (GENERIC_CATEGORY_OR_GEOGRAPHY_WORDS.has(words[0])) {
      return { type: 'GENERIC_TERM', reason: 'bare industry-category or geography word, not a company name (likely a truncated listicle heading or region reference)', matched: words[0], confidence: 'high' }
    }
  }
  if (normalized.length < 3) {
    return { type: 'UNKNOWN', reason: 'too short to classify confidently', confidence: 'low' }
  }

  // COMPANY is the default fallback — absence of a negative signal, not a
  // confirmed positive one — so this is 'medium', not 'high'.
  return { type: 'COMPANY', reason: null, confidence: 'medium' }
}

// ============================================================
// Company-name guess from a bare domain
// ============================================================
// Used by test-analysis/route.ts (a) as the pre-scrape company-name guess
// for kicking off enrichment discovery before scraping starts, and (b) as
// the empty-scrape stub-injection fallback. Word-boundary splitting on
// dashes/underscores/camelCase — same discipline as matchesKeyword()'s
// short-keyword substring-match fix, just for display quality here rather
// than correctness.
//
// Reliability pass item 4 (2026-08-24): for a company hosted on a shared,
// path-based free-hosting platform (confirmed live: AS Agri and Aqua, at
// sites.google.com/view/asagriaqua/home), `domain` alone is the HOSTING
// PLATFORM's own domain, not the company — guessing from it produced
// "Google" as the company name, not "AS Agri and Aqua". The real identifier
// lives in the URL path for these platforms. Deliberately narrow — only the
// one platform actually confirmed by a live benchmark run, not a guessed
// list of "probably similar" ones; extend this table if another platform is
// confirmed the same way.
//
// Extracted into its own lib module (not left inline in route.ts) so it's
// directly unit-testable — Next.js App Router route.ts files may only
// export recognized HTTP-method handlers/route config, not arbitrary named
// exports.
// ============================================================

const PATH_BASED_HOSTING_DOMAINS: Array<{ host: string; pathPattern: RegExp }> = [
  { host: 'sites.google.com', pathPattern: /^\/(?:view|site)\/([^/]+)/ },
]

function wordsToTitleCase(raw: string): string {
  const words = raw
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : words
}

export function guessCompanyNameFromDomain(domain: string, fullUrl?: string): string {
  if (fullUrl) {
    const platform = PATH_BASED_HOSTING_DOMAINS.find(p => domain === p.host || domain.endsWith(`.${p.host}`))
    if (platform) {
      try {
        const pathMatch = new URL(fullUrl).pathname.match(platform.pathPattern)
        const slug = pathMatch?.[1] ? wordsToTitleCase(pathMatch[1]) : ''
        if (slug) return slug
      } catch {
        // Malformed fullUrl — fall through to the domain-based guess below.
      }
    }
  }

  return wordsToTitleCase(domain.replace(/\.(com|co\.in|in|net|org|io|biz|co|ltd)$/, ''))
}

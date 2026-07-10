// ============================================================
// URL Utilities
// ============================================================
// Validation, normalization, and domain extraction.
// Used by the API route before anything touches the database.
// ============================================================

// ── Validation ───────────────────────────────────────────────

export interface URLValidationResult {
  valid: boolean
  error?: string
  normalizedUrl?: string  // https://example.com (no trailing slash)
  domain?: string         // example.com
}

/**
 * Validates a user-submitted URL and returns a normalized form.
 * Accepts URLs with or without https://.
 * Rejects localhost, IPs, and non-http(s) schemes.
 */
export function validateAndNormalizeURL(raw: string): URLValidationResult {
  if (!raw || typeof raw !== 'string') {
    return { valid: false, error: 'URL is required.' }
  }

  const trimmed = raw.trim()

  if (trimmed.length === 0) {
    return { valid: false, error: 'URL cannot be empty.' }
  }

  // Auto-prepend https:// if the user omitted the scheme
  const withScheme = trimmed.startsWith('http://') || trimmed.startsWith('https://')
    ? trimmed
    : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return { valid: false, error: 'Invalid URL format. Example: https://acmemfg.com' }
  }

  // Only allow http and https
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, error: 'Only http and https URLs are supported.' }
  }

  // Reject localhost and loopback
  const host = parsed.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local')
  ) {
    return { valid: false, error: 'Localhost and local network addresses are not supported.' }
  }

  // Reject raw IP addresses (basic check -- covers IPv4)
  const ipPattern = /^\d{1,3}(\.\d{1,3}){3}$/
  if (ipPattern.test(host)) {
    return { valid: false, error: 'IP addresses are not supported. Please enter a company website URL.' }
  }

  // Must have at least one dot in the hostname (e.g. "company" alone is not valid)
  if (!host.includes('.')) {
    return { valid: false, error: 'Invalid URL. Please enter a full company website address.' }
  }

  const domain = extractDomain(parsed)

  // For hosted-platform sites (Google Sites, GitHub Pages, Webflow, etc.)
  // the path IS the company identity -- strip it and you lose the site.
  //   https://sites.google.com/view/acme/home  -->  keep full path
  //   https://www.aitg.co/about.html           -->  strip to origin (normal case)
  const HOSTED_PLATFORMS = [
    'sites.google.com',
    'github.io',
    'webflow.io',
    'wixsite.com',
    'squarespace.com',
    'cargo.site',
    'weebly.com',
    'wordpress.com',
    'blogspot.com',
  ]
  const isHostedPlatform = HOSTED_PLATFORMS.some(p => parsed.hostname.includes(p))
  const normalizedUrl = isHostedPlatform
    ? `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, '')
    : `${parsed.protocol}//${parsed.host}`

  return {
    valid: true,
    normalizedUrl,
    domain,
  }
}

// ── Domain extraction ─────────────────────────────────────────

/**
 * Extracts the normalized domain from a parsed URL.
 * Strips www. prefix so acmemfg.com and www.acmemfg.com map to the same company.
 *
 * Examples:
 *   https://www.acmemfg.com/about  -->  acmemfg.com
 *   https://hartmannstamping.com   -->  hartmannstamping.com
 *   http://www.sub.company.co.uk   -->  sub.company.co.uk
 */
export function extractDomain(url: URL): string {
  let host = url.hostname.toLowerCase()

  // Strip www. prefix
  if (host.startsWith('www.')) {
    host = host.slice(4)
  }

  return host
}

// ── Page URL builder ──────────────────────────────────────────

/**
 * Builds the full URLs for pages to scrape given a base URL and path list.
 * Handles trailing slashes and duplicate slashes safely.
 *
 * Example:
 *   base: "https://acmemfg.com"
 *   paths: ["/", "/about", "/careers"]
 */
export function buildPageURLs(baseUrl: string, paths: string[]): string[] {
  const base = baseUrl.replace(/\/$/, '')

  return paths.map(path => {
    if (path === '/') return base
    const cleanPath = path.startsWith('/') ? path : `/${path}`
    return `${base}${cleanPath}`
  })
}

// ── URL display helper ────────────────────────────────────────

/**
 * Returns a clean display version of a URL for the UI.
 * Strips scheme and www. for readability.
 *
 * Example:
 *   "https://www.hartmannstamping.com"  -->  "hartmannstamping.com"
 */
export function displayURL(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
}

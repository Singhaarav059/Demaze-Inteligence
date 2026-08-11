// ============================================================
// Resolves this app's real public origin for OAuth redirect construction.
// ============================================================
// req.nextUrl.origin (and .protocol) are unreliable on this app's Railway
// deployment — observed live to resolve to http://localhost:8080 (the
// container's internal bind address) instead of the real public URL,
// regardless of which domain (custom or *.up.railway.app) actually served
// the request. This breaks anything built from it: the OAuth state
// cookie's `secure` flag, the redirect_uri sent to Google, and the
// post-auth redirect back into the app's own UI.
//
// Two public domains are both meant to work symmetrically for this app
// (custom domain + *.up.railway.app) — so a single fixed override can't be
// the primary mechanism, it would always force one domain regardless of
// which one the user is actually on. Instead: prefer X-Forwarded-Host /
// X-Forwarded-Proto, the headers Railway's edge proxy sets with the real
// original request info even though req.nextUrl.origin itself gets it
// wrong — this resolves correctly per-domain, with no per-domain env var
// needed. Falls back to OUTBOUND_TRACKING_BASE_URL (this app's existing
// "explicit real public origin" var, see gmail.ts's tracking-pixel
// builder) when forwarded headers are absent, then to req.nextUrl.origin
// for local dev where the request's own origin is reliable and neither is
// typically set.
// ============================================================

import { NextRequest } from 'next/server'

export function resolveForwardedOrigin(req: NextRequest): string | null {
  const forwardedHost = req.headers.get('x-forwarded-host')
  if (!forwardedHost) return null
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'
  return `${forwardedProto}://${forwardedHost}`
}

export function resolvePublicOrigin(req: NextRequest): string {
  const forwarded = resolveForwardedOrigin(req)
  if (forwarded) return forwarded
  const configured = process.env.OUTBOUND_TRACKING_BASE_URL
  if (configured) return configured.replace(/\/+$/, '')
  return req.nextUrl.origin
}

export function isPublicOriginHttps(req: NextRequest): boolean {
  return resolvePublicOrigin(req).startsWith('https:')
}

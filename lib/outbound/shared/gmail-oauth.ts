// ============================================================
// Shared Gmail OAuth redirect-URI resolution
// ============================================================
// Every Google-connected flow in this app (Email Sending, Warm-Up, and any
// future one) redirects through ONE shared callback path
// (app/api/admin/outbound/oauth/gmail/callback). Google enforces exact-match
// redirect URI allowlisting server-side (no wildcards) — the only lever this
// app has is how many distinct URLs it ever asks Google to allow, so every
// flow using the same path means exactly one Console entry per public
// domain, permanently, instead of one per flow. See the callback route's own
// header comment for the full reasoning and the two /start routes for how
// they stay otherwise independent (own state cookie, own scopes).
// ============================================================

import { NextRequest } from 'next/server'
import { resolveForwardedOrigin } from './oauth-origin'

export const GMAIL_OAUTH_CALLBACK_PATH = '/api/admin/outbound/oauth/gmail/callback'

// Forwarded-header origin takes priority so both public domains (custom +
// *.up.railway.app) resolve to their own matching, already-registered
// callback URL — see oauth-origin.ts's header comment. The env var is a
// fallback only, for environments where X-Forwarded-Host isn't set.
export function resolveGmailOAuthRedirectUri(req: NextRequest): string {
  const forwarded = resolveForwardedOrigin(req)
  if (forwarded) return `${forwarded}${GMAIL_OAUTH_CALLBACK_PATH}`
  return process.env.GOOGLE_OAUTH_REDIRECT_URI || `${req.nextUrl.origin}${GMAIL_OAUTH_CALLBACK_PATH}`
}

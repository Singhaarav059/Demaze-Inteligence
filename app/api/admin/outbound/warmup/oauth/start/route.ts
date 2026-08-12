// ============================================================
// Admin: Warmup Gmail OAuth — GET /api/admin/outbound/warmup/oauth/start
// ============================================================
// Kicks off the Google consent flow for a warmup-pool mailbox. Structurally
// identical to the Email Sending capability's OAuth pair
// (app/api/admin/outbound/integrations/gmail/oauth/start) — same
// rate-limit/state-cookie/CSRF discipline, see that route's own header
// comment for the full reasoning (top-level browser navigation, can't use
// verifyAdminRequest). Two real differences: a separate state cookie name
// (a warmup connect and a sending connect could otherwise collide if
// started in different tabs) and GMAIL_WARMUP_SCOPES instead of the
// sending capability's narrower GMAIL_SCOPES — see gmail-client.ts's
// GMAIL_WARMUP_SCOPES comment for why warmup needs gmail.modify. The
// callback landing page is shared with every other Google-connected flow —
// see lib/outbound/shared/gmail-oauth.ts and the shared callback route's
// own header comment for why.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { buildAuthUrl, GMAIL_WARMUP_SCOPES } from '@/lib/outbound/shared/gmail-client'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { isPublicOriginHttps } from '@/lib/outbound/shared/oauth-origin'
import { resolveGmailOAuthRedirectUri } from '@/lib/outbound/shared/gmail-oauth'

export const STATE_COOKIE = 'warmup_gmail_oauth_state'
const OAUTH_RATE_LIMIT = { limit: 10, windowMs: 60_000 }

export async function GET(req: NextRequest) {
  const rateLimit = checkRateLimit(`warmup-gmail-oauth:${getClientIp(req)}`, OAUTH_RATE_LIMIT)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts, please wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds ?? 60) } }
    )
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    return NextResponse.json(
      { success: false, error: 'GOOGLE_CLIENT_ID is not configured, see .env.example for setup steps.' },
      { status: 500 }
    )
  }

  const state = randomBytes(16).toString('hex')
  const authUrl = buildAuthUrl({
    clientId,
    redirectUri: resolveGmailOAuthRedirectUri(req),
    state,
    scopes: GMAIL_WARMUP_SCOPES,
  })

  const res = NextResponse.redirect(authUrl)
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: isPublicOriginHttps(req),
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return res
}

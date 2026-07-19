// ============================================================
// Admin: Gmail OAuth — GET /api/admin/outbound/integrations/gmail/oauth/start
// ============================================================
// Kicks off the one-time Google consent flow for the Email Sending
// capability. This route (and its /callback counterpart) is reached by a
// top-level browser navigation (an <a href> click, then Google's own
// redirect back) — never a fetch() call — so it cannot use this app's
// header-based verifyAdminRequest (x-admin-token is only ever attached by
// this app's own fetch calls, never by a browser following a link/redirect,
// same reason the callback below can't use it either). Instead: a random
// nonce is set as a short-lived httpOnly cookie here and compared against
// Google's returned `state` on callback — the standard OAuth CSRF-
// protection pattern, independent of whether ADMIN_SECRET is configured.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { buildAuthUrl } from '@/lib/outbound/shared/gmail-client'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export const STATE_COOKIE = 'gmail_oauth_state'
const OAUTH_RATE_LIMIT = { limit: 10, windowMs: 60_000 }

export function resolveRedirectUri(req: NextRequest): string {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI
    || `${req.nextUrl.origin}/api/admin/outbound/integrations/gmail/oauth/callback`
}

export async function GET(req: NextRequest) {
  const rateLimit = checkRateLimit(`gmail-oauth:${getClientIp(req)}`, OAUTH_RATE_LIMIT)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts — please wait a minute and try again.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds ?? 60) } }
    )
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    return NextResponse.json(
      { success: false, error: 'GOOGLE_CLIENT_ID is not configured — see .env.example for setup steps.' },
      { status: 500 }
    )
  }

  const state = randomBytes(16).toString('hex')
  const authUrl = buildAuthUrl({ clientId, redirectUri: resolveRedirectUri(req), state })

  const res = NextResponse.redirect(authUrl)
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return res
}

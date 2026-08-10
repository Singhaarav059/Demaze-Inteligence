// ============================================================
// Admin: Warmup Gmail OAuth — GET /api/admin/outbound/warmup/oauth/callback
// ============================================================
// See ../start/route.ts's header for why this is a separate flow from the
// sending capability's OAuth pair (broader gmail.modify scope, own state
// cookie). The one other structural difference from the sending callback:
// NO single-active-provider deactivate-then-upsert — warmup is a POOL, many
// Gmail mailboxes are meant to be connected and active simultaneously, so
// this just upserts the one row for whichever address just connected,
// preserving its existing started_at/status if it's a reconnect (never
// reset someone's warm-up ramp just because they re-authorized).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens, fetchGmailAddress, encodeGmailCredential } from '@/lib/outbound/shared/gmail-client'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { STATE_COOKIE, resolveWarmupRedirectUri } from '../start/route'

const OAUTH_RATE_LIMIT = { limit: 10, windowMs: 60_000 }

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function backToWarmup(req: NextRequest, status: 'success' | 'error', message?: string) {
  const url = new URL('/admin/outbound/warmup', req.nextUrl.origin)
  url.searchParams.set('warmup_oauth', status)
  if (message) url.searchParams.set('warmup_oauth_message', message)
  const res = NextResponse.redirect(url)
  res.cookies.delete(STATE_COOKIE)
  return res
}

export async function GET(req: NextRequest) {
  const rateLimit = checkRateLimit(`warmup-gmail-oauth:${getClientIp(req)}`, OAUTH_RATE_LIMIT)
  if (!rateLimit.allowed) {
    return backToWarmup(req, 'error', 'Too many attempts — please wait a minute and try again.')
  }

  const code = req.nextUrl.searchParams.get('code')
  const returnedState = req.nextUrl.searchParams.get('state')
  const googleError = req.nextUrl.searchParams.get('error')
  const expectedState = req.cookies.get(STATE_COOKIE)?.value

  if (googleError) {
    return backToWarmup(req, 'error', `Google denied access: ${googleError}`)
  }
  if (!code) {
    return backToWarmup(req, 'error', 'No authorization code returned by Google.')
  }
  if (!expectedState || !returnedState || !timingSafeEqualStr(returnedState, expectedState)) {
    return backToWarmup(req, 'error', 'OAuth state mismatch — please try connecting again.')
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return backToWarmup(req, 'error', 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not configured.')
  }

  const tokenResult = await exchangeCodeForTokens({
    code,
    clientId,
    clientSecret,
    redirectUri: resolveWarmupRedirectUri(req),
  })

  if (!tokenResult.ok) {
    return backToWarmup(req, 'error', tokenResult.error)
  }
  if (!tokenResult.refreshToken) {
    return backToWarmup(
      req,
      'error',
      'Google did not return a refresh token — try disconnecting this app\'s access at myaccount.google.com/permissions and reconnecting.'
    )
  }

  const email = await fetchGmailAddress(tokenResult.accessToken)
  if (!email) {
    return backToWarmup(req, 'error', 'Connected, but could not read the account\'s email address from Google.')
  }

  const encrypted = encodeGmailCredential({
    clientId,
    clientSecret,
    refreshToken: tokenResult.refreshToken,
    email,
  })

  const supabase = createServerClient()

  // Preserve started_at/status on a reconnect — an existing pool member
  // re-authorizing (e.g. after a revoked/expired refresh token) should not
  // have its warm-up ramp reset back to day zero.
  const { data: existing } = await supabase
    .from('outbound_warmup_mailboxes')
    .select('id, started_at, status')
    .eq('mailbox_address', email)
    .maybeSingle()

  const { error: upsertError } = await supabase
    .from('outbound_warmup_mailboxes')
    .upsert(
      {
        mailbox_address: email,
        provider_name: 'gmail',
        status: existing?.status ?? 'warming',
        started_at: existing?.started_at ?? new Date().toISOString(),
        credential_encrypted: encrypted,
        oauth_connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'mailbox_address' }
    )

  if (upsertError) {
    return backToWarmup(req, 'error', upsertError.message)
  }

  return backToWarmup(req, 'success', `Connected ${email} to the warm-up pool`)
}

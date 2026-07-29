// ============================================================
// Gmail — shared low-level OAuth + send client
// ============================================================
// Interim Email Sending provider (2026-07-19) until a paid cold-outreach
// platform (Smartlead/Instantly) is chosen — see lib/outbound/sending/
// providers/gmail.ts for why Snov.io was ruled out first: its API is
// drip-campaign/list-based, with no "send this exact pre-written subject/
// body to this address now" primitive, which is what this pipeline's
// per-contact LLM-generated content actually needs.
//
// Unlike Prospeo's single API key, Gmail is OAuth 2.0 (authorization_code
// grant, offline access for a refresh token) — there is no way to send mail
// as a specific Google account without that account's owner clicking
// through Google's own consent screen once. This module only handles the
// token exchange/refresh/send mechanics; the actual consent redirect lives
// in app/api/admin/outbound/integrations/gmail/oauth/{start,callback}.
//
// Credential storage: unlike Prospeo (a single API key string), Gmail needs
// three values together (client_id, client_secret, refresh_token) to ever
// refresh a working access token again — encodeGmailCredential/
// decodeGmailCredential JSON-encode all three (plus the connected account's
// email, for display only) into one blob before it goes through the same
// AES-256-GCM credential_encrypted column every other vendor uses
// (lib/outbound/settings/credential-crypto.ts). Storing client_id/secret
// alongside the refresh token (rather than only trusting current env vars)
// means a stored token keeps working even if GOOGLE_CLIENT_ID/SECRET are
// later rotated for a *different* Google Cloud OAuth app.
// ============================================================

import { encryptCredential, decryptCredential } from '@/lib/outbound/settings/credential-crypto'
import { getActiveCredential } from '@/lib/outbound/settings/provider-selection'

const GMAIL_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const GMAIL_THREADS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/threads'
const DEFAULT_TIMEOUT_MS = 15000

// gmail.metadata (added 2026-07-29 for free reply tracking) grants read
// access to message/thread headers and labels ONLY — never body content —
// which is exactly enough to tell "did this thread get a reply from someone
// else" without ever reading what a prospect actually wrote. userinfo.email
// is only used to show "Connected as: someone@gmail.com" in the Integrations
// UI, never anything else.
//
// IMPORTANT: this scope was added after gmail.send/userinfo.email were
// already live for some accounts — an already-connected account's stored
// refresh token predates this scope and does NOT have read access. Anyone
// who connected Gmail before this change needs to click "Reconnect with
// Google" once (the auth URL's prompt=consent forces a fresh grant) before
// checkGmailThreadForReply() below will work for them; sendEmail() is
// unaffected either way.
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/userinfo.email',
]

export interface GmailCredential {
  clientId: string
  clientSecret: string
  refreshToken: string
  email?: string
}

export function encodeGmailCredential(cred: GmailCredential): string {
  return encryptCredential(JSON.stringify(cred))
}

// Never throws — a corrupted/foreign blob (wrong key, tampered, or simply
// not a Gmail credential) resolves to null, same "null means treat as
// unconfigured" contract as getProspeoApiKey().
export function decodeGmailCredential(blob: string): GmailCredential | null {
  try {
    const parsed = JSON.parse(decryptCredential(blob))
    if (
      parsed && typeof parsed === 'object' &&
      typeof parsed.clientId === 'string' &&
      typeof parsed.clientSecret === 'string' &&
      typeof parsed.refreshToken === 'string'
    ) {
      return parsed as GmailCredential
    }
    return null
  } catch {
    return null
  }
}

export async function getGmailCredential(): Promise<GmailCredential | null> {
  const stored = await getActiveCredential('sending')
  if (!stored) return null
  return decodeGmailCredential(stored)
}

export function buildAuthUrl(params: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(GMAIL_AUTH_URL)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GMAIL_SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  // Forces Google to reissue a refresh_token even for a user who's
  // consented before — without this, a reconnect after a lost/invalidated
  // token could silently come back with no refresh_token at all.
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', params.state)
  return url.toString()
}

export type GmailTokenResult =
  | { ok: true; accessToken: string; refreshToken?: string; expiresIn: number }
  | { ok: false; error: string }

async function postToken(body: Record<string, string>, timeoutMs: number): Promise<GmailTokenResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(GMAIL_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: controller.signal,
    })
    const json = await res.json().catch(() => null)

    if (!res.ok || !json || typeof json.access_token !== 'string') {
      const detail = json?.error_description || json?.error || `HTTP ${res.status}`
      return { ok: false, error: `Google token endpoint error: ${detail}` }
    }

    return {
      ok: true,
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
      expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 3600,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Network error calling Google token endpoint'
    return { ok: false, error: controller.signal.aborted ? `Google token request timed out after ${timeoutMs}ms` : message }
  } finally {
    clearTimeout(timeout)
  }
}

// One-time: authorization code -> {access_token, refresh_token}. Only the
// OAuth callback route calls this — refresh_token is only issued here (or
// on a later re-consent), never from refreshAccessToken().
export async function exchangeCodeForTokens(
  params: { code: string; clientId: string; clientSecret: string; redirectUri: string },
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<GmailTokenResult> {
  return postToken({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
  }, timeoutMs)
}

// Every send needs this first — access tokens are short-lived (~1hr) and
// this repo never caches one across requests (each API route is a fresh
// serverless-style invocation; see lib/ai/provider-factory.ts's equivalent
// per-call-fresh discipline for other providers).
export async function refreshAccessToken(
  params: { clientId: string; clientSecret: string; refreshToken: string },
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<GmailTokenResult> {
  return postToken({
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: 'refresh_token',
  }, timeoutMs)
}

export async function fetchGmailAddress(
  accessToken: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(GMAIL_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => null)
    return typeof json?.email === 'string' ? json.email : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// base64url per RFC 4648 §5 (Gmail's `raw` field requires this, not
// standard base64) — strip padding, swap +/ for -_.
export function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// RFC 2047-encode the Subject header so non-ASCII (any language other than
// plain English) survives — everything else in this minimal MIME message is
// plain text/utf-8, no HTML, no attachments (matches SendEmailRequest's
// current shape: subject + plain body only).
function encodeSubjectHeader(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`
}

export function buildMimeMessage(params: { to: string; subject: string; bodyText: string; from?: string }): string {
  const lines = [
    `To: ${params.to}`,
    ...(params.from ? [`From: ${params.from}`] : []),
    `Subject: ${encodeSubjectHeader(params.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    params.bodyText,
  ]
  return lines.join('\r\n')
}

export type GmailSendResult =
  | { ok: true; messageId: string; threadId: string }
  | { ok: false; error: string }

export async function sendGmailMessage(
  params: { accessToken: string; to: string; subject: string; bodyText: string; from?: string },
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<GmailSendResult> {
  const raw = base64UrlEncode(buildMimeMessage(params))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(GMAIL_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
      signal: controller.signal,
    })
    const json = await res.json().catch(() => null)

    if (!res.ok || !json?.id) {
      const detail = json?.error?.message || `HTTP ${res.status}`
      return { ok: false, error: `Gmail send failed: ${detail}` }
    }

    // threadId is what makes free reply tracking possible (see
    // checkGmailThreadForReply below) — a freshly-sent message starts a new
    // thread of its own, so threadId === messageId at send time, but keeping
    // both named explicitly (rather than reusing one value for both) avoids
    // relying on that Gmail implementation detail elsewhere in this codebase.
    return { ok: true, messageId: json.id, threadId: json.threadId ?? json.id }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Network error calling Gmail send API'
    return { ok: false, error: controller.signal.aborted ? `Gmail send request timed out after ${timeoutMs}ms` : message }
  } finally {
    clearTimeout(timeout)
  }
}

interface GmailThreadMessage {
  id: string
  from: string | null
}

export type GmailThreadResult =
  | { ok: true; messages: GmailThreadMessage[] }
  | { ok: false; error: string }

// format=metadata + metadataHeaders=From deliberately never requests message
// bodies — this only ever sees who a message is from, matching the
// gmail.metadata scope's own read-only-headers guarantee. Used by
// checkGmailThreadForReply() below, and directly by anything that just
// wants the raw per-message From headers for a thread.
export async function getGmailThread(
  threadId: string,
  accessToken: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<GmailThreadResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = new URL(`${GMAIL_THREADS_URL}/${threadId}`)
    url.searchParams.set('format', 'metadata')
    url.searchParams.set('metadataHeaders', 'From')

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
    const json = await res.json().catch(() => null)

    if (!res.ok || !Array.isArray(json?.messages)) {
      const detail = json?.error?.message || `HTTP ${res.status}`
      return { ok: false, error: `Gmail thread fetch failed: ${detail}` }
    }

    const messages: GmailThreadMessage[] = json.messages.map((m: { id: string; payload?: { headers?: Array<{ name: string; value: string }> } }) => {
      const fromHeader = m.payload?.headers?.find(h => h.name.toLowerCase() === 'from')
      return { id: m.id, from: fromHeader?.value ?? null }
    })

    return { ok: true, messages }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Network error calling Gmail threads API'
    return { ok: false, error: controller.signal.aborted ? `Gmail thread request timed out after ${timeoutMs}ms` : message }
  } finally {
    clearTimeout(timeout)
  }
}

export interface ReplyCheckResult {
  hasReply: boolean
  replyMessageId?: string
  fromHeader?: string
}

// A message counts as "a reply" only if its From header doesn't belong to
// the connected account — this is what stops a manually-sent follow-up
// (sent from within Gmail's own UI, in the same thread, by the connected
// account itself) from being mistaken for a prospect's reply. If more than
// one qualifying message exists, the most recent one (last in Gmail's
// thread order) is reported.
export function findReplyInThread(messages: GmailThreadMessage[], connectedEmail: string): ReplyCheckResult {
  const lowerConnected = connectedEmail.toLowerCase()
  const replies = messages.filter(m => m.from && !m.from.toLowerCase().includes(lowerConnected))
  const last = replies[replies.length - 1]
  if (!last) return { hasReply: false }
  return { hasReply: true, replyMessageId: last.id, fromHeader: last.from ?? undefined }
}

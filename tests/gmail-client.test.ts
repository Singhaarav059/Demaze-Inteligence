// ============================================================
// Gmail client — tests
// ============================================================
// Pure-function tests (MIME building, base64url, credential blob round-
// trip) plus real-client tests with global.fetch mocked, same convention
// as tests/prospeo-client.test.ts.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'crypto'
import { encryptCredential, decryptCredential } from '../lib/outbound/settings/credential-crypto'

vi.mock('../lib/outbound/settings/provider-selection', () => ({
  getActiveCredential: vi.fn(),
}))

import { getActiveCredential } from '../lib/outbound/settings/provider-selection'
import {
  base64UrlEncode,
  buildMimeMessage,
  buildAuthUrl,
  encodeGmailCredential,
  decodeGmailCredential,
  getGmailCredential,
  exchangeCodeForTokens,
  refreshAccessToken,
  sendGmailMessage,
  fetchGmailAddress,
  getGmailThread,
  findReplyInThread,
  findReplyInThreadByLabel,
  getLastMessageIdHeader,
  looksLikeBounce,
  GMAIL_SCOPES,
} from '../lib/outbound/shared/gmail-client'

describe('base64UrlEncode', () => {
  it('produces URL-safe base64 with no padding', () => {
    // Standard base64 of this string contains both '+' and '/' and would
    // have '=' padding — confirms the -_ swap and padding strip both fire.
    const input = 'a'.repeat(50) + '>>>???'
    const encoded = base64UrlEncode(input)
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')
    // Round-trip back through standard base64 decoding to confirm content survives.
    const restored = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    expect(restored).toBe(input)
  })
})

describe('buildMimeMessage', () => {
  it('includes To/Subject/body and RFC 2047-encodes the subject', () => {
    const msg = buildMimeMessage({ to: 'jane@example.com', subject: 'Hello Jane', bodyText: 'Body text here.' })
    expect(msg).toContain('To: jane@example.com')
    expect(msg).toContain('Subject: =?UTF-8?B?')
    expect(msg).toContain('Content-Type: text/plain; charset="UTF-8"')
    expect(msg).toContain('Body text here.')
  })

  it('omits the From header when not provided, includes it when provided', () => {
    const withoutFrom = buildMimeMessage({ to: 'a@b.com', subject: 'S', bodyText: 'B' })
    expect(withoutFrom).not.toContain('From:')

    const withFrom = buildMimeMessage({ to: 'a@b.com', subject: 'S', bodyText: 'B', from: 'me@example.com' })
    expect(withFrom).toContain('From: me@example.com')
  })

  it('omits In-Reply-To/References when not provided, includes them when provided (follow-up threading)', () => {
    const untitled = buildMimeMessage({ to: 'a@b.com', subject: 'S', bodyText: 'B' })
    expect(untitled).not.toContain('In-Reply-To:')
    expect(untitled).not.toContain('References:')

    const threaded = buildMimeMessage({
      to: 'a@b.com',
      subject: 'Re: S',
      bodyText: 'B',
      inReplyTo: '<orig@mail.gmail.com>',
      references: '<orig@mail.gmail.com>',
    })
    expect(threaded).toContain('In-Reply-To: <orig@mail.gmail.com>')
    expect(threaded).toContain('References: <orig@mail.gmail.com>')
  })
})

describe('buildAuthUrl', () => {
  it('includes required OAuth params and both scopes', () => {
    const url = buildAuthUrl({ clientId: 'CID', redirectUri: 'https://app.example.com/cb', state: 'xyz' })
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(parsed.searchParams.get('client_id')).toBe('CID')
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example.com/cb')
    expect(parsed.searchParams.get('state')).toBe('xyz')
    expect(parsed.searchParams.get('access_type')).toBe('offline')
    expect(parsed.searchParams.get('prompt')).toBe('consent')
    for (const scope of GMAIL_SCOPES) {
      expect(parsed.searchParams.get('scope')).toContain(scope)
    }
  })
})

describe('encodeGmailCredential / decodeGmailCredential', () => {
  const ORIGINAL_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY

  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  })

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY
    else process.env.CREDENTIALS_ENCRYPTION_KEY = ORIGINAL_KEY
  })

  it('round-trips all fields including optional email', () => {
    const cred = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'refresh-tok', email: 'me@gmail.com' }
    const blob = encodeGmailCredential(cred)
    expect(decodeGmailCredential(blob)).toEqual(cred)
  })

  it('round-trips without the optional email field', () => {
    const cred = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'refresh-tok' }
    const blob = encodeGmailCredential(cred)
    expect(decodeGmailCredential(blob)).toEqual(cred)
  })

  it('returns null for a blob that decrypts but is not a valid credential shape', () => {
    // Confirms the shape-check, not just decrypt success — e.g. a Prospeo
    // API-key blob (plain string, not this JSON shape) landing in the same
    // credential_encrypted column for a different capability should never
    // be silently misread as a Gmail credential.
    const blob = encryptCredential('just-a-plain-api-key')
    expect(decodeGmailCredential(blob)).toBeNull()
  })

  it('returns null for a corrupted/tampered blob rather than throwing', () => {
    const cred = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'refresh-tok' }
    const blob = encodeGmailCredential(cred)
    const tampered = blob.slice(0, -4) + 'abcd'
    expect(decodeGmailCredential(tampered)).toBeNull()
  })
})

describe('getGmailCredential', () => {
  const ORIGINAL_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY

  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    vi.mocked(getActiveCredential).mockReset()
  })

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY
    else process.env.CREDENTIALS_ENCRYPTION_KEY = ORIGINAL_KEY
  })

  // REGRESSION (2026-07-29): getGmailCredential() used to call
  // decodeGmailCredential(stored) directly on getActiveCredential()'s
  // return value — but getActiveCredential() already decrypts
  // credential_encrypted before returning it (see
  // lib/outbound/settings/provider-selection.ts), so this was decrypting
  // an already-decrypted plaintext JSON string a second time.
  // decryptCredential() throws on anything that isn't real AES-GCM
  // ciphertext, so this silently returned null for every real stored Gmail
  // credential, undetected until a real OAuth connection was made and this
  // path was finally exercised live. getActiveCredential is mocked here to
  // return exactly what it really returns in production — decrypted
  // plaintext — not a re-encrypted blob, so this test would have caught
  // the bug.
  it('parses a real stored credential correctly (does not double-decrypt)', async () => {
    const cred = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'refresh-tok', email: 'me@gmail.com' }
    const encryptedBlob = encodeGmailCredential(cred)
    const alreadyDecryptedPlaintext = decryptCredential(encryptedBlob)
    vi.mocked(getActiveCredential).mockResolvedValue(alreadyDecryptedPlaintext)

    const result = await getGmailCredential()
    expect(result).toEqual(cred)
  })

  it('returns null when no credential is stored', async () => {
    vi.mocked(getActiveCredential).mockResolvedValue(null)
    expect(await getGmailCredential()).toBeNull()
  })

  it('returns null rather than throwing if the stored value is not valid JSON', async () => {
    vi.mocked(getActiveCredential).mockResolvedValue('not json at all')
    expect(await getGmailCredential()).toBeNull()
  })
})

describe('exchangeCodeForTokens / refreshAccessToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('exchangeCodeForTokens returns ok:true with access+refresh token on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
    }))

    const result = await exchangeCodeForTokens({ code: 'c', clientId: 'id', clientSecret: 's', redirectUri: 'https://x/cb' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.accessToken).toBe('AT')
      expect(result.refreshToken).toBe('RT')
    }
  })

  it('exchangeCodeForTokens returns ok:false with Google\'s error_description on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'Code was already redeemed.' }),
    }))

    const result = await exchangeCodeForTokens({ code: 'c', clientId: 'id', clientSecret: 's', redirectUri: 'https://x/cb' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Code was already redeemed.')
  })

  it('refreshAccessToken returns ok:true without necessarily getting a new refresh_token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'AT2', expires_in: 3600 }),
    }))

    const result = await refreshAccessToken({ clientId: 'id', clientSecret: 's', refreshToken: 'RT' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.accessToken).toBe('AT2')
      expect(result.refreshToken).toBeUndefined()
    }
  })
})

describe('sendGmailMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns ok:true with the Gmail message id and thread id on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-123', threadId: 'thread-123' }),
    }))

    const result = await sendGmailMessage({ accessToken: 'AT', to: 'a@b.com', subject: 'Hi', bodyText: 'Body' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.messageId).toBe('msg-123')
      expect(result.threadId).toBe('thread-123')
    }
  })

  it('falls back to the message id as threadId if Gmail omits threadId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-123' }),
    }))

    const result = await sendGmailMessage({ accessToken: 'AT', to: 'a@b.com', subject: 'Hi', bodyText: 'Body' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.threadId).toBe('msg-123')
  })

  it('returns ok:false with Gmail\'s error message on failure — a real HTTP response is a definite rejection, not ambiguous', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'Insufficient Permission' } }),
    }))

    const result = await sendGmailMessage({ accessToken: 'AT', to: 'a@b.com', subject: 'Hi', bodyText: 'Body' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Insufficient Permission')
      expect(result.ambiguous).toBeFalsy()
    }
  })

  // Post-Hardening Pilot Readiness Plan, Phase A, Step A4 — a timeout means
  // we never got Gmail's response, so we can't tell whether it actually
  // sent. Callers must treat this differently from a definite rejection.
  it('marks a timeout as ambiguous:true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, opts: any) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        reject(err)
      })
    })))

    const result = await sendGmailMessage({ accessToken: 'AT', to: 'a@b.com', subject: 'Hi', bodyText: 'Body' }, 5)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.ambiguous).toBe(true)
      expect(result.error).toContain('timed out')
    }
  })

  it('marks a generic thrown network error as ambiguous:true too — we still don\'t know if Gmail got the request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))

    const result = await sendGmailMessage({ accessToken: 'AT', to: 'a@b.com', subject: 'Hi', bodyText: 'Body' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.ambiguous).toBe(true)
      expect(result.error).toBe('ECONNRESET')
    }
  })

  it('includes threadId in the request body when provided (follow-up threading), omits it otherwise', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'msg-1', threadId: 'thread-1' }) })
    vi.stubGlobal('fetch', fetchMock)

    await sendGmailMessage({ accessToken: 'AT', to: 'a@b.com', subject: 'Hi', bodyText: 'Body' })
    let body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.threadId).toBeUndefined()

    await sendGmailMessage({ accessToken: 'AT', to: 'a@b.com', subject: 'Re: Hi', bodyText: 'Body', threadId: 'thread-1' })
    body = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(body.threadId).toBe('thread-1')
  })
})

describe('fetchGmailAddress', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the email on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ email: 'someone@gmail.com' }),
    }))
    expect(await fetchGmailAddress('AT')).toBe('someone@gmail.com')
  })

  it('returns null on a non-ok response rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    expect(await fetchGmailAddress('AT')).toBeNull()
  })
})

describe('getGmailThread', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('extracts id + From + Message-Id + Subject header + labelIds for every message in the thread', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [
          { id: 'm1', labelIds: ['SENT'], payload: { headers: [{ name: 'From', value: 'me@example.com' }, { name: 'Message-Id', value: '<m1@mail.gmail.com>' }] } },
          { id: 'm2', payload: { headers: [{ name: 'Subject', value: 'Re: Hi' }, { name: 'From', value: 'Prospect <p@corp.com>' }, { name: 'Message-Id', value: '<m2@mail.gmail.com>' }] } },
        ],
      }),
    }))

    const result = await getGmailThread('thread-1', 'AT')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.messages).toEqual([
        { id: 'm1', from: 'me@example.com', messageIdHeader: '<m1@mail.gmail.com>', subject: null, labelIds: ['SENT'] },
        // No labelIds on the raw API response for m2 — falls back to [], not undefined/throwing.
        { id: 'm2', from: 'Prospect <p@corp.com>', messageIdHeader: '<m2@mail.gmail.com>', subject: 'Re: Hi', labelIds: [] },
      ])
    }
  })

  it('is null-safe for messageIdHeader when a message has no Message-Id header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'm1', payload: { headers: [{ name: 'From', value: 'me@example.com' }] } }] }),
    }))

    const result = await getGmailThread('thread-1', 'AT')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.messages[0].messageIdHeader).toBeNull()
  })

  it('requests only metadata + the From, Message-Id, and Subject headers, never full message bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    await getGmailThread('thread-1', 'AT')
    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string)
    expect(calledUrl.searchParams.get('format')).toBe('metadata')
    expect(calledUrl.searchParams.getAll('metadataHeaders')).toEqual(['From', 'Message-Id', 'Subject'])
  })

  it('returns ok:false on a non-ok response rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: 'Not Found' } }),
    }))

    const result = await getGmailThread('missing-thread', 'AT')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Not Found')
  })
})

describe('findReplyInThread', () => {
  const CONNECTED = 'me@example.com'

  it('reports no reply when the thread only has our own sent message', () => {
    const result = findReplyInThread([{ id: 'm1', from: 'Me <me@example.com>' }], CONNECTED)
    expect(result.hasReply).toBe(false)
  })

  it('reports a reply from a message whose From header does not match the connected account', () => {
    const result = findReplyInThread(
      [
        { id: 'm1', from: 'Me <me@example.com>' },
        { id: 'm2', from: 'Prospect <p@corp.com>' },
      ],
      CONNECTED
    )
    expect(result.hasReply).toBe(true)
    expect(result.replyMessageId).toBe('m2')
    expect(result.fromHeader).toBe('Prospect <p@corp.com>')
  })

  it('does not mistake our own follow-up (sent from Gmail\'s own UI in the same thread) for a reply', () => {
    const result = findReplyInThread(
      [
        { id: 'm1', from: 'Me <me@example.com>' },
        { id: 'm2', from: 'me@example.com' },
      ],
      CONNECTED
    )
    expect(result.hasReply).toBe(false)
  })

  it('picks the most recent qualifying message when there are multiple replies', () => {
    const result = findReplyInThread(
      [
        { id: 'm1', from: 'Me <me@example.com>' },
        { id: 'm2', from: 'Prospect <p@corp.com>' },
        { id: 'm3', from: 'Me <me@example.com>' },
        { id: 'm4', from: 'Prospect <p@corp.com>' },
      ],
      CONNECTED
    )
    expect(result.hasReply).toBe(true)
    expect(result.replyMessageId).toBe('m4')
  })

  it('treats a message with no From header as not-us, not as a reply-blocker for later messages', () => {
    const result = findReplyInThread([{ id: 'm1', from: null }, { id: 'm2', from: 'Prospect <p@corp.com>' }], CONNECTED)
    expect(result.hasReply).toBe(true)
    expect(result.replyMessageId).toBe('m2')
  })
})

describe('findReplyInThreadByLabel', () => {
  // The connectedEmail-less fallback used by reply-check.ts when
  // cred.email is unavailable (fetchGmailAddress can fail/be denied at
  // OAuth-connect time) — uses Gmail's own 'SENT' label instead of a
  // From-header string match.

  it('reports no reply when the thread only has our own sent message', () => {
    const result = findReplyInThreadByLabel([{ id: 'm1', from: 'Me <me@example.com>', labelIds: ['SENT'] }])
    expect(result.hasReply).toBe(false)
  })

  it('reports a reply from a message not labeled SENT', () => {
    const result = findReplyInThreadByLabel([
      { id: 'm1', from: 'Me <me@example.com>', labelIds: ['SENT'] },
      { id: 'm2', from: 'Prospect <p@corp.com>', labelIds: ['INBOX'] },
    ])
    expect(result.hasReply).toBe(true)
    expect(result.replyMessageId).toBe('m2')
    expect(result.fromHeader).toBe('Prospect <p@corp.com>')
  })

  it('does not mistake a manual reply/forward sent from Gmail\'s own UI for a prospect reply', () => {
    // The exact scenario this fix targets: connectedEmail is unknown, so
    // the old fallback (thread.messages.length > 1) would have misfiled
    // this as a reply purely by position. The SENT label still correctly
    // identifies it as something we sent, regardless of where it was sent
    // from.
    const result = findReplyInThreadByLabel([
      { id: 'm1', from: 'Me <me@example.com>', labelIds: ['SENT'] },
      { id: 'm2', from: 'me@example.com', labelIds: ['SENT'] },
    ])
    expect(result.hasReply).toBe(false)
  })

  it('picks the most recent non-SENT message when there are multiple replies', () => {
    const result = findReplyInThreadByLabel([
      { id: 'm1', from: 'Me <me@example.com>', labelIds: ['SENT'] },
      { id: 'm2', from: 'Prospect <p@corp.com>', labelIds: ['INBOX'] },
      { id: 'm3', from: 'Me <me@example.com>', labelIds: ['SENT'] },
      { id: 'm4', from: 'Prospect <p@corp.com>', labelIds: ['INBOX'] },
    ])
    expect(result.hasReply).toBe(true)
    expect(result.replyMessageId).toBe('m4')
  })

  it('treats a message with no labelIds at all as not sent by us (conservative default)', () => {
    const result = findReplyInThreadByLabel([{ id: 'm1', from: 'Prospect <p@corp.com>' }])
    expect(result.hasReply).toBe(true)
    expect(result.replyMessageId).toBe('m1')
  })
})

describe('looksLikeBounce', () => {
  it('detects a mailer-daemon sender', () => {
    expect(looksLikeBounce({ id: 'm1', from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: null })).toBe(true)
  })

  it('detects a postmaster sender', () => {
    expect(looksLikeBounce({ id: 'm1', from: 'postmaster@corp.com', subject: null })).toBe(true)
  })

  it('detects a delivery-failure subject even with an unrecognized sender', () => {
    expect(looksLikeBounce({ id: 'm1', from: 'System <noreply@corp.com>', subject: 'Undelivered Mail Returned to Sender' })).toBe(true)
    expect(looksLikeBounce({ id: 'm1', from: 'System <noreply@corp.com>', subject: 'Delivery Status Notification (Failure)' })).toBe(true)
  })

  it('does not flag a genuine prospect reply', () => {
    expect(looksLikeBounce({ id: 'm1', from: 'Prospect <p@corp.com>', subject: 'Re: Quick question' })).toBe(false)
  })

  it('does not false-positive on an unrelated sender/subject containing similar words', () => {
    // "Undelivered" alone (no "mail returned to sender") shouldn't match —
    // same discipline as this repo's other short-keyword false-positive
    // fixes (matchesKeyword's 'ir'-inside-'wire').
    expect(looksLikeBounce({ id: 'm1', from: 'Ops <ops@corp.com>', subject: 'Package undelivered, please advise' })).toBe(false)
  })

  it('is null-safe when subject/from are missing', () => {
    expect(looksLikeBounce({ id: 'm1', from: null, subject: null })).toBe(false)
  })
})

describe('getLastMessageIdHeader', () => {
  it('returns the most recent message\'s Message-Id header for follow-up threading', () => {
    const result = getLastMessageIdHeader([
      { id: 'm1', from: 'me@example.com', messageIdHeader: '<m1@mail.gmail.com>' },
      { id: 'm2', from: 'me@example.com', messageIdHeader: '<m2@mail.gmail.com>' },
    ])
    expect(result).toBe('<m2@mail.gmail.com>')
  })

  it('skips backwards past a trailing message with no Message-Id header', () => {
    const result = getLastMessageIdHeader([
      { id: 'm1', from: 'me@example.com', messageIdHeader: '<m1@mail.gmail.com>' },
      { id: 'm2', from: 'me@example.com', messageIdHeader: null },
    ])
    expect(result).toBe('<m1@mail.gmail.com>')
  })

  it('returns undefined for an empty thread or one with no Message-Id headers at all', () => {
    expect(getLastMessageIdHeader([])).toBeUndefined()
    expect(getLastMessageIdHeader([{ id: 'm1', from: 'me@example.com', messageIdHeader: null }])).toBeUndefined()
  })
})

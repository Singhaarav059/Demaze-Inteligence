// ============================================================
// Credential Encryption — tests
// ============================================================
// Verifies the outbound_integrations credential-at-rest scheme: same
// plaintext round-trips correctly, tampering is detected (GCM auth tag),
// and a missing/malformed key fails loudly rather than silently degrading.
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'crypto'
import {
  encryptCredential,
  decryptCredential,
  getKeyOrThrow,
  lastFourOf,
} from '../lib/outbound/settings/credential-crypto'

const ORIGINAL_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY

describe('credential-crypto', () => {
  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  })

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY
    else process.env.CREDENTIALS_ENCRYPTION_KEY = ORIGINAL_KEY
  })

  it('round-trips a plaintext credential', () => {
    const plaintext = 'sk-live-abc123XYZ'
    const encrypted = encryptCredential(plaintext)
    expect(encrypted).not.toContain(plaintext)
    expect(decryptCredential(encrypted)).toBe(plaintext)
  })

  it('produces a different ciphertext each time (random IV) for the same plaintext', () => {
    const plaintext = 'same-secret'
    const a = encryptCredential(plaintext)
    const b = encryptCredential(plaintext)
    expect(a).not.toBe(b)
    expect(decryptCredential(a)).toBe(plaintext)
    expect(decryptCredential(b)).toBe(plaintext)
  })

  it('throws on a tampered ciphertext (GCM auth failure)', () => {
    const encrypted = encryptCredential('sensitive-value')
    const raw = Buffer.from(encrypted, 'base64')
    raw[raw.length - 1] ^= 0xff // flip a bit in the ciphertext tail
    const tampered = raw.toString('base64')
    expect(() => decryptCredential(tampered)).toThrow()
  })

  it('throws when decrypting with the wrong key', () => {
    const encrypted = encryptCredential('sensitive-value')
    process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    expect(() => decryptCredential(encrypted)).toThrow()
  })

  it('getKeyOrThrow throws when the env var is missing', () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY
    expect(() => getKeyOrThrow()).toThrow(/CREDENTIALS_ENCRYPTION_KEY is not set/)
  })

  it('getKeyOrThrow throws when the key is the wrong length', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64')
    expect(() => getKeyOrThrow()).toThrow(/must decode to exactly 32 bytes/)
  })

  it('lastFourOf masks all but the last 4 characters', () => {
    expect(lastFourOf('sk-live-abc123XYZ')).toBe('3XYZ')
    expect(lastFourOf('ab')).toBe('ab')
  })
})

// ============================================================
// Credential Encryption — AES-256-GCM
// ============================================================
// The platform's first credential-at-rest store (outbound_integrations.
// credential_encrypted). GCM's auth tag gives tamper detection for free:
// a corrupted or wrong-key blob throws instead of silently decrypting to
// garbage. Key must be CREDENTIALS_ENCRYPTION_KEY — a raw 32-byte value,
// base64-encoded (generate with: openssl rand -base64 32). We deliberately
// require exactly that rather than hashing an arbitrary passphrase, so a
// misconfigured key fails loudly at first use instead of quietly producing
// a weak key.
// ============================================================

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

export function getKeyOrThrow(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32'
    )
  }

  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `CREDENTIALS_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH} bytes (got ${key.length}). ` +
        'Generate one with: openssl rand -base64 32'
    )
  }

  return key
}

// Returns base64(iv[12] + authTag[16] + ciphertext).
export function encryptCredential(plaintext: string): string {
  const key = getKeyOrThrow()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, authTag, ciphertext]).toString('base64')
}

// Throws if the key is wrong or the blob was tampered with (GCM auth failure).
export function decryptCredential(blob: string): string {
  const key = getKeyOrThrow()
  const raw = Buffer.from(blob, 'base64')

  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Malformed credential blob — too short to contain iv + authTag')
  }

  const iv = raw.subarray(0, IV_LENGTH)
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  return plaintext.toString('utf8')
}

// Display-only — never the real credential.
export function lastFourOf(plaintext: string): string {
  return plaintext.length <= 4 ? plaintext : plaintext.slice(-4)
}

// ============================================================
// Shared mock-provider utilities
// ============================================================
// Every outbound mock provider (email finder, validation, enrichment,
// sending, warmup) needs "same input -> same output" determinism without
// Math.random() — so a demo run is reproducible and tests aren't flaky.
// seededRatio() hashes a string to a stable float in [0, 1); mock providers
// compare it against thresholds to decide outcomes/tiers.
// ============================================================

// FNV-1a — small, fast, good-enough distribution for this purpose (not
// cryptographic, never used for anything security-sensitive).
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// Deterministic float in [0, 1) derived from `seed`.
export function seededRatio(seed: string): number {
  return fnv1aHash(seed) / 0xffffffff
}

// Deterministically picks one item from `options` based on `seed`.
export function seededPick<T>(seed: string, options: readonly T[]): T {
  const index = Math.floor(seededRatio(seed) * options.length) % options.length
  return options[index]
}

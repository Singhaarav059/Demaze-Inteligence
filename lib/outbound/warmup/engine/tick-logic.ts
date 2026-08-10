// ============================================================
// Warmup Engine — pure tick logic
// ============================================================
// No I/O, no Supabase, no Gmail API calls — same split as
// lib/outbound/sending/followup-schedule.ts (pure scheduling math) vs.
// lib/outbound/sending/process-followup.ts (the impure orchestration that
// calls it). lib/outbound/warmup/engine/run-tick.ts is this module's
// process-followup.ts equivalent.
//
// Every randomized function takes an injectable `rng` (defaulting to
// Math.random) so tests can pass a seeded/deterministic function instead —
// same "pure, injectable rng, unit-testable without network" precedent
// this repo already uses.
//
// Every default here is deliberately conservative — see CLAUDE.md's
// warmup-engine session notes: a SMALL pool (the account owner's own
// handful of Gmail accounts, not a commercial vendor's network of
// thousands of independent mailboxes) emailing itself too mechanically or
// too frequently is itself a pattern Gmail's abuse detection could flag,
// which would defeat the entire point. Low daily caps, wide randomized
// delays, and a probabilistic per-tick skip all exist for that reason, not
// for their own sake.
// ============================================================

import { pickWarmupTemplate, pickWarmupReplyTemplate, type WarmupContent } from './templates'

export type { WarmupContent }

// ── Daily send cap ramp ─────────────────────────────────────────
// Stepped, not linear — mirrors the shape of the old mock curve's ramp
// (lib/outbound/warmup/providers/mock.ts) but at a far lower ceiling: the
// mock's fake ~7/day average was calibrated for a commercial-scale
// simulation, not a 2-6 account pool mailing itself.

export function computeDailySendCap(daysActive: number): number {
  if (daysActive < 3) return 1
  if (daysActive < 7) return 2
  if (daysActive < 14) return 3
  if (daysActive < 21) return 4
  if (daysActive < 30) return 5
  return 6
}

// ── Randomized recipient-side processing delay ──────────────────
// Real engagement isn't instant — a human doesn't open an email the
// millisecond it arrives. 2-30h keeps it plausible (same day to next day)
// without a detectable fixed cadence.

const MIN_DELAY_HOURS = 2
const MAX_DELAY_HOURS = 30

export function computeProcessDelayMs(rng: () => number = Math.random): number {
  const hours = MIN_DELAY_HOURS + rng() * (MAX_DELAY_HOURS - MIN_DELAY_HOURS)
  return hours * 60 * 60 * 1000
}

// ── Reply probability ────────────────────────────────────────────
// Real threads aren't always replied to — a 100% reply rate would itself
// be an unnatural, detectable pattern.

const REPLY_PROBABILITY = 0.35

export function rollShouldReply(rng: () => number = Math.random): boolean {
  return rng() < REPLY_PROBABILITY
}

// ── Per-tick probabilistic skip ──────────────────────────────────
// Breaks up the otherwise-perfectly-regular tick-interval shape (every N
// minutes, exactly) that an interval-driven scheduler would otherwise
// produce — real human sending activity isn't metronomic.

const SKIP_PROBABILITY = 0.2

export function shouldSkipThisTick(rng: () => number = Math.random): boolean {
  return rng() < SKIP_PROBABILITY
}

// ── Recipient selection ──────────────────────────────────────────
// Excludes self always. Prefers a mailbox NOT already mailed today (when
// the pool is big enough to have a choice) so a small pool doesn't fall
// into an obviously-repeating A-mails-B-mails-A pattern — but falls back to
// the full candidate pool rather than sending nothing when everyone's
// already been mailed today (a 2-mailbox pool has no other choice at all).

export function pickRecipient(
  candidateIds: string[],
  selfId: string,
  recentRecipientIds: string[],
  rng: () => number = Math.random
): string | null {
  const pool = candidateIds.filter(id => id !== selfId)
  if (pool.length === 0) return null

  const preferred = pool.filter(id => !recentRecipientIds.includes(id))
  const choices = preferred.length > 0 ? preferred : pool
  return choices[Math.floor(rng() * choices.length)]
}

// ── Content generation (delegates to templates.ts) ───────────────

export function generateWarmupContent(rng: () => number = Math.random): WarmupContent {
  return pickWarmupTemplate(rng)
}

export function generateWarmupReplyContent(rng: () => number = Math.random): WarmupContent {
  return pickWarmupReplyTemplate(rng)
}

// ── Ref token ──────────────────────────────────────────────────
// Embedded as a plain line in every sent warmup email's body so the
// RECIPIENT-side search (lib/outbound/shared/gmail-client.ts's
// searchGmailMessages) can find that exact message in ITS OWN mailbox —
// necessary because a Gmail API message `id` is scoped to one mailbox's
// view; the sender's id for a message is not the same id the recipient's
// mailbox assigns to its own copy. A short alphanumeric code (not a full
// UUID) reads more like an ordinary business reference number
// ("Ref: 8F3K2Q1A") than an obviously-generated tracking id, while still
// being derived from the exchange row's real UUID primary key (first 8
// hex chars, uppercased) so it stays unique enough in practice for exact-
// phrase search without needing its own separate uniqueness guarantee.

export function buildRefToken(exchangeId: string): string {
  return `Ref: ${exchangeId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

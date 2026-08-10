// ============================================================
// Warmup Engine — tick orchestration
// ============================================================
// Impure: DB + Gmail API calls. This is the warmup engine's equivalent of
// lib/outbound/sending/process-followup.ts (which pairs with the pure
// followup-schedule.ts the same way this pairs with tick-logic.ts).
//
// Two phases per tick, deliberately process-before-send (a tick's own new
// sends shouldn't be swept into the same tick's due-exchange processing —
// they're not due yet anyway given the minimum 2h delay, but ordering it
// this way keeps the two phases' mailbox-state reads from interleaving):
//   A. Recipient side — search for due exchanges' ref tokens in the
//      recipient's own mailbox, rescue from spam, mark read, probabilistically reply.
//   B. Sender side — send new warmup emails, respecting each mailbox's
//      daily cap.
// Then: write one real metrics snapshot per connected mailbox into the
// EXISTING outbound_warmup_metrics table, so the dashboard's chart code
// needs no changes at all — it just starts reading real numbers instead of
// the mock provider's fake curve.
//
// Called by: app/api/admin/outbound/warmup/engine/tick/route.ts (manual,
// on-demand) and instrumentation.ts's setInterval (autonomous, gated
// behind WARMUP_ENGINE_ENABLED — see that file's own comment).
// ============================================================

import { randomUUID } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import {
  decodeGmailCredential,
  refreshAccessToken,
  sendGmailMessage,
  searchGmailMessages,
  getGmailMessageLabels,
  modifyGmailMessageLabels,
  getGmailThread,
  getLastMessageIdHeader,
} from '@/lib/outbound/shared/gmail-client'
import {
  computeDailySendCap,
  computeProcessDelayMs,
  rollShouldReply,
  pickRecipient,
  shouldSkipThisTick,
  generateWarmupContent,
  generateWarmupReplyContent,
  buildRefToken,
} from './tick-logic'

export interface WarmupTickSummary {
  mailboxesChecked: number
  exchangesProcessed: number
  rescuedFromSpam: number
  repliesSent: number
  newExchangesSent: number
  errors: string[]
}

interface MailboxRow {
  id: string
  mailbox_address: string
  credential_encrypted: string | null
  status: string
  started_at: string | null
}

interface ExchangeRow {
  id: string
  from_mailbox_id: string
  to_mailbox_id: string
  gmail_thread_id: string
  subject: string
  sent_at: string
}

const FAILED_LOOKUP_TIMEOUT_MS = 48 * 60 * 60 * 1000
const METRICS_WINDOW = 30
const DUE_EXCHANGE_BATCH_SIZE = 25

function newSummary(): WarmupTickSummary {
  return { mailboxesChecked: 0, exchangesProcessed: 0, rescuedFromSpam: 0, repliesSent: 0, newExchangesSent: 0, errors: [] }
}

export async function runWarmupEngineTick(
  supabase: ReturnType<typeof createServerClient>
): Promise<WarmupTickSummary> {
  const summary = newSummary()

  const { data: mailboxes, error: mailboxError } = await supabase
    .from('outbound_warmup_mailboxes')
    .select('id, mailbox_address, credential_encrypted, status, started_at')
    .not('credential_encrypted', 'is', null)
    .neq('status', 'paused')

  if (mailboxError) {
    summary.errors.push(`Failed to load mailboxes: ${mailboxError.message}`)
    return summary
  }

  const activeMailboxes = (mailboxes ?? []) as MailboxRow[]
  summary.mailboxesChecked = activeMailboxes.length
  if (activeMailboxes.length === 0) return summary

  const mailboxById = new Map(activeMailboxes.map(m => [m.id, m]))

  await processDueExchanges(supabase, activeMailboxes, mailboxById, summary)
  await sendNewExchanges(supabase, activeMailboxes, summary)
  await writeMetricsSnapshots(supabase, activeMailboxes, summary)

  return summary
}

// ── Phase A: recipient-side processing ────────────────────────────

async function processDueExchanges(
  supabase: ReturnType<typeof createServerClient>,
  mailboxes: MailboxRow[],
  mailboxById: Map<string, MailboxRow>,
  summary: WarmupTickSummary
) {
  const { data: due, error } = await supabase
    .from('outbound_warmup_exchanges')
    .select('id, from_mailbox_id, to_mailbox_id, gmail_thread_id, subject, sent_at')
    .eq('status', 'sent')
    .lte('process_after', new Date().toISOString())
    .order('process_after', { ascending: true })
    .limit(DUE_EXCHANGE_BATCH_SIZE)

  if (error) {
    summary.errors.push(`Failed to load due exchanges: ${error.message}`)
    return
  }
  const dueExchanges = (due ?? []) as ExchangeRow[]
  if (dueExchanges.length === 0) return

  const byRecipient = new Map<string, ExchangeRow[]>()
  for (const ex of dueExchanges) {
    const arr = byRecipient.get(ex.to_mailbox_id) ?? []
    arr.push(ex)
    byRecipient.set(ex.to_mailbox_id, arr)
  }

  for (const [toMailboxId, exchanges] of byRecipient) {
    // Recipient may have been paused/disconnected since the send — not in
    // the active pool means not credentialed right now, so leave these
    // rows as 'sent' for a future tick rather than failing them outright.
    const recipientMailbox = mailboxes.find(m => m.id === toMailboxId)
    if (!recipientMailbox?.credential_encrypted) continue

    const cred = decodeGmailCredential(recipientMailbox.credential_encrypted)
    if (!cred) {
      summary.errors.push(`Could not decode credential for ${recipientMailbox.mailbox_address}`)
      continue
    }

    const refreshed = await refreshAccessToken({ clientId: cred.clientId, clientSecret: cred.clientSecret, refreshToken: cred.refreshToken })
    if (!refreshed.ok) {
      summary.errors.push(`Token refresh failed for ${recipientMailbox.mailbox_address}: ${refreshed.error}`)
      continue
    }

    for (const exchange of exchanges) {
      await processOneExchange(supabase, exchange, mailboxById, refreshed.accessToken, summary)
    }
  }
}

async function processOneExchange(
  supabase: ReturnType<typeof createServerClient>,
  exchange: ExchangeRow,
  mailboxById: Map<string, MailboxRow>,
  recipientAccessToken: string,
  summary: WarmupTickSummary
) {
  const refToken = buildRefToken(exchange.id)
  const search = await searchGmailMessages(`"${refToken}"`, recipientAccessToken)
  if (!search.ok) {
    summary.errors.push(`Search failed for exchange ${exchange.id}: ${search.error}`)
    return
  }

  if (search.ids.length === 0) {
    const ageMs = Date.now() - new Date(exchange.sent_at).getTime()
    if (ageMs > FAILED_LOOKUP_TIMEOUT_MS) {
      await supabase
        .from('outbound_warmup_exchanges')
        .update({ status: 'failed', processed_at: new Date().toISOString(), error: 'Not found in recipient inbox after 48h' })
        .eq('id', exchange.id)
    }
    // else: leave as 'sent' — Gmail's search index can lag a fresh message
    // by a few minutes; retried automatically on a later tick.
    return
  }

  const messageId = search.ids[0]
  const labelsResult = await getGmailMessageLabels(messageId, recipientAccessToken)
  if (!labelsResult.ok) {
    summary.errors.push(`Label fetch failed for exchange ${exchange.id}: ${labelsResult.error}`)
    return
  }

  const landedInSpam = labelsResult.labelIds.includes('SPAM')
  let rescued = false

  if (landedInSpam) {
    const modifyResult = await modifyGmailMessageLabels(messageId, { removeLabelIds: ['SPAM'], addLabelIds: ['INBOX'] }, recipientAccessToken)
    if (modifyResult.ok) {
      rescued = true
      summary.rescuedFromSpam++
    } else {
      summary.errors.push(`Spam rescue failed for exchange ${exchange.id}: ${modifyResult.error}`)
    }
  }

  // Mark read regardless of spam status — this is the "open" signal.
  await modifyGmailMessageLabels(messageId, { removeLabelIds: ['UNREAD'] }, recipientAccessToken)

  let replied = false
  let replyMessageId: string | undefined
  const fromMailbox = mailboxById.get(exchange.from_mailbox_id)

  if (fromMailbox && rollShouldReply()) {
    const thread = await getGmailThread(exchange.gmail_thread_id, recipientAccessToken)
    if (thread.ok) {
      const lastMessageId = getLastMessageIdHeader(thread.messages)
      const replyContent = generateWarmupReplyContent()
      const sendResult = await sendGmailMessage({
        accessToken: recipientAccessToken,
        to: fromMailbox.mailbox_address,
        subject: /^re:/i.test(exchange.subject) ? exchange.subject : `Re: ${exchange.subject}`,
        bodyText: replyContent.body,
        threadId: exchange.gmail_thread_id,
        inReplyTo: lastMessageId,
        references: lastMessageId,
      })
      if (sendResult.ok) {
        replied = true
        replyMessageId = sendResult.messageId
        summary.repliesSent++
      } else {
        summary.errors.push(`Reply send failed for exchange ${exchange.id}: ${sendResult.error}`)
      }
    }
  }

  await supabase
    .from('outbound_warmup_exchanges')
    .update({
      status: 'processed',
      processed_at: new Date().toISOString(),
      landed_in_spam: landedInSpam,
      rescued_from_spam: rescued,
      replied,
      reply_gmail_message_id: replyMessageId ?? null,
    })
    .eq('id', exchange.id)

  summary.exchangesProcessed++
}

// ── Phase B: sender-side new sends ──────────────────────────────

async function sendNewExchanges(
  supabase: ReturnType<typeof createServerClient>,
  mailboxes: MailboxRow[],
  summary: WarmupTickSummary
) {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { data: todaysExchanges, error } = await supabase
    .from('outbound_warmup_exchanges')
    .select('from_mailbox_id, to_mailbox_id')
    .gte('sent_at', todayStart.toISOString())

  if (error) {
    summary.errors.push(`Failed to load today's exchanges: ${error.message}`)
    return
  }

  const sentTodayCountBySender = new Map<string, number>()
  const recentRecipientsBySender = new Map<string, string[]>()
  for (const row of (todaysExchanges ?? []) as Array<{ from_mailbox_id: string; to_mailbox_id: string }>) {
    sentTodayCountBySender.set(row.from_mailbox_id, (sentTodayCountBySender.get(row.from_mailbox_id) ?? 0) + 1)
    const arr = recentRecipientsBySender.get(row.from_mailbox_id) ?? []
    arr.push(row.to_mailbox_id)
    recentRecipientsBySender.set(row.from_mailbox_id, arr)
  }

  const allIds = mailboxes.map(m => m.id)

  for (const mailbox of mailboxes) {
    if (shouldSkipThisTick()) continue
    if (!mailbox.credential_encrypted) continue

    const daysActive = mailbox.started_at
      ? (Date.now() - new Date(mailbox.started_at).getTime()) / (1000 * 60 * 60 * 24)
      : 0
    const cap = computeDailySendCap(daysActive)
    const sentToday = sentTodayCountBySender.get(mailbox.id) ?? 0
    if (sentToday >= cap) continue

    const recipientId = pickRecipient(allIds, mailbox.id, recentRecipientsBySender.get(mailbox.id) ?? [])
    if (!recipientId) continue // pool has fewer than 2 connected mailboxes right now

    const recipientMailbox = mailboxes.find(m => m.id === recipientId)
    if (!recipientMailbox) continue

    const cred = decodeGmailCredential(mailbox.credential_encrypted)
    if (!cred) {
      summary.errors.push(`Could not decode credential for ${mailbox.mailbox_address}`)
      continue
    }

    const refreshed = await refreshAccessToken({ clientId: cred.clientId, clientSecret: cred.clientSecret, refreshToken: cred.refreshToken })
    if (!refreshed.ok) {
      summary.errors.push(`Token refresh failed for ${mailbox.mailbox_address}: ${refreshed.error}`)
      continue
    }

    const exchangeId = randomUUID()
    const content = generateWarmupContent()
    const bodyWithRef = `${content.body}\n\n${buildRefToken(exchangeId)}`

    const sendResult = await sendGmailMessage({
      accessToken: refreshed.accessToken,
      to: recipientMailbox.mailbox_address,
      subject: content.subject,
      bodyText: bodyWithRef,
    })

    if (!sendResult.ok) {
      summary.errors.push(`Send failed from ${mailbox.mailbox_address}: ${sendResult.error}`)
      continue
    }

    const sentAt = new Date()
    const processAfter = new Date(sentAt.getTime() + computeProcessDelayMs())

    const { error: insertError } = await supabase.from('outbound_warmup_exchanges').insert({
      id: exchangeId,
      from_mailbox_id: mailbox.id,
      to_mailbox_id: recipientMailbox.id,
      gmail_message_id: sendResult.messageId,
      gmail_thread_id: sendResult.threadId,
      subject: content.subject,
      sent_at: sentAt.toISOString(),
      process_after: processAfter.toISOString(),
      status: 'sent',
    })

    if (insertError) {
      summary.errors.push(`Failed to record exchange: ${insertError.message}`)
      continue
    }

    // Keep this tick's own in-memory counters current so later mailboxes in
    // the same loop see accurate today/recent state.
    sentTodayCountBySender.set(mailbox.id, sentToday + 1)
    const arr = recentRecipientsBySender.get(mailbox.id) ?? []
    arr.push(recipientMailbox.id)
    recentRecipientsBySender.set(mailbox.id, arr)

    summary.newExchangesSent++
  }
}

// ── Metrics snapshot ────────────────────────────────────────────

async function writeMetricsSnapshots(
  supabase: ReturnType<typeof createServerClient>,
  mailboxes: MailboxRow[],
  summary: WarmupTickSummary
) {
  for (const mailbox of mailboxes) {
    const { data: recent, error } = await supabase
      .from('outbound_warmup_exchanges')
      .select('landed_in_spam, replied')
      .eq('from_mailbox_id', mailbox.id)
      .eq('status', 'processed')
      .order('sent_at', { ascending: false })
      .limit(METRICS_WINDOW)

    if (error) {
      summary.errors.push(`Metrics query failed for ${mailbox.mailbox_address}: ${error.message}`)
      continue
    }

    const processed = (recent ?? []) as Array<{ landed_in_spam: boolean | null; replied: boolean }>
    // Nothing real to report yet — leave the existing dashboard state
    // (empty/mock) rather than writing a meaningless all-zero snapshot.
    if (processed.length === 0) continue

    const { count: emailsSentTotal } = await supabase
      .from('outbound_warmup_exchanges')
      .select('id', { count: 'exact', head: true })
      .eq('from_mailbox_id', mailbox.id)

    const spamCount = processed.filter(r => r.landed_in_spam === true).length
    const replyCount = processed.filter(r => r.replied === true).length
    const spamRate = spamCount / processed.length
    const inboxRate = 1 - spamRate
    const replyRate = replyCount / processed.length
    const domainHealthScore = Math.max(0, Math.min(100, Math.round(50 + inboxRate * 40 + replyRate * 10)))

    const { error: insertError } = await supabase.from('outbound_warmup_metrics').insert({
      mailbox_id: mailbox.id,
      emails_sent_total: emailsSentTotal ?? processed.length,
      inbox_rate: Math.round(inboxRate * 100) / 100,
      spam_rate: Math.round(spamRate * 100) / 100,
      domain_health_score: domainHealthScore,
    })

    if (insertError) {
      summary.errors.push(`Failed to write metrics for ${mailbox.mailbox_address}: ${insertError.message}`)
    }
  }
}

// Convenience wrapper for callers that just want to run + log, matching
// the shape instrumentation.ts's scheduler and the manual tick route both want.
export async function runAndLogWarmupEngineTick(): Promise<WarmupTickSummary> {
  const supabase = createServerClient()
  try {
    const summary = await runWarmupEngineTick(supabase)
    logger.info('warmup-engine', 'Tick complete', summary)
    return summary
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('warmup-engine', 'Tick failed', message)
    return { ...newSummary(), errors: [message] }
  }
}

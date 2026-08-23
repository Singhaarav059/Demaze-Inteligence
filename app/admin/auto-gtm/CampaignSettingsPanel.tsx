'use client'

// ============================================================
// CampaignSettingsPanel — Auto Flow step 4's "Campaign Settings"
// ============================================================
// UX redesign (2026-08-17) over the same persisted fields as before
// (migration 020: name, daily_send_limit, send_window_start/end, timezone,
// interval_1/2/3_days) and the same GET/PATCH /campaigns/[id] route — no
// backend, schema, or send-behavior change. Just a friendlier presentation:
// - "Sending strategy" (Conservative/Balanced/Faster) is three preset
//   values for the SAME daily_send_limit field the raw number input still
//   edits under Advanced — no new column, no new concept.
// - The follow-up timeline is a rendering of the same interval_1/2/3_days
//   (or the global default when unset) as a plain-English sequence.
// - "Always-on protections" restates the same fixed, non-configurable stop
//   conditions the send route already enforces (reply / bounce /
//   suppression / removal) — see send/route.ts's own header comment.
// - Campaign Summary is a plain-English readout of current form state,
//   computed client-side, not a new stored field.
//
// "Sending account" reads the real connected Gmail address from
// outbound_integrations.config.email the same way
// /admin/outbound/integrations/page.tsx already derives it — not a new
// lookup.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, ArrowDown, Lock, CheckCircle2, Rocket, Zap, Clock3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { GuideNote } from '@/components/ui/guide-note'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { OutboundIntegrationRow } from '@/lib/outbound/settings/types'

const HOUR_OPTIONS = [
  { value: '__none__', label: 'No restriction' },
  ...Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` })),
]

// A short, common-case list rather than every IANA zone — keeps the select
// scannable. 'UTC' first since it's the safe/neutral default this app uses
// everywhere else it stores a timezone-agnostic timestamp.
const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris',
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai',
  'Australia/Sydney',
]

// Preset values for the existing daily_send_limit field — not a new
// backend concept, just three sensible numbers for the field the raw
// "Maximum emails per day" input under Advanced already edits. A lower
// daily cap genuinely does spread sends over more days (skipped-for-today
// sends stay queued for the next send), so "more spacing" is an accurate
// description, not invented behavior.
const STRATEGIES = [
  { key: 'conservative', label: 'Conservative', limit: 20, description: 'Slower sending with more spacing between emails.', recommended: false },
  { key: 'balanced', label: 'Balanced', limit: 40, description: 'Gradual sending designed for most campaigns.', recommended: true },
  { key: 'faster', label: 'Faster', limit: 80, description: 'Higher sending volume with less spacing.', recommended: false },
] as const

type StrategyKey = typeof STRATEGIES[number]['key']

function matchStrategy(dailyLimit: string): StrategyKey | null {
  if (dailyLimit.trim() === '') return null
  const n = Number(dailyLimit)
  return STRATEGIES.find(s => s.limit === n)?.key ?? null
}

interface SettingsState {
  name: string
  dailyLimit: string // number-as-string; '' = unlimited
  windowStart: string // '__none__' or '0'-'23'
  windowEnd: string
  timezone: string
  interval1: string
  interval2: string
  interval3: string
}

function toWindowValue(hour: number | null | undefined): string {
  return hour == null ? '__none__' : String(hour)
}

function fromWindowValue(value: string): number | null {
  return value === '__none__' ? null : Number(value)
}

function hourLabel(value: string): string {
  return value === '__none__' ? '' : `${value.padStart(2, '0')}:00`
}

export function CampaignSettingsPanel({
  campaignId,
  ensureCampaignId,
  resuming,
  defaultCampaignName,
}: {
  campaignId: string | null
  ensureCampaignId: () => Promise<string | null>
  // True while a resumed run's existing campaign (if any) is still being
  // restored — see useAutoGtmFlow.ts's `resuming` state. Found live
  // (2026-08-12): calling ensureCampaignId() before this settles created
  // real duplicate, orphaned campaigns (two rows named " - Auto Flow" with
  // no source_run_id) because campaignId was still null in local state even
  // though the run already had a real campaign server-side. This component
  // now waits for resuming to go false before ever creating one.
  resuming: boolean
  defaultCampaignName: string
}) {
  const [resolvedId, setResolvedId] = useState<string | null>(campaignId)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [globalIntervals, setGlobalIntervals] = useState<[number, number, number]>([3, 4, 7])
  const [sendingAccount, setSendingAccount] = useState<{ provider: string; isReal: boolean; email: string | null } | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/outbound/followup-settings')
        const data = await res.json()
        if (data.success && Array.isArray(data.intervals)) setGlobalIntervals(data.intervals)
      } catch {
        // Keep the [3,4,7] default — same fail-open discipline as the
        // server-side getFollowupIntervals() this mirrors.
      }
      try {
        const res = await fetch('/api/admin/outbound/integrations')
        const data = await res.json()
        if (!data.success) return
        const row = (data.integrations as OutboundIntegrationRow[]).find(r => r.capability === 'sending' && r.is_active)
        const isReal = Boolean(row && row.provider_name !== 'mock')
        const email = row?.provider_name === 'gmail' ? (row.config as { email?: string } | undefined)?.email ?? null : null
        setSendingAccount({ provider: row?.provider_name ?? 'mock', isReal, email })
      } catch {
        setSendingAccount({ provider: 'mock', isReal: false, email: null })
      }
    })()
  }, [])

  useEffect(() => {
    // While a resumed run is still being restored, campaignId being null
    // here does NOT mean no campaign exists yet — it means
    // restoreContactsAndCampaign hasn't finished checking. Do nothing this
    // pass; the effect re-runs once `resuming` flips false (see the prop's
    // own header comment for the duplicate-campaign bug this closes).
    if (resuming) return

    void (async () => {
      setLoading(true)
      try {
        const id = campaignId ?? (await ensureCampaignId())
        if (!id) return
        setResolvedId(id)
        const res = await fetch(`/api/admin/outbound/campaigns/${id}`)
        const data = await res.json()
        if (!data.success) {
          toast.error(data.error ?? 'Could not load campaign settings')
          return
        }
        const c = data.campaign
        setSettings({
          name: c.name ?? defaultCampaignName,
          dailyLimit: c.daily_send_limit != null ? String(c.daily_send_limit) : '',
          windowStart: toWindowValue(c.send_window_start),
          windowEnd: toWindowValue(c.send_window_end),
          timezone: c.timezone || 'UTC',
          interval1: c.interval_1_days != null ? String(c.interval_1_days) : '',
          interval2: c.interval_2_days != null ? String(c.interval_2_days) : '',
          interval3: c.interval_3_days != null ? String(c.interval_3_days) : '',
        })
      } catch {
        toast.error('Could not reach the campaigns API')
      } finally {
        setLoading(false)
      }
    })()
    // Deliberately depends on `resuming` (not an empty array) so it can
    // re-run once resuming flips false — everything else (campaignId,
    // ensureCampaignId, defaultCampaignName) is read fresh from the
    // enclosing closure each time this fires, which is what we want: a
    // single real attempt, gated on resume state being settled, not a
    // continuous re-fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming])

  const activeStrategy = settings ? matchStrategy(settings.dailyLimit) : null
  const allIntervalsSet = Boolean(settings?.interval1 && settings?.interval2 && settings?.interval3)
  const effectiveIntervals: [number, number, number] = useMemo(() => {
    if (settings && allIntervalsSet) {
      return [Number(settings.interval1), Number(settings.interval2), Number(settings.interval3)]
    }
    return globalIntervals
  }, [settings, allIntervalsSet, globalIntervals])

  const sendingLabel = sendingAccount
    ? sendingAccount.email ?? (sendingAccount.isReal ? sendingAccount.provider : 'your demo (mock) account — no real email will send')
    : 'your connected account'

  const windowText = settings && settings.windowStart !== '__none__' && settings.windowEnd !== '__none__'
    ? `between ${hourLabel(settings.windowStart)}–${hourLabel(settings.windowEnd)} (${settings.timezone} time)`
    : 'at any time of day'

  const dailyLimitText = settings && settings.dailyLimit.trim() !== ''
    ? `up to ${settings.dailyLimit} emails per day`
    : 'with no daily limit'

  async function handleSave() {
    if (!resolvedId || !settings) return

    const dailyLimit = settings.dailyLimit.trim() === '' ? null : Number(settings.dailyLimit)
    if (dailyLimit !== null && (!Number.isInteger(dailyLimit) || dailyLimit <= 0)) {
      toast.error('Maximum emails per day must be a positive whole number, or blank for unlimited.')
      return
    }

    const anyIntervalSet = settings.interval1 || settings.interval2 || settings.interval3
    if (anyIntervalSet && !allIntervalsSet) {
      toast.error('Set all three follow-up steps, or clear all three to use the default schedule.')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/admin/outbound/campaigns/${resolvedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: settings.name.trim() || defaultCampaignName,
          daily_send_limit: dailyLimit,
          send_window_start: fromWindowValue(settings.windowStart),
          send_window_end: fromWindowValue(settings.windowEnd),
          timezone: settings.timezone,
          interval_1_days: allIntervalsSet ? Number(settings.interval1) : null,
          interval_2_days: allIntervalsSet ? Number(settings.interval2) : null,
          interval_3_days: allIntervalsSet ? Number(settings.interval3) : null,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to save campaign settings')
        return
      }
      toast.success('Campaign settings saved')
    } catch {
      toast.error('Could not reach the campaigns API')
    } finally {
      setSaving(false)
    }
  }

  return (
    <CollapsibleRow
      summary={
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Campaign Settings</h3>
            <p className="text-xs text-muted-foreground/70 mt-0.5">Who sends, how fast, and what happens if nobody replies</p>
          </div>
          {settings?.dailyLimit && <Badge variant="outline" className="shrink-0 text-[10px]">{settings.dailyLimit}/day</Badge>}
        </div>
      }
    >
      {loading || !settings ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Spinner className="size-3.5" /> Loading settings…
        </div>
      ) : (
        <div className="space-y-6">
          {/* A. CAMPAIGN */}
          <div className="space-y-4">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground uppercase tracking-wide">
              <Rocket className="size-3.5 text-muted-foreground/70" /> Campaign
            </h4>
            <div className="space-y-1">
              <Label htmlFor="campaign-name">Campaign name</Label>
              <Input
                id="campaign-name"
                value={settings.name}
                onChange={e => setSettings(s => (s ? { ...s, name: e.target.value } : s))}
              />
              <p className="text-xs text-muted-foreground/60">Used to identify this campaign in your workspace.</p>
            </div>

            <div className="space-y-1">
              <Label>Send from</Label>
              <p className="text-xs text-foreground">
                {sendingAccount
                  ? sendingAccount.email
                    ? <><CheckCircle2 className="inline size-3.5 mr-1 text-signal-strong align-[-2px]" />{sendingAccount.email}</>
                    : sendingAccount.isReal
                      ? <>Connected — <span className="font-medium">{sendingAccount.provider}</span></>
                      : 'Demo mode (no real sending account connected yet)'
                  : 'Checking…'}
                {' '}
                <a href="/admin/outbound/integrations" className="underline underline-offset-2 hover:text-foreground text-muted-foreground/70">
                  change in Integrations
                </a>
              </p>
              <p className="text-xs text-muted-foreground/60">Emails will be sent from this account.</p>
            </div>
          </div>

          {/* B. SENDING */}
          <div className="space-y-3 pt-2 border-t border-border">
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground uppercase tracking-wide">
                <Zap className="size-3.5 text-muted-foreground/70" /> Sending
              </h4>
              <p className="text-xs text-muted-foreground/70 mt-1">How should Demaze send?</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Sending strategy">
              {STRATEGIES.map(strategy => {
                const selected = activeStrategy === strategy.key
                return (
                  <button
                    key={strategy.key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setSettings(s => (s ? { ...s, dailyLimit: String(strategy.limit) } : s))}
                    className={cn(
                      'rounded-lg border px-3 py-2.5 text-left transition-colors',
                      selected
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-background/50 hover:bg-accent/40'
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-foreground">{strategy.label}</span>
                      {strategy.recommended && <Badge variant="outline" className="text-[9px] px-1 py-0">Recommended</Badge>}
                      {selected && <Check className="size-3.5 text-primary ml-auto" />}
                    </span>
                    <span className="block text-[11px] text-muted-foreground/70 mt-0.5">{strategy.description}</span>
                  </button>
                )
              })}
            </div>
            {activeStrategy === null && (
              <p className="text-xs text-muted-foreground/60">
                {settings.dailyLimit.trim() === ''
                  ? 'No sending speed chosen yet — sending is currently unlimited. Pick a speed above, or set a custom limit under Advanced settings.'
                  : `Using a custom limit (${settings.dailyLimit}/day) — set under Advanced settings.`}
              </p>
            )}

            <CollapsibleRow
              className="bg-background/50"
              summary={<span className="text-xs font-medium text-foreground">Advanced sending settings</span>}
            >
              <div className="space-y-1">
                <Label htmlFor="daily-limit">Maximum emails per day</Label>
                <Input
                  id="daily-limit"
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  value={settings.dailyLimit}
                  onChange={e => setSettings(s => (s ? { ...s, dailyLimit: e.target.value } : s))}
                />
                <p className="text-xs text-muted-foreground/60">Limits how many emails this campaign can send in a day.</p>
              </div>

              <div className="space-y-1">
                <Label>When should emails be sent?</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="window-start" className="text-[11px] text-muted-foreground/70">Start</Label>
                    <Select
                      items={HOUR_OPTIONS}
                      value={settings.windowStart}
                      onValueChange={v => setSettings(s => (s ? { ...s, windowStart: v as string } : s))}
                    >
                      <SelectTrigger id="window-start" aria-label="Sending window start hour"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {HOUR_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="window-end" className="text-[11px] text-muted-foreground/70">End</Label>
                    <Select
                      items={HOUR_OPTIONS}
                      value={settings.windowEnd}
                      onValueChange={v => setSettings(s => (s ? { ...s, windowEnd: v as string } : s))}
                    >
                      <SelectTrigger id="window-end" aria-label="Sending window end hour"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {HOUR_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="window-tz" className="text-[11px] text-muted-foreground/70">Time zone</Label>
                    <Select
                      items={COMMON_TIMEZONES.map(tz => ({ value: tz, label: tz }))}
                      value={settings.timezone}
                      onValueChange={v => setSettings(s => (s ? { ...s, timezone: v as string } : s))}
                    >
                      <SelectTrigger id="window-tz" aria-label="Sending window timezone"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COMMON_TIMEZONES.map(tz => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground/60">
                  Emails outside this window are held, not sent late — they go out the next time sending runs
                  during this window, in the time zone above.
                </p>
              </div>
            </CollapsibleRow>
          </div>

          {/* C. FOLLOW-UPS */}
          <div className="space-y-3 pt-2 border-t border-border">
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground uppercase tracking-wide">
                <Clock3 className="size-3.5 text-muted-foreground/70" /> Follow-ups
              </h4>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Demaze will follow up when a contact hasn&apos;t replied.{' '}
                <Badge variant="outline" className="text-[9px] align-middle">
                  {allIntervalsSet ? 'Custom schedule' : `Default (${globalIntervals.join(' / ')} days)`}
                </Badge>
              </p>
            </div>

            <div className="rounded-lg border border-border bg-background/50 px-3 py-3 space-y-1.5">
              <TimelineStep label="Initial email" />
              <TimelineWait days={effectiveIntervals[0]} />
              <TimelineStep label="Follow-up #1" />
              <TimelineWait days={effectiveIntervals[1]} />
              <TimelineStep label="Follow-up #2" />
              <TimelineWait days={effectiveIntervals[2]} />
              <TimelineStep label="Final follow-up (#3)" />
            </div>
            <p className="text-xs text-muted-foreground/60">&quot;Wait&quot; is days after the previous email.</p>

            <CollapsibleRow
              className="bg-background/50"
              summary={<span className="text-xs font-medium text-foreground">Edit follow-up sequence</span>}
            >
              <p className="text-xs text-muted-foreground/60">
                Leave all three blank to use the default schedule ({globalIntervals.join(' / ')} days).
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(['interval1', 'interval2', 'interval3'] as const).map((key, i) => (
                  <div key={key} className="space-y-1">
                    <Label htmlFor={key} className="text-[11px] text-muted-foreground/70">Follow-up #{i + 1} (days after previous)</Label>
                    <Input
                      id={key}
                      type="number"
                      min={1}
                      max={365}
                      placeholder={String(globalIntervals[i])}
                      value={settings[key]}
                      onChange={e => setSettings(s => (s ? { ...s, [key]: e.target.value } : s))}
                    />
                  </div>
                ))}
              </div>
            </CollapsibleRow>
          </div>

          {/* D. ALWAYS-ON PROTECTIONS */}
          <div className="space-y-2 pt-2 border-t border-border">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground uppercase tracking-wide">
              <Lock className="size-3" /> Always-on protections
            </h4>
            <p className="text-xs text-muted-foreground/70">
              Demaze automatically stops sending to a contact when any of these happen. These can&apos;t be turned off.
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
              {['Contact replies', 'Email bounces', 'Contact is suppressed', 'Contact is removed from the campaign'].map(item => (
                <li key={item} className="flex items-center gap-1.5 text-xs text-foreground">
                  <CheckCircle2 className="size-3.5 text-signal-strong shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* E. CAMPAIGN SUMMARY */}
          <GuideNote>
            <p className="font-medium text-foreground">What will happen after you save</p>
            <p>Demaze will send approved emails from {sendingLabel}.</p>
            <p>The campaign will send {dailyLimitText}, {windowText}.</p>
            <p>
              If a contact doesn&apos;t reply, Demaze will follow up after {effectiveIntervals[0]} day
              {effectiveIntervals[0] === 1 ? '' : 's'}, then {effectiveIntervals[1]}, then {effectiveIntervals[2]}.
            </p>
            <p>Sending automatically stops when a contact replies, bounces, is suppressed, or is removed from the campaign.</p>
          </GuideNote>

          <Button size="sm" disabled={saving} onClick={handleSave}>
            {saving ? <Spinner className="size-3.5" /> : null}
            Save Settings
          </Button>
        </div>
      )}
    </CollapsibleRow>
  )
}

function TimelineStep({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-1.5 rounded-full bg-primary shrink-0" />
      <span className="text-xs font-medium text-foreground">{label}</span>
    </div>
  )
}

function TimelineWait({ days }: { days: number }) {
  return (
    <div className="flex items-center gap-2 pl-[3px]">
      <ArrowDown className="size-3 text-muted-foreground/50 shrink-0" />
      <span className="text-[11px] text-muted-foreground/70">Wait {days} day{days === 1 ? '' : 's'}</span>
    </div>
  )
}

'use client'

// ============================================================
// CampaignSettingsPanel — Auto Flow step 4's "Campaign & Outreach" settings
// ============================================================
// Progressive disclosure (CollapsibleRow, closed by default — same pattern
// the Follow-ups page already uses for its cadence editor) over the real,
// persisted campaign settings from migration 020: name, daily send limit,
// send window + timezone, and a per-campaign follow-up cadence override.
// "Sending account" is a read-only status display, not a picker — only one
// sending provider is ever active app-wide today (see this file's own
// header note in OutreachStep.tsx), so pretending otherwise would be fake
// configurability.
//
// Needs a real campaignId to read/write settings against, but "campaign" is
// still an internal concept the user never sees named as such (matches the
// rest of Auto Flow) — this panel calls the passed-in ensureCampaignId() on
// mount if one doesn't exist yet, moving campaign creation earlier (used to
// happen lazily on first send) rather than duplicating creation logic here.
// ============================================================

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
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
  const [sendingAccount, setSendingAccount] = useState<{ provider: string; isReal: boolean } | null>(null)

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
        setSendingAccount({ provider: row?.provider_name ?? 'mock', isReal: Boolean(row && row.provider_name !== 'mock') })
      } catch {
        setSendingAccount({ provider: 'mock', isReal: false })
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

  async function handleSave() {
    if (!resolvedId || !settings) return

    const dailyLimit = settings.dailyLimit.trim() === '' ? null : Number(settings.dailyLimit)
    if (dailyLimit !== null && (!Number.isInteger(dailyLimit) || dailyLimit <= 0)) {
      toast.error('Daily send limit must be a positive whole number, or blank for unlimited.')
      return
    }

    const anyIntervalSet = settings.interval1 || settings.interval2 || settings.interval3
    const allIntervalsSet = settings.interval1 && settings.interval2 && settings.interval3
    if (anyIntervalSet && !allIntervalsSet) {
      toast.error('Set all three follow-up steps, or clear all three to use the global default.')
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
            <p className="text-xs text-muted-foreground/70 mt-0.5">Name, sending limits, schedule — optional, sensible defaults apply</p>
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
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="campaign-name">Campaign name</Label>
            <Input
              id="campaign-name"
              value={settings.name}
              onChange={e => setSettings(s => (s ? { ...s, name: e.target.value } : s))}
            />
          </div>

          <div className="space-y-1">
            <Label>Sending account</Label>
            <p className="text-xs text-foreground">
              {sendingAccount
                ? sendingAccount.isReal
                  ? <>Connected — <span className="font-medium">{sendingAccount.provider}</span></>
                  : 'Demo mode (no real sending account connected yet)'
                : 'Checking…'}
              {' '}
              <a href="/admin/outbound/integrations" className="underline underline-offset-2 hover:text-foreground text-muted-foreground/70">
                change in Integrations
              </a>
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="daily-limit">Daily send limit</Label>
            <Input
              id="daily-limit"
              type="number"
              min={1}
              placeholder="Unlimited"
              value={settings.dailyLimit}
              onChange={e => setSettings(s => (s ? { ...s, dailyLimit: e.target.value } : s))}
            />
          </div>

          <div className="space-y-1">
            <Label>Sending window</Label>
            <div className="grid grid-cols-3 gap-2">
              <Select
                items={HOUR_OPTIONS}
                value={settings.windowStart}
                onValueChange={v => setSettings(s => (s ? { ...s, windowStart: v as string } : s))}
              >
                <SelectTrigger aria-label="Sending window start hour"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HOUR_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select
                items={HOUR_OPTIONS}
                value={settings.windowEnd}
                onValueChange={v => setSettings(s => (s ? { ...s, windowEnd: v as string } : s))}
              >
                <SelectTrigger aria-label="Sending window end hour"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HOUR_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select
                items={COMMON_TIMEZONES.map(tz => ({ value: tz, label: tz }))}
                value={settings.timezone}
                onValueChange={v => setSettings(s => (s ? { ...s, timezone: v as string } : s))}
              >
                <SelectTrigger aria-label="Sending window timezone"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map(tz => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground/60">Sends outside this window are held and skipped, not sent late.</p>
          </div>

          <div className="space-y-1">
            <Label>Follow-up schedule</Label>
            <p className="text-xs text-muted-foreground/60">
              Days after the previous email. Leave all three blank to use the app-wide default ({globalIntervals.join(' / ')} days).
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(['interval1', 'interval2', 'interval3'] as const).map((key, i) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={key} className="text-[11px] text-muted-foreground/70">Follow-up {i + 1}</Label>
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
          </div>

          <div className="space-y-1 pt-1 border-t border-border">
            <Label>Stop conditions</Label>
            <p className="text-xs text-muted-foreground/70">
              Always on, not configurable: sending stops automatically for a contact who replies, whose email
              bounces, who is on the suppression list, or who is removed from this campaign.
            </p>
          </div>

          <Button size="sm" disabled={saving} onClick={handleSave}>
            {saving ? <Spinner className="size-3.5" /> : null}
            Save Settings
          </Button>
        </div>
      )}
    </CollapsibleRow>
  )
}

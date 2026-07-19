'use client'

// ============================================================
// Outbound Integrations — /admin/outbound/integrations
// ============================================================
// One stacked Card per outbound capability (Email Finder, Email Validation,
// Contact Enrichment, Email Sending, Email Warm-Up). Every capability ships
// with a working 'mock' provider — selecting a real vendor here just
// records the choice; there's no live provider class behind it yet, and
// Test Connection says so explicitly rather than pretending to succeed.
// Credentials are encrypted server-side (lib/outbound/settings/credential-
// crypto.ts) before storage — this page never receives a stored key back,
// only a masked "····1234" hint via credential_last_four.
// ============================================================

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { staggerList, listItem } from '@/lib/motion'
import {
  OUTBOUND_CAPABILITIES,
  CAPABILITY_LABELS,
  CAPABILITY_HINTS,
  CAPABILITY_KNOWN_PROVIDERS,
  type OutboundCapability,
  type OutboundIntegrationRow,
} from '@/lib/outbound/settings/types'

type RowState = {
  provider_name: string
  api_key: string
  is_enabled: boolean
  saving: boolean
  testing: boolean
}

function emptyRowState(providerName: string): RowState {
  return { provider_name: providerName, api_key: '', is_enabled: false, saving: false, testing: false }
}

function testBadgeVariant(status: OutboundIntegrationRow['last_test_status'] | undefined) {
  if (status === 'success') return 'default' as const
  if (status === 'failure') return 'destructive' as const
  return 'outline' as const
}

export default function OutboundIntegrationsPage() {
  return (
    <Suspense fallback={null}>
      <OutboundIntegrationsPageInner />
    </Suspense>
  )
}

function OutboundIntegrationsPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // Gmail's OAuth callback (a top-level browser redirect, not a fetch call)
  // can't return JSON to this page directly — it redirects back here with
  // ?gmail_oauth=success|error instead. Toast once, then strip the query
  // params so a refresh doesn't re-toast.
  useEffect(() => {
    const status = searchParams.get('gmail_oauth')
    if (!status) return
    const message = searchParams.get('gmail_oauth_message')
    if (status === 'success') toast.success(message ? `Gmail connected — ${message}` : 'Gmail connected')
    else toast.error(message ?? 'Gmail connection failed')
    router.replace('/admin/outbound/integrations')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const [rows, setRows] = useState<Record<OutboundCapability, OutboundIntegrationRow | null>>(
    () =>
      Object.fromEntries(OUTBOUND_CAPABILITIES.map(c => [c, null])) as Record<
        OutboundCapability,
        OutboundIntegrationRow | null
      >
  )
  const [drafts, setDrafts] = useState<Record<OutboundCapability, RowState>>(
    () =>
      Object.fromEntries(OUTBOUND_CAPABILITIES.map(c => [c, emptyRowState('mock')])) as Record<
        OutboundCapability,
        RowState
      >
  )
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void loadIntegrations()
  }, [])

  async function loadIntegrations() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/outbound/integrations')
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to load integrations')
        return
      }
      const byCapability: Record<string, OutboundIntegrationRow> = {}
      for (const row of data.integrations as OutboundIntegrationRow[]) {
        if (row.is_active) byCapability[row.capability] = row
      }
      setRows(prev => ({ ...prev, ...byCapability }))
      setDrafts(prev => {
        const next = { ...prev }
        for (const capability of OUTBOUND_CAPABILITIES) {
          const active = byCapability[capability]
          next[capability] = {
            provider_name: active?.provider_name ?? 'mock',
            api_key: '',
            is_enabled: active?.is_enabled ?? false,
            saving: false,
            testing: false,
          }
        }
        return next
      })
    } catch {
      toast.error('Could not reach the integrations API')
    } finally {
      setLoading(false)
    }
  }

  function updateDraft(capability: OutboundCapability, patch: Partial<RowState>) {
    setDrafts(prev => ({ ...prev, [capability]: { ...prev[capability], ...patch } }))
  }

  async function saveCapability(capability: OutboundCapability) {
    const draft = drafts[capability]
    updateDraft(capability, { saving: true })
    try {
      const res = await fetch(`/api/admin/outbound/integrations/${capability}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_name: draft.provider_name,
          display_name: `${draft.provider_name === 'mock' ? 'Mock' : draft.provider_name} ${CAPABILITY_LABELS[capability]}`,
          api_key: draft.api_key || undefined,
          is_enabled: draft.provider_name === 'mock' ? true : draft.is_enabled,
          is_active: true,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Save failed')
        return
      }
      toast.success(`${CAPABILITY_LABELS[capability]} saved`)
      updateDraft(capability, { api_key: '' })
      await loadIntegrations()
    } catch {
      toast.error('Could not reach the integrations API')
    } finally {
      updateDraft(capability, { saving: false })
    }
  }

  async function testCapability(capability: OutboundCapability) {
    updateDraft(capability, { testing: true })
    try {
      const res = await fetch(`/api/admin/outbound/integrations/${capability}/test`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Test failed')
        return
      }
      if (data.status === 'success') toast.success(data.message)
      else toast.warning(data.message)
      await loadIntegrations()
    } catch {
      toast.error('Could not reach the integrations API')
    } finally {
      updateDraft(capability, { testing: false })
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-foreground">Outbound Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure the vendor behind each outbound capability. Every capability works today via a
          built-in mock provider — adding a real vendor here is a config change, not a code change.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Spinner className="size-4" /> Loading integrations…
        </div>
      ) : (
        <motion.div variants={staggerList} initial="hidden" animate="visible" className="space-y-3">
          {OUTBOUND_CAPABILITIES.map(capability => {
            const active = rows[capability]
            const draft = drafts[capability]
            const knownProviders = CAPABILITY_KNOWN_PROVIDERS[capability]
            const isGmailDraft = capability === 'sending' && draft.provider_name === 'gmail'
            const connectedGmailEmail = active?.provider_name === 'gmail'
              ? (active.config as { email?: string } | undefined)?.email
              : undefined

            return (
              <motion.div key={capability} variants={listItem}>
                <Card className="border-border bg-card">
                  <CardContent className="px-5 py-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm font-semibold text-foreground">
                            {CAPABILITY_LABELS[capability]}
                          </h2>
                          <Badge variant={active?.provider_name === 'mock' ? 'secondary' : 'default'}>
                            {active?.provider_name ?? 'mock'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground/70 mt-0.5">
                          {CAPABILITY_HINTS[capability]}
                        </p>
                        {connectedGmailEmail && (
                          <p className="text-xs text-muted-foreground/70 mt-0.5">
                            Connected as: <span className="text-foreground">{connectedGmailEmail}</span>
                          </p>
                        )}
                      </div>
                      {active?.last_test_status && active.last_test_status !== 'untested' && (
                        <Badge variant={testBadgeVariant(active.last_test_status)}>
                          {active.last_test_status}
                        </Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor={`${capability}-provider`}>Provider</Label>
                        <select
                          id={`${capability}-provider`}
                          value={draft.provider_name}
                          onChange={e => updateDraft(capability, { provider_name: e.target.value })}
                          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                        >
                          {knownProviders.map(p => (
                            <option key={p} value={p}>
                              {p === 'mock' ? 'Mock (built-in, no key needed)' : p}
                            </option>
                          ))}
                        </select>
                      </div>
                      {isGmailDraft ? (
                        <div className="space-y-1">
                          <Label>Google account</Label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => {
                              window.location.href = '/api/admin/outbound/integrations/gmail/oauth/start'
                            }}
                          >
                            {connectedGmailEmail ? 'Reconnect with Google' : 'Connect with Google'}
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <Label htmlFor={`${capability}-key`}>API key</Label>
                          <Input
                            id={`${capability}-key`}
                            type="password"
                            placeholder={
                              active?.credential_last_four
                                ? `•••• ${active.credential_last_four}`
                                : draft.provider_name === 'mock'
                                  ? 'Not required for mock'
                                  : 'Not set'
                            }
                            value={draft.api_key}
                            disabled={draft.provider_name === 'mock'}
                            onChange={e => updateDraft(capability, { api_key: e.target.value })}
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-muted-foreground/70">
                        {isGmailDraft
                          ? 'Gmail is connected via Google\'s consent screen above, not a pasted key — click Test Connection after connecting.'
                          : (active?.last_test_message ?? 'Not tested yet.')}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={draft.testing}
                          onClick={() => testCapability(capability)}
                        >
                          {draft.testing ? <Spinner className="size-3.5" /> : null}
                          Test Connection
                        </Button>
                        {!isGmailDraft && (
                          <Button size="sm" disabled={draft.saving} onClick={() => saveCapability(capability)}>
                            {draft.saving ? <Spinner className="size-3.5" /> : null}
                            Save
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>
      )}
    </div>
  )
}

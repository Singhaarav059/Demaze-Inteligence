'use client'

// ============================================================
// Outbound Contacts — /admin/outbound/contacts
// ============================================================
// Pick a researched company (from run history) -> manually add contacts
// (person_name is always user-supplied, never auto-discovered) -> per-
// contact Find Email / Enrich / Outreach actions. Decision-Maker
// Discovery is a separate, explicit action (DecisionMakerFinder) — it
// surfaces candidates for review, nothing is added as a contact until
// selected. Email validation was removed (2026-07-19) — mock-only
// capability, no real vendor decision made.
// ============================================================

import { useState } from 'react'
import { motion } from 'framer-motion'
import { UserPlus } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { OutboundToolsNav } from '@/components/shell/OutboundToolsNav'
import { staggerList, listItem } from '@/lib/motion'
import { getLeadershipContacts } from '@/lib/pipeline/analysis-sections'
import { useOutboundContacts, guessCompanyName } from './useOutboundContacts'
import { ContactRow } from './ContactRow'
import { DecisionMakerFinder } from './DecisionMakerFinder'

// Maps the saved run's leadership_contacts (evidence-extractor.ts shape,
// name/title/statedPortfolio/sourceUrl/confidence) down to the {name, title}
// shape DecisionMakerFinder's grounding step needs — same boundary-mapping
// discipline as the live API route (see decision-makers/discover/route.ts).
function toLeadershipContactInputs(finalResult: Record<string, unknown> | null | undefined) {
  if (!finalResult) return undefined
  const contacts = getLeadershipContacts(finalResult)
    .filter((c): c is { name: string; title: string } => Boolean(c.name && c.title))
    .map(c => ({ name: c.name, title: c.title }))
  return contacts.length ? contacts : undefined
}

export default function OutboundContactsPage() {
  const {
    runs,
    loadingRuns,
    selectedRunId,
    setSelectedRunId,
    selectedRun,
    contacts,
    setContacts,
    loadingContacts,
    adding,
    pendingAction,
    addContact,
    findEmailForContact,
    enrichContact,
    deleteContact,
  } = useOutboundContacts()

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [personName, setPersonName] = useState('')
  const [titleHint, setTitleHint] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')

  async function handleAdd() {
    if (!personName.trim()) return
    await addContact({ person_name: personName.trim(), title_hint: titleHint.trim(), linkedin_url: linkedinUrl.trim() })
    setPersonName('')
    setTitleHint('')
    setLinkedinUrl('')
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <OutboundToolsNav />
      <div>
        <h1 className="text-lg font-semibold text-foreground">Outbound Contacts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pick a researched company, then add contacts. Manually typing in a name (from Sales
          Navigator, a lead list, etc.) stays the default path. Decision-Maker Discovery below is a
          separate, explicit action. It surfaces candidates for you to review, and nothing is added
          as a contact until you select it.
        </p>
      </div>

      <Card className="border-border bg-card">
        <CardContent className="px-5 py-4 space-y-1">
          <Label htmlFor="run-picker">Company (from Research run history)</Label>
          <select
            id="run-picker"
            value={selectedRunId ?? ''}
            onChange={e => setSelectedRunId(e.target.value || null)}
            disabled={loadingRuns}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          >
            <option value="">{loadingRuns ? 'Loading runs…' : 'Select a company…'}</option>
            {runs.map(run => (
              <option key={run.id} value={run.id}>
                {run.domain || run.company_url}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {selectedRunId && selectedRun && (
        <>
          <DecisionMakerFinder
            companyName={guessCompanyName(selectedRun)}
            domain={selectedRun.domain}
            sourceRunId={selectedRun.id}
            onContactAdded={contact => setContacts(prev => [contact, ...prev])}
            leadershipContacts={toLeadershipContactInputs(selectedRun.final_result)}
          />

          <Card className="border-border bg-card">
            <CardContent className="px-5 py-4 space-y-3">
              <h2 className="text-sm font-semibold text-foreground">Add Contact</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="person-name">Name *</Label>
                  <Input id="person-name" value={personName} onChange={e => setPersonName(e.target.value)} placeholder="Jane Doe" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="title-hint">Title (optional)</Label>
                  <Input id="title-hint" value={titleHint} onChange={e => setTitleHint(e.target.value)} placeholder="VP Manufacturing" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="linkedin-url">LinkedIn URL (optional, pasted manually)</Label>
                <Input id="linkedin-url" value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/..." />
              </div>
              <Button size="sm" disabled={adding || !personName.trim()} onClick={handleAdd}>
                {adding ? <Spinner className="size-3.5" /> : null}
                Add Contact
              </Button>
            </CardContent>
          </Card>

          {loadingContacts ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Spinner className="size-4" /> Loading contacts…
            </div>
          ) : contacts.length === 0 ? (
            <EmptyState
              icon={UserPlus}
              title="No contacts yet"
              description="Add one above by name, or run Decision-Maker Discovery below to find candidates."
              className="border-none py-4"
            />
          ) : (
            <motion.div variants={staggerList} initial="hidden" animate="visible" className="space-y-2">
              {contacts.map(contact => (
                <motion.div key={contact.id} variants={listItem}>
                  <ContactRow
                    contact={contact}
                    pending={pendingAction[contact.id]}
                    expanded={expandedIds.has(contact.id)}
                    onToggleExpanded={() =>
                      setExpandedIds(prev => {
                        const next = new Set(prev)
                        if (next.has(contact.id)) next.delete(contact.id)
                        else next.add(contact.id)
                        return next
                      })
                    }
                    onFindEmail={() => findEmailForContact(contact.id)}
                    onEnrich={() => enrichContact(contact.id)}
                    onDelete={() => deleteContact(contact.id)}
                  />
                </motion.div>
              ))}
            </motion.div>
          )}
        </>
      )}
    </div>
  )
}

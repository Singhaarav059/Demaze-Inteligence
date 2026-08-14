'use client'

// ============================================================
// Sales Knowledge — /admin/outbound/sales-knowledge
// ============================================================
// The admin-editable "sales playbook": Target Industries, Problems We
// Solve, Demaze Capabilities, and Case Studies. One page with 4 tabs
// (not 4 separate routes) — matches the "simple, not overwhelming"
// requirement and this repo's single-page-multi-tab precedent
// (/admin/outbound/integrations is the closest analog). Feeds
// lib/sales-knowledge/matcher.ts, which turns a completed research run
// into a Sales Intelligence recommendation — this used to be surfaced on
// a "Sales Strategy" step in Auto Flow, removed 2026-08-13 because Auto
// Flow shouldn't encode unapproved sales positioning before the official
// sector playbook arrives (see CLAUDE.md's Sales Intelligence section).
// This page and lib/sales-knowledge/* are left fully intact and editable
// for that future work; nothing here is currently wired into Auto Flow.
//
// Cross-reference fields (a Problem's industry_tags, a Capability's
// slug referenced by a Problem) are plain comma-separated tag inputs,
// not a hidden FK picker — a non-technical admin can type "manufacturing,
// automotive" directly. Referential integrity on these tags is app-level
// only (same as demaze-proof-points.ts's industry_tags/capability_tags
// convention this table was seeded from).
// ============================================================

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { GuideNote } from '@/components/ui/guide-note'
import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { BookOpen, Plus, Trash2 } from 'lucide-react'
import { useSalesKnowledge } from './useSalesKnowledge'
import type {
  SalesKnowledgeIndustry,
  SalesKnowledgeProblem,
  SalesKnowledgeCapability,
  SalesKnowledgeCaseStudy,
  SalesKnowledgeCaseStudyOutcome,
} from '@/lib/sales-knowledge/types'

function tagsToText(tags: string[] | undefined) {
  return (tags ?? []).join(', ')
}

function TagField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  hint?: string
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} onChange={e => onChange(e.target.value)} placeholder="comma, separated, tags" />
      {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  )
}

function RowFooter({
  isNew,
  isActive,
  saving,
  onSave,
  onDelete,
  onReactivate,
}: {
  isNew: boolean
  isActive: boolean
  saving: boolean
  onSave: () => void
  onDelete?: () => void
  onReactivate?: () => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  return (
    <div className="flex items-center justify-between pt-1">
      {!isActive && !isNew && <Badge variant="outline">Inactive</Badge>}
      <div className="ml-auto flex gap-2">
        {!isNew && !isActive && onReactivate && (
          <Button variant="outline" size="sm" onClick={onReactivate} disabled={saving}>
            Reactivate
          </Button>
        )}
        {!isNew && isActive && onDelete && (
          <>
            <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(true)} disabled={saving}>
              <Trash2 className="size-3.5" /> Remove
            </Button>
            <ConfirmDialog
              open={confirmingDelete}
              onOpenChange={setConfirmingDelete}
              title="Remove this entry?"
              description="It's deactivated, not deleted — you can reactivate it later, and past Sales Intelligence recommendations that reference it are unaffected."
              confirmLabel="Remove"
              onConfirm={() => {
                setConfirmingDelete(false)
                onDelete()
              }}
            />
          </>
        )}
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? <Spinner className="size-3.5" /> : null}
          {isNew ? 'Add' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

// ── Industries ────────────────────────────────────────────────────────

function IndustryFields({
  draft,
  setDraft,
}: {
  draft: { slug: string; label: string; description: string; keywords: string }
  setDraft: (d: typeof draft) => void
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Label</Label>
          <Input value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} placeholder="Manufacturing" />
        </div>
        <div className="space-y-1">
          <Label>Slug</Label>
          <Input value={draft.slug} onChange={e => setDraft({ ...draft, slug: e.target.value })} placeholder="manufacturing" />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Description</Label>
        <Textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="What kind of company this covers." />
      </div>
      <TagField
        label="Keywords"
        value={draft.keywords}
        onChange={v => setDraft({ ...draft, keywords: v })}
        hint="Plain-language terms matched against a company's research (e.g. manufacturer, factory, plant)."
      />
    </div>
  )
}

function IndustriesTab({ sk }: { sk: ReturnType<typeof useSalesKnowledge> }) {
  const [adding, setAdding] = useState(false)
  const [newDraft, setNewDraft] = useState({ slug: '', label: '', description: '', keywords: '' })
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!newDraft.slug.trim() || !newDraft.label.trim()) {
      toast.error('Label and slug are required')
      return
    }
    setSaving(true)
    const ok = await sk.create('industries', newDraft)
    setSaving(false)
    if (ok) {
      setNewDraft({ slug: '', label: '', description: '', keywords: '' })
      setAdding(false)
    }
  }

  return (
    <div className="space-y-3">
      {!adding ? (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-3.5" /> Add industry
        </Button>
      ) : (
        <CollapsibleRow defaultOpen summary={<span className="text-sm font-medium">New industry</span>}>
          <IndustryFields draft={newDraft} setDraft={setNewDraft} />
          <RowFooter isNew isActive saving={saving} onSave={handleAdd} />
        </CollapsibleRow>
      )}

      {sk.industries.length === 0 ? (
        <EmptyState icon={BookOpen} title="No industries yet" description="Add the industries Demaze targets, e.g. Manufacturing, Automotive, SaaS." />
      ) : (
        sk.industries.map(row => <IndustryRow key={row.id} row={row} sk={sk} />)
      )}
    </div>
  )
}

function IndustryRow({ row, sk }: { row: SalesKnowledgeIndustry; sk: ReturnType<typeof useSalesKnowledge> }) {
  const [draft, setDraft] = useState({
    slug: row.slug,
    label: row.label,
    description: row.description ?? '',
    keywords: tagsToText(row.keywords),
  })
  const [saving, setSaving] = useState(false)

  async function save(is_active: boolean) {
    setSaving(true)
    await sk.update('industries', row.id, { ...draft, is_active })
    setSaving(false)
  }

  return (
    <CollapsibleRow
      summary={
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{row.label}</span>
          {!row.is_active && <Badge variant="outline">Inactive</Badge>}
        </div>
      }
    >
      <IndustryFields draft={draft} setDraft={setDraft} />
      <RowFooter
        isNew={false}
        isActive={row.is_active}
        saving={saving}
        onSave={() => save(row.is_active)}
        onDelete={() => sk.remove('industries', row.id)}
        onReactivate={() => save(true)}
      />
    </CollapsibleRow>
  )
}

// ── Capabilities ──────────────────────────────────────────────────────

function CapabilityFields({
  draft,
  setDraft,
}: {
  draft: { slug: string; label: string; description: string; positioning_template: string; recommended_roles: string; recommended_cta: string }
  setDraft: (d: typeof draft) => void
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Label</Label>
          <Input value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} placeholder="Workflow automation systems" />
        </div>
        <div className="space-y-1">
          <Label>Slug</Label>
          <Input value={draft.slug} onChange={e => setDraft({ ...draft, slug: e.target.value })} placeholder="workflow-automation-systems" />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Description</Label>
        <Textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label>Positioning</Label>
        <Textarea
          value={draft.positioning_template}
          onChange={e => setDraft({ ...draft, positioning_template: e.target.value })}
          placeholder="Use {{company}} to insert the prospect's name."
        />
      </div>
      <TagField label="Recommended roles" value={draft.recommended_roles} onChange={v => setDraft({ ...draft, recommended_roles: v })} hint="e.g. COO, VP Operations" />
      <div className="space-y-1">
        <Label>Recommended call to action</Label>
        <Input value={draft.recommended_cta} onChange={e => setDraft({ ...draft, recommended_cta: e.target.value })} placeholder="Open to a quick discussion?" />
      </div>
    </div>
  )
}

function CapabilitiesTab({ sk }: { sk: ReturnType<typeof useSalesKnowledge> }) {
  const [adding, setAdding] = useState(false)
  const [newDraft, setNewDraft] = useState({ slug: '', label: '', description: '', positioning_template: '', recommended_roles: '', recommended_cta: '' })
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!newDraft.slug.trim() || !newDraft.label.trim()) {
      toast.error('Label and slug are required')
      return
    }
    setSaving(true)
    const ok = await sk.create('capabilities', newDraft)
    setSaving(false)
    if (ok) {
      setNewDraft({ slug: '', label: '', description: '', positioning_template: '', recommended_roles: '', recommended_cta: '' })
      setAdding(false)
    }
  }

  return (
    <div className="space-y-3">
      {!adding ? (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-3.5" /> Add capability
        </Button>
      ) : (
        <CollapsibleRow defaultOpen summary={<span className="text-sm font-medium">New capability</span>}>
          <CapabilityFields draft={newDraft} setDraft={setNewDraft} />
          <RowFooter isNew isActive saving={saving} onSave={handleAdd} />
        </CollapsibleRow>
      )}

      {sk.capabilities.length === 0 ? (
        <EmptyState icon={BookOpen} title="No capabilities yet" description="Add the services Demaze sells, e.g. Workflow automation systems." />
      ) : (
        sk.capabilities.map(row => <CapabilityRow key={row.id} row={row} sk={sk} />)
      )}
    </div>
  )
}

function CapabilityRow({ row, sk }: { row: SalesKnowledgeCapability; sk: ReturnType<typeof useSalesKnowledge> }) {
  const [draft, setDraft] = useState({
    slug: row.slug,
    label: row.label,
    description: row.description ?? '',
    positioning_template: row.positioning_template ?? '',
    recommended_roles: tagsToText(row.recommended_roles),
    recommended_cta: row.recommended_cta ?? '',
  })
  const [saving, setSaving] = useState(false)

  async function save(is_active: boolean) {
    setSaving(true)
    await sk.update('capabilities', row.id, { ...draft, is_active })
    setSaving(false)
  }

  return (
    <CollapsibleRow
      summary={
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{row.label}</span>
          {!row.is_active && <Badge variant="outline">Inactive</Badge>}
        </div>
      }
    >
      <CapabilityFields draft={draft} setDraft={setDraft} />
      <RowFooter
        isNew={false}
        isActive={row.is_active}
        saving={saving}
        onSave={() => save(row.is_active)}
        onDelete={() => sk.remove('capabilities', row.id)}
        onReactivate={() => save(true)}
      />
    </CollapsibleRow>
  )
}

// ── Problems ──────────────────────────────────────────────────────────

function ProblemFields({
  draft,
  setDraft,
}: {
  draft: { slug: string; label: string; description: string; industry_tags: string; evidence_keywords: string; capability_tags: string }
  setDraft: (d: typeof draft) => void
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Label</Label>
          <Input value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} placeholder="Manual, spreadsheet-driven reporting" />
        </div>
        <div className="space-y-1">
          <Label>Slug</Label>
          <Input value={draft.slug} onChange={e => setDraft({ ...draft, slug: e.target.value })} placeholder="manual-reporting" />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Description</Label>
        <Textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} />
      </div>
      <TagField label="Industries this applies to" value={draft.industry_tags} onChange={v => setDraft({ ...draft, industry_tags: v })} hint="Slugs from the Industries tab, e.g. manufacturing, automotive" />
      <TagField label="Evidence keywords" value={draft.evidence_keywords} onChange={v => setDraft({ ...draft, evidence_keywords: v })} hint="Phrases that count as a signal when found in a company's research" />
      <TagField label="Solved by capability" value={draft.capability_tags} onChange={v => setDraft({ ...draft, capability_tags: v })} hint="Slugs from the Capabilities tab" />
    </div>
  )
}

function ProblemsTab({ sk }: { sk: ReturnType<typeof useSalesKnowledge> }) {
  const [adding, setAdding] = useState(false)
  const [newDraft, setNewDraft] = useState({ slug: '', label: '', description: '', industry_tags: '', evidence_keywords: '', capability_tags: '' })
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!newDraft.slug.trim() || !newDraft.label.trim()) {
      toast.error('Label and slug are required')
      return
    }
    setSaving(true)
    const ok = await sk.create('problems', newDraft)
    setSaving(false)
    if (ok) {
      setNewDraft({ slug: '', label: '', description: '', industry_tags: '', evidence_keywords: '', capability_tags: '' })
      setAdding(false)
    }
  }

  return (
    <div className="space-y-3">
      {!adding ? (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-3.5" /> Add problem
        </Button>
      ) : (
        <CollapsibleRow defaultOpen summary={<span className="text-sm font-medium">New problem</span>}>
          <ProblemFields draft={newDraft} setDraft={setNewDraft} />
          <RowFooter isNew isActive saving={saving} onSave={handleAdd} />
        </CollapsibleRow>
      )}

      {sk.problems.length === 0 ? (
        <EmptyState icon={BookOpen} title="No problems yet" description="Add the operational problems Demaze solves, e.g. manual reporting, fragmented data." />
      ) : (
        sk.problems.map(row => <ProblemRow key={row.id} row={row} sk={sk} />)
      )}
    </div>
  )
}

function ProblemRow({ row, sk }: { row: SalesKnowledgeProblem; sk: ReturnType<typeof useSalesKnowledge> }) {
  const [draft, setDraft] = useState({
    slug: row.slug,
    label: row.label,
    description: row.description ?? '',
    industry_tags: tagsToText(row.industry_tags),
    evidence_keywords: tagsToText(row.evidence_keywords),
    capability_tags: tagsToText(row.capability_tags),
  })
  const [saving, setSaving] = useState(false)

  async function save(is_active: boolean) {
    setSaving(true)
    await sk.update('problems', row.id, { ...draft, is_active })
    setSaving(false)
  }

  return (
    <CollapsibleRow
      summary={
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{row.label}</span>
          {!row.is_active && <Badge variant="outline">Inactive</Badge>}
        </div>
      }
    >
      <ProblemFields draft={draft} setDraft={setDraft} />
      <RowFooter
        isNew={false}
        isActive={row.is_active}
        saving={saving}
        onSave={() => save(row.is_active)}
        onDelete={() => sk.remove('problems', row.id)}
        onReactivate={() => save(true)}
      />
    </CollapsibleRow>
  )
}

// ── Case Studies ──────────────────────────────────────────────────────

type CaseStudyDraft = {
  title: string
  client: string
  provenance: 'named_client' | 'composite_illustrative'
  industry_tags: string
  capability_tags: string
  challenge: string
  outcomes: SalesKnowledgeCaseStudyOutcome[]
  source_doc: string
}

function OutcomesEditor({ outcomes, setOutcomes }: { outcomes: SalesKnowledgeCaseStudyOutcome[]; setOutcomes: (o: SalesKnowledgeCaseStudyOutcome[]) => void }) {
  function updateAt(i: number, patch: Partial<SalesKnowledgeCaseStudyOutcome>) {
    setOutcomes(outcomes.map((o, idx) => (idx === i ? { ...o, ...patch } : o)))
  }
  function removeAt(i: number) {
    setOutcomes(outcomes.filter((_, idx) => idx !== i))
  }
  return (
    <div className="space-y-2">
      <Label>Outcomes</Label>
      {outcomes.map((o, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
          <Input value={o.metric} onChange={e => updateAt(i, { metric: e.target.value })} placeholder="Metric" />
          <Input value={o.value} onChange={e => updateAt(i, { value: e.target.value })} placeholder="Value" />
          <Input value={o.window ?? ''} onChange={e => updateAt(i, { window: e.target.value })} placeholder="Window (optional)" />
          <Button variant="outline" size="sm" onClick={() => removeAt(i)}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => setOutcomes([...outcomes, { metric: '', value: '' }])}>
        <Plus className="size-3.5" /> Add outcome
      </Button>
    </div>
  )
}

function CaseStudyFields({ draft, setDraft }: { draft: CaseStudyDraft; setDraft: (d: CaseStudyDraft) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Title</Label>
          <Input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Predictive Maintenance AI" />
        </div>
        <div className="space-y-1">
          <Label>Client</Label>
          <Input value={draft.client} onChange={e => setDraft({ ...draft, client: e.target.value })} placeholder="Real name, or an anonymized description" />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Provenance</Label>
        <Select value={draft.provenance} onValueChange={v => setDraft({ ...draft, provenance: v as CaseStudyDraft['provenance'] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="named_client">Named client — may be named directly in outreach</SelectItem>
            <SelectItem value="composite_illustrative">Composite / illustrative — must stay anonymized</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Challenge</Label>
        <Textarea value={draft.challenge} onChange={e => setDraft({ ...draft, challenge: e.target.value })} />
      </div>
      <OutcomesEditor outcomes={draft.outcomes} setOutcomes={o => setDraft({ ...draft, outcomes: o })} />
      <TagField label="Industries" value={draft.industry_tags} onChange={v => setDraft({ ...draft, industry_tags: v })} />
      <TagField label="Capabilities" value={draft.capability_tags} onChange={v => setDraft({ ...draft, capability_tags: v })} hint="Slugs from the Capabilities tab, so this case study can be matched to a recommendation" />
      <div className="space-y-1">
        <Label>Source (optional)</Label>
        <Input value={draft.source_doc} onChange={e => setDraft({ ...draft, source_doc: e.target.value })} placeholder="Where this came from" />
      </div>
    </div>
  )
}

function CaseStudiesTab({ sk }: { sk: ReturnType<typeof useSalesKnowledge> }) {
  const [adding, setAdding] = useState(false)
  const emptyDraft: CaseStudyDraft = { title: '', client: '', provenance: 'composite_illustrative', industry_tags: '', capability_tags: '', challenge: '', outcomes: [], source_doc: '' }
  const [newDraft, setNewDraft] = useState<CaseStudyDraft>(emptyDraft)
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!newDraft.title.trim() || !newDraft.client.trim() || !newDraft.challenge.trim()) {
      toast.error('Title, client, and challenge are required')
      return
    }
    setSaving(true)
    const ok = await sk.create('case-studies', newDraft)
    setSaving(false)
    if (ok) {
      setNewDraft(emptyDraft)
      setAdding(false)
    }
  }

  return (
    <div className="space-y-3">
      {!adding ? (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-3.5" /> Add case study
        </Button>
      ) : (
        <CollapsibleRow defaultOpen summary={<span className="text-sm font-medium">New case study</span>}>
          <CaseStudyFields draft={newDraft} setDraft={setNewDraft} />
          <RowFooter isNew isActive saving={saving} onSave={handleAdd} />
        </CollapsibleRow>
      )}

      {sk.caseStudies.length === 0 ? (
        <EmptyState icon={BookOpen} title="No case studies yet" description="Add real Demaze proof points so outreach can cite relevant results." />
      ) : (
        sk.caseStudies.map(row => <CaseStudyRow key={row.id} row={row} sk={sk} />)
      )}
    </div>
  )
}

function CaseStudyRow({ row, sk }: { row: SalesKnowledgeCaseStudy; sk: ReturnType<typeof useSalesKnowledge> }) {
  const [draft, setDraft] = useState<CaseStudyDraft>({
    title: row.title,
    client: row.client,
    provenance: row.provenance,
    industry_tags: tagsToText(row.industry_tags),
    capability_tags: tagsToText(row.capability_tags),
    challenge: row.challenge,
    outcomes: row.outcomes,
    source_doc: row.source_doc ?? '',
  })
  const [saving, setSaving] = useState(false)

  async function save(is_active: boolean) {
    setSaving(true)
    await sk.update('case-studies', row.id, { ...draft, is_active })
    setSaving(false)
  }

  return (
    <CollapsibleRow
      summary={
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{row.title}</span>
          <Badge variant="secondary">{row.provenance === 'named_client' ? row.client : 'Anonymized'}</Badge>
          {!row.is_active && <Badge variant="outline">Inactive</Badge>}
        </div>
      }
    >
      <CaseStudyFields draft={draft} setDraft={setDraft} />
      <RowFooter
        isNew={false}
        isActive={row.is_active}
        saving={saving}
        onSave={() => save(row.is_active)}
        onDelete={() => sk.remove('case-studies', row.id)}
        onReactivate={() => save(true)}
      />
    </CollapsibleRow>
  )
}

// ── Page ──────────────────────────────────────────────────────────────

export default function SalesKnowledgePage() {
  const sk = useSalesKnowledge()

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Sales Knowledge</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Industries, problems, capabilities, and case studies used to generate sales positioning.
        </p>
      </div>

      <GuideNote>
        <p>
          This is Demaze's own sales playbook — what we sell, who we sell it to, and the proof we have.
          It&apos;s not currently used by Auto Flow — that wiring was removed until an official,
          approved sector playbook is ready. Editing anything here is safe to do ahead of that: it has
          no effect on Auto Flow today.
        </p>
      </GuideNote>

      {sk.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Spinner className="size-4" /> Loading Sales Knowledge…
        </div>
      ) : (
        <Tabs defaultValue="industries">
          <TabsList>
            <TabsTrigger value="industries">Industries</TabsTrigger>
            <TabsTrigger value="problems">Problems</TabsTrigger>
            <TabsTrigger value="capabilities">Capabilities</TabsTrigger>
            <TabsTrigger value="case-studies">Case Studies</TabsTrigger>
          </TabsList>
          <TabsContent value="industries" className="mt-4">
            <IndustriesTab sk={sk} />
          </TabsContent>
          <TabsContent value="problems" className="mt-4">
            <ProblemsTab sk={sk} />
          </TabsContent>
          <TabsContent value="capabilities" className="mt-4">
            <CapabilitiesTab sk={sk} />
          </TabsContent>
          <TabsContent value="case-studies" className="mt-4">
            <CaseStudiesTab sk={sk} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

'use client'

// ============================================================
// ContactInfoStep — Auto Flow's "Contact Information" step
// ============================================================
// Runs email discovery automatically for every contact that hasn't been
// looked up yet (email_finder_status === 'pending'), sequentially — same
// "loop on mount, no button, one at a time" pattern OutreachStep's
// draftMissing() uses for generation. Phone and LinkedIn have no discovery
// call to make (no phone provider exists in this codebase; LinkedIn is
// whatever the contact already carries from decision-maker discovery or a
// manual paste) — ContactInfoRow just displays those honestly.
// ============================================================

import { useCallback, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { staggerList, listItem } from '@/lib/motion'
import type { OutboundContact } from '@/app/admin/outbound/contacts/useOutboundContacts'
import { ContactInfoRow } from './ContactInfoRow'

export function ContactInfoStep({
  contacts,
  pendingAction,
  findEmailForContact,
  deleteContact,
  groupByCompany = false,
}: {
  contacts: OutboundContact[]
  pendingAction: Record<string, 'find-email' | 'delete' | undefined>
  findEmailForContact: (contactId: string) => Promise<void>
  deleteContact: (contactId: string) => Promise<void>
  // Batch mode (many companies at once) shows a company-name header above
  // each run of contacts, same grouping the old Contacts step used —
  // single-company mode has nothing to group by, so this defaults off.
  groupByCompany?: boolean
}) {
  const inFlight = useRef(new Set<string>())

  const runLookups = useCallback(async () => {
    for (const contact of contacts) {
      if (contact.email_finder_status !== 'pending') continue
      if (inFlight.current.has(contact.id)) continue
      inFlight.current.add(contact.id)
      try {
        await findEmailForContact(contact.id)
      } finally {
        inFlight.current.delete(contact.id)
      }
    }
  }, [contacts, findEmailForContact])

  useEffect(() => {
    void runLookups()
    // Deliberately keyed on the joined contact-id list rather than
    // `contacts` itself (contacts is re-created every parent render) — this
    // effect should only re-run when the set of contacts actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts.map(c => c.id).join(',')])

  return (
    <motion.div variants={staggerList} initial="hidden" animate="visible" className="space-y-2">
      {contacts.map((contact, i) => (
        <motion.div key={contact.id} variants={listItem}>
          {groupByCompany && (i === 0 || contacts[i - 1].company_name !== contact.company_name) && (
            <p className="text-xs font-medium text-muted-foreground/70 mt-3 mb-1.5 first:mt-0">
              {contact.company_name}
            </p>
          )}
          <ContactInfoRow
            contact={contact}
            lookingUpEmail={pendingAction[contact.id] === 'find-email' || contact.email_finder_status === 'pending'}
            removing={pendingAction[contact.id] === 'delete'}
            onRemove={() => void deleteContact(contact.id)}
          />
        </motion.div>
      ))}
    </motion.div>
  )
}

-- Adds 'verified' as a distinct, higher tier than 'high' on
-- outbound_contacts.email_confidence.
--
-- Why: the Exa-vs-Prospeo benchmark (benchmarks/exa/REPORT.md) found that
-- Prospeo's 'high' confidence already comes from a real SMTP verification
-- signal (only_verified_email:true in the request, confidence derived from
-- a genuine email.status field containing "verif" — see
-- lib/outbound/email-finder/providers/prospeo.ts), while every other
-- provider's 'high'/'medium'/'low' is a locally-derived heuristic with no
-- such signal. Collapsing both into the same 'high' value made a real,
-- provider-confirmed verification indistinguishable from a confident guess.
-- 'verified' is reserved exclusively for a result where the provider
-- itself confirmed deliverability — never set from local heuristics, never
-- inferred from existence alone.
ALTER TABLE outbound_contacts DROP CONSTRAINT outbound_contacts_email_confidence_check;
ALTER TABLE outbound_contacts ADD CONSTRAINT outbound_contacts_email_confidence_check
  CHECK (email_confidence IN ('verified', 'high', 'medium', 'low', 'none'));

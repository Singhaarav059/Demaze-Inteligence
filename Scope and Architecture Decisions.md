---
tags: [demaze, architecture, decisions]
updated: 2026-07-14
---

# Scope & Architecture Decisions

← [[PROJECT_STATUS]]

> [!info] Why this note exists
> These are the *locked* calls — things that were explicitly considered and decided, not just left alone by default. Re-opening any of these needs a deliberate new decision, not a quiet drift back in. Full reasoning lives in [[CLAUDE]].

> [!warning] Scope pivot, 2026-07-14 — TWO decisions same day
> Decision A (earlier): company-level lead discovery + open output schema reopened, contact/email kept locked. Decision B (later, after live Explee screenshots were reviewed): contact/email reopened too — **the full 6-phase AutoGTM loop is now the target**, not just company discovery. See the "SCOPE PIVOT" section in [[CLAUDE]] for both decisions in full. Phases 5-6 (decision-maker discovery, email send) are approved in scope but blocked on vendor decisions (people-data API, sending infra) not yet made — architecture/vendor selection needed before any code.

- [x] ~~Output schema locked to exactly 5 fields~~ **Reopened 2026-07-14** — the 5 fields (Company Description, Pain Points, AI Opportunities, Recent News, Personalization Summary) stay as the core, but new top-level fields (competitors, ICPs, market intelligence, outreach intelligence, decision-maker contacts) are now allowed, added one at a time per the new priority order. Buyer/stakeholder-as-*input* concept still holds for existing leads; a matched-company's contacts found via phase 5 are new output, not the old locked "no buyer field" case.
- [x] ~~Scope boundary locked: lead discovery + contact/email permanently out of scope~~ **Fully reopened 2026-07-14 in two steps** — Decision A opened company-level discovery (ICP → matching companies, search/public-web, no Apollo/ZoomInfo/PDL/LinkedIn). Decision B, later the same day, opened contact-level discovery (named decision-makers per company) and email generation+send too, after the user reviewed Explee's live 6-phase product end to end. LinkedIn scraping/automation specifically stays excluded either way — contact discovery should use a people-data API, not LinkedIn. Both phase 5 (contacts) and phase 6 (send) need a vendor decision before implementation — see [[Left To Do]].
- [x] LinkedIn stays excluded/optional — must not drive architecture decisions; Demaze is not trying to replace Sales Navigator
- [x] `business-model-classifier.ts` retirement **decided against** — verified 3 real consumers (`normalize.ts`'s `classifyBusinessModel()`/`filterSignalsForBusinessModel()`, `signal-clustering.ts`, `opportunity-engine.ts`) before deciding to keep it
- [x] `company_fit` / ICP scoring demoted to informational-only — feeds `outreach_priority_score`'s weighting (35%) but gates no pipeline stage; leads arrive pre-qualified, so a low fit score should never skip research
- [x] Dead `icp_score_modifier` field deleted from the business-model PROFILES table — verified unread anywhere outside its own definition
- [x] Model-quality investigated and closed — **not the bottleneck**. Estimated impact: architecture fixes ~+30%, model upgrade ~+5–10%. Current open/free models (DeepSeek, GLM, Qwen, Llama) are sufficient; failures are scraping/classification/signals/timeouts/parsing, not reasoning quality
- [x] Buyer-selection and website-conflict-resolution work explicitly cancelled — website discovery only runs when a lead has **no** website at all; conflicting/multiple websites on the same input row are a data-quality problem for whoever maintains the lead list, not Demaze's to resolve

## See also
- [[Phase 1 - Pipeline Engineering]] — what got built under these constraints
- [[Left To Do]] — the longer-horizon items these decisions still leave open

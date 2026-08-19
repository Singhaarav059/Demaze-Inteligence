# Demaze AI Outbound Intelligence Platform — Full Project Report

**Purpose of this file**: a self-contained summary of the whole project's history
and current state, written to be pasted into another tool (e.g. ChatGPT) for
discussion — it doesn't assume the reader has access to the codebase. It covers
everything, not just the most recent session.

---

## 1. What this project is

A **company-research and outbound-sales intelligence platform** for Demaze, a B2B
sales/services company. Given a company (by URL, name, or a batch/spreadsheet of
leads), it:

1. Finds the company's website (if not already known)
2. Scrapes and researches the company across public web sources (not just its own
   site — annual reports, investor calls, press, government filings, job postings,
   etc.)
3. Extracts evidence-backed signals: pain points, competitors, target-customer
   segments, market intelligence, "why this company is a good outreach target"
4. Finds decision-makers (named people) at the company
5. Generates personalized outreach emails, grounded in the actual evidence found
   (not generic templates)
6. Sends those emails (via Gmail), tracks opens, and automatically follows up

Target industries: Manufacturing, Automotive, Industrial, SaaS, Financial
Institutions, SMBs. Currently, the product is scoped down to **3 active target
sectors** for Demaze's own lead generation: Manufacturing, Automotive, E-commerce.

This is explicitly **not** a chatbot and **not** a generic "analyze this website"
tool — every output is meant to be directly useful to a salesperson deciding
whether/how to reach out to a specific company.

---

## 2. How the scope evolved (major decisions, in order)

The project's scope has expanded twice, deliberately and explicitly, from an
original narrow boundary:

**Original scope (locked, then partially superseded)**: Demaze's job was exactly
four steps — find website → enrich → find the pain point → AI research. Finding
*who* to contact, finding their email, writing the email, and sending it were all
explicitly out of scope — that data was assumed to arrive already attached to each
lead (e.g. from a Sales Navigator export).

**Decision A**: company-level lead discovery came into scope — i.e., "given a
target-customer profile, go find matching companies" (not just researching a
company you already have).

**Decision B (same day, a bigger reversal)**: after reviewing a competitor
product's full workflow (research → competitors → target segments → find
companies → find decision-makers → send outreach), the *entire* remaining scope
was pulled in — including finding named decision-makers and actually sending
personalized emails. This is a full reversal of the original "no contact/email
work" boundary. **LinkedIn scraping stays excluded regardless** — contact
discovery goes through a licensed people-data API, never LinkedIn scraping or
automation.

This scope now defines a 9-item roadmap, of which items 1-7 are complete
(Competitor Discovery, Target-Segment/ICP Generator, Company Discovery Engine,
Research Quality Framework, Research Evaluation Framework, Market Intelligence
Layer, Outreach Intelligence Layer) and items 8-9 (Decision-maker discovery,
Outreach send) are also now built (see below) — they were originally flagged as
needing a vendor decision first, which has since been made.

---

## 3. Current pipeline architecture

```
Company identity (URL, name, or a batch export)
  → Website discovery (only runs if no URL is given — confirms identity via
    real page-content matching, refuses to guess when ambiguous)
  → Scraper (multi-tier fallback: primary scraping service → free JS-rendering
    fallback → search fallback → direct HTTP fetch)
  → Multi-source enrichment, running in PARALLEL with the scrape (not a
    fallback for it) — investor relations, annual reports, press releases,
    CEO interviews, government filings (SEC EDGAR, US-only), PDFs
  → Company profile classification (industry/business-model type)
  → Signal extraction (evidence-tagged: "observed" from a real quote vs.
    "inferred" reasoning)
  → Deterministic opportunity engine (matches evidence against Demaze's own
    8 real service lines) + a second, LLM-grounded path for opportunities
    the deterministic engine misses (every claim must cite a real, verified
    quote, or be honestly labeled as inference, never fabricated)
  → Competitor discovery (3-tier: ask the AI directly what it confidently
    knows → search + AI synthesis of real search results → regex-based
    search extraction, in that fallback order)
  → Target-customer-segment discovery (same 3-tier pattern)
  → Market intelligence (industry trends/growth, source-attributed)
  → Sector-playbook qualification scorecard (sector fit / company fit /
    opportunity evidence / contactability / overall — for the 3 active
    sectors: Manufacturing, Automotive, E-commerce)
  → Decision-maker discovery (named people, via a licensed people-data API)
  → Email generation (subject lines → email body → follow-up sequence),
    grounded only in facts already established above — an explicit
    anti-hallucination rule
  → Send (Gmail), open tracking (invisible pixel), automatic follow-ups if
    unopened past a set cadence
  → Validation gate: PASS / WARN / PARTIAL — the pipeline is designed to
    NEVER hard-fail; a company with poor evidence gets an honest "insufficient
    evidence" result, never a forced/fabricated one
```

A recurring design principle throughout: **prefer under-confidence over a wrong
guess.** Many subsystems explicitly refuse to produce an answer rather than
produce a plausible-but-wrong one (e.g. website discovery returns "ambiguous"
rather than picking between two similarly-named companies; the AI-knowledge
competitor-discovery path is instructed to say "I don't know" rather than
invent a plausible-sounding competitor).

---

## 4. Major subsystems, and what's real vs. simulated

| Subsystem | Status |
|---|---|
| Core research pipeline (scrape → evidence → opportunities) | **Live**, extensively iterated on and bug-fixed |
| Competitor Discovery / Target-Segment Discovery / Company Discovery | **Live**, 3-tier fallback (AI knowledge → AI+search synthesis → regex extraction), live-verified |
| Market Intelligence | **Live**, live-verified |
| Decision-maker discovery | **Live**, real vendor (Prospeo), live-verified |
| Email finding / validation / enrichment | **Code-complete**; one vendor (Prospeo) fully live-verified, a second vendor (Apollo) added but blocked on an account-plan upgrade (see §7) |
| Email generation | **Live**, real AI calls, grounded-evidence discipline |
| Email sending | **Live** — real Gmail OAuth integration (a prior vendor, Lemlist, was tried and removed after an incident; Gmail is the current, working sender) |
| Open tracking + automatic follow-ups | **Live**, confirmed end-to-end with a real send/open/DB-write cycle. The *automatic* (no-click) follow-up engine is code-complete and its logic verified against real data, but is currently switched off pending a Gmail re-authorization (its OAuth token had expired) |
| Gmail warmup (sending-reputation building) | **Real, DIY-built** system (not a paid vendor) — uses the account owner's own Gmail accounts to send/receive warmup traffic on a schedule. Confirmed working for real sends; the "recipient reacts to the email" half is built but not yet independently re-confirmed |
| Sector playbooks (Manufacturing/Automotive/E-commerce) qualification scorecard | **Live**, explicitly marked as a "draft" data source (a placeholder pending an official document from the business side), live-verified against all 3 sectors |
| Apollo.io (a second people-data vendor) | Wired into 4 integration points; only 1 of 4 confirmed working live (company-data enrichment) — the other 3 (person lookups, company search) are blocked by the current Apollo account's plan tier, not a code problem |
| SEC EDGAR (US government company filings) | **Live**, free, no API key. India's equivalent (MCA) was explicitly **not built** — no public API exists, and the only access path is CAPTCHA-gated, which is a hard no regardless of the reason |
| Mobile app-like shell (installable PWA, bottom nav bar, etc.) | **Live**, for the internal admin tool only (not the public marketing site) |
| CI, rate limiting, structured logging, env validation | **Live**, added as a "production hardening" pass |

---

## 5. Recurring bug classes found and fixed

A pattern worth knowing about: several multi-session "audit chains" found and
fixed the *same underlying bug shape* recurring across different files, because
each fix was applied narrowly and the same root cause existed elsewhere
un-noticed. Two notable examples:

- **Non-English / accented company names silently broke identity matching.**
  JavaScript's standard "word character" regex class only understands plain
  ASCII letters — so a name like "Möller Group" or "Société Générale" would get
  mangled during internal text processing, corrupting company-identity matching,
  search-result relevance filtering, and evidence extraction. This bug shape was
  found and fixed across at least 6 different files over several sessions (the
  last of which was found during an unrelated audit, months after the "main" fix
  pass). No dedicated non-English test fixture existed to catch regressions of
  this class automatically until one was deliberately built.
- **"Silent zero" failures** — several different bugs could each independently
  cause a company to come back with zero pain points and zero opportunities with
  no visible explanation why (a scraper page-selection issue, a subject-classifier
  gap, an English-only leadership-title vocabulary, etc.). A dedicated audit and
  a debug-visibility UI panel were built specifically to make these failures loud
  and diagnosable instead of silent.

Also worth knowing: a specific adversarial-content bug was found and fixed —
an AI-search-synthesis pass once cited a real quote from a Facebook page
literally titled "[Company] SCAM" as evidence that the company's fraud
**victims** were a legitimate customer segment. The quote itself was real (so
the "is this quote genuine" check passed), but its *interpretation* was
completely wrong. A content-level filter for scam/fraud-adjacent language was
added as a result — flagged as a "first pass, not exhaustive" defense.

---

## 6. The "Master Research Optimization Plan" (a 15-phase initiative, G0–G15)

A separate, ongoing engineering initiative layered on top of the product above.
Its goal: make the research layer more evidence-first, source-traceable, cheaper
(via caching and in-house tooling instead of always calling paid vendors), and
faster (via controlled concurrency). It has its own standing rules (no new
vendors without approval, don't remove existing paid providers before
benchmarking replacements, don't weaken outbound-safety guardrails).

**Completed phases**:
- **G0** — read-only architecture audit. Found the biggest concrete bottleneck is
  outer-loop sequential processing across a batch of companies (not the
  per-company research itself, which is already fairly parallel).
- **G1** — cost/latency instrumentation. Real baseline measured: ~$0.04/company,
  ~34s/company (on a cache-heavy run, not a cold-cache worst case).
- **G2** — a real "evidence ledger": every piece of evidence gets a source-
  authority tier (first-party / regulatory / reputable third-party / weak /
  unknown), a freshness rating, and a confidence score. Includes basic
  contradiction detection between claims.
- **G3** — an in-house, plain-HTTP fetcher (reduces dependency on paid scraping
  vendors for simple fetches). Built and tested, not yet wired into the live
  pipeline.
- **G4** — an in-house HTML-to-readable-text converter, matching the existing
  scraper's output shape so it's a drop-in replacement candidate later.
- **G5** — a "smart crawler" — a policy layer (robots.txt respect, sitemap
  discovery, URL scoring, page limits, early stopping) sitting on top of G3/G4.
  Not yet wired into the live pipeline.
- **G6** — a caching layer: an in-memory page cache and an in-memory "evidence
  attribution" cache (avoids expensive quote-verification re-work within one
  research run). A separate, already-existing, already-live search-result cache
  was confirmed to already satisfy this phase's "search cache" requirement — no
  need to rebuild it.
- **G7** (this session's work — see the separate detailed section below) — a
  search-provider router.

**Remaining phases (not started)**: G8 (demote the current default scraping
vendor to a fallback, once its in-house replacement is proven), G9 (a
LinkedIn evidence adapter — explicitly restricted to only legitimate,
non-scraping access methods), G10 (a real concurrent job queue for processing
many companies at once), G11 (more internal parallelism), G12 (adaptive research
depth — do less work for easy cases, more for hard ones), G13 (a better
progress/status UI), G14 (a concurrency benchmark to find the safe worker count),
G15 (a final head-to-head comparison of the old vs. new research pipeline before
this initiative is considered "graduated" to production use).

### G7 in detail (this session)

**What it asked for**: a search router trying providers in this order — cache,
then Gemini's AI-powered search, then a secondary search vendor (Serper), then a
tertiary one (Tavily) — stopping as soon as results are judged "good enough."

**What was actually missing**: (1) Gemini (an AI model already used elsewhere in
this app) had a *native* web-search capability that was never turned on
anywhere in the codebase — it was only ever used as a plain text-generation
model; (2) no code existed anywhere that tried multiple search providers in a
stated priority order with an explicit "stop once sufficient" rule — the
existing live code only has a simple two-tier fallback with no such concept.

**What was built**:
- A new function that calls Gemini with its native Google-Search tool attached,
  returning real cited web results. This is a new *capability* on an
  already-approved vendor (Gemini), not a new external dependency.
  A known, honest limitation: unlike the other two search vendors, Gemini's
  response doesn't give a distinct text snippet per result — every result
  from one query shares the same short summary text. Downstream code needing a
  *verified quote* from a specific source still has to fetch that source
  directly.
- A new router function that tries: cache → Gemini Search → Serper → Tavily
  (deliberately the *opposite* order from the existing live search code, which
  tries Tavily first — that's not a bug, it's literally what this phase's spec
  asked for; the existing live code is untouched). "Sufficient" is a simple,
  intentionally basic rule: at least 3 usable results with at least 40
  characters of real content each — deliberately not reusing the more complex,
  post-extraction evidence-confidence system elsewhere in the app, since a
  search router is deciding whether to keep searching, not scoring an
  already-extracted claim.
- New tests (21 new test cases), a full design-decisions writeup, and an update
  to the project's persistent history file.

**Verification**: type-checking is clean, and the full automated test suite
passes (990 out of 990 tests) in the real, current state of the codebase.
**No real API calls were made** — this was built and verified with mocked
dependencies only, per instruction not to autonomously spend real, paid API
quota. A real live smoke test (confirming Gemini's search grounding actually
works under this app's specific API tier, and resolving whether it can be
combined with structured-JSON output) is the natural next step, needing an
explicit go-ahead first (this app's standing rule: real API spend always needs
human confirmation).

**Not done yet, on purpose**: this new router is not wired into any of the
app's live discovery features yet (competitor discovery, target-segment
discovery, etc. all still use the old code path) — that's planned for a later
phase, since it requires resolving the provider-ordering question and, per this
initiative's own rules, benchmarking before replacing anything currently live.

### A real complication found and handled during G7

The engineering agent that built G7 worked in an isolated, parallel copy of the
codebase (a separate "worktree," similar to a fresh git checkout on a branch).
That isolated copy was created from the project's last **git-committed** state —
but it turns out **none of G0 through G6's work has actually been committed to
git at all.** All of it exists only as *uncommitted* changes sitting in the main
working directory. (This has apparently happened before in this same initiative
— an earlier phase's own design document contains an identical warning about the
same issue.)

So the isolated worktree had the persistent instruction file (which *describes*
all of G0–G6 in prose) but literally none of the actual code files those
descriptions refer to. The agent did not fabricate or paper over this — it
documented the mismatch plainly, verified the two specific things it actually
needed by reading the real code that *was* present, and built G7 as a
self-contained module that didn't depend on any of the missing pieces. Once it
finished, I pulled its output back into the real, complete working directory
(where G0–G6 genuinely are present, just not committed) and re-verified
everything there instead — 990/990 tests, not the 922/922 the isolated worktree
saw (its lower number reflects the smaller amount of pre-existing code it could
see, not a discrepancy in G7 itself).

**Standing risk flagged as a result**: this entire 7-phase initiative — many
sessions' worth of work — currently exists only as uncommitted changes. Nothing
has been formally saved to git yet. This is a real, growing risk (uncommitted
work is much easier to lose than committed work) that's been noted more than
once across this initiative's history but not yet acted on.

---

## 7. Vendor / integration status (as of now)

| Vendor | Purpose | Status |
|---|---|---|
| A primary web-scraping service | Main website scraper | Live, default |
| Tavily / Serper | Web search | Live, default |
| Gemini (via Google Vertex AI) | Primary AI model for research/writing | Live, default. Native web-search tool now built (this session) but not yet wired in |
| Two fallback AI models | Backup if Gemini fails | Live |
| Prospeo | Decision-maker discovery, email finding, contact enrichment | Live and active |
| Apollo.io | A second vendor for the same email/contact/company-search capabilities | Code-complete for 4 integration points; only 1 confirmed working (the account is on a trial plan that blocks the other 3 endpoints) |
| SEC EDGAR | US government company-filing data | Live, free |
| India's MCA company registry | Equivalent filing data for India | **Explicitly not built** — no public API exists; the only access method is CAPTCHA-gated, which is a hard exclusion regardless of business value |
| Gmail (OAuth) | Sending outreach emails + warmup traffic | Live, real sends confirmed |
| LinkedIn | Any form of access | **Permanently excluded** — no scraping or automation of any kind, by explicit, repeated decision |

---

## 8. Standing "do not touch right now" list (as of the project's own instructions)

- No further model-quality tuning for now — architecture/evidence fixes have
  had a much larger measured impact than model swaps.
- No further ad-hoc pattern-matching/classifier tweaks beyond specific,
  validated gaps already identified.
- No LinkedIn-driven architecture decisions of any kind.
- Government-filings work beyond the US (SEC EDGAR) needs its own paid-vendor
  decision first — not a code task to pick up unilaterally.

---

## 9. Open items and questions worth a second opinion

1. **The uncommitted-work risk.** A large amount of engineering work (the
   entire G0–G7 research-optimization initiative, at minimum) has never been
   committed to git. Worth deciding: commit it all now in one or several
   commits, or continue letting it accumulate?
2. **G7's "good enough" threshold** (3 results, 40+ characters each) is a
   simple placeholder, not a tuned value — worth a second opinion on whether
   it's the right bar before it's ever wired into anything live.
3. **Provider ordering conflict.** G7's new router puts the search vendor
   Tavily last; the existing live code tries it first. Someone needs to decide
   which is actually correct (and why the original ordering was chosen) before
   wiring the new router in.
4. **Gemini Search's missing per-source snippets.** Is a "AI's own summary,
   shared across all results" search tier actually useful in a pipeline that
   otherwise places heavy emphasis on verifying an exact quoted sentence
   against a specific real source? Or should Gemini's role stay limited to a
   quick sufficiency check, with the other two vendors doing the real
   quote-level evidence gathering?
5. **Apollo's real value is currently unproven** — 3 of its 4 intended uses
   are blocked behind a paid-plan upgrade that hasn't happened yet. Worth
   deciding whether to pay for the upgrade, or whether Prospeo alone is
   sufficient and Apollo should be deprioritized.
6. **The automatic (no-click) follow-up engine is built and verified in logic,
   but currently can't actually send** because its Gmail authorization expired.
   Needs a straightforward but manual re-authorization step before it can be
   turned on for real.

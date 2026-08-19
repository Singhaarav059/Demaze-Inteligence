# Session Report — G7 (Search Router), Demaze AI Outbound Intelligence Platform

**Purpose of this file**: a self-contained summary of one work session, written to be
pasted into another tool (e.g. ChatGPT) for discussion — it doesn't assume the
reader has access to the codebase.

---

## 1. Background: what this project is

Demaze AI Outbound Intelligence Platform is a company-research pipeline for B2B
sales outreach. Given a company (URL, name, or a batch of leads), it scrapes/
searches the web, extracts evidence (pain points, opportunities, competitors,
target-customer segments, decision-makers), and generates outreach emails — with a
send pipeline (Gmail), open tracking, and automatic follow-ups.

There's a separate, currently active engineering initiative layered on top of the
existing product: a **"Master Research Optimization Plan"** (a 15-phase plan,
labeled G0 through G15) whose goal is to make the research layer more evidence-first,
cheaper, faster (via concurrency), and more resilient. Each phase (G0, G1, G2, …)
is a self-contained unit of work with its own design doc, tests, and (where
possible) a real live-API verification pass.

**Phases completed before this session**: G0 (read-only architecture audit) through
G6 (a page cache + evidence-attribution cache). Each added new, mostly standalone
modules (a plain-HTTP fetcher, an HTML-to-markdown extractor, a crawl-policy layer,
a cache layer) without wiring them into the live production pipeline yet — that
wiring is planned for later phases (G8 specifically).

**Standing rules for this whole initiative** (from the plan document itself):
- No Apollo (a people-data vendor) — out of scope for this initiative.
- No LinkedIn scraping or bypass of its access controls.
- Don't weaken existing outbound-safety guardrails (e.g. requiring explicit
  confirmation before real sends).
- Don't introduce new vendors without explicit approval.
- Don't remove existing search/scrape vendors (Firecrawl, Tavily, Serper) before
  benchmarking their replacements.
- Don't force a "confident" output when the underlying evidence is weak.

---

## 2. What was asked this session

"Start G7 in a new tab" — i.e., begin the next phase of the plan (G7, "Search
router") as an isolated, parallel unit of work.

**G7's literal spec** (from the plan document, which is terse by design — each
phase gets fleshed out into a real design when it's actually worked):

> Implement a search router with priority: `cache → Gemini Search → Serper →
> Tavily`. Stop [trying more providers] once evidence is sufficient.

Two real gaps this closes, identified from the G0 audit:
1. **Gemini has no web-search capability wired in anywhere in this codebase.**
   Gemini (Google's AI model, already used elsewhere in this app for text
   generation) has a *native* "Google Search grounding" tool it can be given
   access to, but the existing integration never attaches it — Gemini is used
   purely as a text-completion model today, with zero web access of its own.
2. **No unified "try these search providers in priority order, stop when you have
   enough" router exists.** The current live search code (used by every
   discovery module in the app — competitor discovery, target-segment discovery,
   market-intelligence discovery, etc.) has only a two-tier fallback (try Tavily,
   fall back to Serper only if Tavily returns literally zero results) — no
   concept of "good enough," no Gemini tier at all.

---

## 3. How it was executed

I delegated the implementation to a background coding agent running in an
**isolated git worktree** — a separate, parallel checkout of the repository so it
could work without touching the main session's files, similar to opening a new
tab/window on a fresh copy of the code.

### A real complication the agent found and handled correctly

The agent's isolated worktree was branched from the repository's last **committed**
state. But it turns out **none of G0 through G6's work has ever actually been
committed to git** — all of it exists only as *uncommitted* changes sitting in the
main working directory (this has apparently been a recurring pattern across this
initiative — a prior phase's own design doc contains an identical warning about
the same issue).

So the agent's fresh worktree had:
- No `demaze_master_research_optimization_plan.md` (the plan document itself)
- None of the G0–G6 code modules (evidence ledger, page cache, HTML extractor, etc.)
- A CLAUDE.md (the project's persistent instruction file) that *described* all
  that work in prose, but none of the actual code

The agent did not fabricate results or silently paper over this. It:
1. Documented the discrepancy plainly, in its own design doc, before writing any code.
2. Verified the two things G7 actually needed by reading the *real, present* code
   directly (confirming Gemini has no search tool wired in, and confirming the
   existing search fallback has no "sufficiency" concept) rather than trusting the
   stale instructions it was given.
3. Built G7 as a new, self-contained, additive module against what was actually
   there — not wired into anything live, so it couldn't have broken the existing
   (also-uncommitted) G0–G6 work even if there'd been a mismatch.

Once the agent finished, I:
- Pulled its two new source files (plus tests and its design doc) back into the
  **actual** main working directory — the one that *does* have all of G0–G6's
  uncommitted work present.
- Corrected its design doc's opening section, since the "G0–G6 doesn't exist" framing
  was only true inside its isolated worktree — in the real working tree, that work is
  present, just not yet committed to git.
- Re-ran the full type-check and test suite against the *real* codebase state (with
  G0–G6 actually present) to confirm the new code integrates cleanly — this
  hadn't been possible inside the agent's own isolated worktree, since it never had
  G0–G6 to check against.

---

## 4. What was actually built

### `lib/ai/providers/vertex-gemini-search.ts` — Gemini Search grounding

A new function, `searchWithGeminiGrounding(query, apiKey, maxResults)`, that calls
Gemini with its native Google Search grounding tool attached
(`tools: [{ googleSearch: {} }]`). This lets Gemini search the live web and return
real, cited source URLs — a capability that existed in Google's API but was never
turned on anywhere in this codebase.

Notes:
- This is **not a new third-party vendor** — Gemini (via Google's Vertex AI) is
  already an approved, actively-used AI provider in this app. This is a new
  *capability* on that same already-approved vendor, not a new external
  dependency. (Flagged explicitly, since the plan's standing rules require
  approval for genuinely new vendors.)
- **A real, honest limitation**: unlike the existing Tavily/Serper search
  providers, Gemini's grounding response gives a source URL + title per result,
  but *not* a distinct snippet of quoted text per source — every result from one
  query shares the same "content" field (the model's own synthesized answer,
  capped at 300 characters). Anything downstream that needs a *verified quote*
  from a specific source still has to fetch and check that source's real content
  directly.
- Results are cached in-memory only (not in the app's durable database) — the
  existing database table for search-result caching has a hard constraint that
  only allows `'tavily'` or `'serper'` as the source, and widening that for a
  capability with zero live callers yet would be a premature schema change.
  Flagged as a "when this actually goes live" follow-up.

### `lib/enrichment/search-router.ts` — the router itself

A new function, `routedSearch(query, options)`, that tries search sources **in
this priority order**: cache → Gemini Search → Serper → Tavily — stopping at the
first one whose results are judged "sufficient," and skipping any tier whose API
key isn't configured.

Key design decisions:
- **Cache is checked before every live tier, not folded into one of them.** A
  cache hit means real evidence already exists for this exact query, regardless
  of which vendor originally produced it — re-fetching live just to respect tier
  order would waste a paid API call for something already on hand.
- **Tavily is deliberately last** — this is the *opposite* of the existing live
  search code's order (which tries Tavily first today). That's not a bug; it's
  literally what the G7 spec asks for. The existing live code was **not
  changed** this session — this new router is a separate, standalone module. A
  future phase has to explicitly decide whether/how to point the existing code
  at this new router, including resolving that ordering conflict.
- **"Sufficient" is a simple, pure function**: at least 3 results, each with at
  least 40 real characters of content (to exclude near-empty junk results). This
  was a deliberate choice *not* to reuse a more complex, existing "evidence
  confidence" scoring system elsewhere in the app — that system scores
  already-extracted *claims* (e.g. "this company has 6 factories") for
  trustworthiness; a search router has no claim yet to score, it's just deciding
  whether to keep searching. Reusing the wrong tool for this would have been
  forcing a fit.
- If nothing clears the "sufficient" bar, it returns the largest result set seen
  across whichever tiers it tried, rather than a hard empty result — same
  graceful-degradation principle used elsewhere in the codebase.

### Documentation

- `docs/search-router-design.md` — a full design writeup (this codebase's
  convention: every phase gets one).
- A new dated entry appended to `CLAUDE.md` (this project's persistent
  instruction/history file), matching the existing narrative style of every prior
  phase's entry.

---

## 5. Verification

- `tsc --noEmit` (TypeScript type-check): clean, both in the agent's isolated
  worktree and, after I merged the files back, in the real working tree.
- Automated test suite: **990/990 tests passing** in the real working tree (the
  agent's own isolated worktree — missing all of G0–G6 — only had 922 tests to
  run against; 990 is the real, full count with everything present).
- **No real API calls were made this session** — no live Gemini Search-grounding
  call, no live Tavily/Serper call through the new router. This was a deliberate
  choice: the background agent was explicitly told not to autonomously spend
  real, paid API quota. That's flagged as the natural next step for whoever picks
  this up, requiring an explicit go-ahead first (this app's standing policy:
  real API spend always needs a human confirmation, not something done
  silently).

---

## 6. What's explicitly deferred (not done, and why)

1. **No live verification yet.** In particular, it's not yet confirmed whether
   Gemini's Search grounding tool actually returns results under the specific
   "Express Mode" API tier this app uses (some of Google's API surfaces gate
   this feature behind a fuller, billing-enabled project setup — unconfirmed
   either way), or whether Gemini's structured-JSON-output mode and Search
   grounding can be used together in one call.
2. **Not wired into the live pipeline.** None of the app's 5-6 real discovery
   features (competitor discovery, target-segment discovery, etc.) have been
   pointed at this new router yet — it exists as a new, tested, but currently
   unused module. Wiring it in is planned for a later phase (G8), since it
   requires resolving the Tavily-ordering conflict and (per the plan's own
   discipline) benchmarking before replacing anything currently live.
3. **Gemini's search results aren't durably cached** (only in-memory, lost on
   server restart) — deferred until there's a real, live caller that needs that
   durability.
4. **Nothing from this entire initiative (G0 through G7) has been committed to
   git yet.** All of it — many sessions' worth of work — exists only as
   uncommitted changes sitting in the working directory. This is a real,
   standing risk (uncommitted work can be lost far more easily than committed
   work) that's been flagged repeatedly across this initiative's history but not
   yet acted on.

---

## 7. Open questions worth discussing

- **Should all of G0–G7 be committed to git now**, in one or several commits,
  before continuing to G8? Given how much uncommitted work has accumulated, this
  seems increasingly urgent from a "don't lose work" standpoint.
- **Is the "stop when sufficient" heuristic (≥3 results, ≥40 chars each) the
  right bar?** It was chosen as a deliberately simple, defensible placeholder —
  worth a second opinion on whether it's too permissive or too strict for real
  search-quality decisions.
- **Is Tavily-last really the right order**, or was that just what the plan's
  shorthand said without deeper justification? The existing live code deliberately
  tries Tavily first today — worth understanding why that choice was made
  originally before reordering it for real.
- **Value of Gemini Search grounding vs. its limitation** (no per-source quote,
  just a shared synthesized-answer blurb) — is this actually useful for a
  pipeline that elsewhere places heavy emphasis on being able to verify a
  specific quoted sentence against a specific real source? Worth discussing
  whether Gemini's role here should stay "quick sufficiency check" only, with
  Tavily/Serper still doing the real quote-level evidence gathering.

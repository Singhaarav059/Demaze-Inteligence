<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:4F46E5,100:8B5CF6&height=200&section=header&text=Demaze%20Intelligence%20Platform&fontSize=40&fontColor=ffffff&animation=fadeIn&fontAlignY=35&desc=AI-Powered%20Company%20Research%20%26%20Outbound%20Intelligence%20Engine&descAlignY=55&descSize=18" width="100%"/>

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&size=20&pause=1000&color=8B5CF6&center=true&vCenter=true&width=700&lines=Research+any+company+in+minutes%2C+not+hours;Competitor+%2B+ICP+%2B+Market+Intelligence%2C+auto-discovered;Evidence-grounded+outreach%2C+never+fabricated;Built+for+Demaze+Technologies%27+outbound+team" alt="Typing SVG" />

<br/>

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149ECA?style=for-the-badge&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Vitest](https://img.shields.io/badge/tests-355%20passing-22C55E?style=for-the-badge&logo=vitest&logoColor=white)](#testing)
[![Status](https://img.shields.io/badge/status-internal%20tool-8B5CF6?style=for-the-badge)](#)

</div>

---

## What this is

A **company intelligence engine** for Demaze Technologies' outbound sales team — not a generic website analyzer, and not a chatbot. Give it a company (a URL, a name, or a bulk lead list) and it produces a sales-ready research brief: what the company does, its real operational pain points, evidence-backed AI opportunities, competitors, target-customer segments, market signals, and a drafted outreach sequence grounded in Demaze's own real delivered work — never an invented stat or fabricated case study.

Every claim in a report traces back to something real: a scraped page, a search result, or Demaze's own proof-point library. When the evidence isn't there, the report says so instead of guessing.

## Features

**Research pipeline**
- Multi-tier scraping (Firecrawl → Jina Reader → Tavily → direct fetch) with PDF ingestion for annual reports and investor decks
- Parallel enrichment: discovery, evidence extraction, and business-model classification run alongside the scrape, not after it
- Signal-driven, evidence-gated opportunity generation — no "Digital Transformation" boilerplate for companies with no real signal

**Discovery engine (Phase 2 — AutoGTM loop)**
- **Competitor Discovery** — search-grounded, confidence-tiered, never invented from the model's own training knowledge
- **ICP Generator** — surfaces who a researched company actually sells to, with evidence
- **Company Discovery** — given an ICP segment, finds new candidate leads, filtered for both relevance *and* realistic company-size fit
- **Market Intelligence** — growth indicators, challenges, and shifts, always source-attributed

**Outreach drafting**
- Connection notes, first messages, and follow-ups written in Demaze's real, reply-tested voice
- Every proof point cited is cross-checked against Demaze's actual case-study library — a drafted message can't cite a stat or client that doesn't exist in the real data

**Research quality & evaluation**
- Per-item confidence auditing that flags when a stated confidence isn't backed by its own evidence
- Offline 0–100 evaluation scoring for benchmarking across runs, with historical regression tracking

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4, `@base-ui/react` primitives |
| Motion | Framer Motion |
| Data | Supabase (Postgres) |
| Search / scrape | Firecrawl, Tavily, Serper, Jina Reader |
| LLM | NVIDIA NIM / OpenRouter (provider-agnostic) |
| Testing | Vitest |

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in the keys below
npm run dev
```

Open [http://localhost:3000/admin/intelligence-lab](http://localhost:3000/admin/intelligence-lab) to start researching a company.

### Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Run history, saved research |
| `FIRECRAWL_API_KEY` | Primary scraper |
| `TAVILY_API_KEY` / `SERPER_API_KEY` | Search-grounded discovery + enrichment |
| `NVIDIA_NIM_API_KEY` / `NVIDIA_NIM_MODEL` or `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | LLM provider (either works) |
| `ADMIN_SECRET` | Admin route auth |

## Testing

```bash
npx tsc --noEmit   # typecheck
npx vitest run     # 355 assertions across the pipeline, discovery modules, and exporters
```

## Project structure

```
app/admin/            Internal SDR tool — Research, Discover, History
app/api/admin/         Pipeline + discovery API routes
lib/pipeline/           Scraper → extractor → normalizer → scorer
lib/enrichment/          Competitor / ICP / Company Discovery, Market Intelligence
lib/knowledge/           Demaze's real proof-point library + matcher
lib/prompts/             LLM prompt construction (research + narration)
components/              Shared UI (shadcn/base-ui) + admin shell
tests/                   Vitest suite
```

---

<div align="center">
<sub>Internal tool for Demaze Technologies. Not for public/customer-facing use.</sub>
</div>

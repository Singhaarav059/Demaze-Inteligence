-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 012 — Search Query Cache (Tavily/Serper)
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- Every one of the pipeline's discovery modules (Enrichment Discovery,
-- Competitor Discovery, ICP Generator, Market Intelligence, Website
-- Discovery, Company Discovery) funnels through searchTavily()/searchSerper()
-- in lib/enrichment/discovery-engine.ts. None of them cached results before
-- this migration, so a single company could fire the same query fresh on
-- every re-run (batch retries, reprocessing, repeat single-company research)
-- at $0.008/query (Tavily) even when nothing about the company changed.
--
-- Cache key is (provider, query, max_results) — the exact inputs to
-- searchTavily()/searchSerper(). Same pattern and TTL discipline as
-- company_scrape_cache (migration 003), just keyed on a search query
-- instead of a URL. 30-day TTL (vs. the scrape cache's 24h) — company
-- research search results (competitors, ICP segments, market trends) are
-- far less volatile day-to-day than a live page scrape, and staying fresh
-- for scrapes matters more since that's the primary evidence source.
-- ============================================================

CREATE TABLE IF NOT EXISTS search_query_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      TEXT NOT NULL CHECK (provider IN ('tavily', 'serper')),
  query         TEXT NOT NULL,
  max_results   INTEGER NOT NULL,

  -- Raw results array as returned by searchTavily()/searchSerper() —
  -- { title, url, content }[], stored as-is so callers need zero
  -- transformation on a cache hit.
  results       JSONB NOT NULL,

  cached_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cache key lookup (provider + exact query text + result count)
CREATE UNIQUE INDEX IF NOT EXISTS idx_search_cache_key
  ON search_query_cache (provider, query, max_results);

-- Useful for cache management / pruning old entries
CREATE INDEX IF NOT EXISTS idx_search_cache_cached_at
  ON search_query_cache (cached_at DESC);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'search_query_cache';

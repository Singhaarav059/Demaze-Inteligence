-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 003 — Company Scrape Cache
-- ============================================================
-- Caches Firecrawl scrape results per URL for 24 hours.
-- Both test-scraper and test-analysis check this table before
-- making a live Firecrawl request, saving credits and time.
-- ============================================================

CREATE TABLE IF NOT EXISTS company_scrape_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url             TEXT NOT NULL UNIQUE,   -- normalized URL (used as cache key)
  domain          TEXT,

  -- Full scrape output — stored as JSONB so the API can return it as-is
  scrape_result   JSONB NOT NULL,

  -- Quality summary (denormalized for quick reads without unpacking JSONB)
  quality_score   INTEGER DEFAULT 0,
  quality_note    TEXT,
  pages_scraped   INTEGER DEFAULT 0,

  -- When the cache entry was created / last refreshed
  scraped_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by URL (the primary access pattern)
CREATE INDEX IF NOT EXISTS idx_scrape_cache_url
  ON company_scrape_cache (url);

-- Useful for cache management / pruning old entries
CREATE INDEX IF NOT EXISTS idx_scrape_cache_scraped_at
  ON company_scrape_cache (scraped_at DESC);

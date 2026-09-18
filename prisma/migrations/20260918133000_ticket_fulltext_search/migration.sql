-- Full-text search for tickets.
--
-- `title ILIKE '%term%'` cannot use an index, so every search was a sequential
-- scan and had no notion of relevance. A stored generated column keeps the
-- vector in step with the row automatically — no trigger to forget, no
-- application code that can skip it.
--
-- Weighting matters: a term in the title should outrank the same term buried in
-- a description, which is exactly what ts_rank uses these labels for.
ALTER TABLE "tickets"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')),       'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("remarks", '')),     'C')
  ) STORED;

CREATE INDEX "tickets_search_idx" ON "tickets" USING GIN ("searchVector");

-- Trigram index on the human key, so "ATLAS-1" still prefix-matches quickly.
-- tsvector tokenises that as one lexeme and cannot serve a partial key.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "tickets_key_trgm_idx" ON "tickets" USING GIN ("key" gin_trgm_ops);

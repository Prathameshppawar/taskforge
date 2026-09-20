-- Semantic similarity for tickets.
--
-- Lexical search cannot connect "users cannot sign in" to "login redirect
-- broken": they share no words, so duplicate detection scored them at zero and
-- happily created the duplicate. A sentence embedding puts them at 0.67.
--
-- Stored as real[] rather than a pgvector column on purpose. pgvector is not
-- present in a stock Postgres image, so requiring it would break CI and anyone
-- cloning this repository, for an index that only earns its keep well past the
-- scale this scoring runs at — similarity is always evaluated inside a single
-- project. `docs/ROADMAP.md` records when that trade stops being right.
ALTER TABLE "tickets" ADD COLUMN "embedding" real[];

-- md5 of the exact text that produced the embedding. A sweep compares it with
-- the current title and description, so a row cannot silently keep a stale
-- vector and no write path has to remember to invalidate anything.
ALTER TABLE "tickets" ADD COLUMN "embeddingHash" TEXT;

-- Finds work for the sweep: rows never embedded, or embedded from text that has
-- since changed. Partial, because the answer is usually "none".
CREATE INDEX "tickets_embedding_pending_idx"
  ON "tickets" ("projectId")
  WHERE "embedding" IS NULL;

-- Where a model price came from, so a refresh from the public catalogue never
-- overwrites a price a person set.
ALTER TABLE "ai_model_prices" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';

-- The seeded Anthropic rows are list prices, and a 0/0 row is a price nobody
-- has set yet (the engine form saved blanks as zero): both may be refreshed.
UPDATE "ai_model_prices" SET "source" = 'auto'
WHERE "provider" = 'anthropic' OR ("inputPerMTok" = 0 AND "outputPerMTok" = 0);

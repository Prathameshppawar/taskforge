-- Billing plans per engine, and the list-price cost of every call beside what
-- was actually paid.
ALTER TABLE "ai_engine_settings" ADD COLUMN "billingPlan" TEXT NOT NULL DEFAULT 'list';
ALTER TABLE "ai_usage_events" ADD COLUMN "listCostMicros" BIGINT NOT NULL DEFAULT 0;

-- A model keeps its list price and, separately, the rate this workspace pays.
-- A price someone typed before this migration was their rate, so it moves
-- there; the list price is then refreshed from the catalogue.
ALTER TABLE "ai_model_prices"
  ADD COLUMN "customInputPerMTok" DECIMAL(10,4),
  ADD COLUMN "customOutputPerMTok" DECIMAL(10,4);
UPDATE "ai_model_prices"
SET "customInputPerMTok" = "inputPerMTok", "customOutputPerMTok" = "outputPerMTok"
WHERE "source" = 'manual';

-- Calls recorded before a model had a price have a list cost of 0. Estimate
-- it from today's list price, so "at list price" and the month's projection
-- cover the history too. Only fills zeros: never rewrites a recorded figure.
UPDATE "ai_usage_events" e
SET "listCostMicros" = round(e."inputTokens" * p."inputPerMTok" + e."outputTokens" * p."outputPerMTok")::bigint
FROM "ai_model_prices" p
WHERE p."provider" = e."provider" AND p."model" = e."model" AND e."listCostMicros" = 0;

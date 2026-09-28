-- AI engine settings, the usage ledger, budgets, and report subscriptions.
--
-- Hand-written from the generated diff, keeping only the additive half; the
-- usual proposals to drop the search indexes and rewrite the embedding column
-- are left out.

-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('COPILOT', 'AI_FIX', 'CAPTURE', 'FILTER', 'WEEKLY_UPDATE');

-- CreateEnum
CREATE TYPE "AiBudgetScope" AS ENUM ('WORKSPACE', 'PROJECT', 'PROVIDER');

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('AI_USAGE_WEEKLY', 'AI_BUDGET_ALERT');

-- CreateTable
CREATE TABLE "ai_engine_settings" (
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKeyEnc" TEXT,
    "keyHint" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_engine_settings_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "ai_workspace_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "copilotProvider" TEXT,
    "fixProvider" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_workspace_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_prices" (
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputPerMTok" DECIMAL(10,4) NOT NULL,
    "outputPerMTok" DECIMAL(10,4) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_model_prices_pkey" PRIMARY KEY ("provider","model")
);

-- CreateTable
CREATE TABLE "ai_usage_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "userId" TEXT,
    "projectId" TEXT,
    "ticketKey" TEXT,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costMicros" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_budgets" (
    "id" TEXT NOT NULL,
    "scope" "AiBudgetScope" NOT NULL,
    "projectId" TEXT,
    "provider" TEXT,
    "monthlyLimitUsd" DECIMAL(10,2) NOT NULL,
    "hardStop" BOOLEAN NOT NULL DEFAULT false,
    "lastAlert" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_subscriptions" (
    "id" TEXT NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_events_createdAt_idx" ON "ai_usage_events"("createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_events_projectId_createdAt_idx" ON "ai_usage_events"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_events_userId_createdAt_idx" ON "ai_usage_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_events_provider_createdAt_idx" ON "ai_usage_events"("provider", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_budgets_scope_projectId_provider_key" ON "ai_budgets"("scope", "projectId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "report_subscriptions_kind_userId_key" ON "report_subscriptions"("kind", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "report_subscriptions_kind_teamId_key" ON "report_subscriptions"("kind", "teamId");

-- AddForeignKey
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_budgets" ADD CONSTRAINT "ai_budgets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_subscriptions" ADD CONSTRAINT "report_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_subscriptions" ADD CONSTRAINT "report_subscriptions_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_subscriptions" ADD CONSTRAINT "report_subscriptions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- List prices, per million tokens, so spend reads in dollars from day one.
-- Anthropic's are its published rates. OpenAI and Groq change often enough
-- that guessing would be worse than a visible zero; set them on the AI page.
INSERT INTO "ai_model_prices" ("provider", "model", "inputPerMTok", "outputPerMTok", "updatedAt") VALUES
  ('anthropic', 'claude-fable-5-1', 10, 50, CURRENT_TIMESTAMP),
  ('anthropic', 'claude-opus-5-5',   4, 20, CURRENT_TIMESTAMP),
  ('anthropic', 'claude-opus-5',     5, 25, CURRENT_TIMESTAMP),
  ('anthropic', 'claude-opus-4-8',   5, 25, CURRENT_TIMESTAMP),
  ('anthropic', 'claude-sonnet-5',   2, 10, CURRENT_TIMESTAMP),
  ('anthropic', 'claude-haiku-4-5',  1,  5, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permission")
SELECT r.id, 'ai:manage' FROM "roles" r WHERE r.key = 'ADMIN'
ON CONFLICT DO NOTHING;

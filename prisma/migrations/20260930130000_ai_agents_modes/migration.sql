-- AI agents as workspace members, AI run modes (plan first, heal CI), and the
-- per-project auto-heal switch. Hand-written; the usual proposals to drop the
-- search indexes and rewrite the embedding column are left out.

CREATE TYPE "AiFixMode" AS ENUM ('FIX', 'PLAN', 'HEAL_CI');

ALTER TABLE "ai_fix_runs"
  ADD COLUMN "mode" "AiFixMode" NOT NULL DEFAULT 'FIX',
  ADD COLUMN "planRunId" TEXT,
  ADD COLUMN "targetPrNumber" INTEGER;

ALTER TABLE "project_settings" ADD COLUMN "aiAutoHeal" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "users" ADD COLUMN "isAgent" BOOLEAN NOT NULL DEFAULT false;

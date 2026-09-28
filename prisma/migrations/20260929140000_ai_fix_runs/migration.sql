-- "Fix with AI" runs, and the permission that allows starting one.
--
-- Hand-written from the generated diff, keeping only the additive half; the
-- usual proposals to drop the search indexes and rewrite the embedding column
-- are left out.

-- CreateEnum
CREATE TYPE "AiFixStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'NO_CHANGES', 'FAILED');

-- CreateTable
CREATE TABLE "ai_fix_runs" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "requestedById" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "instructions" TEXT,
    "status" "AiFixStatus" NOT NULL DEFAULT 'QUEUED',
    "branch" TEXT,
    "prNumber" INTEGER,
    "prUrl" TEXT,
    "summary" TEXT,
    "error" TEXT,
    "changedFiles" TEXT,
    "transcript" TEXT,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_fix_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_fix_runs_ticketId_createdAt_idx" ON "ai_fix_runs"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_fix_runs_status_idx" ON "ai_fix_runs"("status");

-- AddForeignKey
ALTER TABLE "ai_fix_runs" ADD CONSTRAINT "ai_fix_runs_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_fix_runs" ADD CONSTRAINT "ai_fix_runs_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "github_repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_fix_runs" ADD CONSTRAINT "ai_fix_runs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Admin only. Every run spends money and writes to a repository, so any other
-- role gets it by an administrator's deliberate choice.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT r.id, 'ai:code' FROM "roles" r WHERE r.key = 'ADMIN'
ON CONFLICT DO NOTHING;

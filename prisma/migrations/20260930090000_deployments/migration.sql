-- Deployments reported to GitHub, and which tickets each one shipped.
-- Additive half of the generated diff only, as ever.

-- CreateEnum
CREATE TYPE "DeploymentState" AS ENUM ('PENDING', 'QUEUED', 'IN_PROGRESS', 'SUCCESS', 'FAILURE', 'ERROR', 'INACTIVE');

-- AlterTable
ALTER TABLE "ticket_git_refs" ADD COLUMN     "mergeCommitSha" TEXT;

-- CreateTable
CREATE TABLE "deployments" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "githubId" BIGINT NOT NULL,
    "environment" TEXT NOT NULL,
    "isProduction" BOOLEAN NOT NULL DEFAULT false,
    "state" "DeploymentState" NOT NULL DEFAULT 'PENDING',
    "url" TEXT,
    "logUrl" TEXT,
    "sha" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "creatorLogin" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_deployments" (
    "ticketId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_deployments_pkey" PRIMARY KEY ("ticketId","deploymentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "deployments_githubId_key" ON "deployments"("githubId");

-- CreateIndex
CREATE INDEX "deployments_repoId_sha_idx" ON "deployments"("repoId", "sha");

-- CreateIndex
CREATE INDEX "deployments_repoId_isProduction_state_createdAt_idx" ON "deployments"("repoId", "isProduction", "state", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_deployments_deploymentId_idx" ON "ticket_deployments"("deploymentId");

-- CreateIndex
CREATE INDEX "ticket_git_refs_repoId_mergeCommitSha_idx" ON "ticket_git_refs"("repoId", "mergeCommitSha");

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "github_repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_deployments" ADD CONSTRAINT "ticket_deployments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_deployments" ADD CONSTRAINT "ticket_deployments_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

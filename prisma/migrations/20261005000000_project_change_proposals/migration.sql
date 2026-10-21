-- Project documents beyond the handbook, and change proposals: a change to a
-- project's details or documents that an agent (or a person) proposes and a
-- project manager approves before it applies.
--
-- Named documents need no schema change: `project_documents.kind` already
-- identifies the document, and now holds a slug (`architecture`) as well as
-- HANDBOOK. This migration adds the proposals table, two notification types
-- and a link on notifications (a proposal is not a ticket), and grants the new
-- `proposal:create` permission to the roles that can already write tickets.
--
-- Written from `prisma migrate diff` between the previous and the new schema,
-- so nothing here touches the raw-SQL search objects or embedding columns.
-- Every statement is additive and safe on existing data.

-- CreateEnum
CREATE TYPE "ProposalKind" AS ENUM ('PROJECT_DETAILS', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- AlterEnum. Postgres 12+ allows ADD VALUE in a transaction as long as the new
-- values are not used in it, and nothing below uses them.
ALTER TYPE "NotificationType" ADD VALUE 'PROPOSAL_PENDING';
ALTER TYPE "NotificationType" ADD VALUE 'PROPOSAL_REVIEWED';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "link" TEXT;

-- CreateTable
CREATE TABLE "project_change_proposals" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "ProposalKind" NOT NULL,
    "documentKey" TEXT,
    "payload" JSONB NOT NULL,
    "summary" TEXT,
    "rationale" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "baseVersion" INTEGER,
    "baseValues" JSONB,
    "proposedById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "appliedVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_change_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_change_proposals_projectId_status_createdAt_idx" ON "project_change_proposals"("projectId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "project_change_proposals" ADD CONSTRAINT "project_change_proposals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_change_proposals" ADD CONSTRAINT "project_change_proposals_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_change_proposals" ADD CONSTRAINT "project_change_proposals_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Proposing is a contribution, like filing a ticket: the three built-in roles
-- that write tickets may propose. Clients may not. Custom roles get it from an
-- administrator, like any other permission.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT r.id, 'proposal:create' FROM "roles" r WHERE r.key IN ('ADMIN', 'PROJECT_MANAGER', 'USER')
ON CONFLICT DO NOTHING;

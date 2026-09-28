-- GitHub integration, and a semantic kind for ticket types.
--
-- Hand-written from the generated diff, keeping only the additive half. As on
-- every migration since full-text search, Prisma also proposed dropping
-- "tickets_search_idx" and "tickets_key_trgm_idx" and rewriting the
-- Unsupported() embedding column; all three are left out.

-- CreateEnum
CREATE TYPE "TicketKind" AS ENUM ('TASK', 'FEATURE', 'ENHANCEMENT', 'BUG', 'PRODUCTION', 'DEPLOYMENT', 'RESEARCH');

-- CreateEnum
CREATE TYPE "GitRefKind" AS ENUM ('BRANCH', 'PULL_REQUEST', 'COMMIT');

-- CreateEnum
CREATE TYPE "GitRefState" AS ENUM ('OPEN', 'DRAFT', 'MERGED', 'CLOSED');

-- CreateEnum
CREATE TYPE "GitCheckState" AS ENUM ('PENDING', 'SUCCESS', 'FAILURE');

-- AlterEnum
ALTER TYPE "ActivityEntity" ADD VALUE 'INTEGRATION';

-- AlterTable
ALTER TABLE "project_settings" ADD COLUMN     "githubAutomation" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "template_ticket_types" ADD COLUMN     "kind" "TicketKind" NOT NULL DEFAULT 'TASK';

-- AlterTable
ALTER TABLE "ticket_types" ADD COLUMN     "kind" "TicketKind" NOT NULL DEFAULT 'TASK';

-- CreateTable
CREATE TABLE "github_apps" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "appId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerLogin" TEXT NOT NULL,
    "htmlUrl" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretEnc" TEXT NOT NULL,
    "privateKeyEnc" TEXT NOT NULL,
    "webhookSecretEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_installations" (
    "id" TEXT NOT NULL,
    "installationId" BIGINT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "repositorySelection" TEXT NOT NULL,
    "suspendedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_repos" (
    "id" TEXT NOT NULL,
    "githubId" BIGINT NOT NULL,
    "installationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerLogin" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "htmlUrl" TEXT NOT NULL,
    "description" TEXT,
    "isAccessible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_repos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_repos" (
    "projectId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_repos_pkey" PRIMARY KEY ("projectId","repoId")
);

-- CreateTable
CREATE TABLE "ticket_git_refs" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "kind" "GitRefKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "state" "GitRefState",
    "checkState" "GitCheckState",
    "authorLogin" TEXT,
    "headSha" TEXT,
    "headBranch" TEXT,
    "mergedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_git_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_apps_appId_key" ON "github_apps"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "github_installations_installationId_key" ON "github_installations"("installationId");

-- CreateIndex
CREATE UNIQUE INDEX "github_repos_githubId_key" ON "github_repos"("githubId");

-- CreateIndex
CREATE INDEX "github_repos_installationId_idx" ON "github_repos"("installationId");

-- CreateIndex
CREATE INDEX "github_repos_fullName_idx" ON "github_repos"("fullName");

-- CreateIndex
CREATE INDEX "project_repos_repoId_idx" ON "project_repos"("repoId");

-- CreateIndex
CREATE INDEX "ticket_git_refs_repoId_kind_externalId_idx" ON "ticket_git_refs"("repoId", "kind", "externalId");

-- CreateIndex
CREATE INDEX "ticket_git_refs_repoId_headSha_idx" ON "ticket_git_refs"("repoId", "headSha");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_git_refs_ticketId_repoId_kind_externalId_key" ON "ticket_git_refs"("ticketId", "repoId", "kind", "externalId");

-- AddForeignKey
ALTER TABLE "github_repos" ADD CONSTRAINT "github_repos_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "github_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_repos" ADD CONSTRAINT "project_repos_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_repos" ADD CONSTRAINT "project_repos_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "github_repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_git_refs" ADD CONSTRAINT "ticket_git_refs_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_git_refs" ADD CONSTRAINT "ticket_git_refs_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "github_repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: give every existing type the kind its name implies, so automation
-- behaves sensibly on projects created before kinds existed. The same rules
-- live in `inferTicketKind` for types created without an explicit kind.
UPDATE "ticket_types" SET "kind" = CASE
    WHEN "name" ~* '(deploy|release|rollout)'                 THEN 'DEPLOYMENT'::"TicketKind"
    WHEN "name" ~* '(hotfix|incident|production|outage|prod)' THEN 'PRODUCTION'::"TicketKind"
    WHEN "name" ~* '(bug|defect|fix)'                         THEN 'BUG'::"TicketKind"
    WHEN "name" ~* '(improve|enhance|refactor)'               THEN 'ENHANCEMENT'::"TicketKind"
    WHEN "name" ~* '(story|feature|epic)'                     THEN 'FEATURE'::"TicketKind"
    WHEN "name" ~* '(research|spike|investigat)'              THEN 'RESEARCH'::"TicketKind"
    ELSE 'TASK'::"TicketKind"
END;

UPDATE "template_ticket_types" SET "kind" = CASE
    WHEN "name" ~* '(deploy|release|rollout)'                 THEN 'DEPLOYMENT'::"TicketKind"
    WHEN "name" ~* '(hotfix|incident|production|outage|prod)' THEN 'PRODUCTION'::"TicketKind"
    WHEN "name" ~* '(bug|defect|fix)'                         THEN 'BUG'::"TicketKind"
    WHEN "name" ~* '(improve|enhance|refactor)'               THEN 'ENHANCEMENT'::"TicketKind"
    WHEN "name" ~* '(story|feature|epic)'                     THEN 'FEATURE'::"TicketKind"
    WHEN "name" ~* '(research|spike|investigat)'              THEN 'RESEARCH'::"TicketKind"
    ELSE 'TASK'::"TicketKind"
END;

-- The new permission. Admin holds every permission by definition; nobody else
-- gets it implicitly, because it reveals every repository the app can see.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT r.id, 'integration:manage' FROM "roles" r WHERE r.key = 'ADMIN'
ON CONFLICT DO NOTHING;

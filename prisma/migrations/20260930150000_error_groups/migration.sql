-- Production errors grouped by fingerprint, and each project's ingest token hash.
-- Additive half of the generated diff only.

-- AlterTable
ALTER TABLE "project_settings" ADD COLUMN     "errorIngestHash" TEXT;

-- CreateTable
CREATE TABLE "error_groups" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lastDetail" TEXT NOT NULL,
    "environment" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketId" TEXT,

    CONSTRAINT "error_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "error_groups_ticketId_idx" ON "error_groups"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "error_groups_projectId_fingerprint_key" ON "error_groups"("projectId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "project_settings_errorIngestHash_key" ON "project_settings"("errorIngestHash");

-- AddForeignKey
ALTER TABLE "error_groups" ADD CONSTRAINT "error_groups_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_groups" ADD CONSTRAINT "error_groups_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

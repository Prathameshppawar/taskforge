-- Uptime monitors and their recent checks.
-- Additive half of the generated diff only.

-- CreateEnum
CREATE TYPE "MonitorState" AS ENUM ('UNKNOWN', 'UP', 'DOWN');

-- CreateTable
CREATE TABLE "monitors" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "expectedStatus" INTEGER NOT NULL DEFAULT 200,
    "keyword" TEXT,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 5,
    "failureThreshold" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "state" "MonitorState" NOT NULL DEFAULT 'UNKNOWN',
    "lastCheckedAt" TIMESTAMP(3),
    "lastLatencyMs" INTEGER,
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "downSince" TIMESTAMP(3),
    "incidentTicketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_checks" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "status" INTEGER,
    "latencyMs" INTEGER,
    "error" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monitors_projectId_idx" ON "monitors"("projectId");

-- CreateIndex
CREATE INDEX "monitors_isActive_lastCheckedAt_idx" ON "monitors"("isActive", "lastCheckedAt");

-- CreateIndex
CREATE INDEX "monitor_checks_monitorId_checkedAt_idx" ON "monitor_checks"("monitorId", "checkedAt");

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_checks" ADD CONSTRAINT "monitor_checks_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

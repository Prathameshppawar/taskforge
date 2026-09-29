-- Import, forecasts, project memory and the handbook, triage, outbound webhooks, the job queue, and per-project toggles.

ALTER TABLE "project_settings" ADD COLUMN     "dailyDigest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "handbookAutoRefresh" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "liveUpdates" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "memoryEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "triageAgent" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "tickets" ADD COLUMN "externalRef" TEXT;

CREATE TABLE "memory_chunks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "text" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "embedding" real[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_documents" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'HANDBOOK',
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "engine" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_document_reads" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_document_reads_pkey" PRIMARY KEY ("userId","projectId","kind")
);

CREATE TABLE "triage_runs" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "triage_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbound_webhooks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "events" TEXT[],
    "projectId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "lastDeliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_webhooks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_cursor" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "statusChangesAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commentsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_cursor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "memory_chunks_projectId_idx" ON "memory_chunks"("projectId");

CREATE UNIQUE INDEX "memory_chunks_projectId_sourceType_sourceId_chunkIndex_key" ON "memory_chunks"("projectId", "sourceType", "sourceId", "chunkIndex");

CREATE UNIQUE INDEX "project_documents_projectId_kind_version_key" ON "project_documents"("projectId", "kind", "version");

CREATE INDEX "triage_runs_ticketId_idx" ON "triage_runs"("ticketId");

CREATE UNIQUE INDEX "jobs_dedupeKey_key" ON "jobs"("dedupeKey");

CREATE INDEX "jobs_status_runAt_idx" ON "jobs"("status", "runAt");

CREATE INDEX "jobs_kind_status_idx" ON "jobs"("kind", "status");

CREATE UNIQUE INDEX "tickets_projectId_externalRef_key" ON "tickets"("projectId", "externalRef");

ALTER TABLE "memory_chunks" ADD CONSTRAINT "memory_chunks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "triage_runs" ADD CONSTRAINT "triage_runs_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "outbound_webhooks" ADD CONSTRAINT "outbound_webhooks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;


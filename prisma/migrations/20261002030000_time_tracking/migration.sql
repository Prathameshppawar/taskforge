-- Time tracking, and what an hour is billed at.

ALTER TABLE "project_settings" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN "hourlyRate" DECIMAL(10,2);

CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "minutes" INTEGER,
    "note" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "time_entries_ticketId_idx" ON "time_entries"("ticketId");
CREATE INDEX "time_entries_userId_startedAt_idx" ON "time_entries"("userId", "startedAt");
CREATE INDEX "time_entries_startedAt_idx" ON "time_entries"("startedAt");

-- One running timer per person. Starting another stops the first in code;
-- this makes a race between two tabs impossible rather than unlikely.
CREATE UNIQUE INDEX "time_entries_one_running" ON "time_entries"("userId") WHERE "endedAt" IS NULL;

ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

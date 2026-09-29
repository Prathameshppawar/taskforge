-- Bulk edits, remembered so they can be undone.

CREATE TABLE "bulk_operations" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "summary" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_operations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bulk_operations_actorId_createdAt_idx" ON "bulk_operations"("actorId", "createdAt");

ALTER TABLE "bulk_operations" ADD CONSTRAINT "bulk_operations_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


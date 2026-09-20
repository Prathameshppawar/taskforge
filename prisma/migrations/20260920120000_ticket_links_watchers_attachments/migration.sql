-- Ticket links, watchers and attachments.
--
-- Hand-written, keeping only the additive half of the generated diff. Prisma
-- proposed three destructive statements unrelated to this change:
--
--   * dropping "tickets_search_idx" and "tickets_key_trgm_idx", which it does on
--     every migration because they are declared in raw SQL, not the schema; and
--   * DROP COLUMN "embedding" followed by ADD COLUMN "embedding" real[] — a
--     pointless rewrite of an Unsupported() column that would have discarded
--     all 26,042 stored vectors.
--
-- The CI guard catches the index drops. The embedding rewrite it would not have
-- caught, which is why a generated migration still gets read before it runs.

-- CreateEnum
CREATE TYPE "TicketLinkType" AS ENUM ('BLOCKS', 'RELATES_TO', 'DUPLICATES');

-- CreateTable
CREATE TABLE "ticket_links" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "type" "TicketLinkType" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_watchers" (
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_watchers_pkey" PRIMARY KEY ("ticketId","userId")
);

-- CreateTable
CREATE TABLE "ticket_attachments" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_attachment_data" (
    "attachmentId" TEXT NOT NULL,
    "content" BYTEA NOT NULL,

    CONSTRAINT "ticket_attachment_data_pkey" PRIMARY KEY ("attachmentId")
);

-- CreateIndex
CREATE INDEX "ticket_links_targetId_idx" ON "ticket_links"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_links_sourceId_targetId_type_key" ON "ticket_links"("sourceId", "targetId", "type");

-- CreateIndex
CREATE INDEX "ticket_watchers_userId_idx" ON "ticket_watchers"("userId");

-- CreateIndex
CREATE INDEX "ticket_attachments_ticketId_idx" ON "ticket_attachments"("ticketId");

-- AddForeignKey
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachment_data" ADD CONSTRAINT "ticket_attachment_data_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "ticket_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

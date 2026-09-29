-- Email in: what the mailbox read, the workspace setting, and each project's opt-in.

ALTER TABLE "project_settings" ADD COLUMN     "emailIntake" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "inbound_emails" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "ticketId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_emails_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inbound_email_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "structureWithAi" BOOLEAN NOT NULL DEFAULT true,
    "lastPolledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_email_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inbound_emails_messageId_key" ON "inbound_emails"("messageId");

CREATE INDEX "inbound_emails_createdAt_idx" ON "inbound_emails"("createdAt");

ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The Microsoft Teams bot: its conversations, what was said, and who is who.

CREATE TABLE "msteams_conversations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "serviceUrl" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "projectId" TEXT,
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "draft" JSONB,
    "draftParticipants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "msteams_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "msteams_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "authorName" TEXT,
    "userId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "msteams_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "msteams_users" (
    "aadObjectId" TEXT NOT NULL,
    "tenantId" TEXT,
    "email" TEXT,
    "userId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "msteams_users_pkey" PRIMARY KEY ("aadObjectId")
);

CREATE INDEX "msteams_conversations_projectId_idx" ON "msteams_conversations"("projectId");

CREATE INDEX "msteams_messages_conversationId_createdAt_idx" ON "msteams_messages"("conversationId", "createdAt");

CREATE INDEX "msteams_users_userId_idx" ON "msteams_users"("userId");

ALTER TABLE "msteams_conversations" ADD CONSTRAINT "msteams_conversations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "msteams_messages" ADD CONSTRAINT "msteams_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "msteams_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "msteams_users" ADD CONSTRAINT "msteams_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


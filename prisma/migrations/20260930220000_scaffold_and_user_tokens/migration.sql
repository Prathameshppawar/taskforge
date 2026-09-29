-- Scaffolding new repositories, and each person's own GitHub authorisation
-- (needed to create a repository under a personal account).
ALTER TYPE "AiFixMode" ADD VALUE 'SCAFFOLD';

CREATE TABLE "github_user_tokens" (
    "userId" TEXT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "tokenEnc" TEXT NOT NULL,
    "refreshEnc" TEXT,
    "expiresAt" TIMESTAMP(3),
    "refreshExpiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_user_tokens_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "github_user_tokens" ADD CONSTRAINT "github_user_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

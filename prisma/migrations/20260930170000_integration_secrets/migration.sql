-- Sealed credentials for integrations without a table of their own (Vercel).
CREATE TABLE "integration_secrets" (
    "key" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "meta" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_secrets_pkey" PRIMARY KEY ("key")
);

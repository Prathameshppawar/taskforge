-- A model per agent, and the capability facts recommendations are made from.
ALTER TABLE "ai_model_prices"
  ADD COLUMN "supportsTools" BOOLEAN,
  ADD COLUMN "supportsReasoning" BOOLEAN,
  ADD COLUMN "supportsVision" BOOLEAN,
  ADD COLUMN "contextTokens" INTEGER;

CREATE TABLE "agent_settings" (
    "agent" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_settings_pkey" PRIMARY KEY ("agent")
);

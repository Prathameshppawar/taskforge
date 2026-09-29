-- The custom OpenAI-compatible engine's endpoint.
ALTER TABLE "ai_engine_settings" ADD COLUMN "baseUrl" TEXT;

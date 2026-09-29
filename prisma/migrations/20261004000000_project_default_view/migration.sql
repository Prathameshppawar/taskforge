-- The view a project opens on. Every existing project lands on Insights,
-- which is the new default; each can choose another in its settings.
ALTER TABLE "project_settings" ADD COLUMN "defaultView" TEXT NOT NULL DEFAULT 'insights';

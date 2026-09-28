-- Per-project opt-in for "Fix with AI" to write GitHub Actions workflows.
-- Off for every existing project: a workflow runs as soon as its pull request
-- opens, so allowing it is a deliberate choice, never a default.
ALTER TABLE "project_settings" ADD COLUMN "aiWorkflows" BOOLEAN NOT NULL DEFAULT false;

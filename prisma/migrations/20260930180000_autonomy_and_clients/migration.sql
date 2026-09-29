-- Stage 3 and the agency features: review verdicts on pull requests, draft
-- until green, the auto-merge policy, multi-repository batches, and the
-- Client role with its approval permission.

ALTER TABLE "ticket_git_refs" ADD COLUMN "aiReviewVerdict" TEXT;

ALTER TABLE "project_settings"
  ADD COLUMN "aiDraftUntilGreen" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aiAutoMerge" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoMergeMaxLines" INTEGER NOT NULL DEFAULT 40,
  ADD COLUMN "autoMergeKinds" TEXT NOT NULL DEFAULT 'TASK,ENHANCEMENT';

ALTER TABLE "ai_fix_runs" ADD COLUMN "batchId" TEXT;
CREATE INDEX "ai_fix_runs_batchId_idx" ON "ai_fix_runs"("batchId");

-- Client: an outside stakeholder. Sees the projects they are added to, files
-- requests, comments, and approves work waiting on them — nothing else. Ranked
-- below every staff role, so no one can be demoted into it by a peer.
INSERT INTO "roles" ("id", "key", "name", "description", "isSystem", "level", "createdAt", "updatedAt")
VALUES ('role_client', 'CLIENT', 'Client', 'Outside stakeholder: sees their projects, files requests, approves work.', false, 80, now(), now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permission")
SELECT r.id, p.permission FROM "roles" r
CROSS JOIN (VALUES ('project:view'), ('ticket:create'), ('comment:create'), ('ticket:approve')) AS p(permission)
WHERE r.key = 'CLIENT'
ON CONFLICT DO NOTHING;

-- Admin holds every permission, including the new one.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT r.id, 'ticket:approve' FROM "roles" r WHERE r.key IN ('ADMIN', 'PROJECT_MANAGER')
ON CONFLICT DO NOTHING;

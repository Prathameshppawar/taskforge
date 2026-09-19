-- Configurable roles and teams.
--
-- Hand-written. The generated version would have dropped `roles.key` and
-- recreated it (destroying every role assignment) and, because Prisma does not
-- know about the manually created search objects, would also have dropped the
-- ticket full-text and trigram indexes. Neither is acceptable on live data.

-- 1. Enum -> text, preserving the existing values. The USING clause is what the
--    generated migration lacked, and the reason it wanted to drop the column.
ALTER TABLE "roles" ALTER COLUMN "key" TYPE TEXT USING "key"::text;
DROP TYPE "RoleKey";

-- 2. New roles are custom unless a seed says otherwise; the three existing ones
--    are re-marked as system below.
ALTER TABLE "roles" ADD COLUMN "level" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "roles" ALTER COLUMN "isSystem" SET DEFAULT false;

-- 3. The permission mapping, previously a hardcoded matrix in TypeScript.
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permission")
);
CREATE INDEX "role_permissions_permission_idx" ON "role_permissions"("permission");
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Teams, which scope delegated administration.
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");
ALTER TABLE "teams" ADD CONSTRAINT "teams_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "team_members" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isManager" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("teamId","userId")
);
CREATE INDEX "team_members_userId_idx" ON "team_members"("userId");
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Indexes Prisma now expects. The unique index on `key` is NOT recreated:
--    ALTER COLUMN ... TYPE rebuilds an index in place rather than dropping it,
--    so "roles_key_key" already exists and carried over from the enum column.
CREATE INDEX "roles_level_idx" ON "roles"("level");

-- 6. Data migration: reproduce the previous hardcoded matrix exactly, so every
--    existing account keeps precisely the access it had before this ran.
-- Admin: 32 permissions
INSERT INTO "role_permissions" ("roleId", "permission") VALUES
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'user:create'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'user:update'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'user:deactivate'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'user:reset-password'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'user:view'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'template:manage'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'audit:view-all'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'role:manage'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'team:manage'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'team:manage-members'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'project:create'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'project:update'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'project:archive'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'project:delete'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'project:manage-members'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'project:manage-config'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'project:view'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'project:view-all'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'project:access-all'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'label:create'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'label:update'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'label:delete'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'ticket:create'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'ticket:update'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'ticket:update-any'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'ticket:delete'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'ticket:assign'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'ticket:transition'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'comment:create'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'comment:delete-any'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'recurring:manage'),
  ((SELECT id FROM "roles" WHERE "key" = 'ADMIN'), 'ai:use')
ON CONFLICT DO NOTHING;

-- Project Manager: 22 permissions
INSERT INTO "role_permissions" ("roleId", "permission") VALUES
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'project:view'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'ticket:create'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'ticket:update'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'ticket:transition'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'comment:create'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'ai:use'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'user:view'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'project:create'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'project:update'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'project:archive'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'project:manage-members'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'project:manage-config'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'label:create'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'label:update'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'label:delete'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'ticket:update-any'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'ticket:delete'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'ticket:assign'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'comment:delete-any'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'recurring:manage'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'team:manage-members'),
  ((SELECT id FROM "roles" WHERE "key" = 'PROJECT_MANAGER'), 'project:view-all')
ON CONFLICT DO NOTHING;

-- User: 6 permissions
INSERT INTO "role_permissions" ("roleId", "permission") VALUES
  ((SELECT id FROM "roles" WHERE "key" = 'USER'), 'project:view'),
  ((SELECT id FROM "roles" WHERE "key" = 'USER'), 'ticket:create'),
  ((SELECT id FROM "roles" WHERE "key" = 'USER'), 'ticket:update'),
  ((SELECT id FROM "roles" WHERE "key" = 'USER'), 'ticket:transition'),
  ((SELECT id FROM "roles" WHERE "key" = 'USER'), 'comment:create'),
  ((SELECT id FROM "roles" WHERE "key" = 'USER'), 'ai:use')
ON CONFLICT DO NOTHING;

-- levels
UPDATE "roles" SET "level" = 0, "isSystem" = true WHERE "key" = 'ADMIN';
UPDATE "roles" SET "level" = 20, "isSystem" = true WHERE "key" = 'PROJECT_MANAGER';
UPDATE "roles" SET "level" = 40, "isSystem" = true WHERE "key" = 'USER';

-- Deliberately NOT dropped: "tickets_search_idx" and "tickets_key_trgm_idx".
-- Prisma proposes removing them on every migration because they are declared in
-- raw SQL rather than the schema. They are load-bearing for ticket search.

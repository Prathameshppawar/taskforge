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
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT r.id, p.permission
FROM "roles" r
CROSS JOIN (VALUES
    ('user:create'),
    ('user:update'),
    ('user:deactivate'),
    ('user:reset-password'),
    ('user:view'),
    ('template:manage'),
    ('audit:view-all'),
    ('role:manage'),
    ('team:manage'),
    ('team:manage-members'),
    ('project:create'),
    ('project:update'),
    ('project:archive'),
    ('project:delete'),
    ('project:manage-members'),
    ('project:manage-config'),
    ('project:view'),
    ('project:view-all'),
    ('project:access-all'),
    ('label:create'),
    ('label:update'),
    ('label:delete'),
    ('ticket:create'),
    ('ticket:update'),
    ('ticket:update-any'),
    ('ticket:delete'),
    ('ticket:assign'),
    ('ticket:transition'),
    ('comment:create'),
    ('comment:delete-any'),
    ('recurring:manage'),
    ('ai:use')
) AS p(permission)
WHERE r."key" = 'ADMIN'
ON CONFLICT DO NOTHING;

-- Project Manager: 22 permissions
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT r.id, p.permission
FROM "roles" r
CROSS JOIN (VALUES
    ('project:view'),
    ('ticket:create'),
    ('ticket:update'),
    ('ticket:transition'),
    ('comment:create'),
    ('ai:use'),
    ('user:view'),
    ('project:create'),
    ('project:update'),
    ('project:archive'),
    ('project:manage-members'),
    ('project:manage-config'),
    ('label:create'),
    ('label:update'),
    ('label:delete'),
    ('ticket:update-any'),
    ('ticket:delete'),
    ('ticket:assign'),
    ('comment:delete-any'),
    ('recurring:manage'),
    ('team:manage-members'),
    ('project:view-all')
) AS p(permission)
WHERE r."key" = 'PROJECT_MANAGER'
ON CONFLICT DO NOTHING;

-- User: 6 permissions
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT r.id, p.permission
FROM "roles" r
CROSS JOIN (VALUES
    ('project:view'),
    ('ticket:create'),
    ('ticket:update'),
    ('ticket:transition'),
    ('comment:create'),
    ('ai:use')
) AS p(permission)
WHERE r."key" = 'USER'
ON CONFLICT DO NOTHING;

-- A fresh database has no roles yet — migrations run before any seed — so each
-- statement above is an INSERT ... SELECT rather than VALUES with a subquery.
-- The subquery form yields a NULL roleId and violates NOT NULL; this form simply
-- inserts nothing, leaving the seed to create the roles and their permissions.

-- levels
UPDATE "roles" SET "level" = 0, "isSystem" = true WHERE "key" = 'ADMIN';
UPDATE "roles" SET "level" = 20, "isSystem" = true WHERE "key" = 'PROJECT_MANAGER';
UPDATE "roles" SET "level" = 40, "isSystem" = true WHERE "key" = 'USER';

-- Deliberately NOT dropped: "tickets_search_idx" and "tickets_key_trgm_idx".
-- Prisma proposes removing them on every migration because they are declared in
-- raw SQL rather than the schema. They are load-bearing for ticket search.

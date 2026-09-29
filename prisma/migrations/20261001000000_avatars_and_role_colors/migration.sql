-- Profile photos, and a rim colour per role.
ALTER TABLE "roles" ADD COLUMN "color" TEXT;
ALTER TABLE "users" ADD COLUMN "avatarUpdatedAt" TIMESTAMP(3);

CREATE TABLE "user_avatar_images" (
    "userId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_avatar_images_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "user_avatar_images" ADD CONSTRAINT "user_avatar_images_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The built-in roles get their rim. Custom roles start without one; an
-- administrator picks it on the Roles page.
UPDATE "roles" SET "color" = 'violet'  WHERE "key" = 'ADMIN';
UPDATE "roles" SET "color" = 'blue'    WHERE "key" = 'PROJECT_MANAGER';
UPDATE "roles" SET "color" = 'green'   WHERE "key" = 'USER';
UPDATE "roles" SET "color" = 'amber'   WHERE "key" = 'CLIENT';
UPDATE "roles" SET "color" = 'fuchsia' WHERE "key" = 'AI_AGENT';

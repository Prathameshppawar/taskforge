-- Email preferences, both on by default like the notification chime.
ALTER TABLE "users" ADD COLUMN "emailNotifications" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "emailDigest" BOOLEAN NOT NULL DEFAULT true;

-- Whether the notification chime plays for this person.
--
-- The preference used to live in localStorage, which meant muting on a laptop
-- said nothing about a phone and clearing site data silently un-muted someone.
-- On the account it is one answer per person, wherever they sign in.
--
-- Written by hand rather than generated: `tickets.embedding` is an
-- Unsupported("real[]") column, so `prisma migrate dev` proposes dropping and
-- recreating it — discarding every embedding — to add an unrelated boolean.
ALTER TABLE "users" ADD COLUMN "notificationSound" BOOLEAN NOT NULL DEFAULT true;

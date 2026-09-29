-- Status history, response/resolution targets, WIP limits and the stuck flag.

ALTER TYPE "NotificationType" ADD VALUE 'SLA_AT_RISK';
ALTER TYPE "NotificationType" ADD VALUE 'SLA_BREACHED';

ALTER TABLE "priorities" ADD COLUMN "resolveWithinHours" INTEGER,
ADD COLUMN "respondWithinHours" INTEGER;

ALTER TABLE "project_settings" ADD COLUMN "slaKinds" TEXT NOT NULL DEFAULT 'PRODUCTION,BUG',
ADD COLUMN "stuckAfterDays" INTEGER DEFAULT 5;

ALTER TABLE "statuses" ADD COLUMN "wipLimit" INTEGER;

ALTER TABLE "tickets" ADD COLUMN "firstResponseAt" TIMESTAMP(3),
ADD COLUMN "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "ticket_status_changes" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "ticketId" TEXT NOT NULL,
    "fromStatusId" TEXT,
    "toStatusId" TEXT,
    "fromCategory" "StatusCategory",
    "toCategory" "StatusCategory" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_status_changes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ticket_sla_alerts" (
    "ticketId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_sla_alerts_pkey" PRIMARY KEY ("ticketId","kind")
);

CREATE INDEX "ticket_status_changes_ticketId_changedAt_idx" ON "ticket_status_changes"("ticketId", "changedAt");
CREATE INDEX "ticket_status_changes_changedAt_idx" ON "ticket_status_changes"("changedAt");

ALTER TABLE "ticket_status_changes" ADD CONSTRAINT "ticket_status_changes_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_sla_alerts" ADD CONSTRAINT "ticket_sla_alerts_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill history from the audit log, which has recorded status changes by
-- name. The first change's old value is where the ticket started; a name that
-- no longer resolves (a renamed or deleted status) is skipped.
-- ---------------------------------------------------------------------------

INSERT INTO "ticket_status_changes" ("ticketId", "toStatusId", "toCategory", "changedAt")
SELECT t."id", s."id", s."category", t."createdAt"
FROM "tickets" t
JOIN LATERAL (
  SELECT a."oldValue" FROM "activity_logs" a
  WHERE a."ticketId" = t."id" AND a."action" = 'STATUS_CHANGED' AND a."oldValue" IS NOT NULL
  ORDER BY a."createdAt" ASC LIMIT 1
) first ON TRUE
JOIN "statuses" s ON s."projectId" = t."projectId" AND s."name" = first."oldValue";

INSERT INTO "ticket_status_changes" ("ticketId", "fromStatusId", "toStatusId", "fromCategory", "toCategory", "changedAt")
SELECT a."ticketId", f."id", s."id", f."category", s."category", a."createdAt"
FROM "activity_logs" a
JOIN "tickets" t ON t."id" = a."ticketId"
JOIN "statuses" s ON s."projectId" = t."projectId" AND s."name" = a."newValue"
LEFT JOIN "statuses" f ON f."projectId" = t."projectId" AND f."name" = a."oldValue"
WHERE a."action" = 'STATUS_CHANGED' AND a."newValue" IS NOT NULL;

-- Tickets the log says nothing usable about start in their current status.
INSERT INTO "ticket_status_changes" ("ticketId", "toStatusId", "toCategory", "changedAt")
SELECT t."id", t."statusId", s."category", t."createdAt"
FROM "tickets" t
JOIN "statuses" s ON s."id" = t."statusId"
WHERE NOT EXISTS (SELECT 1 FROM "ticket_status_changes" h WHERE h."ticketId" = t."id");

-- Where the reconstructed history does not end in the ticket's actual status
-- (bulk edits logged no names), close the gap at the ticket's last update.
INSERT INTO "ticket_status_changes" ("ticketId", "fromStatusId", "toStatusId", "fromCategory", "toCategory", "changedAt")
SELECT t."id", last."toStatusId", t."statusId", last."toCategory", s."category", GREATEST(t."updatedAt", last."changedAt")
FROM "tickets" t
JOIN "statuses" s ON s."id" = t."statusId"
JOIN LATERAL (
  SELECT h."toStatusId", h."toCategory", h."changedAt" FROM "ticket_status_changes" h
  WHERE h."ticketId" = t."id" ORDER BY h."changedAt" DESC LIMIT 1
) last ON TRUE
WHERE last."toStatusId" IS DISTINCT FROM t."statusId";

UPDATE "tickets" t SET "statusChangedAt" = h."at"
FROM (SELECT "ticketId", MAX("changedAt") AS "at" FROM "ticket_status_changes" GROUP BY "ticketId") h
WHERE h."ticketId" = t."id";

-- First response: another person's comment, or the first move past To Do.
UPDATE "tickets" t SET "firstResponseAt" = r."at"
FROM (
  SELECT t2."id", LEAST(
    (SELECT MIN(c."createdAt") FROM "comments" c JOIN "users" u ON u."id" = c."authorId"
      WHERE c."ticketId" = t2."id" AND c."authorId" IS DISTINCT FROM t2."reporterId" AND NOT u."isAgent"),
    (SELECT MIN(h."changedAt") FROM "ticket_status_changes" h
      WHERE h."ticketId" = t2."id" AND h."fromCategory" IS NOT NULL AND h."toCategory" NOT IN ('BACKLOG', 'TODO'))
  ) AS "at"
  FROM "tickets" t2
) r
WHERE r."id" = t."id" AND r."at" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The triggers. Timestamps are written in UTC, as Prisma writes them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "taskforge_ticket_status_before"() RETURNS trigger AS $$
DECLARE
  category "StatusCategory";
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."statusChangedAt" := NEW."createdAt";
  ELSIF NEW."statusId" IS DISTINCT FROM OLD."statusId" THEN
    NEW."statusChangedAt" := (now() AT TIME ZONE 'UTC');
    SELECT s."category" INTO category FROM "statuses" s WHERE s."id" = NEW."statusId";
    IF NEW."firstResponseAt" IS NULL AND category NOT IN ('BACKLOG', 'TODO') THEN
      NEW."firstResponseAt" := NEW."statusChangedAt";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tickets_status_before"
BEFORE INSERT OR UPDATE OF "statusId" ON "tickets"
FOR EACH ROW EXECUTE FUNCTION "taskforge_ticket_status_before"();

CREATE OR REPLACE FUNCTION "taskforge_ticket_status_after"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "ticket_status_changes" ("ticketId", "toStatusId", "toCategory", "changedAt")
    SELECT NEW."id", NEW."statusId", s."category", NEW."statusChangedAt"
    FROM "statuses" s WHERE s."id" = NEW."statusId";
  ELSIF NEW."statusId" IS DISTINCT FROM OLD."statusId" THEN
    INSERT INTO "ticket_status_changes" ("ticketId", "fromStatusId", "toStatusId", "fromCategory", "toCategory", "changedAt")
    SELECT NEW."id", OLD."statusId", NEW."statusId",
      (SELECT f."category" FROM "statuses" f WHERE f."id" = OLD."statusId"),
      s."category", NEW."statusChangedAt"
    FROM "statuses" s WHERE s."id" = NEW."statusId";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tickets_status_after"
AFTER INSERT OR UPDATE OF "statusId" ON "tickets"
FOR EACH ROW EXECUTE FUNCTION "taskforge_ticket_status_after"();

CREATE OR REPLACE FUNCTION "taskforge_comment_first_response"() RETURNS trigger AS $$
BEGIN
  UPDATE "tickets" t SET "firstResponseAt" = NEW."createdAt"
  WHERE t."id" = NEW."ticketId"
    AND t."firstResponseAt" IS NULL
    AND t."reporterId" IS DISTINCT FROM NEW."authorId"
    AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = NEW."authorId" AND u."isAgent");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "comments_first_response"
AFTER INSERT ON "comments"
FOR EACH ROW EXECUTE FUNCTION "taskforge_comment_first_response"();

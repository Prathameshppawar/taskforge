-- Sprints and milestones, the ranked backlog, and cycle-membership history.

CREATE TYPE "CycleKind" AS ENUM ('SPRINT', 'MILESTONE');
CREATE TYPE "CycleState" AS ENUM ('PLANNED', 'ACTIVE', 'CLOSED');
ALTER TYPE "FilterField" ADD VALUE 'CYCLE';
ALTER TYPE "AiFeature" ADD VALUE 'PLANNING';

ALTER TABLE "tickets" ADD COLUMN "backlogRank" DOUBLE PRECISION,
ADD COLUMN "cycleId" TEXT;

CREATE TABLE "cycles" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CycleKind" NOT NULL DEFAULT 'SPRINT',
    "goal" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "state" "CycleState" NOT NULL DEFAULT 'PLANNED',
    "capacity" INTEGER,
    "startedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "summary" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ticket_cycle_changes" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "ticketId" TEXT NOT NULL,
    "fromCycleId" TEXT,
    "toCycleId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_cycle_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cycles_projectId_state_idx" ON "cycles"("projectId", "state");
CREATE INDEX "ticket_cycle_changes_ticketId_changedAt_idx" ON "ticket_cycle_changes"("ticketId", "changedAt");
CREATE INDEX "ticket_cycle_changes_toCycleId_idx" ON "ticket_cycle_changes"("toCycleId");
CREATE INDEX "ticket_cycle_changes_fromCycleId_idx" ON "ticket_cycle_changes"("fromCycleId");
CREATE INDEX "tickets_cycleId_idx" ON "tickets"("cycleId");

-- At most one running sprint per project. Milestones may overlap.
CREATE UNIQUE INDEX "cycles_one_active_sprint" ON "cycles"("projectId") WHERE "state" = 'ACTIVE' AND "kind" = 'SPRINT';

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_cycle_changes" ADD CONSTRAINT "ticket_cycle_changes_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every move into or out of a cycle, from every write path — including a
-- deleted cycle releasing its tickets, which Postgres performs as an UPDATE.
CREATE OR REPLACE FUNCTION "taskforge_ticket_cycle_after"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."cycleId" IS NOT NULL THEN
      INSERT INTO "ticket_cycle_changes" ("ticketId", "toCycleId", "changedAt")
      VALUES (NEW."id", NEW."cycleId", NEW."createdAt");
    END IF;
  ELSIF NEW."cycleId" IS DISTINCT FROM OLD."cycleId" THEN
    INSERT INTO "ticket_cycle_changes" ("ticketId", "fromCycleId", "toCycleId", "changedAt")
    VALUES (NEW."id", OLD."cycleId", NEW."cycleId", (now() AT TIME ZONE 'UTC'));
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tickets_cycle_after"
AFTER INSERT OR UPDATE OF "cycleId" ON "tickets"
FOR EACH ROW EXECUTE FUNCTION "taskforge_ticket_cycle_after"();

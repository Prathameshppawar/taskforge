-- Acceptance criteria on tickets, and the templates each ticket type starts from.
ALTER TABLE "template_ticket_types" ADD COLUMN "checklistTemplate" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "descriptionTemplate" TEXT;

ALTER TABLE "ticket_types" ADD COLUMN "checklistTemplate" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "descriptionTemplate" TEXT;

CREATE TABLE "ticket_checklist_items" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_checklist_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_checklist_items_ticketId_position_idx" ON "ticket_checklist_items"("ticketId", "position");

ALTER TABLE "ticket_checklist_items" ADD CONSTRAINT "ticket_checklist_items_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_checklist_items" ADD CONSTRAINT "ticket_checklist_items_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_checklist_items" ADD CONSTRAINT "ticket_checklist_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing types get their kind's default template (src/core/domain/ticket-templates.ts).
UPDATE "ticket_types" SET "descriptionTemplate" = '## Steps to reproduce
1. 

## Expected

## Actual

## Environment
Browser / device / version:', "checklistTemplate" = ARRAY['The steps above no longer reproduce the bug', 'A test covers the case that failed']::TEXT[]
  WHERE "kind" = 'BUG' AND "descriptionTemplate" IS NULL;
UPDATE "ticket_types" SET "descriptionTemplate" = '## Impact
Who is affected, and how badly:

## Since

## What we know
', "checklistTemplate" = ARRAY['Users are no longer affected', 'The cause is understood and written up', 'Monitoring would catch it next time']::TEXT[]
  WHERE "kind" = 'PRODUCTION' AND "descriptionTemplate" IS NULL;
UPDATE "ticket_types" SET "descriptionTemplate" = '## What ships

## Rollback plan

## Who to tell
', "checklistTemplate" = ARRAY['Migrations run on production first', 'Smoke-tested after release', 'Release notes sent']::TEXT[]
  WHERE "kind" = 'DEPLOYMENT' AND "descriptionTemplate" IS NULL;
UPDATE "ticket_types" SET "descriptionTemplate" = '## Why
Who needs this, and what it lets them do:

## What

## Out of scope
', "checklistTemplate" = ARRAY[]::TEXT[]
  WHERE "kind" = 'FEATURE' AND "descriptionTemplate" IS NULL;
UPDATE "ticket_types" SET "descriptionTemplate" = '## Today

## Better
', "checklistTemplate" = ARRAY[]::TEXT[]
  WHERE "kind" = 'ENHANCEMENT' AND "descriptionTemplate" IS NULL;
UPDATE "ticket_types" SET "descriptionTemplate" = '## Question

## Timebox

## Findings
', "checklistTemplate" = ARRAY['The question is answered, or shown unanswerable', 'Findings are written on this ticket']::TEXT[]
  WHERE "kind" = 'RESEARCH' AND "descriptionTemplate" IS NULL;
UPDATE "template_ticket_types" SET "descriptionTemplate" = '## Steps to reproduce
1. 

## Expected

## Actual

## Environment
Browser / device / version:', "checklistTemplate" = ARRAY['The steps above no longer reproduce the bug', 'A test covers the case that failed']::TEXT[]
  WHERE "kind" = 'BUG' AND "descriptionTemplate" IS NULL;
UPDATE "template_ticket_types" SET "descriptionTemplate" = '## Impact
Who is affected, and how badly:

## Since

## What we know
', "checklistTemplate" = ARRAY['Users are no longer affected', 'The cause is understood and written up', 'Monitoring would catch it next time']::TEXT[]
  WHERE "kind" = 'PRODUCTION' AND "descriptionTemplate" IS NULL;
UPDATE "template_ticket_types" SET "descriptionTemplate" = '## What ships

## Rollback plan

## Who to tell
', "checklistTemplate" = ARRAY['Migrations run on production first', 'Smoke-tested after release', 'Release notes sent']::TEXT[]
  WHERE "kind" = 'DEPLOYMENT' AND "descriptionTemplate" IS NULL;
UPDATE "template_ticket_types" SET "descriptionTemplate" = '## Why
Who needs this, and what it lets them do:

## What

## Out of scope
', "checklistTemplate" = ARRAY[]::TEXT[]
  WHERE "kind" = 'FEATURE' AND "descriptionTemplate" IS NULL;
UPDATE "template_ticket_types" SET "descriptionTemplate" = '## Today

## Better
', "checklistTemplate" = ARRAY[]::TEXT[]
  WHERE "kind" = 'ENHANCEMENT' AND "descriptionTemplate" IS NULL;
UPDATE "template_ticket_types" SET "descriptionTemplate" = '## Question

## Timebox

## Findings
', "checklistTemplate" = ARRAY['The question is answered, or shown unanswerable', 'Findings are written on this ticket']::TEXT[]
  WHERE "kind" = 'RESEARCH' AND "descriptionTemplate" IS NULL;

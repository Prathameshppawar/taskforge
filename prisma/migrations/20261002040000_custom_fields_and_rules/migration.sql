-- Custom fields per project, and what must be true before a ticket enters a status.
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'DATE', 'CHECKBOX', 'URL', 'USER');



ALTER TABLE "statuses" ADD COLUMN     "requirements" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "ticket_cycle_changes" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;



CREATE TABLE "custom_fields" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "description" TEXT,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ticket_field_values" (
    "ticketId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_field_values_pkey" PRIMARY KEY ("ticketId","fieldId")
);

CREATE INDEX "custom_fields_projectId_position_idx" ON "custom_fields"("projectId", "position");

CREATE UNIQUE INDEX "custom_fields_projectId_name_key" ON "custom_fields"("projectId", "name");

CREATE INDEX "ticket_field_values_fieldId_value_idx" ON "ticket_field_values"("fieldId", "value");

ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_field_values" ADD CONSTRAINT "ticket_field_values_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_field_values" ADD CONSTRAINT "ticket_field_values_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;


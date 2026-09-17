-- CreateEnum
CREATE TYPE "RoleKey" AS ENUM ('ADMIN', 'PROJECT_MANAGER', 'USER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProjectMemberRole" AS ENUM ('MANAGER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "StatusCategory" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('GITHUB', 'SHAREPOINT', 'FIGMA', 'BUILD', 'DOCUMENTATION', 'API_SPEC', 'OTHER');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ActivityEntity" AS ENUM ('PROJECT', 'TICKET', 'COMMENT', 'USER', 'LABEL', 'MEMBER', 'RESOURCE', 'STATUS', 'PRIORITY', 'TICKET_TYPE', 'TEMPLATE', 'RECURRING_TICKET');

-- CreateEnum
CREATE TYPE "ActivityAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED', 'ARCHIVED', 'RESTORED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'ASSIGNED', 'UNASSIGNED', 'LABEL_ADDED', 'LABEL_REMOVED', 'MEMBER_ADDED', 'MEMBER_REMOVED', 'COMMENTED', 'COMMENT_EDITED', 'COMMENT_DELETED', 'RESOURCE_ADDED', 'RESOURCE_REMOVED', 'PARENT_CHANGED', 'DUE_DATE_CHANGED', 'ACTIVATED', 'DEACTIVATED', 'PASSWORD_RESET', 'LOGGED_IN', 'AI_GENERATED');

-- CreateEnum
CREATE TYPE "FilterField" AS ENUM ('PROJECT', 'ASSIGNEE', 'REPORTER', 'STATUS', 'STATUS_CATEGORY', 'PRIORITY', 'TYPE', 'LABEL', 'PARENT', 'DUE_DATE', 'CREATED_AT', 'UPDATED_AT', 'SEARCH');

-- CreateEnum
CREATE TYPE "FilterOperator" AS ENUM ('EQUALS', 'NOT_EQUALS', 'IN', 'NOT_IN', 'CONTAINS', 'BEFORE', 'AFTER', 'BETWEEN', 'IS_NULL', 'IS_NOT_NULL');

-- CreateEnum
CREATE TYPE "ViewType" AS ENUM ('TABLE', 'KANBAN', 'CALENDAR', 'TIMELINE');

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "key" "RoleKey" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "avatarColor" TEXT NOT NULL DEFAULT 'slate',
    "jobTitle" TEXT,
    "roleId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "lastLoginAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'layout-template',
    "color" TEXT NOT NULL DEFAULT 'indigo',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_statuses" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "StatusCategory" NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "position" INTEGER NOT NULL,
    "isInitial" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "template_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_priorities" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "level" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "template_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_ticket_types" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "icon" TEXT NOT NULL DEFAULT 'circle-dot',
    "position" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "template_ticket_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_labels" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "description" TEXT,

    CONSTRAINT "template_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_tickets" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "typeName" TEXT,
    "priorityName" TEXT,
    "parentId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "template_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_ticket_labels" (
    "templateTicketId" TEXT NOT NULL,
    "labelName" TEXT NOT NULL,

    CONSTRAINT "template_ticket_labels_pkey" PRIMARY KEY ("templateTicketId","labelName")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "ownerId" TEXT NOT NULL,
    "templateId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_settings" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "nextTicketNumber" INTEGER NOT NULL DEFAULT 1,
    "color" TEXT NOT NULL DEFAULT 'indigo',
    "icon" TEXT NOT NULL DEFAULT 'folder-kanban',
    "autoStatusRollup" BOOLEAN NOT NULL DEFAULT true,
    "allowSubtasks" BOOLEAN NOT NULL DEFAULT true,
    "requireDueDate" BOOLEAN NOT NULL DEFAULT false,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "defaultAssigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectMemberRole" NOT NULL DEFAULT 'MEMBER',
    "addedById" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statuses" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "StatusCategory" NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "position" INTEGER NOT NULL,
    "isInitial" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "priorities" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "level" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_types" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "icon" TEXT NOT NULL DEFAULT 'circle-dot',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labels" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "remarks" TEXT,
    "projectId" TEXT NOT NULL,
    "statusId" TEXT NOT NULL,
    "priorityId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "reporterId" TEXT,
    "parentId" TEXT,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "estimateHours" DECIMAL(6,2),
    "storyPoints" INTEGER,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "recurringTicketId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_labels" (
    "ticketId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_labels_pkey" PRIMARY KEY ("ticketId","labelId")
);

-- CreateTable
CREATE TABLE "ticket_resources" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL DEFAULT 'OTHER',
    "url" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "parentId" TEXT,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_mentions" (
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_mentions_pkey" PRIMARY KEY ("commentId","userId")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL,
    "action" "ActivityAction" NOT NULL,
    "entityType" "ActivityEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityLabel" TEXT,
    "projectId" TEXT,
    "ticketId" TEXT,
    "actorId" TEXT,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_tickets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "statusId" TEXT NOT NULL,
    "priorityId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "dueInDays" INTEGER,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_ticket_labels" (
    "recurringTicketId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,

    CONSTRAINT "recurring_ticket_labels_pkey" PRIMARY KEY ("recurringTicketId","labelId")
);

-- CreateTable
CREATE TABLE "saved_filters" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "projectId" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "viewType" "ViewType" NOT NULL DEFAULT 'TABLE',
    "sortBy" TEXT NOT NULL DEFAULT 'updatedAt',
    "sortDir" TEXT NOT NULL DEFAULT 'desc',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_filter_criteria" (
    "id" TEXT NOT NULL,
    "savedFilterId" TEXT NOT NULL,
    "field" "FilterField" NOT NULL,
    "operator" "FilterOperator" NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "saved_filter_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_roleId_idx" ON "users"("roleId");

-- CreateIndex
CREATE INDEX "users_isActive_idx" ON "users"("isActive");

-- CreateIndex
CREATE INDEX "users_name_idx" ON "users"("name");

-- CreateIndex
CREATE INDEX "user_sessions_userId_createdAt_idx" ON "user_sessions"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_templates_name_key" ON "project_templates"("name");

-- CreateIndex
CREATE INDEX "project_templates_isActive_idx" ON "project_templates"("isActive");

-- CreateIndex
CREATE INDEX "template_statuses_templateId_idx" ON "template_statuses"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "template_statuses_templateId_name_key" ON "template_statuses"("templateId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "template_statuses_templateId_position_key" ON "template_statuses"("templateId", "position");

-- CreateIndex
CREATE INDEX "template_priorities_templateId_idx" ON "template_priorities"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "template_priorities_templateId_name_key" ON "template_priorities"("templateId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "template_priorities_templateId_level_key" ON "template_priorities"("templateId", "level");

-- CreateIndex
CREATE INDEX "template_ticket_types_templateId_idx" ON "template_ticket_types"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "template_ticket_types_templateId_name_key" ON "template_ticket_types"("templateId", "name");

-- CreateIndex
CREATE INDEX "template_labels_templateId_idx" ON "template_labels"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "template_labels_templateId_name_key" ON "template_labels"("templateId", "name");

-- CreateIndex
CREATE INDEX "template_tickets_templateId_idx" ON "template_tickets"("templateId");

-- CreateIndex
CREATE INDEX "template_tickets_parentId_idx" ON "template_tickets"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");

-- CreateIndex
CREATE INDEX "projects_ownerId_idx" ON "projects"("ownerId");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "projects_isArchived_idx" ON "projects"("isArchived");

-- CreateIndex
CREATE INDEX "projects_code_idx" ON "projects"("code");

-- CreateIndex
CREATE UNIQUE INDEX "project_settings_projectId_key" ON "project_settings"("projectId");

-- CreateIndex
CREATE INDEX "project_members_userId_idx" ON "project_members"("userId");

-- CreateIndex
CREATE INDEX "project_members_projectId_role_idx" ON "project_members"("projectId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_projectId_userId_key" ON "project_members"("projectId", "userId");

-- CreateIndex
CREATE INDEX "statuses_projectId_position_idx" ON "statuses"("projectId", "position");

-- CreateIndex
CREATE INDEX "statuses_projectId_category_idx" ON "statuses"("projectId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "statuses_projectId_name_key" ON "statuses"("projectId", "name");

-- CreateIndex
CREATE INDEX "priorities_projectId_level_idx" ON "priorities"("projectId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "priorities_projectId_name_key" ON "priorities"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "priorities_projectId_level_key" ON "priorities"("projectId", "level");

-- CreateIndex
CREATE INDEX "ticket_types_projectId_position_idx" ON "ticket_types"("projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_types_projectId_name_key" ON "ticket_types"("projectId", "name");

-- CreateIndex
CREATE INDEX "labels_projectId_idx" ON "labels"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "labels_projectId_name_key" ON "labels"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_key_key" ON "tickets"("key");

-- CreateIndex
CREATE INDEX "tickets_projectId_statusId_idx" ON "tickets"("projectId", "statusId");

-- CreateIndex
CREATE INDEX "tickets_projectId_isArchived_idx" ON "tickets"("projectId", "isArchived");

-- CreateIndex
CREATE INDEX "tickets_assigneeId_statusId_idx" ON "tickets"("assigneeId", "statusId");

-- CreateIndex
CREATE INDEX "tickets_parentId_idx" ON "tickets"("parentId");

-- CreateIndex
CREATE INDEX "tickets_dueDate_idx" ON "tickets"("dueDate");

-- CreateIndex
CREATE INDEX "tickets_priorityId_idx" ON "tickets"("priorityId");

-- CreateIndex
CREATE INDEX "tickets_typeId_idx" ON "tickets"("typeId");

-- CreateIndex
CREATE INDEX "tickets_reporterId_idx" ON "tickets"("reporterId");

-- CreateIndex
CREATE INDEX "tickets_createdAt_idx" ON "tickets"("createdAt");

-- CreateIndex
CREATE INDEX "tickets_projectId_statusId_position_idx" ON "tickets"("projectId", "statusId", "position");

-- CreateIndex
CREATE INDEX "tickets_recurringTicketId_idx" ON "tickets"("recurringTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_projectId_number_key" ON "tickets"("projectId", "number");

-- CreateIndex
CREATE INDEX "ticket_labels_labelId_idx" ON "ticket_labels"("labelId");

-- CreateIndex
CREATE INDEX "ticket_resources_ticketId_idx" ON "ticket_resources"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_resources_type_idx" ON "ticket_resources"("type");

-- CreateIndex
CREATE INDEX "comments_ticketId_createdAt_idx" ON "comments"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "comments_authorId_idx" ON "comments"("authorId");

-- CreateIndex
CREATE INDEX "comments_parentId_idx" ON "comments"("parentId");

-- CreateIndex
CREATE INDEX "comment_mentions_userId_idx" ON "comment_mentions"("userId");

-- CreateIndex
CREATE INDEX "activity_logs_projectId_createdAt_idx" ON "activity_logs"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_ticketId_createdAt_idx" ON "activity_logs"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_actorId_createdAt_idx" ON "activity_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_entityType_entityId_idx" ON "activity_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "activity_logs_createdAt_idx" ON "activity_logs"("createdAt");

-- CreateIndex
CREATE INDEX "recurring_tickets_projectId_idx" ON "recurring_tickets"("projectId");

-- CreateIndex
CREATE INDEX "recurring_tickets_isActive_nextRunAt_idx" ON "recurring_tickets"("isActive", "nextRunAt");

-- CreateIndex
CREATE INDEX "recurring_ticket_labels_labelId_idx" ON "recurring_ticket_labels"("labelId");

-- CreateIndex
CREATE INDEX "saved_filters_ownerId_idx" ON "saved_filters"("ownerId");

-- CreateIndex
CREATE INDEX "saved_filters_projectId_idx" ON "saved_filters"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_filters_ownerId_name_key" ON "saved_filters"("ownerId", "name");

-- CreateIndex
CREATE INDEX "saved_filter_criteria_savedFilterId_idx" ON "saved_filter_criteria"("savedFilterId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_statuses" ADD CONSTRAINT "template_statuses_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "project_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_priorities" ADD CONSTRAINT "template_priorities_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "project_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_ticket_types" ADD CONSTRAINT "template_ticket_types_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "project_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_labels" ADD CONSTRAINT "template_labels_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "project_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_tickets" ADD CONSTRAINT "template_tickets_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "project_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_tickets" ADD CONSTRAINT "template_tickets_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "template_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_ticket_labels" ADD CONSTRAINT "template_ticket_labels_templateTicketId_fkey" FOREIGN KEY ("templateTicketId") REFERENCES "template_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "project_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_settings" ADD CONSTRAINT "project_settings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_settings" ADD CONSTRAINT "project_settings_defaultAssigneeId_fkey" FOREIGN KEY ("defaultAssigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statuses" ADD CONSTRAINT "statuses_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priorities" ADD CONSTRAINT "priorities_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_priorityId_fkey" FOREIGN KEY ("priorityId") REFERENCES "priorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_recurringTicketId_fkey" FOREIGN KEY ("recurringTicketId") REFERENCES "recurring_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_labels" ADD CONSTRAINT "ticket_labels_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_labels" ADD CONSTRAINT "ticket_labels_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_resources" ADD CONSTRAINT "ticket_resources_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_resources" ADD CONSTRAINT "ticket_resources_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_tickets" ADD CONSTRAINT "recurring_tickets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_tickets" ADD CONSTRAINT "recurring_tickets_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_tickets" ADD CONSTRAINT "recurring_tickets_priorityId_fkey" FOREIGN KEY ("priorityId") REFERENCES "priorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_tickets" ADD CONSTRAINT "recurring_tickets_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_tickets" ADD CONSTRAINT "recurring_tickets_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_tickets" ADD CONSTRAINT "recurring_tickets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_ticket_labels" ADD CONSTRAINT "recurring_ticket_labels_recurringTicketId_fkey" FOREIGN KEY ("recurringTicketId") REFERENCES "recurring_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_ticket_labels" ADD CONSTRAINT "recurring_ticket_labels_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_filter_criteria" ADD CONSTRAINT "saved_filter_criteria_savedFilterId_fkey" FOREIGN KEY ("savedFilterId") REFERENCES "saved_filters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

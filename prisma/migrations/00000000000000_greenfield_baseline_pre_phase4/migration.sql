-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "OrgAccessMode" AS ENUM ('FIXED', 'MULTI_ORG', 'PLATFORM_SUPPORT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "nickname" TEXT,
    "avatar" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authProvider" TEXT NOT NULL DEFAULT 'email',
    "inviteCodeId" TEXT,
    "wechatOpenId" TEXT,
    "salesRepInitials" TEXT,
    "canEditCustomers" BOOLEAN NOT NULL DEFAULT true,
    "companyIdsJson" TEXT,
    "activeOrgId" TEXT,
    "orgAccessMode" "OrgAccessMode" NOT NULL DEFAULT 'FIXED',
    "canSelfSwitchOrg" BOOLEAN NOT NULL DEFAULT false,
    "salesMonthlyTargetCad" DOUBLE PRECISION,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailBinding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'smtp',
    "smtpHost" TEXT,
    "smtpPort" INTEGER DEFAULT 587,
    "smtpUser" TEXT,
    "smtpPass" TEXT,
    "useTls" BOOLEAN NOT NULL DEFAULT true,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "label" TEXT,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyIdsJson" TEXT,

    CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#3B82F6',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "category" TEXT,
    "clientOrganization" TEXT,
    "currency" TEXT,
    "estimatedValue" DOUBLE PRECISION,
    "location" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "solicitationNumber" TEXT,
    "sourceMetadataJson" TEXT,
    "sourcePlatform" TEXT,
    "sourceSystem" TEXT,
    "tenderStatus" TEXT,
    "workflowTemplate" TEXT,
    "awardDate" TIMESTAMP(3),
    "closeDate" TIMESTAMP(3),
    "distributedAt" TIMESTAMP(3),
    "interpretedAt" TIMESTAMP(3),
    "publicDate" TIMESTAMP(3),
    "questionCloseDate" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "supplierQuotedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "dispatchedById" TEXT,
    "intakeStatus" TEXT NOT NULL DEFAULT 'dispatched',
    "supplierInquiredAt" TIMESTAMP(3),
    "abandonedAt" TIMESTAMP(3),
    "abandonedById" TEXT,
    "abandonedReason" TEXT,
    "abandonedStage" TEXT,
    "ourBidPrice" DOUBLE PRECISION,
    "winningBidPrice" DOUBLE PRECISION,
    "projectTypes" JSONB,
    "aiAdviceStatus" TEXT,
    "purchaserId" TEXT,
    "openDate" TIMESTAMP(3),
    "workspaceId" TEXT,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "dueDate" TIMESTAMP(3),
    "needReminder" BOOLEAN NOT NULL DEFAULT false,
    "followupAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT,
    "assigneeId" TEXT,
    "creatorId" TEXT NOT NULL,
    "blockedReason" TEXT,
    "waitingOn" TEXT,
    "waitingUntil" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskActivity" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,

    CONSTRAINT "TaskActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6B7280',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagOnTask" (
    "taskId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "TagOnTask_pkey" PRIMARY KEY ("taskId","tagId")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "reminderMinutes" INTEGER NOT NULL DEFAULT 15,
    "source" TEXT NOT NULL DEFAULT 'qingyan',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "taskId" TEXT,
    "userId" TEXT NOT NULL,
    "sourceKey" TEXT,
    "projectId" TEXT,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlindsOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "ruleVersion" TEXT NOT NULL DEFAULT 'blinds_20251024_v1',
    "customerName" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "installDate" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "creatorId" TEXT NOT NULL,
    "projectId" TEXT,
    "customerId" TEXT,
    "opportunityId" TEXT,
    "appointmentId" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "expectedInstallDate" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "productionStartAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),

    CONSTRAINT "BlindsOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "note" TEXT,
    "operatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlindsOrderItem" (
    "id" TEXT NOT NULL,
    "itemNumber" INTEGER NOT NULL,
    "location" TEXT NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "fabricSku" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "measureType" TEXT NOT NULL,
    "controlType" TEXT NOT NULL,
    "controlSide" TEXT NOT NULL,
    "headrailType" TEXT NOT NULL,
    "mountType" TEXT NOT NULL,
    "fabricRatio" DOUBLE PRECISION,
    "silkRatio" DOUBLE PRECISION,
    "bottomBarWidth" DOUBLE PRECISION,
    "itemRemark" TEXT,
    "cutHeadrail" DOUBLE PRECISION,
    "cutTube38" DOUBLE PRECISION,
    "cutRollerBar" DOUBLE PRECISION,
    "cutZebraBar" DOUBLE PRECISION,
    "cutCoreRod" DOUBLE PRECISION,
    "cutShangrilaBar" DOUBLE PRECISION,
    "cutFabricWidth" DOUBLE PRECISION,
    "cutFabricLength" DOUBLE PRECISION,
    "insertSize" DOUBLE PRECISION,
    "cordLength" DOUBLE PRECISION,
    "cordSleeveLen" DOUBLE PRECISION,
    "squareFeet" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "BlindsOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FabricInventory" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "fabricName" TEXT NOT NULL,
    "color" TEXT,
    "supplier" TEXT,
    "totalYards" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reservedYards" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minYards" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'in_stock',
    "lastRestockAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FabricInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FabricStockLog" (
    "id" TEXT NOT NULL,
    "fabricId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "yards" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "operatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FabricStockLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "triggerAt" TIMESTAMP(3) NOT NULL,
    "readAt" TIMESTAMP(3),
    "taskId" TEXT,
    "eventId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarProvider" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "accountEmail" TEXT,
    "calendarId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CalendarProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "planType" TEXT NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "modulesJson" JSONB,
    "settingsJson" JSONB,
    "industryPackId" TEXT,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'department',
    "status" TEXT NOT NULL DEFAULT 'active',
    "description" TEXT,
    "settingsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationProjectRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "sourceProjectId" TEXT,
    "sourceReviewId" TEXT,
    "sourceInsightId" TEXT,
    "evidenceJson" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationProjectRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'org_member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "principalType" TEXT NOT NULL DEFAULT 'HUMAN',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermissionBinding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleProfileId" TEXT NOT NULL,
    "permissionKey" TEXT NOT NULL,
    "dataScope" TEXT NOT NULL,
    "effect" TEXT NOT NULL DEFAULT 'ALLOW',
    "conditionsJson" JSONB,

    CONSTRAINT "RolePermissionBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrincipalRoleBinding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "roleProfileId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrincipalRoleBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "principalType" TEXT NOT NULL DEFAULT 'HUMAN',
    "status" TEXT NOT NULL DEFAULT 'active',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "primaryRoleProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PositionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'operator',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Environment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Environment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prompt" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'system',
    "status" TEXT NOT NULL DEFAULT 'active',
    "activeVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "note" TEXT,
    "sourceVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptPublishLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "promptKey" TEXT NOT NULL,
    "fromEnvironmentId" TEXT NOT NULL,
    "toEnvironmentId" TEXT NOT NULL,
    "fromVersionId" TEXT NOT NULL,
    "toVersionId" TEXT NOT NULL,
    "publishedById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptPublishLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeBase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "activeVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeBaseVersion" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "note" TEXT,
    "sourceVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeBaseVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "knowledgeBaseVersionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "summary" TEXT,
    "note" TEXT,
    "sourceVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgePublishLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "knowledgeBaseKey" TEXT NOT NULL,
    "fromEnvironmentId" TEXT NOT NULL,
    "toEnvironmentId" TEXT NOT NULL,
    "fromKnowledgeBaseVersionId" TEXT NOT NULL,
    "toKnowledgeBaseVersionId" TEXT NOT NULL,
    "publishedById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgePublishLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "channel" TEXT NOT NULL DEFAULT 'web',
    "status" TEXT NOT NULL DEFAULT 'active',
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgLatencyMs" INTEGER NOT NULL DEFAULT 0,
    "promptId" TEXT,
    "promptVersionId" TEXT,
    "knowledgeBaseId" TEXT,
    "knowledgeBaseVersionId" TEXT,
    "agentId" TEXT,
    "runtimeStatus" TEXT NOT NULL DEFAULT 'idle',
    "lastErrorMessage" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "contentType" TEXT NOT NULL DEFAULT 'text',
    "sequence" INTEGER NOT NULL,
    "modelName" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'success',
    "errorMessage" TEXT,
    "finishReason" TEXT,
    "toolName" TEXT,
    "toolCallId" TEXT,
    "parentMessageId" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationContextSnapshot" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "promptId" TEXT,
    "promptVersionId" TEXT,
    "promptKey" TEXT,
    "knowledgeBaseId" TEXT,
    "knowledgeBaseVersionId" TEXT,
    "knowledgeBaseKey" TEXT,
    "environmentId" TEXT,
    "systemPromptSnapshot" TEXT,
    "retrievalConfigJson" TEXT,
    "extraConfigJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationContextSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "beforeData" TEXT,
    "afterData" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" TEXT,
    "traceId" TEXT,
    "riskLevel" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'chat',
    "status" TEXT NOT NULL DEFAULT 'active',
    "promptId" TEXT,
    "promptVersionId" TEXT,
    "knowledgeBaseId" TEXT,
    "knowledgeBaseVersionId" TEXT,
    "modelProvider" TEXT NOT NULL DEFAULT 'openai',
    "modelName" TEXT NOT NULL DEFAULT 'gpt-5.2',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "systemBehaviorNote" TEXT,
    "extraConfigJson" TEXT,
    "activeVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentVersion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "configSnapshotJson" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolRegistry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'builtin',
    "type" TEXT NOT NULL DEFAULT 'function',
    "status" TEXT NOT NULL DEFAULT 'active',
    "inputSchemaJson" TEXT,
    "outputSchemaJson" TEXT,
    "configJson" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToolBinding" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "configOverrideJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentToolBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCallTrace" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "agentId" TEXT,
    "toolId" TEXT,
    "toolKey" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolCallId" TEXT,
    "inputJson" TEXT,
    "outputJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'success',
    "errorMessage" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCallTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationFeedback" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "agentId" TEXT,
    "promptId" TEXT,
    "promptVersionId" TEXT,
    "knowledgeBaseId" TEXT,
    "knowledgeBaseVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 0,
    "scoreAccuracy" INTEGER,
    "scoreHelpfulness" INTEGER,
    "scoreSafety" INTEGER,
    "scoreCompleteness" INTEGER,
    "sentiment" TEXT NOT NULL DEFAULT 'neutral',
    "issueType" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageFeedback" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "agentId" TEXT,
    "createdById" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 0,
    "issueType" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationTag" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'quality',
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationFeedbackTag" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationFeedbackTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageFeedbackTag" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageFeedbackTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'manual',
    "judgeModel" TEXT,
    "judgeVersion" TEXT,
    "criteriaJson" TEXT,
    "resultJson" TEXT,
    "score" DOUBLE PRECISION,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'update',
    "category" TEXT NOT NULL DEFAULT 'update',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "activityId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unread',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "dueAt" TIMESTAMP(3),
    "snoozeUntil" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "sourceKey" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "enableInAppNotifications" BOOLEAN NOT NULL DEFAULT true,
    "onlyHighPriority" BOOLEAN NOT NULL DEFAULT false,
    "onlyMyItems" BOOLEAN NOT NULL DEFAULT false,
    "includeWatchedProjects" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledTypesJson" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectNotificationRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "watchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notifyProjectUpdates" BOOLEAN NOT NULL DEFAULT true,
    "notifyRuntimeFailed" BOOLEAN NOT NULL DEFAULT true,
    "notifyFeedbackCreated" BOOLEAN NOT NULL DEFAULT true,
    "notifyLowEvaluations" BOOLEAN NOT NULL DEFAULT true,
    "notifyTaskDue" BOOLEAN NOT NULL DEFAULT true,
    "minimumPriority" TEXT NOT NULL DEFAULT 'medium',
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectNotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalReference" (
    "id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectIntelligence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "fitScore" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "fullReportUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fullReportJson" TEXT,
    "reportMarkdown" TEXT,
    "reportStatus" TEXT NOT NULL DEFAULT 'ai_generated',
    "reviewNotes" TEXT,
    "reviewScore" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "structuredSummaryJson" TEXT,

    CONSTRAINT "ProjectIntelligence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectInsight" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'chat',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "embedding" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSimilarity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT NOT NULL,
    "similarProjectId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reasonsJson" TEXT NOT NULL,
    "impactText" TEXT,
    "recommendationsJson" TEXT,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectSimilarity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectReview" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "outcome" TEXT,
    "priceAnalysisJson" TEXT,
    "reasonTagsJson" TEXT,
    "narrative" TEXT,
    "customerFeedback" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectGeneratedDocument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "blobUrl" TEXT,
    "fileUrl" TEXT,
    "metaJson" TEXT,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectGeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectProgressSummary" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "overallStatus" TEXT NOT NULL,
    "statusLabel" TEXT NOT NULL,
    "outputJson" TEXT NOT NULL,
    "executiveSummary" TEXT,
    "docType" TEXT NOT NULL DEFAULT 'project_progress_summary',
    "promptVersion" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "usedFallback" BOOLEAN NOT NULL DEFAULT false,
    "generationTimeMs" INTEGER NOT NULL DEFAULT 0,
    "metaJson" TEXT,
    "reportStatus" TEXT NOT NULL DEFAULT 'ai_generated',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "reviewScore" INTEGER,
    "triggerType" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectProgressSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDocument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blobUrl" TEXT,
    "fileSize" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'external_link',
    "uploadedById" TEXT,
    "contentText" TEXT,
    "parseError" TEXT,
    "parseStatus" TEXT NOT NULL DEFAULT 'pending',
    "aiSummaryJson" TEXT,
    "aiSummaryStatus" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "permissions" TEXT NOT NULL DEFAULT 'project:create',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastCalledAt" TIMESTAMP(3),
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectConversation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'MAIN',
    "title" TEXT NOT NULL DEFAULT '项目讨论',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "senderId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "replyToId" TEXT,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL DEFAULT '新对话',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT,

    CONSTRAINT "AiThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "workSuggestion" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingAction" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdById" TEXT NOT NULL,
    "threadId" TEXT,
    "messageId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "resultRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT,
    "approverUserId" TEXT,
    "requiredRole" TEXT,
    "decidedById" TEXT,
    "agentRunId" TEXT,
    "workspaceId" TEXT,
    "payloadVersion" INTEGER,
    "payloadHash" TEXT,
    "policyVersion" TEXT,
    "resourceVersion" TEXT,
    "idempotencyKey" TEXT,

    CONSTRAINT "PendingAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecisionIdempotency" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "approvalKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecisionIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "category" TEXT,
    "region" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "brochureUrl" TEXT,
    "brochureParseStatus" TEXT,
    "brochureParseResult" JSONB,
    "brochureParseWarning" TEXT,
    "aiClassification" JSONB,
    "capabilities" TEXT,
    "lastContactAt" TIMESTAMP(3),
    "rating" DOUBLE PRECISION DEFAULT 0,
    "ratingDetail" JSONB,
    "source" TEXT,
    "sourceDetail" TEXT,
    "tags" TEXT,
    "website" TEXT,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectInquiry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT,
    "scope" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "dueDate" TIMESTAMP(3),
    "token" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquiryItem" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentVia" TEXT,
    "sentAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "unitPrice" DECIMAL(18,2),
    "totalPrice" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "deliveryDays" INTEGER,
    "validUntil" TIMESTAMP(3),
    "quoteNotes" TEXT,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "contactNotes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InquiryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectQuote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "templateType" TEXT NOT NULL DEFAULT 'export_standard',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "tradeTerms" TEXT,
    "paymentTerms" TEXT,
    "deliveryDays" INTEGER,
    "validUntil" TIMESTAMP(3),
    "moq" INTEGER,
    "originCountry" TEXT,
    "subtotal" DECIMAL(18,2),
    "totalAmount" DECIMAL(18,2),
    "internalCost" DECIMAL(18,2),
    "profitMargin" DECIMAL(5,2),
    "internalNotes" TEXT,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiDraftJson" TEXT,
    "aiReviewJson" TEXT,
    "inquiryId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLineItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL DEFAULT 'product',
    "itemName" TEXT NOT NULL,
    "specification" TEXT,
    "unit" TEXT,
    "quantity" DECIMAL(18,2),
    "unitPrice" DECIMAL(18,2),
    "totalPrice" DECIMAL(18,2),
    "remarks" TEXT,
    "costPrice" DECIMAL(18,2),
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailProvider" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'gmail',
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "accountEmail" TEXT NOT NULL,
    "grantedScopes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEmail" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "inquiryId" TEXT,
    "inquiryItemId" TEXT,
    "toEmail" TEXT NOT NULL,
    "toName" TEXT,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "provider" TEXT NOT NULL DEFAULT 'gmail',
    "externalMessageId" TEXT,
    "errorMessage" TEXT,
    "createdById" TEXT NOT NULL,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectQuestion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "orgId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "locationOrReference" TEXT,
    "clarificationNeeded" TEXT,
    "impactNote" TEXT,
    "generatedSubject" TEXT,
    "generatedBody" TEXT,
    "toRecipients" TEXT,
    "ccRecipients" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "emailId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL DEFAULT 'custom',
    "triggerType" TEXT NOT NULL DEFAULT 'manual',
    "intent" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL DEFAULT 'low',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "totalSteps" INTEGER NOT NULL DEFAULT 0,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "parentTaskId" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assignedAgentKey" TEXT,
    "instruction" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "blockedReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "inputSnapshot" JSONB,
    "structuredResult" JSONB,
    "reviewStatus" TEXT,
    "returnedForRevisionReason" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "invalidationReason" TEXT,
    "invalidationCount" INTEGER NOT NULL DEFAULT 0,
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "cancelRequestedAt" TIMESTAMP(3),

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTaskStep" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "skillId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'low',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "inputJson" TEXT,
    "outputJson" TEXT,
    "outputSummary" TEXT,
    "checkReportJson" TEXT,
    "confidence" DOUBLE PRECISION,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionNote" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTaskStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "riskReason" TEXT,
    "previewJson" TEXT,
    "approverUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "deadlineAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decisionNote" TEXT,
    "acceptedWithRisk" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFlowTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "category" TEXT NOT NULL DEFAULT 'custom',
    "stepsJson" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFlowTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeCampaign" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productDesc" TEXT NOT NULL,
    "targetMarket" TEXT NOT NULL,
    "searchKeywords" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "scoreThreshold" DOUBLE PRECISION NOT NULL DEFAULT 7,
    "totalProspects" INTEGER NOT NULL DEFAULT 0,
    "qualified" INTEGER NOT NULL DEFAULT 0,
    "contacted" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeProspect" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactTitle" TEXT,
    "website" TEXT,
    "country" TEXT,
    "source" TEXT NOT NULL DEFAULT 'google',
    "researchReport" JSONB,
    "score" DOUBLE PRECISION,
    "scoreReason" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "outreachSubject" TEXT,
    "outreachBody" TEXT,
    "outreachLang" TEXT DEFAULT 'en',
    "outreachSentAt" TIMESTAMP(3),
    "lastContactAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "websiteCandidates" JSONB,
    "websiteConfidence" DOUBLE PRECISION,
    "websiteCandidateSource" TEXT,
    "websiteVerifiedAt" TIMESTAMP(3),
    "websiteVerifiedBy" TEXT,
    "researchStatus" TEXT,
    "researchWarnings" JSONB,
    "crawlStatus" TEXT,
    "crawlSourceType" TEXT,
    "sourcesCount" INTEGER,
    "lastResearchError" VARCHAR(2000),
    "lastResearchedAt" TIMESTAMP(3),
    "convertedToSalesCustomerId" TEXT,
    "convertedToSalesOpportunityId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedById" TEXT,
    "ownerId" TEXT,

    CONSTRAINT "TradeProspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeWatchTarget" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "prospectId" TEXT,
    "url" TEXT NOT NULL,
    "pageType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastContentHash" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastChangedAt" TIMESTAMP(3),
    "lastFetchError" VARCHAR(500),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeWatchTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeSignal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "watchTargetId" TEXT NOT NULL,
    "prospectId" TEXT,
    "signalType" TEXT NOT NULL DEFAULT 'page_text_changed',
    "strength" TEXT NOT NULL DEFAULT 'low',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketCompetitor" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "normalizedDomain" TEXT NOT NULL,
    "targetGeography" TEXT,
    "primaryProduct" TEXT,
    "salesModel" TEXT DEFAULT '询价报价 + 预约量房',
    "watchFocus" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketCompetitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketMonitor" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'firecrawl',
    "providerMonitorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'provisioning',
    "scheduleText" TEXT NOT NULL DEFAULT 'weekly',
    "scheduleCron" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "goal" TEXT NOT NULL,
    "targetUrls" JSONB NOT NULL,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastCheckId" TEXT,
    "lastError" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "providerEventId" TEXT,
    "providerCheckId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "pageStatus" TEXT NOT NULL,
    "isMeaningful" BOOLEAN,
    "diffJson" JSONB,
    "snapshotJson" JSONB,
    "judgmentJson" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSignal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'low',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidenceJson" JSONB,
    "analysisStatus" TEXT NOT NULL DEFAULT 'queued',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "analysisAttempts" INTEGER NOT NULL DEFAULT 0,
    "analysisNextAttemptAt" TIMESTAMP(3),
    "analysisLeaseExpiresAt" TIMESTAMP(3),
    "analysisLastError" VARCHAR(2000),

    CONSTRAINT "MarketSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketAnalysisRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "signalId" TEXT,
    "skillExecutionId" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'webhook',
    "status" TEXT NOT NULL DEFAULT 'running',
    "inputJson" JSONB,
    "outputMarkdown" TEXT,
    "error" VARCHAR(2000),
    "createdById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketAnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketResearchRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "inputJson" JSONB NOT NULL,
    "outputMarkdown" TEXT,
    "errorCode" TEXT,
    "error" VARCHAR(2000),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "primaryModel" TEXT NOT NULL,
    "fallbackModel" TEXT,
    "modelUsed" TEXT,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "skillExecutionId" TEXT,
    "createdById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT,
    "planId" TEXT,
    "pendingActionId" TEXT,
    "actionDraftJson" JSONB,
    "planStatus" TEXT NOT NULL DEFAULT 'none',

    CONSTRAINT "MarketResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeMessage" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "subject" TEXT,
    "content" TEXT NOT NULL,
    "intent" TEXT,
    "sentiment" TEXT,
    "aiDraft" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeChatSession" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '新对话',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolName" TEXT,
    "toolInput" JSONB,
    "toolOutput" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeIntelligenceCase" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "productName" TEXT,
    "brand" TEXT,
    "upc" TEXT,
    "gtin" TEXT,
    "sku" TEXT,
    "mpn" TEXT,
    "productUrl" TEXT,
    "retailerName" TEXT,
    "category" TEXT,
    "material" TEXT,
    "size" TEXT,
    "color" TEXT,
    "countryOfOrigin" TEXT,
    "notes" TEXT,
    "structuredProduct" JSONB,
    "searchQueries" JSONB,
    "evidence" JSONB,
    "buyerCandidates" JSONB,
    "retailerCandidates" JSONB,
    "importerCandidates" JSONB,
    "supplierCandidates" JSONB,
    "contactCandidates" JSONB,
    "recommendedProspects" JSONB,
    "analysisReport" TEXT,
    "confidenceScore" DOUBLE PRECISION,
    "lastRunAt" TIMESTAMP(3),
    "lastError" VARCHAR(2000),
    "convertedProspectId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeIntelligenceCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeIntelligenceAsset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "extractedText" JSONB,
    "extractedFields" JSONB,
    "confidence" DOUBLE PRECISION,
    "warnings" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeIntelligenceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeServiceRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fulfillmentOrgId" TEXT,
    "requestType" TEXT NOT NULL DEFAULT 'other',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "structuredSpec" JSONB,
    "status" TEXT NOT NULL DEFAULT 'new',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "sourceChannel" TEXT,
    "externalUserId" TEXT,
    "bindingId" TEXT,
    "createdById" TEXT,
    "assigneeId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeServiceAsset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "meta" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeServiceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeChannel" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "config" JSONB NOT NULL,
    "webhookSecret" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeActivityLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "prospectId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeQuote" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "prospectId" TEXT,
    "campaignId" TEXT,
    "quoteNumber" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "country" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "incoterm" TEXT NOT NULL DEFAULT 'FOB',
    "paymentTerms" TEXT,
    "validDays" INTEGER NOT NULL DEFAULT 30,
    "leadTimeDays" INTEGER,
    "moq" TEXT,
    "shippingPort" TEXT,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shippingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "internalNotes" TEXT,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeQuoteItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "productName" TEXT NOT NULL,
    "specification" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remarks" TEXT,

    CONSTRAINT "TradeQuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeKnowledge" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT,
    "language" TEXT NOT NULL DEFAULT 'zh',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgKnowledgeDocument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "tags" TEXT,
    "language" TEXT NOT NULL DEFAULT 'zh',
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "sourcePath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgKnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeEmailTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "variables" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeEmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesCustomer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "source" TEXT,
    "wechatNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "tags" TEXT,
    "notes" TEXT,
    "jdyDataId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "orgId" TEXT NOT NULL,

    CONSTRAINT "SalesCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOpportunity" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'new_lead',
    "estimatedValue" DOUBLE PRECISION,
    "windowCount" INTEGER,
    "productTypes" TEXT,
    "source" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'warm',
    "lostReason" TEXT,
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "nextFollowupAt" TIMESTAMP(3),
    "measureDate" TIMESTAMP(3),
    "installDate" TIMESTAMP(3),
    "jdyDataId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "sourceTradeProspectId" TEXT,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "SalesOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerInteraction" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "type" TEXT NOT NULL,
    "direction" TEXT,
    "summary" TEXT NOT NULL,
    "content" TEXT,
    "emailMessageId" TEXT,
    "attachments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "channel" TEXT,
    "language" TEXT,
    "outcome" TEXT,
    "rawMessages" TEXT,
    "sentiment" TEXT,
    "topicTags" TEXT,
    "analysisResult" JSONB,
    "analysisStatus" TEXT,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "CustomerInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesQuote" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT,
    "customerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "installMode" TEXT NOT NULL DEFAULT 'default',
    "merchSubtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "addonsSubtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "installSubtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "installApplied" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "preTaxTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0.13,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "sentAt" TIMESTAMP(3),
    "emailMessageId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "aiSource" TEXT,
    "shareToken" TEXT,
    "signatureUrl" TEXT,
    "signedAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "formDataJson" TEXT,
    "orderNumber" TEXT,
    "totalMsrp" DOUBLE PRECISION,
    "specialPromotion" DOUBLE PRECISION DEFAULT 0,
    "finalDiscountPct" DOUBLE PRECISION,
    "depositAmount" DOUBLE PRECISION,
    "depositMethod" TEXT,
    "depositCollectedAt" TIMESTAMP(3),
    "depositCollectedById" TEXT,
    "depositNote" TEXT,
    "agreedDepositAmount" DOUBLE PRECISION,
    "agreedBalanceAmount" DOUBLE PRECISION,
    "orgId" TEXT NOT NULL,
    "sourceTradeQuoteId" TEXT,
    "pdfPath" TEXT,
    "signedPdfPath" TEXT,

    CONSTRAINT "SalesQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteDiscountSettings" (
    "id" TEXT NOT NULL,
    "zebra" DOUBLE PRECISION NOT NULL DEFAULT 0.45,
    "shangrila" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "cellular" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "roller" DOUBLE PRECISION NOT NULL DEFAULT 0.45,
    "drapery" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "sheer" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "shutters" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "honeycomb" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "promoWarnPct" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "promoDangerPct" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "promoMaxPct" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "depositWarnPct" DOUBLE PRECISION NOT NULL DEFAULT 0.40,
    "depositMinPct" DOUBLE PRECISION NOT NULL DEFAULT 0.30,
    "depositOverrideCode" TEXT,
    "orgId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lineDiscountUnlockCodeHash" TEXT,

    CONSTRAINT "QuoteDiscountSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgBusinessRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "configJson" JSONB NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgBusinessRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationGlossaryTerm" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "scopeKey" TEXT NOT NULL DEFAULT 'org',
    "canonicalTerm" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "aliasesJson" JSONB NOT NULL DEFAULT '[]',
    "category" TEXT NOT NULL DEFAULT 'general',
    "language" TEXT NOT NULL DEFAULT 'zh',
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationGlossaryTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessObjectDefinition" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "industryPackId" TEXT,
    "objectKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "aliasesJson" JSONB NOT NULL DEFAULT '[]',
    "sourceModel" TEXT,
    "idField" TEXT DEFAULT 'id',
    "statusField" TEXT,
    "allowedStatusesJson" JSONB,
    "relationDefinitionsJson" JSONB,
    "riskFieldsJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessObjectDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessMetricDefinition" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'operations',
    "unit" TEXT NOT NULL DEFAULT 'count',
    "direction" TEXT NOT NULL DEFAULT 'higher_better',
    "sourceType" TEXT NOT NULL DEFAULT 'query',
    "sourceConfigJson" JSONB NOT NULL DEFAULT '{}',
    "warningThresholdJson" JSONB,
    "targetValueJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessMetricDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSkillBinding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "skillKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "paramsJson" JSONB,
    "allowOrgRolesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSkillBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceKnowledgeBinding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceKnowledgeBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesQuoteItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "product" TEXT NOT NULL,
    "fabric" TEXT NOT NULL,
    "sku" TEXT,
    "widthIn" DOUBLE PRECISION NOT NULL,
    "heightIn" DOUBLE PRECISION NOT NULL,
    "bracketWidth" DOUBLE PRECISION,
    "bracketHeight" DOUBLE PRECISION,
    "cordless" BOOLEAN NOT NULL DEFAULT false,
    "msrp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "installFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "location" TEXT,
    "roomId" TEXT,

    CONSTRAINT "SalesQuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesQuoteAddon" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "addonKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "SalesQuoteAddon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRoom" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "windowWidth" DOUBLE PRECISION,
    "windowHeight" DOUBLE PRECISION,
    "remarks" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuoteRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomAttachment" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL DEFAULT 'image',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'measure',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT,
    "contactPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "cancelReason" TEXT,
    "assignedToId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "googleEventId" TEXT,
    "googleSyncedAt" TIMESTAMP(3),

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementRecord" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "appointmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "overallNotes" TEXT,
    "measuredById" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasurementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementWindow" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "windowLabel" TEXT,
    "widthIn" DOUBLE PRECISION NOT NULL,
    "heightIn" DOUBLE PRECISION NOT NULL,
    "measureType" TEXT NOT NULL DEFAULT 'IN',
    "product" TEXT,
    "fabric" TEXT,
    "cordless" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MeasurementWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementPhoto" (
    "id" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeasurementPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesPlaybook" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "scene" TEXT NOT NULL,
    "sceneLabel" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "example" TEXT,
    "effectiveness" INTEGER NOT NULL DEFAULT 0,
    "sourceInteractionId" TEXT,
    "tags" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "embedding" vector,
    "sourceType" TEXT,

    CONSTRAINT "SalesPlaybook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesFAQ" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "categoryLabel" TEXT NOT NULL,
    "productTags" TEXT,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "sourceInteractionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "embedding" vector,

    CONSTRAINT "SalesFAQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memoryType" TEXT NOT NULL,
    "layer" INTEGER NOT NULL DEFAULT 1,
    "content" TEXT NOT NULL,
    "tags" TEXT,
    "sourceThreadId" TEXT,
    "customerId" TEXT,
    "projectId" TEXT,
    "importance" INTEGER NOT NULL DEFAULT 3,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "embedding" JSONB,
    "supersededById" TEXT,
    "orgId" TEXT NOT NULL,
    "supersedesId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSkill" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'foundation',
    "systemPrompt" TEXT NOT NULL,
    "userPromptTemplate" TEXT NOT NULL,
    "outputFormat" TEXT NOT NULL DEFAULT 'text',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "maxTokens" INTEGER NOT NULL DEFAULT 2000,
    "inputSchema" JSONB,
    "outputSchema" JSONB,
    "requiredTools" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "lastOptimizedAt" TIMESTAMP(3),
    "optimizationCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillExecution" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inputJson" TEXT NOT NULL,
    "outputJson" TEXT,
    "toolCalls" JSONB,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "durationMs" INTEGER,
    "tokenCount" INTEGER,
    "userRating" INTEGER,
    "userFeedback" TEXT,
    "wasEdited" BOOLEAN NOT NULL DEFAULT false,
    "promptSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageEmbedding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sessionTitle" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationSummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sessionTitle" TEXT,
    "summary" TEXT NOT NULL,
    "keyTopics" TEXT,
    "keyDecisions" TEXT,
    "messageCount" INTEGER NOT NULL,
    "tokenEstimate" INTEGER,
    "embedding" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeChatBinding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastActiveAt" TIMESTAMP(3),
    "pushBriefing" BOOLEAN NOT NULL DEFAULT true,
    "pushFollowup" BOOLEAN NOT NULL DEFAULT true,
    "pushReport" BOOLEAN NOT NULL DEFAULT true,
    "pushSales" BOOLEAN NOT NULL DEFAULT false,
    "silentStart" TEXT,
    "silentEnd" TEXT,
    "pushDomains" TEXT NOT NULL DEFAULT 'trade',
    "filterMode" TEXT NOT NULL DEFAULT 'all',
    "filterKeyword" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeChatBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeChatGateway" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "botNickname" TEXT,
    "loginStatus" TEXT NOT NULL DEFAULT 'disconnected',
    "corpId" TEXT,
    "agentId" TEXT,
    "secret" TEXT,
    "callbackToken" TEXT,
    "encodingKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "lastHeartbeat" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "botBaseUrl" TEXT,
    "botToken" TEXT,
    "getUpdatesBuf" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'assistant',
    "fulfillmentOrgId" TEXT,

    CONSTRAINT "WeChatGateway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeChatContext" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "contextToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeChatContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeChatGraderContext" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalUserId" TEXT,
    "contextData" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeChatGraderContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeChatMessage" (
    "id" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'text',
    "externalMsgId" TEXT,
    "agentProcessed" BOOLEAN NOT NULL DEFAULT false,
    "agentResponse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "channel" TEXT NOT NULL,
    "channelUserId" TEXT,
    "channelConversationId" TEXT,
    "currentProjectId" TEXT,
    "currentCustomerId" TEXT,
    "currentOpportunityId" TEXT,
    "currentQuoteId" TEXT,
    "lastResponseId" TEXT,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userMessageId" TEXT,
    "runType" TEXT NOT NULL DEFAULT 'conversation',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "model" TEXT,
    "intent" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "supervisorState" JSONB,
    "traceId" TEXT,
    "parentRunId" TEXT,
    "planJson" JSONB,
    "runtimeVersion" TEXT,
    "agentTaskId" TEXT,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunStep" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dependsOnJson" JSONB NOT NULL DEFAULT '[]',
    "preferredTool" TEXT,
    "executionMode" TEXT NOT NULL DEFAULT 'read',
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "inputJson" JSONB,
    "outputJson" JSONB,
    "evidenceJson" JSONB,
    "pendingActionId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "idempotencyKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunVerification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "satisfiedCriteriaJson" JSONB NOT NULL DEFAULT '[]',
    "unsatisfiedCriteriaJson" JSONB NOT NULL DEFAULT '[]',
    "evidenceReferencesJson" JSONB NOT NULL DEFAULT '[]',
    "repairInstructionsJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRunVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "title" TEXT,
    "payload" JSONB,
    "visibleToUser" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceConversation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "lastCustomerMessageAt" TIMESTAMP(3),
    "lastReplyAt" TIMESTAMP(3),
    "unansweredSince" TIMESTAMP(3),
    "reminderLevel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'text',
    "externalMsgId" TEXT,
    "sentByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "customerId" TEXT,
    "opportunityId" TEXT,
    "interactionId" TEXT,
    "content" TEXT NOT NULL,
    "embedding" vector,
    "metadata" JSONB,
    "tags" TEXT[],
    "language" TEXT NOT NULL DEFAULT 'en',
    "sentiment" TEXT,
    "intent" TEXT,
    "objectionType" TEXT,
    "isWinPattern" BOOLEAN NOT NULL DEFAULT false,
    "isLossSignal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesInsight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "insightType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "embedding" vector,
    "dealStage" TEXT,
    "productType" TEXT,
    "customerTags" TEXT[],
    "objectionType" TEXT,
    "effectiveness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "sourceChunkIds" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerProfile" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerType" TEXT,
    "decisionRole" TEXT,
    "budgetRange" TEXT,
    "priceSensitivity" DOUBLE PRECISION,
    "communicationStyle" TEXT,
    "preferredChannel" TEXT,
    "responseSpeed" TEXT,
    "decisionSpeed" TEXT,
    "productPreferences" TEXT[],
    "roomTypes" TEXT[],
    "keyNeeds" TEXT[],
    "objectionHistory" TEXT[],
    "winProbability" DOUBLE PRECISION,
    "estimatedLifetimeValue" DOUBLE PRECISION,
    "churnRisk" DOUBLE PRECISION,
    "acquisitionChannel" TEXT,
    "referralSource" TEXT,
    "contentEngagement" JSONB,
    "segment" TEXT,
    "campaignIds" TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastAnalyzedAt" TIMESTAMP(3),
    "analysisVersion" INTEGER NOT NULL DEFAULT 1,
    "embedding" vector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachingRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "insightId" TEXT,
    "coachingType" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "context" JSONB,
    "adopted" BOOLEAN,
    "adoptedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "daysToOutcome" INTEGER,
    "dealValue" DOUBLE PRECISION,
    "contributionScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualizerSession" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '可视化方案',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "customerId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "quoteId" TEXT,
    "measurementRecordId" TEXT,
    "createdById" TEXT NOT NULL,
    "salesOwnerId" TEXT,
    "shareToken" TEXT,
    "shareExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisualizerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualizerSourceImage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "measurementPhotoId" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "roomLabel" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualizerSourceImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualizerWindowRegion" (
    "id" TEXT NOT NULL,
    "sourceImageId" TEXT NOT NULL,
    "measurementWindowId" TEXT,
    "label" TEXT,
    "shape" TEXT NOT NULL DEFAULT 'polygon',
    "pointsJson" JSONB NOT NULL,
    "widthIn" DOUBLE PRECISION,
    "heightIn" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualizerWindowRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualizerVariant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "exportImageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisualizerVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualizerProductOption" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "productCatalogId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productCategory" TEXT NOT NULL,
    "color" TEXT,
    "colorHex" TEXT,
    "opacity" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "mountingType" TEXT,
    "transformJson" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualizerProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualizerSelection" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "selectedBy" TEXT NOT NULL,
    "selectedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualizerSelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualizerCatalogProduct" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "categoryLabel" TEXT NOT NULL,
    "previewImageUrl" TEXT,
    "textureUrl" TEXT,
    "defaultOpacity" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "colorsJson" JSONB NOT NULL,
    "mountingsJson" JSONB NOT NULL,
    "pricingProductName" TEXT,
    "notes" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisualizerCatalogProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualizerCatalogAsset" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT NOT NULL DEFAULT 'real',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verificationStatus" TEXT NOT NULL DEFAULT 'draft',

    CONSTRAINT "VisualizerCatalogAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualizerCatalogTemplateJob" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "templateType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedModel" TEXT,
    "resolvedModel" TEXT,
    "promptVersion" TEXT,
    "outputAssetId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "VisualizerCatalogTemplateJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "tagline" TEXT,
    "positioning" TEXT,
    "sellingPoints" TEXT,
    "targetAudience" TEXT,
    "toneOfVoice" TEXT,
    "serviceScope" TEXT,
    "caseStudies" TEXT,
    "forbiddenClaims" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPlanItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "plannedDate" DATE NOT NULL,
    "groupName" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "angle" TEXT,
    "suggestedCaption" TEXT,
    "hashtags" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "source" TEXT NOT NULL DEFAULT 'ai',
    "assetId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sourceSignalId" TEXT,
    "sourceResearchRunId" TEXT,

    CONSTRAINT "ContentPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatrixAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT,
    "groupName" TEXT NOT NULL DEFAULT '默认组',
    "personaNotes" TEXT,
    "publishChannel" TEXT NOT NULL DEFAULT 'manual',
    "externalChannelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "dailyQuota" INTEGER NOT NULL DEFAULT 3,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'matrix',

    CONSTRAINT "MatrixAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAsset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "topic" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "videoUrl" TEXT NOT NULL,
    "coverUrl" TEXT,
    "durationSec" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "blockReason" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "captionText" TEXT NOT NULL,
    "hashtags" TEXT,
    "channel" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "externalJobId" TEXT,
    "errorMessage" TEXT,
    "sampledForReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),

    CONSTRAINT "PublishJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "automationKey" TEXT NOT NULL,
    "orgId" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'cron',
    "status" TEXT NOT NULL DEFAULT 'running',
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "succeededCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(2000),
    "metadataJson" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingBrandProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "website" TEXT,
    "phone" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "postalCode" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "industry" TEXT NOT NULL,
    "productsJson" JSONB NOT NULL DEFAULT '[]',
    "serviceAreasJson" JSONB NOT NULL DEFAULT '[]',
    "targetAudiencesJson" JSONB NOT NULL DEFAULT '[]',
    "competitorsJson" JSONB NOT NULL DEFAULT '[]',
    "forbiddenContextsJson" JSONB NOT NULL DEFAULT '[]',
    "canonicalNapJson" JSONB,
    "validationStatus" TEXT NOT NULL DEFAULT 'draft',
    "validationScore" INTEGER NOT NULL DEFAULT 0,
    "validationIssues" JSONB NOT NULL DEFAULT '[]',
    "validatedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "productMarketingContextJson" JSONB,

    CONSTRAINT "MarketingBrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingChannelAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'manual',
    "providerConfig" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingChannelAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAuditRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totalScore" INTEGER,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "profileValidationSnapshot" JSONB NOT NULL,
    "invalidReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingAuditRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingDimensionScore" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "evidenceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingDimensionScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingFinding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "auditRunId" TEXT,
    "dimension" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "currentValue" TEXT,
    "expectedValue" TEXT,
    "evidenceUrl" TEXT,
    "evidenceJson" JSONB,
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'open',
    "taskId" TEXT,
    "createdById" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPlan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT,
    "sourceResearchRunId" TEXT,
    "pendingActionId" TEXT,

    CONSTRAINT "MarketingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPlanItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dayOffset" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "taskId" TEXT,
    "findingId" TEXT,
    "dueDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT,
    "successMetric" TEXT,
    "targetValue" TEXT,
    "stopCondition" TEXT,
    "evidenceSummary" TEXT,
    "confidence" INTEGER,

    CONSTRAINT "MarketingPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "product" TEXT,
    "geography" TEXT,
    "offer" TEXT,
    "primaryConversion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "budget" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingContentAsset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contentPlanItemId" TEXT,
    "videoAssetId" TEXT,
    "assetType" TEXT NOT NULL DEFAULT 'video',
    "variantKey" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'draft',
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingContentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPublication" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contentAssetId" TEXT,
    "publishJobId" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "externalPostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingMetricSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channelAccountId" TEXT,
    "campaignId" TEXT,
    "publicationId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "engagements" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "qualifiedLeads" INTEGER NOT NULL DEFAULT 0,
    "appointments" INTEGER NOT NULL DEFAULT 0,
    "quotes" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "rawJson" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "granularity" TEXT NOT NULL DEFAULT 'snapshot',
    "geography" TEXT,
    "productCategory" TEXT,
    "objective" TEXT,
    "baseCurrency" TEXT NOT NULL DEFAULT 'CAD',
    "ingestionKey" TEXT,
    "externalEventId" TEXT,
    "dataQualityStatus" TEXT NOT NULL DEFAULT 'unverified',

    CONSTRAINT "MarketingMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingWorkflowRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'activepieces',
    "flowKey" TEXT NOT NULL,
    "externalRunId" TEXT,
    "requestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "inputJson" JSONB,
    "outputJson" JSONB,
    "error" TEXT,
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingWorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MmmDatasetVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "granularity" TEXT NOT NULL DEFAULT 'weekly',
    "targetKpi" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "weekCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "checksum" TEXT NOT NULL,
    "schemaJson" JSONB NOT NULL,
    "dataJson" JSONB NOT NULL,
    "qualityIssues" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MmmDatasetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MmmModelRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'meridian',
    "externalRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "modelVersion" TEXT,
    "configJson" JSONB,
    "diagnosticsJson" JSONB,
    "summaryJson" JSONB,
    "error" TEXT,
    "requestedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MmmModelRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MmmChannelContribution" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "modelRunId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contribution" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contributionShare" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "roi" DOUBLE PRECISION,
    "marginalRoi" DOUBLE PRECISION,
    "confidenceLow" DOUBLE PRECISION,
    "confidenceHigh" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MmmChannelContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MmmBudgetScenario" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "modelRunId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totalBudget" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "allocationsJson" JSONB NOT NULL,
    "expectedKpi" DOUBLE PRECISION,
    "confidenceLow" DOUBLE PRECISION,
    "confidenceHigh" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MmmBudgetScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingExperiment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "primaryMetric" TEXT NOT NULL,
    "secondaryMetricsJson" JSONB NOT NULL DEFAULT '[]',
    "variantsJson" JSONB NOT NULL,
    "trafficAllocationJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "winnerVariantKey" TEXT,
    "learningSummary" TEXT,
    "stopCondition" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingLeadAttribution" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "salesOpportunityId" TEXT NOT NULL,
    "publicationId" TEXT,
    "attributionModel" TEXT NOT NULL DEFAULT 'manual',
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "attributedRevenue" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingLeadAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAiProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleScope" TEXT NOT NULL DEFAULT 'general',
    "department" TEXT,
    "preferredLanguage" TEXT,
    "responseDetailLevel" TEXT,
    "preferredFormats" JSONB,
    "preferredChannels" JSONB,
    "schedulingPreferences" JSONB,
    "communicationStyle" JSONB,
    "approvalPreferences" JSONB,
    "personalTemplates" JSONB,
    "learnedPreferences" JSONB,
    "manuallyConfirmedPreferences" JSONB,
    "consentConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "consentConfirmedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAiProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanFeedbackEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentRunId" TEXT,
    "skillExecutionId" TEXT,
    "pendingActionId" TEXT,
    "supervisorStepId" TEXT,
    "workerType" TEXT,
    "skillSlug" TEXT,
    "taskType" TEXT NOT NULL,
    "aiOutputRef" JSONB NOT NULL,
    "aiOutputSnapshot" JSONB,
    "humanDecision" TEXT NOT NULL,
    "humanEditedOutput" JSONB,
    "diffSummary" JSONB,
    "reasonCode" TEXT,
    "reasonText" TEXT,
    "feedbackScope" TEXT NOT NULL DEFAULT 'personal_only',
    "consentConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanFeedbackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessOutcome" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "feedbackEventId" TEXT,
    "pendingActionId" TEXT,
    "skillExecutionId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionOccurredAt" TIMESTAMP(3) NOT NULL,
    "outcomeType" TEXT NOT NULL,
    "outcomeValue" JSONB,
    "successSignals" JSONB,
    "failureSignals" JSONB,
    "revenueImpact" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "manuallyVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidatePractice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "roleScope" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "triggerConditions" JSONB,
    "recommendedProcess" JSONB,
    "exceptions" JSONB,
    "evidenceSummary" JSONB,
    "supportingFeedbackIds" JSONB,
    "supportingOutcomeIds" JSONB,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generatedByRunId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidatePractice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePlaybook" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "roleScope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "rules" JSONB,
    "workflows" JSONB,
    "templates" JSONB,
    "exceptions" JSONB,
    "evidenceSummary" JSONB,
    "sourceCandidatePracticeIds" JSONB,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RolePlaybook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSkillVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "systemPromptHash" TEXT NOT NULL,
    "inputSchemaHash" TEXT,
    "outputSchemaHash" TEXT,
    "playbookVersionRefs" JSONB,
    "changeReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentSkillVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationCase" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "inputFixture" JSONB NOT NULL,
    "expectedConstraints" JSONB,
    "expectedSignals" JSONB,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeProduct" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "brand" TEXT,
    "category" TEXT,
    "collection" TEXT,
    "modelNumber" TEXT,
    "industryPack" TEXT NOT NULL DEFAULT 'home_textile',
    "geometryClass" TEXT NOT NULL DEFAULT 'DEFORMABLE_SURFACE',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAsset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "productId" TEXT,
    "jobId" TEXT,
    "roleAuto" TEXT NOT NULL DEFAULT 'unknown',
    "roleConfirmed" TEXT,
    "roleConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceType" TEXT NOT NULL DEFAULT 'upload',
    "blobPathname" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileName" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFact" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "productId" TEXT,
    "jobId" TEXT,
    "fieldKey" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "normalizedValue" JSONB,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceLocation" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" TEXT NOT NULL DEFAULT 'extracted',
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFactConflict" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "currentFactId" TEXT,
    "incomingFactId" TEXT,
    "currentValue" JSONB,
    "incomingValue" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFactConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductContentJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "productId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "executionMode" TEXT NOT NULL DEFAULT 'AUTOPILOT',
    "industryPack" TEXT NOT NULL DEFAULT 'home_textile',
    "selectedSku" TEXT,
    "planJson" JSONB,
    "missingFieldsJson" JSONB,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "errorMessage" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "estimatedCostCents" INTEGER NOT NULL DEFAULT 0,
    "documentPurpose" TEXT NOT NULL DEFAULT 'INTERNAL_DRAFT',

    CONSTRAINT "ProductContentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductContentSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "purpose" TEXT NOT NULL DEFAULT 'INTERNAL_DRAFT',
    "payloadJson" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductContentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductContentCostEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "estimatedCents" INTEGER NOT NULL DEFAULT 0,
    "actualCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "requestId" TEXT,
    "latencyMs" INTEGER,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductContentCostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageLedger" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "userId" TEXT,
    "traceId" TEXT,
    "runId" TEXT,
    "parentRunId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "usageType" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "imageCount" INTEGER,
    "audioSeconds" DOUBLE PRECISION,
    "durationMs" INTEGER,
    "costAmount" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "pricingVersion" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" JSONB,

    CONSTRAINT "AiUsageLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapabilityQuotaPolicy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "warningLimit" DECIMAL(18,6),
    "softLimit" DECIMAL(18,6),
    "hardLimit" DECIMAL(18,6),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityQuotaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapabilityQuotaReservation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "metric" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "committedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "runId" TEXT,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityQuotaReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductContentJobInput" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "inputType" TEXT NOT NULL,
    "blobPathname" TEXT,
    "mimeType" TEXT,
    "fileName" TEXT,
    "textContent" TEXT,
    "url" TEXT,
    "purpose" TEXT,
    "parseStatus" TEXT NOT NULL DEFAULT 'pending',
    "parseResultJson" JSONB,
    "transcriptText" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductContentJobInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductContentStep" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "inputJson" JSONB,
    "outputJson" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductContentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualGenerationJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "sceneType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "prompt" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisualGenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualOutput" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "visualJobId" TEXT NOT NULL,
    "blobPathname" TEXT,
    "status" TEXT NOT NULL DEFAULT 'generated',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "model" TEXT,
    "qaOverallScore" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisualOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualQaResult" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "visualOutputId" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "shapeScore" DOUBLE PRECISION NOT NULL,
    "colorScore" DOUBLE PRECISION NOT NULL,
    "patternScore" DOUBLE PRECISION,
    "textureScore" DOUBLE PRECISION,
    "logoScore" DOUBLE PRECISION,
    "textScore" DOUBLE PRECISION,
    "accessoryScore" DOUBLE PRECISION,
    "detectedChangesJson" JSONB NOT NULL,
    "recommendedStatus" TEXT NOT NULL,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualQaResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCopy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "productNameEn" TEXT,
    "titleEn" TEXT,
    "sellingPointsJson" JSONB,
    "shortDescriptionEn" TEXT,
    "longDescriptionEn" TEXT,
    "specificationsJson" JSONB,
    "packagingJson" JSONB,
    "careInstructionsEn" TEXT,
    "useCasesJson" JSONB,
    "missingInformationJson" JSONB,
    "claimsToVerifyJson" JSONB,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedDocument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "blobPathname" TEXT,
    "fileName" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductContentApproval" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductContentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentApprovalSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "defaultExecutionMode" TEXT NOT NULL DEFAULT 'AUTOPILOT',
    "autoAnalyzeFiles" BOOLEAN NOT NULL DEFAULT true,
    "autoCreateProductDraft" BOOLEAN NOT NULL DEFAULT true,
    "autoGenerateLowCostVisuals" BOOLEAN NOT NULL DEFAULT true,
    "autoRunFidelityQa" BOOLEAN NOT NULL DEFAULT true,
    "autoGenerateCopyDraft" BOOLEAN NOT NULL DEFAULT true,
    "autoGenerateFormalDocuments" BOOLEAN NOT NULL DEFAULT false,
    "autoProcessMultipleSkus" BOOLEAN NOT NULL DEFAULT false,
    "askBeforeHighCostModel" BOOLEAN NOT NULL DEFAULT true,
    "askBeforeCreativeMode" BOOLEAN NOT NULL DEFAULT true,
    "askBeforeFormalPdf" BOOLEAN NOT NULL DEFAULT true,
    "askBeforeOverwriteApprovedContent" BOOLEAN NOT NULL DEFAULT true,
    "askBeforeExternalSend" BOOLEAN NOT NULL DEFAULT true,
    "askBeforePublish" BOOLEAN NOT NULL DEFAULT true,
    "maxAutoCostPerJobCents" INTEGER,
    "maxAutoCostPerDayCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,

    CONSTRAINT "AgentApprovalSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTaskDependency" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTaskDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidDataRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sourceRootTaskId" TEXT,
    "sourceTenderRunId" TEXT,
    "sourceProductRunId" TEXT,
    "sourceComplianceRunId" TEXT,
    "sourcePricingRunId" TEXT,
    "sourceDocumentQaRunId" TEXT,
    "projectionVersion" TEXT NOT NULL,
    "projectionHash" TEXT NOT NULL,
    "technicalReadiness" TEXT NOT NULL DEFAULT 'BLOCKED',
    "financialReadiness" TEXT NOT NULL DEFAULT 'BLOCKED',
    "blockingIssueCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "issuesJson" JSONB,
    "origin" TEXT NOT NULL DEFAULT 'AGENT_PROJECTION',
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "lockedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "supersedesRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "technicalReviewStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "financialReviewStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "submittedByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "technicalApprovedByUserId" TEXT,
    "technicalApprovedAt" TIMESTAMP(3),
    "financialApprovedByUserId" TEXT,
    "financialApprovedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "revisionContentHash" TEXT,

    CONSTRAINT "BidDataRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceResponse" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bidDataRevisionId" TEXT NOT NULL,
    "tenderRequirementId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "proposedResponse" TEXT,
    "rationale" TEXT,
    "riskLevel" TEXT,
    "confidence" DOUBLE PRECISION,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "sourceAgentTaskId" TEXT,
    "sourceAgentRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewerNote" TEXT,
    "conditionText" TEXT,
    "requiredFollowUp" TEXT,
    "responsibleParty" TEXT,
    "dueDate" TIMESTAMP(3),

    CONSTRAINT "ComplianceResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceResponseEvidence" (
    "id" TEXT NOT NULL,
    "complianceResponseId" TEXT NOT NULL,
    "productEvidenceId" TEXT NOT NULL,
    "relevance" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "mappingReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceResponseEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingScenario" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bidDataRevisionId" TEXT NOT NULL,
    "scenarioNumber" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "readiness" TEXT NOT NULL DEFAULT 'BLOCKED',
    "quantity" DECIMAL(18,6),
    "outputCurrency" TEXT,
    "factoryCostCurrency" TEXT,
    "exchangeRate" DECIMAL(18,8),
    "exchangeRateBaseCurrency" TEXT,
    "exchangeRateQuoteCurrency" TEXT,
    "marginMethod" TEXT,
    "targetRate" DECIMAL(18,8),
    "totalCost" DECIMAL(18,6),
    "unitSellingPrice" DECIMAL(18,6),
    "totalSellingPrice" DECIMAL(18,6),
    "calculationVersion" TEXT,
    "sourcePricingRunId" TEXT,
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "lockedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingScenarioLineItem" (
    "id" TEXT NOT NULL,
    "pricingScenarioId" TEXT NOT NULL,
    "lineType" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(18,6),
    "unitCost" DECIMAL(18,6),
    "currency" TEXT,
    "exchangeRate" DECIMAL(18,8),
    "amountInOutputCurrency" DECIMAL(18,6),
    "includedInTotal" BOOLEAN NOT NULL DEFAULT false,
    "sourceProjectFactId" TEXT,
    "sourceDocumentId" TEXT,
    "sourceMessageId" TEXT,
    "sourceAgentRunId" TEXT,
    "confirmationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewerNote" TEXT,

    CONSTRAINT "PricingScenarioLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEvidence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bidDataRevisionId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "factKey" TEXT,
    "manufacturerName" TEXT,
    "productName" TEXT,
    "productModel" TEXT,
    "displayValue" TEXT NOT NULL,
    "valueJson" JSONB,
    "unit" TEXT,
    "evidenceType" TEXT NOT NULL DEFAULT 'AI_EXTRACTION',
    "evidenceStrength" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "confirmationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "usageScopes" JSONB NOT NULL DEFAULT '[]',
    "sourceProjectFactId" TEXT,
    "sourceDocumentId" TEXT,
    "sourceMessageId" TEXT,
    "sourcePage" INTEGER,
    "sourceExcerpt" TEXT,
    "sourceAgentTaskId" TEXT,
    "sourceAgentRunId" TEXT,
    "certificateNumber" TEXT,
    "standard" TEXT,
    "applicableModel" TEXT,
    "confidence" DOUBLE PRECISION,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAgentEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'system',
    "actorId" TEXT,
    "rootTaskId" TEXT,
    "taskId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "visibilityScope" TEXT NOT NULL DEFAULT 'PROJECT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAgentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectConflict" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "rootTaskId" TEXT,
    "sourceTaskId" TEXT,
    "sourceAgentRunId" TEXT,
    "conflictType" TEXT NOT NULL,
    "factKey" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "competingValuesJson" JSONB NOT NULL,
    "sourceReferencesJson" JSONB,
    "affectedTaskIdsJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolutionJson" JSONB,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "approvalRequestId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFact" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "displayValue" TEXT NOT NULL,
    "unit" TEXT,
    "currency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "confidence" DOUBLE PRECISION,
    "usageScopes" JSONB NOT NULL,
    "effectiveAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "sourceMessageId" TEXT,
    "sourceDocumentId" TEXT,
    "sourcePage" TEXT,
    "sourceExcerpt" TEXT,
    "sourceLocation" TEXT,
    "sourceInsightId" TEXT,
    "createdById" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "supersedesFactId" TEXT,
    "lockedByArtifactId" TEXT,
    "pendingActionId" TEXT,
    "aiThreadId" TEXT,
    "agentRunId" TEXT,
    "agentTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT,

    CONSTRAINT "ProjectFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderRequirement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bidDataRevisionId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "requirementNumber" TEXT,
    "title" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "requirementText" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "evaluationType" TEXT NOT NULL DEFAULT 'OTHER',
    "comparator" TEXT,
    "expectedValueJson" JSONB,
    "unit" TEXT,
    "sourceDocumentId" TEXT,
    "sourcePage" INTEGER,
    "sourceExcerpt" TEXT,
    "sourceAgentTaskId" TEXT,
    "sourceAgentRunId" TEXT,
    "confidence" DOUBLE PRECISION,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'AGENT',
    "originalValueJson" JSONB,
    "lastChangeReason" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TenderRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_wechatOpenId_key" ON "User"("wechatOpenId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_authProvider_idx" ON "User"("authProvider");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_activeOrgId_idx" ON "User"("activeOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailBinding_userId_key" ON "EmailBinding"("userId");

-- CreateIndex
CREATE INDEX "EmailBinding_email_idx" ON "EmailBinding"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");

-- CreateIndex
CREATE INDEX "InviteCode_code_idx" ON "InviteCode"("code");

-- CreateIndex
CREATE INDEX "InviteCode_role_idx" ON "InviteCode"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE INDEX "Project_orgId_idx" ON "Project"("orgId");

-- CreateIndex
CREATE INDEX "Project_workspaceId_idx" ON "Project"("workspaceId");

-- CreateIndex
CREATE INDEX "Project_purchaserId_idx" ON "Project"("purchaserId");

-- CreateIndex
CREATE INDEX "Project_sourceSystem_idx" ON "Project"("sourceSystem");

-- CreateIndex
CREATE INDEX "Project_tenderStatus_idx" ON "Project"("tenderStatus");

-- CreateIndex
CREATE INDEX "Project_intakeStatus_idx" ON "Project"("intakeStatus");

-- CreateIndex
CREATE INDEX "Project_status_createdAt_idx" ON "Project"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");

-- CreateIndex
CREATE INDEX "Task_projectId_createdAt_idx" ON "Task"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Task_creatorId_idx" ON "Task"("creatorId");

-- CreateIndex
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- CreateIndex
CREATE INDEX "Task_status_createdAt_idx" ON "Task"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Task_waitingUntil_idx" ON "Task"("waitingUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "CalendarEvent_projectId_idx" ON "CalendarEvent"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_userId_sourceKey_key" ON "CalendarEvent"("userId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "BlindsOrder_code_key" ON "BlindsOrder"("code");

-- CreateIndex
CREATE INDEX "BlindsOrder_customerId_idx" ON "BlindsOrder"("customerId");

-- CreateIndex
CREATE INDEX "BlindsOrder_opportunityId_idx" ON "BlindsOrder"("opportunityId");

-- CreateIndex
CREATE INDEX "BlindsOrder_status_idx" ON "BlindsOrder"("status");

-- CreateIndex
CREATE INDEX "BlindsOrder_expectedInstallDate_idx" ON "BlindsOrder"("expectedInstallDate");

-- CreateIndex
CREATE INDEX "OrderStatusLog_orderId_createdAt_idx" ON "OrderStatusLog"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FabricInventory_sku_key" ON "FabricInventory"("sku");

-- CreateIndex
CREATE INDEX "FabricInventory_productType_idx" ON "FabricInventory"("productType");

-- CreateIndex
CREATE INDEX "FabricInventory_status_idx" ON "FabricInventory"("status");

-- CreateIndex
CREATE INDEX "FabricInventory_sku_idx" ON "FabricInventory"("sku");

-- CreateIndex
CREATE INDEX "FabricStockLog_fabricId_createdAt_idx" ON "FabricStockLog"("fabricId", "createdAt");

-- CreateIndex
CREATE INDEX "FabricStockLog_type_idx" ON "FabricStockLog"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_sourceKey_key" ON "Reminder"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_code_key" ON "Organization"("code");

-- CreateIndex
CREATE INDEX "Workspace_orgId_status_idx" ON "Workspace"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_orgId_slug_key" ON "Workspace"("orgId", "slug");

-- CreateIndex
CREATE INDEX "WorkspaceMember_workspaceId_idx" ON "WorkspaceMember"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "OrganizationProjectRule_orgId_status_idx" ON "OrganizationProjectRule"("orgId", "status");

-- CreateIndex
CREATE INDEX "OrganizationProjectRule_orgId_category_idx" ON "OrganizationProjectRule"("orgId", "category");

-- CreateIndex
CREATE INDEX "OrganizationProjectRule_sourceProjectId_idx" ON "OrganizationProjectRule"("sourceProjectId");

-- CreateIndex
CREATE INDEX "OrganizationMember_orgId_idx" ON "OrganizationMember"("orgId");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_orgId_userId_key" ON "OrganizationMember"("orgId", "userId");

-- CreateIndex
CREATE INDEX "RoleProfile_orgId_status_idx" ON "RoleProfile"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RoleProfile_orgId_key_key" ON "RoleProfile"("orgId", "key");

-- CreateIndex
CREATE INDEX "RolePermissionBinding_orgId_permissionKey_idx" ON "RolePermissionBinding"("orgId", "permissionKey");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermissionBinding_roleProfileId_permissionKey_dataScope_key" ON "RolePermissionBinding"("roleProfileId", "permissionKey", "dataScope");

-- CreateIndex
CREATE INDEX "PrincipalRoleBinding_orgId_principalType_principalId_status_idx" ON "PrincipalRoleBinding"("orgId", "principalType", "principalId", "status");

-- CreateIndex
CREATE INDEX "PrincipalRoleBinding_roleProfileId_idx" ON "PrincipalRoleBinding"("roleProfileId");

-- CreateIndex
CREATE INDEX "PositionTemplate_orgId_status_idx" ON "PositionTemplate"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PositionTemplate_orgId_key_key" ON "PositionTemplate"("orgId", "key");

-- CreateIndex
CREATE INDEX "ProjectMember_projectId_idx" ON "ProjectMember"("projectId");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE INDEX "Environment_projectId_idx" ON "Environment"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Environment_projectId_code_key" ON "Environment"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Prompt_activeVersionId_key" ON "Prompt"("activeVersionId");

-- CreateIndex
CREATE INDEX "Prompt_projectId_environmentId_idx" ON "Prompt"("projectId", "environmentId");

-- CreateIndex
CREATE INDEX "Prompt_environmentId_idx" ON "Prompt"("environmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Prompt_projectId_environmentId_key_key" ON "Prompt"("projectId", "environmentId", "key");

-- CreateIndex
CREATE INDEX "PromptVersion_promptId_idx" ON "PromptVersion"("promptId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_promptId_version_key" ON "PromptVersion"("promptId", "version");

-- CreateIndex
CREATE INDEX "PromptPublishLog_projectId_idx" ON "PromptPublishLog"("projectId");

-- CreateIndex
CREATE INDEX "PromptPublishLog_promptKey_idx" ON "PromptPublishLog"("promptKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeBase_activeVersionId_key" ON "KnowledgeBase"("activeVersionId");

-- CreateIndex
CREATE INDEX "KnowledgeBase_projectId_environmentId_idx" ON "KnowledgeBase"("projectId", "environmentId");

-- CreateIndex
CREATE INDEX "KnowledgeBase_environmentId_idx" ON "KnowledgeBase"("environmentId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeBase_projectId_environmentId_key_key" ON "KnowledgeBase"("projectId", "environmentId", "key");

-- CreateIndex
CREATE INDEX "KnowledgeBaseVersion_knowledgeBaseId_idx" ON "KnowledgeBaseVersion"("knowledgeBaseId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeBaseVersion_knowledgeBaseId_version_key" ON "KnowledgeBaseVersion"("knowledgeBaseId", "version");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_knowledgeBaseId_idx" ON "KnowledgeDocument"("knowledgeBaseId");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_environmentId_idx" ON "KnowledgeDocument"("environmentId");

-- CreateIndex
CREATE INDEX "KnowledgeDocumentVersion_knowledgeBaseVersionId_idx" ON "KnowledgeDocumentVersion"("knowledgeBaseVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocumentVersion_documentId_knowledgeBaseVersionId_key" ON "KnowledgeDocumentVersion"("documentId", "knowledgeBaseVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocumentVersion_documentId_version_key" ON "KnowledgeDocumentVersion"("documentId", "version");

-- CreateIndex
CREATE INDEX "KnowledgePublishLog_projectId_idx" ON "KnowledgePublishLog"("projectId");

-- CreateIndex
CREATE INDEX "KnowledgePublishLog_knowledgeBaseKey_idx" ON "KnowledgePublishLog"("knowledgeBaseKey");

-- CreateIndex
CREATE INDEX "Conversation_projectId_environmentId_idx" ON "Conversation"("projectId", "environmentId");

-- CreateIndex
CREATE INDEX "Conversation_projectId_idx" ON "Conversation"("projectId");

-- CreateIndex
CREATE INDEX "Conversation_projectId_startedAt_idx" ON "Conversation"("projectId", "startedAt");

-- CreateIndex
CREATE INDEX "Conversation_environmentId_idx" ON "Conversation"("environmentId");

-- CreateIndex
CREATE INDEX "Conversation_userId_idx" ON "Conversation"("userId");

-- CreateIndex
CREATE INDEX "Conversation_status_idx" ON "Conversation"("status");

-- CreateIndex
CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_sequence_key" ON "Message"("conversationId", "sequence");

-- CreateIndex
CREATE INDEX "ConversationContextSnapshot_conversationId_idx" ON "ConversationContextSnapshot"("conversationId");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_idx" ON "AuditLog"("orgId");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_idx" ON "AuditLog"("projectId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_workspaceId_createdAt_idx" ON "AuditLog"("orgId", "workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_traceId_idx" ON "AuditLog"("traceId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_activeVersionId_key" ON "Agent"("activeVersionId");

-- CreateIndex
CREATE INDEX "Agent_projectId_environmentId_idx" ON "Agent"("projectId", "environmentId");

-- CreateIndex
CREATE INDEX "Agent_environmentId_idx" ON "Agent"("environmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_projectId_environmentId_key_key" ON "Agent"("projectId", "environmentId", "key");

-- CreateIndex
CREATE INDEX "AgentVersion_agentId_idx" ON "AgentVersion"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentVersion_agentId_version_key" ON "AgentVersion"("agentId", "version");

-- CreateIndex
CREATE INDEX "ToolRegistry_projectId_idx" ON "ToolRegistry"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ToolRegistry_projectId_key_key" ON "ToolRegistry"("projectId", "key");

-- CreateIndex
CREATE INDEX "AgentToolBinding_agentId_idx" ON "AgentToolBinding"("agentId");

-- CreateIndex
CREATE INDEX "AgentToolBinding_toolId_idx" ON "AgentToolBinding"("toolId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentToolBinding_agentId_toolId_key" ON "AgentToolBinding"("agentId", "toolId");

-- CreateIndex
CREATE INDEX "ToolCallTrace_conversationId_idx" ON "ToolCallTrace"("conversationId");

-- CreateIndex
CREATE INDEX "ToolCallTrace_messageId_idx" ON "ToolCallTrace"("messageId");

-- CreateIndex
CREATE INDEX "ToolCallTrace_projectId_environmentId_idx" ON "ToolCallTrace"("projectId", "environmentId");

-- CreateIndex
CREATE INDEX "ConversationFeedback_projectId_environmentId_idx" ON "ConversationFeedback"("projectId", "environmentId");

-- CreateIndex
CREATE INDEX "ConversationFeedback_conversationId_idx" ON "ConversationFeedback"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationFeedback_status_idx" ON "ConversationFeedback"("status");

-- CreateIndex
CREATE INDEX "ConversationFeedback_rating_idx" ON "ConversationFeedback"("rating");

-- CreateIndex
CREATE INDEX "ConversationFeedback_createdById_idx" ON "ConversationFeedback"("createdById");

-- CreateIndex
CREATE INDEX "MessageFeedback_projectId_environmentId_idx" ON "MessageFeedback"("projectId", "environmentId");

-- CreateIndex
CREATE INDEX "MessageFeedback_conversationId_idx" ON "MessageFeedback"("conversationId");

-- CreateIndex
CREATE INDEX "MessageFeedback_messageId_idx" ON "MessageFeedback"("messageId");

-- CreateIndex
CREATE INDEX "MessageFeedback_status_idx" ON "MessageFeedback"("status");

-- CreateIndex
CREATE INDEX "MessageFeedback_createdById_idx" ON "MessageFeedback"("createdById");

-- CreateIndex
CREATE INDEX "EvaluationTag_projectId_idx" ON "EvaluationTag"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationTag_projectId_key_key" ON "EvaluationTag"("projectId", "key");

-- CreateIndex
CREATE INDEX "ConversationFeedbackTag_feedbackId_idx" ON "ConversationFeedbackTag"("feedbackId");

-- CreateIndex
CREATE INDEX "ConversationFeedbackTag_tagId_idx" ON "ConversationFeedbackTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationFeedbackTag_feedbackId_tagId_key" ON "ConversationFeedbackTag"("feedbackId", "tagId");

-- CreateIndex
CREATE INDEX "MessageFeedbackTag_feedbackId_idx" ON "MessageFeedbackTag"("feedbackId");

-- CreateIndex
CREATE INDEX "MessageFeedbackTag_tagId_idx" ON "MessageFeedbackTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageFeedbackTag_feedbackId_tagId_key" ON "MessageFeedbackTag"("feedbackId", "tagId");

-- CreateIndex
CREATE INDEX "EvaluationRun_projectId_environmentId_idx" ON "EvaluationRun"("projectId", "environmentId");

-- CreateIndex
CREATE INDEX "EvaluationRun_conversationId_idx" ON "EvaluationRun"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_sourceKey_key" ON "Notification"("sourceKey");

-- CreateIndex
CREATE INDEX "Notification_userId_status_idx" ON "Notification"("userId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_projectId_idx" ON "Notification"("projectId");

-- CreateIndex
CREATE INDEX "Notification_projectId_status_idx" ON "Notification"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotificationPreference_userId_key" ON "UserNotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "UserNotificationPreference_userId_idx" ON "UserNotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "ProjectNotificationRule_projectId_idx" ON "ProjectNotificationRule"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectNotificationRule_userId_projectId_key" ON "ProjectNotificationRule"("userId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalReference_projectId_key" ON "ExternalReference"("projectId");

-- CreateIndex
CREATE INDEX "ExternalReference_system_idx" ON "ExternalReference"("system");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalReference_system_externalId_key" ON "ExternalReference"("system", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectIntelligence_projectId_key" ON "ProjectIntelligence"("projectId");

-- CreateIndex
CREATE INDEX "ProjectInsight_projectId_status_idx" ON "ProjectInsight"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectInsight_orgId_status_idx" ON "ProjectInsight"("orgId", "status");

-- CreateIndex
CREATE INDEX "ProjectInsight_kind_idx" ON "ProjectInsight"("kind");

-- CreateIndex
CREATE INDEX "ProjectSimilarity_projectId_score_idx" ON "ProjectSimilarity"("projectId", "score");

-- CreateIndex
CREATE INDEX "ProjectSimilarity_orgId_idx" ON "ProjectSimilarity"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSimilarity_projectId_similarProjectId_key" ON "ProjectSimilarity"("projectId", "similarProjectId");

-- CreateIndex
CREATE INDEX "ProjectReview_projectId_status_idx" ON "ProjectReview"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectReview_orgId_status_idx" ON "ProjectReview"("orgId", "status");

-- CreateIndex
CREATE INDEX "ProjectReview_outcome_idx" ON "ProjectReview"("outcome");

-- CreateIndex
CREATE INDEX "ProjectGeneratedDocument_projectId_docType_idx" ON "ProjectGeneratedDocument"("projectId", "docType");

-- CreateIndex
CREATE INDEX "ProjectGeneratedDocument_orgId_idx" ON "ProjectGeneratedDocument"("orgId");

-- CreateIndex
CREATE INDEX "ProjectProgressSummary_projectId_idx" ON "ProjectProgressSummary"("projectId");

-- CreateIndex
CREATE INDEX "ProjectProgressSummary_projectId_createdAt_idx" ON "ProjectProgressSummary"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectDocument_projectId_idx" ON "ProjectDocument"("projectId");

-- CreateIndex
CREATE INDEX "ProjectDocument_source_idx" ON "ProjectDocument"("source");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_token_key" ON "ApiToken"("token");

-- CreateIndex
CREATE INDEX "ApiToken_token_idx" ON "ApiToken"("token");

-- CreateIndex
CREATE INDEX "ApiToken_system_idx" ON "ApiToken"("system");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_system_idx" ON "WebhookEndpoint"("system");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectConversation_projectId_key" ON "ProjectConversation"("projectId");

-- CreateIndex
CREATE INDEX "ProjectMessage_conversationId_createdAt_id_idx" ON "ProjectMessage"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ProjectMessage_projectId_createdAt_id_idx" ON "ProjectMessage"("projectId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ProjectMessage_projectId_type_createdAt_idx" ON "ProjectMessage"("projectId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectMessage_senderId_createdAt_idx" ON "ProjectMessage"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "AiThread_userId_pinned_lastMessageAt_idx" ON "AiThread"("userId", "pinned", "lastMessageAt");

-- CreateIndex
CREATE INDEX "AiThread_userId_projectId_idx" ON "AiThread"("userId", "projectId");

-- CreateIndex
CREATE INDEX "AiThread_userId_orgId_pinned_lastMessageAt_idx" ON "AiThread"("userId", "orgId", "pinned", "lastMessageAt");

-- CreateIndex
CREATE INDEX "AiThread_userId_orgId_projectId_idx" ON "AiThread"("userId", "orgId", "projectId");

-- CreateIndex
CREATE INDEX "AiMessage_threadId_createdAt_idx" ON "AiMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "PendingAction_createdById_status_createdAt_idx" ON "PendingAction"("createdById", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PendingAction_approverUserId_status_createdAt_idx" ON "PendingAction"("approverUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PendingAction_orgId_status_createdAt_idx" ON "PendingAction"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PendingAction_projectId_status_createdAt_idx" ON "PendingAction"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PendingAction_threadId_idx" ON "PendingAction"("threadId");

-- CreateIndex
CREATE INDEX "PendingAction_agentRunId_status_idx" ON "PendingAction"("agentRunId", "status");

-- CreateIndex
CREATE INDEX "PendingAction_orgId_workspaceId_status_idx" ON "PendingAction"("orgId", "workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PendingAction_orgId_idempotencyKey_key" ON "PendingAction"("orgId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ApprovalDecisionIdempotency_orgId_approvalKey_idx" ON "ApprovalDecisionIdempotency"("orgId", "approvalKey");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalDecisionIdempotency_orgId_idempotencyKey_key" ON "ApprovalDecisionIdempotency"("orgId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Supplier_orgId_status_idx" ON "Supplier"("orgId", "status");

-- CreateIndex
CREATE INDEX "Supplier_orgId_name_idx" ON "Supplier"("orgId", "name");

-- CreateIndex
CREATE INDEX "Supplier_orgId_source_idx" ON "Supplier"("orgId", "source");

-- CreateIndex
CREATE INDEX "Supplier_orgId_tags_idx" ON "Supplier"("orgId", "tags");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInquiry_token_key" ON "ProjectInquiry"("token");

-- CreateIndex
CREATE INDEX "ProjectInquiry_projectId_status_idx" ON "ProjectInquiry"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInquiry_projectId_roundNumber_key" ON "ProjectInquiry"("projectId", "roundNumber");

-- CreateIndex
CREATE INDEX "InquiryItem_inquiryId_status_idx" ON "InquiryItem"("inquiryId", "status");

-- CreateIndex
CREATE INDEX "InquiryItem_supplierId_idx" ON "InquiryItem"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "InquiryItem_inquiryId_supplierId_key" ON "InquiryItem"("inquiryId", "supplierId");

-- CreateIndex
CREATE INDEX "ProjectQuote_projectId_status_idx" ON "ProjectQuote"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectQuote_projectId_version_idx" ON "ProjectQuote"("projectId", "version");

-- CreateIndex
CREATE INDEX "QuoteLineItem_quoteId_sortOrder_idx" ON "QuoteLineItem"("quoteId", "sortOrder");

-- CreateIndex
CREATE INDEX "EmailProvider_userId_idx" ON "EmailProvider"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailProvider_userId_type_key" ON "EmailProvider"("userId", "type");

-- CreateIndex
CREATE INDEX "ProjectEmail_projectId_idx" ON "ProjectEmail"("projectId");

-- CreateIndex
CREATE INDEX "ProjectEmail_inquiryItemId_idx" ON "ProjectEmail"("inquiryItemId");

-- CreateIndex
CREATE INDEX "ProjectEmail_orgId_projectId_idx" ON "ProjectEmail"("orgId", "projectId");

-- CreateIndex
CREATE INDEX "ProjectQuestion_projectId_status_idx" ON "ProjectQuestion"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectQuestion_projectId_createdAt_idx" ON "ProjectQuestion"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentTask_projectId_status_idx" ON "AgentTask"("projectId", "status");

-- CreateIndex
CREATE INDEX "AgentTask_createdById_status_idx" ON "AgentTask"("createdById", "status");

-- CreateIndex
CREATE INDEX "AgentTask_assignedAgentKey_status_idx" ON "AgentTask"("assignedAgentKey", "status");

-- CreateIndex
CREATE INDEX "AgentTask_invalidatedAt_idx" ON "AgentTask"("invalidatedAt");

-- CreateIndex
CREATE INDEX "AgentTask_parentTaskId_idx" ON "AgentTask"("parentTaskId");

-- CreateIndex
CREATE INDEX "AgentTask_taskType_status_leaseExpiresAt_idx" ON "AgentTask"("taskType", "status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AgentTask_taskType_status_nextAttemptAt_idx" ON "AgentTask"("taskType", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AgentTaskStep_taskId_stepIndex_idx" ON "AgentTaskStep"("taskId", "stepIndex");

-- CreateIndex
CREATE INDEX "ApprovalRequest_taskId_idx" ON "ApprovalRequest"("taskId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_approverUserId_status_idx" ON "ApprovalRequest"("approverUserId", "status");

-- CreateIndex
CREATE INDEX "CustomFlowTemplate_createdById_idx" ON "CustomFlowTemplate"("createdById");

-- CreateIndex
CREATE INDEX "CustomFlowTemplate_category_idx" ON "CustomFlowTemplate"("category");

-- CreateIndex
CREATE INDEX "TradeCampaign_orgId_status_idx" ON "TradeCampaign"("orgId", "status");

-- CreateIndex
CREATE INDEX "TradeCampaign_createdById_idx" ON "TradeCampaign"("createdById");

-- CreateIndex
CREATE INDEX "TradeProspect_campaignId_stage_idx" ON "TradeProspect"("campaignId", "stage");

-- CreateIndex
CREATE INDEX "TradeProspect_orgId_stage_idx" ON "TradeProspect"("orgId", "stage");

-- CreateIndex
CREATE INDEX "TradeProspect_orgId_ownerId_stage_idx" ON "TradeProspect"("orgId", "ownerId", "stage");

-- CreateIndex
CREATE INDEX "TradeProspect_orgId_researchStatus_idx" ON "TradeProspect"("orgId", "researchStatus");

-- CreateIndex
CREATE INDEX "TradeProspect_nextFollowUpAt_idx" ON "TradeProspect"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "TradeProspect_score_idx" ON "TradeProspect"("score");

-- CreateIndex
CREATE INDEX "TradeWatchTarget_orgId_isActive_idx" ON "TradeWatchTarget"("orgId", "isActive");

-- CreateIndex
CREATE INDEX "TradeWatchTarget_prospectId_idx" ON "TradeWatchTarget"("prospectId");

-- CreateIndex
CREATE INDEX "TradeSignal_orgId_createdAt_idx" ON "TradeSignal"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeSignal_prospectId_createdAt_idx" ON "TradeSignal"("prospectId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeSignal_watchTargetId_createdAt_idx" ON "TradeSignal"("watchTargetId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketCompetitor_orgId_status_idx" ON "MarketCompetitor"("orgId", "status");

-- CreateIndex
CREATE INDEX "MarketCompetitor_orgId_updatedAt_idx" ON "MarketCompetitor"("orgId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketCompetitor_orgId_normalizedDomain_key" ON "MarketCompetitor"("orgId", "normalizedDomain");

-- CreateIndex
CREATE UNIQUE INDEX "MarketMonitor_providerMonitorId_key" ON "MarketMonitor"("providerMonitorId");

-- CreateIndex
CREATE INDEX "MarketMonitor_orgId_status_idx" ON "MarketMonitor"("orgId", "status");

-- CreateIndex
CREATE INDEX "MarketMonitor_orgId_nextRunAt_idx" ON "MarketMonitor"("orgId", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketMonitor_competitorId_provider_key" ON "MarketMonitor"("competitorId", "provider");

-- CreateIndex
CREATE INDEX "MarketSnapshot_orgId_capturedAt_idx" ON "MarketSnapshot"("orgId", "capturedAt");

-- CreateIndex
CREATE INDEX "MarketSnapshot_monitorId_capturedAt_idx" ON "MarketSnapshot"("monitorId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSnapshot_monitorId_providerCheckId_urlHash_key" ON "MarketSnapshot"("monitorId", "providerCheckId", "urlHash");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSignal_snapshotId_key" ON "MarketSignal"("snapshotId");

-- CreateIndex
CREATE INDEX "MarketSignal_orgId_status_createdAt_idx" ON "MarketSignal"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketSignal_competitorId_createdAt_idx" ON "MarketSignal"("competitorId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketSignal_orgId_severity_createdAt_idx" ON "MarketSignal"("orgId", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "MarketSignal_analysisStatus_analysisNextAttemptAt_idx" ON "MarketSignal"("analysisStatus", "analysisNextAttemptAt");

-- CreateIndex
CREATE INDEX "MarketSignal_analysisStatus_analysisLeaseExpiresAt_idx" ON "MarketSignal"("analysisStatus", "analysisLeaseExpiresAt");

-- CreateIndex
CREATE INDEX "MarketAnalysisRun_orgId_createdAt_idx" ON "MarketAnalysisRun"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketAnalysisRun_competitorId_createdAt_idx" ON "MarketAnalysisRun"("competitorId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketAnalysisRun_signalId_createdAt_idx" ON "MarketAnalysisRun"("signalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketResearchRun_planId_key" ON "MarketResearchRun"("planId");

-- CreateIndex
CREATE INDEX "MarketResearchRun_orgId_createdAt_idx" ON "MarketResearchRun"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketResearchRun_orgId_status_createdAt_idx" ON "MarketResearchRun"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketResearchRun_orgId_planStatus_createdAt_idx" ON "MarketResearchRun"("orgId", "planStatus", "createdAt");

-- CreateIndex
CREATE INDEX "MarketResearchRun_status_nextAttemptAt_idx" ON "MarketResearchRun"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MarketResearchRun_status_leaseExpiresAt_idx" ON "MarketResearchRun"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "TradeMessage_prospectId_createdAt_idx" ON "TradeMessage"("prospectId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeMessage_prospectId_direction_idx" ON "TradeMessage"("prospectId", "direction");

-- CreateIndex
CREATE INDEX "TradeChatSession_userId_updatedAt_idx" ON "TradeChatSession"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "TradeChatSession_orgId_idx" ON "TradeChatSession"("orgId");

-- CreateIndex
CREATE INDEX "TradeChatMessage_sessionId_createdAt_idx" ON "TradeChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeIntelligenceCase_orgId_idx" ON "TradeIntelligenceCase"("orgId");

-- CreateIndex
CREATE INDEX "TradeIntelligenceCase_orgId_status_idx" ON "TradeIntelligenceCase"("orgId", "status");

-- CreateIndex
CREATE INDEX "TradeIntelligenceCase_orgId_createdAt_idx" ON "TradeIntelligenceCase"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeIntelligenceCase_orgId_upc_idx" ON "TradeIntelligenceCase"("orgId", "upc");

-- CreateIndex
CREATE INDEX "TradeIntelligenceCase_orgId_mpn_idx" ON "TradeIntelligenceCase"("orgId", "mpn");

-- CreateIndex
CREATE INDEX "TradeIntelligenceAsset_orgId_idx" ON "TradeIntelligenceAsset"("orgId");

-- CreateIndex
CREATE INDEX "TradeIntelligenceAsset_caseId_idx" ON "TradeIntelligenceAsset"("caseId");

-- CreateIndex
CREATE INDEX "TradeServiceRequest_orgId_status_idx" ON "TradeServiceRequest"("orgId", "status");

-- CreateIndex
CREATE INDEX "TradeServiceRequest_orgId_createdAt_idx" ON "TradeServiceRequest"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeServiceRequest_fulfillmentOrgId_status_idx" ON "TradeServiceRequest"("fulfillmentOrgId", "status");

-- CreateIndex
CREATE INDEX "TradeServiceRequest_assigneeId_idx" ON "TradeServiceRequest"("assigneeId");

-- CreateIndex
CREATE INDEX "TradeServiceAsset_orgId_idx" ON "TradeServiceAsset"("orgId");

-- CreateIndex
CREATE INDEX "TradeServiceAsset_requestId_idx" ON "TradeServiceAsset"("requestId");

-- CreateIndex
CREATE INDEX "TradeServiceAsset_requestId_kind_idx" ON "TradeServiceAsset"("requestId", "kind");

-- CreateIndex
CREATE INDEX "TradeChannel_orgId_idx" ON "TradeChannel"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeChannel_orgId_channel_key" ON "TradeChannel"("orgId", "channel");

-- CreateIndex
CREATE INDEX "TradeActivityLog_campaignId_createdAt_idx" ON "TradeActivityLog"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeActivityLog_prospectId_createdAt_idx" ON "TradeActivityLog"("prospectId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeActivityLog_orgId_createdAt_idx" ON "TradeActivityLog"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeQuote_quoteNumber_key" ON "TradeQuote"("quoteNumber");

-- CreateIndex
CREATE INDEX "TradeQuote_orgId_status_idx" ON "TradeQuote"("orgId", "status");

-- CreateIndex
CREATE INDEX "TradeQuote_prospectId_idx" ON "TradeQuote"("prospectId");

-- CreateIndex
CREATE INDEX "TradeQuoteItem_quoteId_sortOrder_idx" ON "TradeQuoteItem"("quoteId", "sortOrder");

-- CreateIndex
CREATE INDEX "TradeKnowledge_orgId_category_idx" ON "TradeKnowledge"("orgId", "category");

-- CreateIndex
CREATE INDEX "TradeKnowledge_orgId_isActive_idx" ON "TradeKnowledge"("orgId", "isActive");

-- CreateIndex
CREATE INDEX "OrgKnowledgeDocument_orgId_status_updatedAt_idx" ON "OrgKnowledgeDocument"("orgId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "OrgKnowledgeDocument_orgId_category_idx" ON "OrgKnowledgeDocument"("orgId", "category");

-- CreateIndex
CREATE INDEX "OrgKnowledgeChunk_orgId_documentId_idx" ON "OrgKnowledgeChunk"("orgId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgKnowledgeChunk_documentId_chunkIndex_key" ON "OrgKnowledgeChunk"("documentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "TradeEmailTemplate_orgId_category_idx" ON "TradeEmailTemplate"("orgId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "SalesCustomer_jdyDataId_key" ON "SalesCustomer"("jdyDataId");

-- CreateIndex
CREATE INDEX "SalesCustomer_status_idx" ON "SalesCustomer"("status");

-- CreateIndex
CREATE INDEX "SalesCustomer_phone_idx" ON "SalesCustomer"("phone");

-- CreateIndex
CREATE INDEX "SalesCustomer_email_idx" ON "SalesCustomer"("email");

-- CreateIndex
CREATE INDEX "SalesCustomer_createdAt_idx" ON "SalesCustomer"("createdAt");

-- CreateIndex
CREATE INDEX "SalesCustomer_orgId_idx" ON "SalesCustomer"("orgId");

-- CreateIndex
CREATE INDEX "SalesCustomer_archivedAt_idx" ON "SalesCustomer"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOpportunity_jdyDataId_key" ON "SalesOpportunity"("jdyDataId");

-- CreateIndex
CREATE INDEX "SalesOpportunity_customerId_idx" ON "SalesOpportunity"("customerId");

-- CreateIndex
CREATE INDEX "SalesOpportunity_stage_idx" ON "SalesOpportunity"("stage");

-- CreateIndex
CREATE INDEX "SalesOpportunity_assignedToId_idx" ON "SalesOpportunity"("assignedToId");

-- CreateIndex
CREATE INDEX "SalesOpportunity_nextFollowupAt_idx" ON "SalesOpportunity"("nextFollowupAt");

-- CreateIndex
CREATE INDEX "SalesOpportunity_stage_updatedAt_idx" ON "SalesOpportunity"("stage", "updatedAt");

-- CreateIndex
CREATE INDEX "SalesOpportunity_sourceTradeProspectId_idx" ON "SalesOpportunity"("sourceTradeProspectId");

-- CreateIndex
CREATE INDEX "SalesOpportunity_orgId_idx" ON "SalesOpportunity"("orgId");

-- CreateIndex
CREATE INDEX "CustomerInteraction_customerId_createdAt_idx" ON "CustomerInteraction"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerInteraction_opportunityId_idx" ON "CustomerInteraction"("opportunityId");

-- CreateIndex
CREATE INDEX "CustomerInteraction_type_idx" ON "CustomerInteraction"("type");

-- CreateIndex
CREATE INDEX "CustomerInteraction_channel_idx" ON "CustomerInteraction"("channel");

-- CreateIndex
CREATE INDEX "CustomerInteraction_analysisStatus_idx" ON "CustomerInteraction"("analysisStatus");

-- CreateIndex
CREATE INDEX "CustomerInteraction_orgId_idx" ON "CustomerInteraction"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesQuote_shareToken_key" ON "SalesQuote"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "SalesQuote_sourceTradeQuoteId_key" ON "SalesQuote"("sourceTradeQuoteId");

-- CreateIndex
CREATE INDEX "SalesQuote_customerId_idx" ON "SalesQuote"("customerId");

-- CreateIndex
CREATE INDEX "SalesQuote_opportunityId_idx" ON "SalesQuote"("opportunityId");

-- CreateIndex
CREATE INDEX "SalesQuote_status_idx" ON "SalesQuote"("status");

-- CreateIndex
CREATE INDEX "SalesQuote_createdAt_idx" ON "SalesQuote"("createdAt");

-- CreateIndex
CREATE INDEX "SalesQuote_orgId_idx" ON "SalesQuote"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteDiscountSettings_orgId_key" ON "QuoteDiscountSettings"("orgId");

-- CreateIndex
CREATE INDEX "OrgBusinessRule_orgId_ruleKey_status_idx" ON "OrgBusinessRule"("orgId", "ruleKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrgBusinessRule_orgId_ruleKey_version_key" ON "OrgBusinessRule"("orgId", "ruleKey", "version");

-- CreateIndex
CREATE INDEX "OrganizationGlossaryTerm_orgId_status_idx" ON "OrganizationGlossaryTerm"("orgId", "status");

-- CreateIndex
CREATE INDEX "OrganizationGlossaryTerm_orgId_workspaceId_status_idx" ON "OrganizationGlossaryTerm"("orgId", "workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationGlossaryTerm_orgId_scopeKey_canonicalTerm_language_" ON "OrganizationGlossaryTerm"("orgId", "scopeKey", "canonicalTerm", "language");

-- CreateIndex
CREATE INDEX "BusinessObjectDefinition_orgId_status_idx" ON "BusinessObjectDefinition"("orgId", "status");

-- CreateIndex
CREATE INDEX "BusinessObjectDefinition_orgId_workspaceId_idx" ON "BusinessObjectDefinition"("orgId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessObjectDefinition_orgId_objectKey_key" ON "BusinessObjectDefinition"("orgId", "objectKey");

-- CreateIndex
CREATE INDEX "BusinessMetricDefinition_orgId_status_displayOrder_idx" ON "BusinessMetricDefinition"("orgId", "status", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessMetricDefinition_orgId_key_key" ON "BusinessMetricDefinition"("orgId", "key");

-- CreateIndex
CREATE INDEX "WorkspaceSkillBinding_orgId_workspaceId_idx" ON "WorkspaceSkillBinding"("orgId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSkillBinding_workspaceId_skillKey_key" ON "WorkspaceSkillBinding"("workspaceId", "skillKey");

-- CreateIndex
CREATE INDEX "WorkspaceKnowledgeBinding_orgId_workspaceId_idx" ON "WorkspaceKnowledgeBinding"("orgId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceKnowledgeBinding_workspaceId_knowledgeBaseId_key" ON "WorkspaceKnowledgeBinding"("workspaceId", "knowledgeBaseId");

-- CreateIndex
CREATE INDEX "SalesQuoteItem_quoteId_sortOrder_idx" ON "SalesQuoteItem"("quoteId", "sortOrder");

-- CreateIndex
CREATE INDEX "SalesQuoteItem_roomId_idx" ON "SalesQuoteItem"("roomId");

-- CreateIndex
CREATE INDEX "SalesQuoteAddon_quoteId_idx" ON "SalesQuoteAddon"("quoteId");

-- CreateIndex
CREATE INDEX "QuoteRoom_quoteId_sortOrder_idx" ON "QuoteRoom"("quoteId", "sortOrder");

-- CreateIndex
CREATE INDEX "RoomAttachment_roomId_idx" ON "RoomAttachment"("roomId");

-- CreateIndex
CREATE INDEX "Appointment_assignedToId_startAt_idx" ON "Appointment"("assignedToId", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_customerId_idx" ON "Appointment"("customerId");

-- CreateIndex
CREATE INDEX "Appointment_opportunityId_idx" ON "Appointment"("opportunityId");

-- CreateIndex
CREATE INDEX "Appointment_status_startAt_idx" ON "Appointment"("status", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_startAt_idx" ON "Appointment"("startAt");

-- CreateIndex
CREATE INDEX "Appointment_type_startAt_idx" ON "Appointment"("type", "startAt");

-- CreateIndex
CREATE INDEX "MeasurementRecord_customerId_idx" ON "MeasurementRecord"("customerId");

-- CreateIndex
CREATE INDEX "MeasurementRecord_opportunityId_idx" ON "MeasurementRecord"("opportunityId");

-- CreateIndex
CREATE INDEX "MeasurementRecord_measuredById_createdAt_idx" ON "MeasurementRecord"("measuredById", "createdAt");

-- CreateIndex
CREATE INDEX "MeasurementWindow_recordId_sortOrder_idx" ON "MeasurementWindow"("recordId", "sortOrder");

-- CreateIndex
CREATE INDEX "MeasurementPhoto_windowId_idx" ON "MeasurementPhoto"("windowId");

-- CreateIndex
CREATE INDEX "SalesPlaybook_userId_channel_idx" ON "SalesPlaybook"("userId", "channel");

-- CreateIndex
CREATE INDEX "SalesPlaybook_userId_scene_idx" ON "SalesPlaybook"("userId", "scene");

-- CreateIndex
CREATE INDEX "SalesPlaybook_userId_status_idx" ON "SalesPlaybook"("userId", "status");

-- CreateIndex
CREATE INDEX "SalesFAQ_userId_category_idx" ON "SalesFAQ"("userId", "category");

-- CreateIndex
CREATE INDEX "SalesFAQ_userId_language_idx" ON "SalesFAQ"("userId", "language");

-- CreateIndex
CREATE INDEX "SalesFAQ_userId_status_idx" ON "SalesFAQ"("userId", "status");

-- CreateIndex
CREATE INDEX "UserMemory_orgId_userId_layer_idx" ON "UserMemory"("orgId", "userId", "layer");

-- CreateIndex
CREATE INDEX "UserMemory_orgId_userId_memoryType_idx" ON "UserMemory"("orgId", "userId", "memoryType");

-- CreateIndex
CREATE INDEX "UserMemory_orgId_userId_importance_idx" ON "UserMemory"("orgId", "userId", "importance");

-- CreateIndex
CREATE INDEX "UserMemory_orgId_userId_tags_idx" ON "UserMemory"("orgId", "userId", "tags");

-- CreateIndex
CREATE INDEX "UserMemory_orgId_userId_customerId_idx" ON "UserMemory"("orgId", "userId", "customerId");

-- CreateIndex
CREATE INDEX "UserMemory_orgId_userId_projectId_idx" ON "UserMemory"("orgId", "userId", "projectId");

-- CreateIndex
CREATE INDEX "UserMemory_orgId_userId_effectiveTo_idx" ON "UserMemory"("orgId", "userId", "effectiveTo");

-- CreateIndex
CREATE INDEX "UserMemory_userId_layer_idx" ON "UserMemory"("userId", "layer");

-- CreateIndex
CREATE INDEX "UserMemory_supersedesId_idx" ON "UserMemory"("supersedesId");

-- CreateIndex
CREATE INDEX "UserMemory_supersededById_idx" ON "UserMemory"("supersededById");

-- CreateIndex
CREATE INDEX "AgentSkill_orgId_domain_idx" ON "AgentSkill"("orgId", "domain");

-- CreateIndex
CREATE INDEX "AgentSkill_orgId_isActive_idx" ON "AgentSkill"("orgId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSkill_orgId_slug_key" ON "AgentSkill"("orgId", "slug");

-- CreateIndex
CREATE INDEX "SkillExecution_skillId_createdAt_idx" ON "SkillExecution"("skillId", "createdAt");

-- CreateIndex
CREATE INDEX "SkillExecution_skillId_success_idx" ON "SkillExecution"("skillId", "success");

-- CreateIndex
CREATE INDEX "SkillExecution_skillId_userRating_idx" ON "SkillExecution"("skillId", "userRating");

-- CreateIndex
CREATE INDEX "MessageEmbedding_userId_sourceType_idx" ON "MessageEmbedding"("userId", "sourceType");

-- CreateIndex
CREATE INDEX "MessageEmbedding_orgId_sourceType_idx" ON "MessageEmbedding"("orgId", "sourceType");

-- CreateIndex
CREATE INDEX "MessageEmbedding_userId_createdAt_idx" ON "MessageEmbedding"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageEmbedding_sourceType_sourceId_key" ON "MessageEmbedding"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "ConversationSummary_userId_sourceType_idx" ON "ConversationSummary"("userId", "sourceType");

-- CreateIndex
CREATE INDEX "ConversationSummary_userId_updatedAt_idx" ON "ConversationSummary"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationSummary_sourceType_sessionId_key" ON "ConversationSummary"("sourceType", "sessionId");

-- CreateIndex
CREATE INDEX "WeChatBinding_userId_idx" ON "WeChatBinding"("userId");

-- CreateIndex
CREATE INDEX "WeChatBinding_channel_status_idx" ON "WeChatBinding"("channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WeChatBinding_channel_externalId_key" ON "WeChatBinding"("channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "WeChatGateway_orgId_channel_key" ON "WeChatGateway"("orgId", "channel");

-- CreateIndex
CREATE INDEX "WeChatContext_orgId_channel_idx" ON "WeChatContext"("orgId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "WeChatContext_orgId_channel_externalUserId_key" ON "WeChatContext"("orgId", "channel", "externalUserId");

-- CreateIndex
CREATE INDEX "WeChatGraderContext_userId_idx" ON "WeChatGraderContext"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WeChatGraderContext_orgId_userId_channel_key" ON "WeChatGraderContext"("orgId", "userId", "channel");

-- CreateIndex
CREATE INDEX "WeChatMessage_bindingId_createdAt_idx" ON "WeChatMessage"("bindingId", "createdAt");

-- CreateIndex
CREATE INDEX "WeChatMessage_userId_createdAt_idx" ON "WeChatMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WeChatMessage_channel_createdAt_idx" ON "WeChatMessage"("channel", "createdAt");

-- CreateIndex
CREATE INDEX "WeChatMessage_orgId_channel_externalMsgId_idx" ON "WeChatMessage"("orgId", "channel", "externalMsgId");

-- CreateIndex
CREATE INDEX "AgentSession_orgId_userId_idx" ON "AgentSession"("orgId", "userId");

-- CreateIndex
CREATE INDEX "AgentSession_orgId_channel_channelConversationId_idx" ON "AgentSession"("orgId", "channel", "channelConversationId");

-- CreateIndex
CREATE INDEX "AgentSession_orgId_channel_channelUserId_status_idx" ON "AgentSession"("orgId", "channel", "channelUserId", "status");

-- CreateIndex
CREATE INDEX "AgentRun_orgId_sessionId_idx" ON "AgentRun"("orgId", "sessionId");

-- CreateIndex
CREATE INDEX "AgentRun_orgId_status_idx" ON "AgentRun"("orgId", "status");

-- CreateIndex
CREATE INDEX "AgentRun_orgId_userMessageId_idx" ON "AgentRun"("orgId", "userMessageId");

-- CreateIndex
CREATE INDEX "AgentRun_orgId_traceId_idx" ON "AgentRun"("orgId", "traceId");

-- CreateIndex
CREATE INDEX "AgentRun_orgId_runtimeVersion_status_idx" ON "AgentRun"("orgId", "runtimeVersion", "status");

-- CreateIndex
CREATE INDEX "AgentRun_status_nextAttemptAt_idx" ON "AgentRun"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AgentRun_status_leaseExpiresAt_idx" ON "AgentRun"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AgentRun_agentTaskId_idx" ON "AgentRun"("agentTaskId");

-- CreateIndex
CREATE INDEX "AgentRunStep_orgId_runId_idx" ON "AgentRunStep"("orgId", "runId");

-- CreateIndex
CREATE INDEX "AgentRunStep_runId_status_idx" ON "AgentRunStep"("runId", "status");

-- CreateIndex
CREATE INDEX "AgentRunStep_orgId_pendingActionId_idx" ON "AgentRunStep"("orgId", "pendingActionId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRunStep_runId_stepKey_key" ON "AgentRunStep"("runId", "stepKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRunStep_orgId_idempotencyKey_key" ON "AgentRunStep"("orgId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentRunVerification_orgId_runId_idx" ON "AgentRunVerification"("orgId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRunVerification_runId_attempt_key" ON "AgentRunVerification"("runId", "attempt");

-- CreateIndex
CREATE INDEX "AgentRunEvent_orgId_runId_idx" ON "AgentRunEvent"("orgId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRunEvent_runId_sequence_key" ON "AgentRunEvent"("runId", "sequence");

-- CreateIndex
CREATE INDEX "ServiceConversation_orgId_status_unansweredSince_idx" ON "ServiceConversation"("orgId", "status", "unansweredSince");

-- CreateIndex
CREATE INDEX "ServiceConversation_orgId_lastCustomerMessageAt_idx" ON "ServiceConversation"("orgId", "lastCustomerMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceConversation_orgId_channel_externalUserId_key" ON "ServiceConversation"("orgId", "channel", "externalUserId");

-- CreateIndex
CREATE INDEX "ServiceMessage_conversationId_createdAt_idx" ON "ServiceMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceMessage_orgId_createdAt_idx" ON "ServiceMessage"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesKnowledgeChunk_customerId_idx" ON "SalesKnowledgeChunk"("customerId");

-- CreateIndex
CREATE INDEX "SalesKnowledgeChunk_opportunityId_idx" ON "SalesKnowledgeChunk"("opportunityId");

-- CreateIndex
CREATE INDEX "SalesKnowledgeChunk_interactionId_idx" ON "SalesKnowledgeChunk"("interactionId");

-- CreateIndex
CREATE INDEX "SalesKnowledgeChunk_sourceType_idx" ON "SalesKnowledgeChunk"("sourceType");

-- CreateIndex
CREATE INDEX "SalesKnowledgeChunk_isWinPattern_idx" ON "SalesKnowledgeChunk"("isWinPattern");

-- CreateIndex
CREATE INDEX "SalesKnowledgeChunk_isLossSignal_idx" ON "SalesKnowledgeChunk"("isLossSignal");

-- CreateIndex
CREATE INDEX "SalesKnowledgeChunk_intent_idx" ON "SalesKnowledgeChunk"("intent");

-- CreateIndex
CREATE INDEX "SalesInsight_insightType_idx" ON "SalesInsight"("insightType");

-- CreateIndex
CREATE INDEX "SalesInsight_dealStage_idx" ON "SalesInsight"("dealStage");

-- CreateIndex
CREATE INDEX "SalesInsight_status_idx" ON "SalesInsight"("status");

-- CreateIndex
CREATE INDEX "SalesInsight_effectiveness_idx" ON "SalesInsight"("effectiveness");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfile_customerId_key" ON "CustomerProfile"("customerId");

-- CreateIndex
CREATE INDEX "CustomerProfile_customerType_idx" ON "CustomerProfile"("customerType");

-- CreateIndex
CREATE INDEX "CustomerProfile_segment_idx" ON "CustomerProfile"("segment");

-- CreateIndex
CREATE INDEX "CustomerProfile_budgetRange_idx" ON "CustomerProfile"("budgetRange");

-- CreateIndex
CREATE INDEX "CustomerProfile_winProbability_idx" ON "CustomerProfile"("winProbability");

-- CreateIndex
CREATE INDEX "CoachingRecord_userId_idx" ON "CoachingRecord"("userId");

-- CreateIndex
CREATE INDEX "CoachingRecord_customerId_idx" ON "CoachingRecord"("customerId");

-- CreateIndex
CREATE INDEX "CoachingRecord_opportunityId_idx" ON "CoachingRecord"("opportunityId");

-- CreateIndex
CREATE INDEX "CoachingRecord_insightId_idx" ON "CoachingRecord"("insightId");

-- CreateIndex
CREATE INDEX "CoachingRecord_outcome_idx" ON "CoachingRecord"("outcome");

-- CreateIndex
CREATE INDEX "CoachingRecord_coachingType_idx" ON "CoachingRecord"("coachingType");

-- CreateIndex
CREATE UNIQUE INDEX "VisualizerSession_shareToken_key" ON "VisualizerSession"("shareToken");

-- CreateIndex
CREATE INDEX "VisualizerSession_customerId_idx" ON "VisualizerSession"("customerId");

-- CreateIndex
CREATE INDEX "VisualizerSession_opportunityId_idx" ON "VisualizerSession"("opportunityId");

-- CreateIndex
CREATE INDEX "VisualizerSession_quoteId_idx" ON "VisualizerSession"("quoteId");

-- CreateIndex
CREATE INDEX "VisualizerSession_salesOwnerId_idx" ON "VisualizerSession"("salesOwnerId");

-- CreateIndex
CREATE INDEX "VisualizerSession_createdById_createdAt_idx" ON "VisualizerSession"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "VisualizerSourceImage_sessionId_idx" ON "VisualizerSourceImage"("sessionId");

-- CreateIndex
CREATE INDEX "VisualizerWindowRegion_sourceImageId_idx" ON "VisualizerWindowRegion"("sourceImageId");

-- CreateIndex
CREATE INDEX "VisualizerVariant_sessionId_sortOrder_idx" ON "VisualizerVariant"("sessionId", "sortOrder");

-- CreateIndex
CREATE INDEX "VisualizerProductOption_variantId_idx" ON "VisualizerProductOption"("variantId");

-- CreateIndex
CREATE INDEX "VisualizerProductOption_regionId_idx" ON "VisualizerProductOption"("regionId");

-- CreateIndex
CREATE INDEX "VisualizerSelection_variantId_idx" ON "VisualizerSelection"("variantId");

-- CreateIndex
CREATE INDEX "VisualizerCatalogProduct_orgId_archived_idx" ON "VisualizerCatalogProduct"("orgId", "archived");

-- CreateIndex
CREATE INDEX "VisualizerCatalogProduct_category_idx" ON "VisualizerCatalogProduct"("category");

-- CreateIndex
CREATE INDEX "VisualizerCatalogAsset_productId_role_sortOrder_idx" ON "VisualizerCatalogAsset"("productId", "role", "sortOrder");

-- CreateIndex
CREATE INDEX "VisualizerCatalogAsset_productId_verificationStatus_idx" ON "VisualizerCatalogAsset"("productId", "verificationStatus");

-- CreateIndex
CREATE INDEX "VisualizerCatalogTemplateJob_status_createdAt_idx" ON "VisualizerCatalogTemplateJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VisualizerCatalogTemplateJob_productId_templateType_createdAt_i" ON "VisualizerCatalogTemplateJob"("productId", "templateType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfile_orgId_key" ON "BrandProfile"("orgId");

-- CreateIndex
CREATE INDEX "ContentPlanItem_orgId_plannedDate_idx" ON "ContentPlanItem"("orgId", "plannedDate");

-- CreateIndex
CREATE INDEX "ContentPlanItem_orgId_status_idx" ON "ContentPlanItem"("orgId", "status");

-- CreateIndex
CREATE INDEX "ContentPlanItem_orgId_sourceSignalId_idx" ON "ContentPlanItem"("orgId", "sourceSignalId");

-- CreateIndex
CREATE INDEX "MatrixAccount_orgId_status_idx" ON "MatrixAccount"("orgId", "status");

-- CreateIndex
CREATE INDEX "MatrixAccount_orgId_groupName_idx" ON "MatrixAccount"("orgId", "groupName");

-- CreateIndex
CREATE UNIQUE INDEX "MatrixAccount_orgId_platform_handle_key" ON "MatrixAccount"("orgId", "platform", "handle");

-- CreateIndex
CREATE INDEX "VideoAsset_orgId_status_createdAt_idx" ON "VideoAsset"("orgId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoAsset_source_externalId_key" ON "VideoAsset"("source", "externalId");

-- CreateIndex
CREATE INDEX "PublishJob_orgId_status_scheduledAt_idx" ON "PublishJob"("orgId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "PublishJob_accountId_status_idx" ON "PublishJob"("accountId", "status");

-- CreateIndex
CREATE INDEX "PublishJob_channel_status_nextAttemptAt_idx" ON "PublishJob"("channel", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PublishJob_channel_leaseExpiresAt_idx" ON "PublishJob"("channel", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublishJob_assetId_accountId_key" ON "PublishJob"("assetId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishJob_channel_externalJobId_key" ON "PublishJob"("channel", "externalJobId");

-- CreateIndex
CREATE INDEX "AutomationRun_automationKey_startedAt_idx" ON "AutomationRun"("automationKey", "startedAt");

-- CreateIndex
CREATE INDEX "AutomationRun_orgId_automationKey_startedAt_idx" ON "AutomationRun"("orgId", "automationKey", "startedAt");

-- CreateIndex
CREATE INDEX "AutomationRun_status_startedAt_idx" ON "AutomationRun"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingBrandProfile_orgId_key" ON "MarketingBrandProfile"("orgId");

-- CreateIndex
CREATE INDEX "MarketingBrandProfile_orgId_validationStatus_idx" ON "MarketingBrandProfile"("orgId", "validationStatus");

-- CreateIndex
CREATE INDEX "MarketingChannelAccount_orgId_status_idx" ON "MarketingChannelAccount"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingChannelAccount_orgId_provider_name_key" ON "MarketingChannelAccount"("orgId", "provider", "name");

-- CreateIndex
CREATE INDEX "MarketingAuditRun_orgId_createdAt_idx" ON "MarketingAuditRun"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingAuditRun_orgId_status_idx" ON "MarketingAuditRun"("orgId", "status");

-- CreateIndex
CREATE INDEX "MarketingDimensionScore_orgId_dimension_idx" ON "MarketingDimensionScore"("orgId", "dimension");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingDimensionScore_auditRunId_dimension_key" ON "MarketingDimensionScore"("auditRunId", "dimension");

-- CreateIndex
CREATE INDEX "MarketingFinding_orgId_status_severity_idx" ON "MarketingFinding"("orgId", "status", "severity");

-- CreateIndex
CREATE INDEX "MarketingFinding_orgId_dimension_idx" ON "MarketingFinding"("orgId", "dimension");

-- CreateIndex
CREATE INDEX "MarketingFinding_taskId_idx" ON "MarketingFinding"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPlan_sourceResearchRunId_key" ON "MarketingPlan"("sourceResearchRunId");

-- CreateIndex
CREATE INDEX "MarketingPlan_orgId_status_startDate_idx" ON "MarketingPlan"("orgId", "status", "startDate");

-- CreateIndex
CREATE INDEX "MarketingPlanItem_orgId_dueDate_idx" ON "MarketingPlanItem"("orgId", "dueDate");

-- CreateIndex
CREATE INDEX "MarketingPlanItem_planId_dayOffset_idx" ON "MarketingPlanItem"("planId", "dayOffset");

-- CreateIndex
CREATE INDEX "MarketingCampaign_orgId_status_createdAt_idx" ON "MarketingCampaign"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingContentAsset_orgId_campaignId_idx" ON "MarketingContentAsset"("orgId", "campaignId");

-- CreateIndex
CREATE INDEX "MarketingContentAsset_contentPlanItemId_idx" ON "MarketingContentAsset"("contentPlanItemId");

-- CreateIndex
CREATE INDEX "MarketingContentAsset_videoAssetId_idx" ON "MarketingContentAsset"("videoAssetId");

-- CreateIndex
CREATE INDEX "MarketingPublication_orgId_campaignId_status_idx" ON "MarketingPublication"("orgId", "campaignId", "status");

-- CreateIndex
CREATE INDEX "MarketingPublication_publishJobId_idx" ON "MarketingPublication"("publishJobId");

-- CreateIndex
CREATE INDEX "MarketingMetricSnapshot_orgId_capturedAt_idx" ON "MarketingMetricSnapshot"("orgId", "capturedAt");

-- CreateIndex
CREATE INDEX "MarketingMetricSnapshot_orgId_campaignId_idx" ON "MarketingMetricSnapshot"("orgId", "campaignId");

-- CreateIndex
CREATE INDEX "MarketingMetricSnapshot_orgId_periodStart_granularity_idx" ON "MarketingMetricSnapshot"("orgId", "periodStart", "granularity");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingMetricSnapshot_orgId_source_ingestionKey_key" ON "MarketingMetricSnapshot"("orgId", "source", "ingestionKey");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingWorkflowRun_requestId_key" ON "MarketingWorkflowRun"("requestId");

-- CreateIndex
CREATE INDEX "MarketingWorkflowRun_orgId_flowKey_createdAt_idx" ON "MarketingWorkflowRun"("orgId", "flowKey", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingWorkflowRun_status_createdAt_idx" ON "MarketingWorkflowRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingWorkflowRun_provider_externalRunId_key" ON "MarketingWorkflowRun"("provider", "externalRunId");

-- CreateIndex
CREATE INDEX "MmmDatasetVersion_orgId_createdAt_idx" ON "MmmDatasetVersion"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MmmDatasetVersion_orgId_checksum_key" ON "MmmDatasetVersion"("orgId", "checksum");

-- CreateIndex
CREATE INDEX "MmmModelRun_orgId_createdAt_idx" ON "MmmModelRun"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "MmmModelRun_datasetVersionId_status_idx" ON "MmmModelRun"("datasetVersionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MmmModelRun_provider_externalRunId_key" ON "MmmModelRun"("provider", "externalRunId");

-- CreateIndex
CREATE INDEX "MmmChannelContribution_orgId_channel_idx" ON "MmmChannelContribution"("orgId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "MmmChannelContribution_modelRunId_channel_key" ON "MmmChannelContribution"("modelRunId", "channel");

-- CreateIndex
CREATE INDEX "MmmBudgetScenario_orgId_createdAt_idx" ON "MmmBudgetScenario"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "MmmBudgetScenario_modelRunId_idx" ON "MmmBudgetScenario"("modelRunId");

-- CreateIndex
CREATE INDEX "MarketingExperiment_orgId_status_idx" ON "MarketingExperiment"("orgId", "status");

-- CreateIndex
CREATE INDEX "MarketingExperiment_campaignId_idx" ON "MarketingExperiment"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingLeadAttribution_orgId_salesOpportunityId_idx" ON "MarketingLeadAttribution"("orgId", "salesOpportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingLeadAttribution_orgId_campaignId_salesOpportunityI_key" ON "MarketingLeadAttribution"("orgId", "campaignId", "salesOpportunityId");

-- CreateIndex
CREATE INDEX "EmployeeAiProfile_orgId_department_idx" ON "EmployeeAiProfile"("orgId", "department");

-- CreateIndex
CREATE INDEX "EmployeeAiProfile_userId_idx" ON "EmployeeAiProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAiProfile_orgId_userId_key" ON "EmployeeAiProfile"("orgId", "userId");

-- CreateIndex
CREATE INDEX "HumanFeedbackEvent_orgId_userId_createdAt_idx" ON "HumanFeedbackEvent"("orgId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "HumanFeedbackEvent_orgId_feedbackScope_createdAt_idx" ON "HumanFeedbackEvent"("orgId", "feedbackScope", "createdAt");

-- CreateIndex
CREATE INDEX "HumanFeedbackEvent_orgId_skillSlug_createdAt_idx" ON "HumanFeedbackEvent"("orgId", "skillSlug", "createdAt");

-- CreateIndex
CREATE INDEX "HumanFeedbackEvent_agentRunId_idx" ON "HumanFeedbackEvent"("agentRunId");

-- CreateIndex
CREATE INDEX "HumanFeedbackEvent_pendingActionId_idx" ON "HumanFeedbackEvent"("pendingActionId");

-- CreateIndex
CREATE INDEX "HumanFeedbackEvent_skillExecutionId_idx" ON "HumanFeedbackEvent"("skillExecutionId");

-- CreateIndex
CREATE INDEX "BusinessOutcome_orgId_entityType_entityId_idx" ON "BusinessOutcome"("orgId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "BusinessOutcome_orgId_outcomeType_createdAt_idx" ON "BusinessOutcome"("orgId", "outcomeType", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessOutcome_feedbackEventId_idx" ON "BusinessOutcome"("feedbackEventId");

-- CreateIndex
CREATE INDEX "BusinessOutcome_pendingActionId_idx" ON "BusinessOutcome"("pendingActionId");

-- CreateIndex
CREATE INDEX "CandidatePractice_orgId_status_department_idx" ON "CandidatePractice"("orgId", "status", "department");

-- CreateIndex
CREATE INDEX "CandidatePractice_orgId_roleScope_idx" ON "CandidatePractice"("orgId", "roleScope");

-- CreateIndex
CREATE INDEX "RolePlaybook_orgId_status_department_idx" ON "RolePlaybook"("orgId", "status", "department");

-- CreateIndex
CREATE INDEX "RolePlaybook_orgId_roleScope_status_idx" ON "RolePlaybook"("orgId", "roleScope", "status");

-- CreateIndex
CREATE INDEX "RolePlaybook_supersedesId_idx" ON "RolePlaybook"("supersedesId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePlaybook_orgId_name_version_key" ON "RolePlaybook"("orgId", "name", "version");

-- CreateIndex
CREATE INDEX "AgentSkillVersion_orgId_skillId_idx" ON "AgentSkillVersion"("orgId", "skillId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSkillVersion_skillId_version_key" ON "AgentSkillVersion"("skillId", "version");

-- CreateIndex
CREATE INDEX "EvaluationCase_orgId_domain_taskType_idx" ON "EvaluationCase"("orgId", "domain", "taskType");

-- CreateIndex
CREATE INDEX "EvaluationCase_orgId_approved_idx" ON "EvaluationCase"("orgId", "approved");

-- CreateIndex
CREATE INDEX "TradeProduct_orgId_category_idx" ON "TradeProduct"("orgId", "category");

-- CreateIndex
CREATE INDEX "TradeProduct_orgId_status_idx" ON "TradeProduct"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TradeProduct_orgId_sku_key" ON "TradeProduct"("orgId", "sku");

-- CreateIndex
CREATE INDEX "ProductAsset_orgId_productId_idx" ON "ProductAsset"("orgId", "productId");

-- CreateIndex
CREATE INDEX "ProductAsset_orgId_jobId_idx" ON "ProductAsset"("orgId", "jobId");

-- CreateIndex
CREATE INDEX "ProductFact_orgId_jobId_fieldKey_idx" ON "ProductFact"("orgId", "jobId", "fieldKey");

-- CreateIndex
CREATE INDEX "ProductFact_orgId_productId_fieldKey_idx" ON "ProductFact"("orgId", "productId", "fieldKey");

-- CreateIndex
CREATE INDEX "ProductFact_orgId_status_idx" ON "ProductFact"("orgId", "status");

-- CreateIndex
CREATE INDEX "ProductFactConflict_orgId_jobId_status_idx" ON "ProductFactConflict"("orgId", "jobId", "status");

-- CreateIndex
CREATE INDEX "ProductContentJob_orgId_status_idx" ON "ProductContentJob"("orgId", "status");

-- CreateIndex
CREATE INDEX "ProductContentJob_orgId_createdAt_idx" ON "ProductContentJob"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductContentJob_orgId_productId_idx" ON "ProductContentJob"("orgId", "productId");

-- CreateIndex
CREATE INDEX "ProductContentSnapshot_orgId_jobId_idx" ON "ProductContentSnapshot"("orgId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductContentSnapshot_jobId_version_key" ON "ProductContentSnapshot"("jobId", "version");

-- CreateIndex
CREATE INDEX "ProductContentCostEntry_orgId_jobId_idx" ON "ProductContentCostEntry"("orgId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageLedger_idempotencyKey_key" ON "AiUsageLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AiUsageLedger_orgId_occurredAt_idx" ON "AiUsageLedger"("orgId", "occurredAt");

-- CreateIndex
CREATE INDEX "AiUsageLedger_workspaceId_occurredAt_idx" ON "AiUsageLedger"("workspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "AiUsageLedger_traceId_idx" ON "AiUsageLedger"("traceId");

-- CreateIndex
CREATE INDEX "AiUsageLedger_runId_idx" ON "AiUsageLedger"("runId");

-- CreateIndex
CREATE INDEX "AiUsageLedger_provider_model_idx" ON "AiUsageLedger"("provider", "model");

-- CreateIndex
CREATE INDEX "AiUsageLedger_orgId_sourceType_sourceId_idx" ON "AiUsageLedger"("orgId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "CapabilityQuotaPolicy_orgId_metric_enabled_idx" ON "CapabilityQuotaPolicy"("orgId", "metric", "enabled");

-- CreateIndex
CREATE INDEX "CapabilityQuotaPolicy_orgId_workspaceId_metric_idx" ON "CapabilityQuotaPolicy"("orgId", "workspaceId", "metric");

-- CreateIndex
CREATE INDEX "CapabilityQuotaPolicy_orgId_metric_version_idx" ON "CapabilityQuotaPolicy"("orgId", "metric", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CapabilityQuotaReservation_idempotencyKey_key" ON "CapabilityQuotaReservation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CapabilityQuotaReservation_orgId_metric_status_expiresAt_idx" ON "CapabilityQuotaReservation"("orgId", "metric", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "CapabilityQuotaReservation_orgId_workspaceId_metric_status_idx" ON "CapabilityQuotaReservation"("orgId", "workspaceId", "metric", "status");

-- CreateIndex
CREATE INDEX "CapabilityQuotaReservation_runId_idx" ON "CapabilityQuotaReservation"("runId");

-- CreateIndex
CREATE INDEX "ProductContentJobInput_orgId_jobId_idx" ON "ProductContentJobInput"("orgId", "jobId");

-- CreateIndex
CREATE INDEX "ProductContentStep_orgId_jobId_stepKey_idx" ON "ProductContentStep"("orgId", "jobId", "stepKey");

-- CreateIndex
CREATE INDEX "VisualGenerationJob_orgId_jobId_idx" ON "VisualGenerationJob"("orgId", "jobId");

-- CreateIndex
CREATE INDEX "VisualOutput_orgId_visualJobId_idx" ON "VisualOutput"("orgId", "visualJobId");

-- CreateIndex
CREATE INDEX "VisualOutput_orgId_status_idx" ON "VisualOutput"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VisualQaResult_visualOutputId_key" ON "VisualQaResult"("visualOutputId");

-- CreateIndex
CREATE INDEX "VisualQaResult_orgId_recommendedStatus_idx" ON "VisualQaResult"("orgId", "recommendedStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCopy_jobId_key" ON "ProductCopy"("jobId");

-- CreateIndex
CREATE INDEX "ProductCopy_orgId_status_idx" ON "ProductCopy"("orgId", "status");

-- CreateIndex
CREATE INDEX "GeneratedDocument_orgId_jobId_docType_idx" ON "GeneratedDocument"("orgId", "jobId", "docType");

-- CreateIndex
CREATE INDEX "ProductContentApproval_orgId_jobId_status_idx" ON "ProductContentApproval"("orgId", "jobId", "status");

-- CreateIndex
CREATE INDEX "ProductContentApproval_orgId_actionKey_idx" ON "ProductContentApproval"("orgId", "actionKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentApprovalSettings_orgId_key" ON "AgentApprovalSettings"("orgId");

-- CreateIndex
CREATE INDEX "AgentTaskDependency_dependsOnTaskId_idx" ON "AgentTaskDependency"("dependsOnTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTaskDependency_taskId_dependsOnTaskId_key" ON "AgentTaskDependency"("taskId", "dependsOnTaskId");

-- CreateIndex
CREATE INDEX "BidDataRevision_projectId_createdAt_idx" ON "BidDataRevision"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "BidDataRevision_projectId_status_idx" ON "BidDataRevision"("projectId", "status");

-- CreateIndex
CREATE INDEX "BidDataRevision_sourceRootTaskId_idx" ON "BidDataRevision"("sourceRootTaskId");

-- CreateIndex
CREATE INDEX "BidDataRevision_status_idx" ON "BidDataRevision"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BidDataRevision_projectId_projectionHash_key" ON "BidDataRevision"("projectId", "projectionHash");

-- CreateIndex
CREATE UNIQUE INDEX "BidDataRevision_projectId_revisionNumber_key" ON "BidDataRevision"("projectId", "revisionNumber");

-- CreateIndex
CREATE INDEX "ComplianceResponse_bidDataRevisionId_idx" ON "ComplianceResponse"("bidDataRevisionId");

-- CreateIndex
CREATE INDEX "ComplianceResponse_projectId_idx" ON "ComplianceResponse"("projectId");

-- CreateIndex
CREATE INDEX "ComplianceResponse_reviewStatus_idx" ON "ComplianceResponse"("reviewStatus");

-- CreateIndex
CREATE INDEX "ComplianceResponse_sourceAgentRunId_idx" ON "ComplianceResponse"("sourceAgentRunId");

-- CreateIndex
CREATE INDEX "ComplianceResponse_status_idx" ON "ComplianceResponse"("status");

-- CreateIndex
CREATE INDEX "ComplianceResponse_tenderRequirementId_idx" ON "ComplianceResponse"("tenderRequirementId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceResponse_bidDataRevisionId_stableKey_key" ON "ComplianceResponse"("bidDataRevisionId", "stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceResponse_bidDataRevisionId_tenderRequirementId_key" ON "ComplianceResponse"("bidDataRevisionId", "tenderRequirementId");

-- CreateIndex
CREATE INDEX "ComplianceResponseEvidence_complianceResponseId_idx" ON "ComplianceResponseEvidence"("complianceResponseId");

-- CreateIndex
CREATE INDEX "ComplianceResponseEvidence_productEvidenceId_idx" ON "ComplianceResponseEvidence"("productEvidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceResponseEvidence_complianceResponseId_productEvidence" ON "ComplianceResponseEvidence"("complianceResponseId", "productEvidenceId");

-- CreateIndex
CREATE INDEX "PricingScenario_bidDataRevisionId_idx" ON "PricingScenario"("bidDataRevisionId");

-- CreateIndex
CREATE INDEX "PricingScenario_projectId_idx" ON "PricingScenario"("projectId");

-- CreateIndex
CREATE INDEX "PricingScenario_sourcePricingRunId_idx" ON "PricingScenario"("sourcePricingRunId");

-- CreateIndex
CREATE INDEX "PricingScenario_status_idx" ON "PricingScenario"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PricingScenario_bidDataRevisionId_scenarioNumber_key" ON "PricingScenario"("bidDataRevisionId", "scenarioNumber");

-- CreateIndex
CREATE INDEX "PricingScenarioLineItem_confirmationStatus_idx" ON "PricingScenarioLineItem"("confirmationStatus");

-- CreateIndex
CREATE INDEX "PricingScenarioLineItem_lineType_idx" ON "PricingScenarioLineItem"("lineType");

-- CreateIndex
CREATE INDEX "PricingScenarioLineItem_pricingScenarioId_idx" ON "PricingScenarioLineItem"("pricingScenarioId");

-- CreateIndex
CREATE INDEX "PricingScenarioLineItem_sourceAgentRunId_idx" ON "PricingScenarioLineItem"("sourceAgentRunId");

-- CreateIndex
CREATE INDEX "PricingScenarioLineItem_sourceProjectFactId_idx" ON "PricingScenarioLineItem"("sourceProjectFactId");

-- CreateIndex
CREATE INDEX "ProductEvidence_bidDataRevisionId_idx" ON "ProductEvidence"("bidDataRevisionId");

-- CreateIndex
CREATE INDEX "ProductEvidence_confirmationStatus_idx" ON "ProductEvidence"("confirmationStatus");

-- CreateIndex
CREATE INDEX "ProductEvidence_factKey_idx" ON "ProductEvidence"("factKey");

-- CreateIndex
CREATE INDEX "ProductEvidence_projectId_idx" ON "ProductEvidence"("projectId");

-- CreateIndex
CREATE INDEX "ProductEvidence_reviewStatus_idx" ON "ProductEvidence"("reviewStatus");

-- CreateIndex
CREATE INDEX "ProductEvidence_sourceAgentRunId_idx" ON "ProductEvidence"("sourceAgentRunId");

-- CreateIndex
CREATE INDEX "ProductEvidence_sourceDocumentId_idx" ON "ProductEvidence"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "ProductEvidence_sourceProjectFactId_idx" ON "ProductEvidence"("sourceProjectFactId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductEvidence_bidDataRevisionId_stableKey_key" ON "ProductEvidence"("bidDataRevisionId", "stableKey");

-- CreateIndex
CREATE INDEX "ProjectAgentEvent_eventType_createdAt_idx" ON "ProjectAgentEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectAgentEvent_projectId_createdAt_idx" ON "ProjectAgentEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectAgentEvent_projectId_id_idx" ON "ProjectAgentEvent"("projectId", "id");

-- CreateIndex
CREATE INDEX "ProjectAgentEvent_rootTaskId_createdAt_idx" ON "ProjectAgentEvent"("rootTaskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectConflict_idempotencyKey_key" ON "ProjectConflict"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProjectConflict_conflictType_factKey_idx" ON "ProjectConflict"("conflictType", "factKey");

-- CreateIndex
CREATE INDEX "ProjectConflict_projectId_status_idx" ON "ProjectConflict"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectConflict_rootTaskId_idx" ON "ProjectConflict"("rootTaskId");

-- CreateIndex
CREATE INDEX "ProjectConflict_sourceAgentRunId_idx" ON "ProjectConflict"("sourceAgentRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFact_idempotencyKey_key" ON "ProjectFact"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProjectFact_agentRunId_idx" ON "ProjectFact"("agentRunId");

-- CreateIndex
CREATE INDEX "ProjectFact_agentTaskId_idx" ON "ProjectFact"("agentTaskId");

-- CreateIndex
CREATE INDEX "ProjectFact_orgId_status_idx" ON "ProjectFact"("orgId", "status");

-- CreateIndex
CREATE INDEX "ProjectFact_pendingActionId_idx" ON "ProjectFact"("pendingActionId");

-- CreateIndex
CREATE INDEX "ProjectFact_projectId_factKey_status_idx" ON "ProjectFact"("projectId", "factKey", "status");

-- CreateIndex
CREATE INDEX "ProjectFact_projectId_status_updatedAt_idx" ON "ProjectFact"("projectId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ProjectFact_sourceMessageId_idx" ON "ProjectFact"("sourceMessageId");

-- CreateIndex
CREATE INDEX "TenderRequirement_bidDataRevisionId_idx" ON "TenderRequirement"("bidDataRevisionId");

-- CreateIndex
CREATE INDEX "TenderRequirement_category_idx" ON "TenderRequirement"("category");

-- CreateIndex
CREATE INDEX "TenderRequirement_deletedAt_idx" ON "TenderRequirement"("deletedAt");

-- CreateIndex
CREATE INDEX "TenderRequirement_projectId_idx" ON "TenderRequirement"("projectId");

-- CreateIndex
CREATE INDEX "TenderRequirement_reviewStatus_idx" ON "TenderRequirement"("reviewStatus");

-- CreateIndex
CREATE INDEX "TenderRequirement_sourceAgentRunId_idx" ON "TenderRequirement"("sourceAgentRunId");

-- CreateIndex
CREATE INDEX "TenderRequirement_sourceDocumentId_idx" ON "TenderRequirement"("sourceDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "TenderRequirement_bidDataRevisionId_stableKey_key" ON "TenderRequirement"("bidDataRevisionId", "stableKey");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeOrgId_fkey" FOREIGN KEY ("activeOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailBinding" ADD CONSTRAINT "EmailBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_purchaserId_fkey" FOREIGN KEY ("purchaserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskActivity" ADD CONSTRAINT "TaskActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskActivity" ADD CONSTRAINT "TaskActivity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagOnTask" ADD CONSTRAINT "TagOnTask_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagOnTask" ADD CONSTRAINT "TagOnTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindsOrder" ADD CONSTRAINT "BlindsOrder_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindsOrder" ADD CONSTRAINT "BlindsOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindsOrder" ADD CONSTRAINT "BlindsOrder_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindsOrder" ADD CONSTRAINT "BlindsOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusLog" ADD CONSTRAINT "OrderStatusLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "BlindsOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindsOrderItem" ADD CONSTRAINT "BlindsOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "BlindsOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarProvider" ADD CONSTRAINT "CalendarProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationProjectRule" ADD CONSTRAINT "OrganizationProjectRule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleProfile" ADD CONSTRAINT "RoleProfile_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermissionBinding" ADD CONSTRAINT "RolePermissionBinding_roleProfileId_fkey" FOREIGN KEY ("roleProfileId") REFERENCES "RoleProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrincipalRoleBinding" ADD CONSTRAINT "PrincipalRoleBinding_roleProfileId_fkey" FOREIGN KEY ("roleProfileId") REFERENCES "RoleProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionTemplate" ADD CONSTRAINT "PositionTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionTemplate" ADD CONSTRAINT "PositionTemplate_primaryRoleProfileId_fkey" FOREIGN KEY ("primaryRoleProfileId") REFERENCES "RoleProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "PromptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "PromptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptPublishLog" ADD CONSTRAINT "PromptPublishLog_fromEnvironmentId_fkey" FOREIGN KEY ("fromEnvironmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptPublishLog" ADD CONSTRAINT "PromptPublishLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptPublishLog" ADD CONSTRAINT "PromptPublishLog_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptPublishLog" ADD CONSTRAINT "PromptPublishLog_toEnvironmentId_fkey" FOREIGN KEY ("toEnvironmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "KnowledgeBaseVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBaseVersion" ADD CONSTRAINT "KnowledgeBaseVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBaseVersion" ADD CONSTRAINT "KnowledgeBaseVersion_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBaseVersion" ADD CONSTRAINT "KnowledgeBaseVersion_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "KnowledgeBaseVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocumentVersion" ADD CONSTRAINT "KnowledgeDocumentVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocumentVersion" ADD CONSTRAINT "KnowledgeDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocumentVersion" ADD CONSTRAINT "KnowledgeDocumentVersion_knowledgeBaseVersionId_fkey" FOREIGN KEY ("knowledgeBaseVersionId") REFERENCES "KnowledgeBaseVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocumentVersion" ADD CONSTRAINT "KnowledgeDocumentVersion_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "KnowledgeDocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePublishLog" ADD CONSTRAINT "KnowledgePublishLog_fromEnvironmentId_fkey" FOREIGN KEY ("fromEnvironmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePublishLog" ADD CONSTRAINT "KnowledgePublishLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePublishLog" ADD CONSTRAINT "KnowledgePublishLog_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePublishLog" ADD CONSTRAINT "KnowledgePublishLog_toEnvironmentId_fkey" FOREIGN KEY ("toEnvironmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationContextSnapshot" ADD CONSTRAINT "ConversationContextSnapshot_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "AgentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentVersion" ADD CONSTRAINT "AgentVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentVersion" ADD CONSTRAINT "AgentVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolRegistry" ADD CONSTRAINT "ToolRegistry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolRegistry" ADD CONSTRAINT "ToolRegistry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolRegistry" ADD CONSTRAINT "ToolRegistry_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolBinding" ADD CONSTRAINT "AgentToolBinding_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolBinding" ADD CONSTRAINT "AgentToolBinding_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "ToolRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCallTrace" ADD CONSTRAINT "ToolCallTrace_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCallTrace" ADD CONSTRAINT "ToolCallTrace_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationFeedbackTag" ADD CONSTRAINT "ConversationFeedbackTag_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "ConversationFeedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationFeedbackTag" ADD CONSTRAINT "ConversationFeedbackTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "EvaluationTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageFeedbackTag" ADD CONSTRAINT "MessageFeedbackTag_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "MessageFeedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageFeedbackTag" ADD CONSTRAINT "MessageFeedbackTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "EvaluationTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotificationPreference" ADD CONSTRAINT "UserNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectNotificationRule" ADD CONSTRAINT "ProjectNotificationRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectNotificationRule" ADD CONSTRAINT "ProjectNotificationRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalReference" ADD CONSTRAINT "ExternalReference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIntelligence" ADD CONSTRAINT "ProjectIntelligence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInsight" ADD CONSTRAINT "ProjectInsight_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSimilarity" ADD CONSTRAINT "ProjectSimilarity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSimilarity" ADD CONSTRAINT "ProjectSimilarity_similarProjectId_fkey" FOREIGN KEY ("similarProjectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReview" ADD CONSTRAINT "ProjectReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectGeneratedDocument" ADD CONSTRAINT "ProjectGeneratedDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProgressSummary" ADD CONSTRAINT "ProjectProgressSummary_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectConversation" ADD CONSTRAINT "ProjectConversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMessage" ADD CONSTRAINT "ProjectMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ProjectConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMessage" ADD CONSTRAINT "ProjectMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiThread" ADD CONSTRAINT "AiThread_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiThread" ADD CONSTRAINT "AiThread_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiThread" ADD CONSTRAINT "AiThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AiThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingAction" ADD CONSTRAINT "PendingAction_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingAction" ADD CONSTRAINT "PendingAction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingAction" ADD CONSTRAINT "PendingAction_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInquiry" ADD CONSTRAINT "ProjectInquiry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryItem" ADD CONSTRAINT "InquiryItem_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "ProjectInquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryItem" ADD CONSTRAINT "InquiryItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectQuote" ADD CONSTRAINT "ProjectQuote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ProjectQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskStep" ADD CONSTRAINT "AgentTaskStep_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentTaskStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFlowTemplate" ADD CONSTRAINT "CustomFlowTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeProspect" ADD CONSTRAINT "TradeProspect_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "TradeCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeProspect" ADD CONSTRAINT "TradeProspect_convertedById_fkey" FOREIGN KEY ("convertedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeProspect" ADD CONSTRAINT "TradeProspect_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeWatchTarget" ADD CONSTRAINT "TradeWatchTarget_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "TradeProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSignal" ADD CONSTRAINT "TradeSignal_watchTargetId_fkey" FOREIGN KEY ("watchTargetId") REFERENCES "TradeWatchTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketCompetitor" ADD CONSTRAINT "MarketCompetitor_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketMonitor" ADD CONSTRAINT "MarketMonitor_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "MarketCompetitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "MarketMonitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketAnalysisRun" ADD CONSTRAINT "MarketAnalysisRun_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "MarketCompetitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketAnalysisRun" ADD CONSTRAINT "MarketAnalysisRun_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "MarketSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeMessage" ADD CONSTRAINT "TradeMessage_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "TradeProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeChatMessage" ADD CONSTRAINT "TradeChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TradeChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIntelligenceCase" ADD CONSTRAINT "TradeIntelligenceCase_convertedById_fkey" FOREIGN KEY ("convertedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIntelligenceCase" ADD CONSTRAINT "TradeIntelligenceCase_convertedProspectId_fkey" FOREIGN KEY ("convertedProspectId") REFERENCES "TradeProspect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIntelligenceCase" ADD CONSTRAINT "TradeIntelligenceCase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIntelligenceAsset" ADD CONSTRAINT "TradeIntelligenceAsset_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "TradeIntelligenceCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIntelligenceAsset" ADD CONSTRAINT "TradeIntelligenceAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeServiceAsset" ADD CONSTRAINT "TradeServiceAsset_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TradeServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeQuote" ADD CONSTRAINT "TradeQuote_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "TradeProspect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeQuoteItem" ADD CONSTRAINT "TradeQuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "TradeQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgKnowledgeChunk" ADD CONSTRAINT "OrgKnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "OrgKnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesCustomer" ADD CONSTRAINT "SalesCustomer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOpportunity" ADD CONSTRAINT "SalesOpportunity_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOpportunity" ADD CONSTRAINT "SalesOpportunity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOpportunity" ADD CONSTRAINT "SalesOpportunity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInteraction" ADD CONSTRAINT "CustomerInteraction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInteraction" ADD CONSTRAINT "CustomerInteraction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInteraction" ADD CONSTRAINT "CustomerInteraction_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuote" ADD CONSTRAINT "SalesQuote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuote" ADD CONSTRAINT "SalesQuote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuote" ADD CONSTRAINT "SalesQuote_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteDiscountSettings" ADD CONSTRAINT "QuoteDiscountSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgBusinessRule" ADD CONSTRAINT "OrgBusinessRule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationGlossaryTerm" ADD CONSTRAINT "OrganizationGlossaryTerm_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationGlossaryTerm" ADD CONSTRAINT "OrganizationGlossaryTerm_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessObjectDefinition" ADD CONSTRAINT "BusinessObjectDefinition_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessObjectDefinition" ADD CONSTRAINT "BusinessObjectDefinition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMetricDefinition" ADD CONSTRAINT "BusinessMetricDefinition_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMetricDefinition" ADD CONSTRAINT "BusinessMetricDefinition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSkillBinding" ADD CONSTRAINT "WorkspaceSkillBinding_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSkillBinding" ADD CONSTRAINT "WorkspaceSkillBinding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceKnowledgeBinding" ADD CONSTRAINT "WorkspaceKnowledgeBinding_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceKnowledgeBinding" ADD CONSTRAINT "WorkspaceKnowledgeBinding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuoteItem" ADD CONSTRAINT "SalesQuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "SalesQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuoteItem" ADD CONSTRAINT "SalesQuoteItem_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "QuoteRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuoteAddon" ADD CONSTRAINT "SalesQuoteAddon_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "SalesQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRoom" ADD CONSTRAINT "QuoteRoom_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "SalesQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAttachment" ADD CONSTRAINT "RoomAttachment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "QuoteRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementRecord" ADD CONSTRAINT "MeasurementRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementWindow" ADD CONSTRAINT "MeasurementWindow_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "MeasurementRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementPhoto" ADD CONSTRAINT "MeasurementPhoto_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "MeasurementWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMemory" ADD CONSTRAINT "UserMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillExecution" ADD CONSTRAINT "SkillExecution_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "AgentSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeChatBinding" ADD CONSTRAINT "WeChatBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentTaskId_fkey" FOREIGN KEY ("agentTaskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunStep" ADD CONSTRAINT "AgentRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunVerification" ADD CONSTRAINT "AgentRunVerification_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunEvent" ADD CONSTRAINT "AgentRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessage" ADD CONSTRAINT "ServiceMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ServiceConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesKnowledgeChunk" ADD CONSTRAINT "SalesKnowledgeChunk_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesKnowledgeChunk" ADD CONSTRAINT "SalesKnowledgeChunk_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "CustomerInteraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesKnowledgeChunk" ADD CONSTRAINT "SalesKnowledgeChunk_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInsight" ADD CONSTRAINT "SalesInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingRecord" ADD CONSTRAINT "CoachingRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingRecord" ADD CONSTRAINT "CoachingRecord_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "SalesInsight"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingRecord" ADD CONSTRAINT "CoachingRecord_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingRecord" ADD CONSTRAINT "CoachingRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerSession" ADD CONSTRAINT "VisualizerSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerSession" ADD CONSTRAINT "VisualizerSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerSession" ADD CONSTRAINT "VisualizerSession_measurementRecordId_fkey" FOREIGN KEY ("measurementRecordId") REFERENCES "MeasurementRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerSession" ADD CONSTRAINT "VisualizerSession_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerSession" ADD CONSTRAINT "VisualizerSession_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "SalesQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerSession" ADD CONSTRAINT "VisualizerSession_salesOwnerId_fkey" FOREIGN KEY ("salesOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerSourceImage" ADD CONSTRAINT "VisualizerSourceImage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisualizerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerWindowRegion" ADD CONSTRAINT "VisualizerWindowRegion_sourceImageId_fkey" FOREIGN KEY ("sourceImageId") REFERENCES "VisualizerSourceImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerVariant" ADD CONSTRAINT "VisualizerVariant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisualizerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerProductOption" ADD CONSTRAINT "VisualizerProductOption_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "VisualizerWindowRegion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerProductOption" ADD CONSTRAINT "VisualizerProductOption_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "VisualizerVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerSelection" ADD CONSTRAINT "VisualizerSelection_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerSelection" ADD CONSTRAINT "VisualizerSelection_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "VisualizerVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerCatalogProduct" ADD CONSTRAINT "VisualizerCatalogProduct_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerCatalogAsset" ADD CONSTRAINT "VisualizerCatalogAsset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "VisualizerCatalogProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualizerCatalogTemplateJob" ADD CONSTRAINT "VisualizerCatalogTemplateJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "VisualizerCatalogProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MatrixAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "VideoAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDimensionScore" ADD CONSTRAINT "MarketingDimensionScore_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "MarketingAuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFinding" ADD CONSTRAINT "MarketingFinding_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "MarketingAuditRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPlanItem" ADD CONSTRAINT "MarketingPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentAsset" ADD CONSTRAINT "MarketingContentAsset_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPublication" ADD CONSTRAINT "MarketingPublication_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MmmModelRun" ADD CONSTRAINT "MmmModelRun_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "MmmDatasetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MmmChannelContribution" ADD CONSTRAINT "MmmChannelContribution_modelRunId_fkey" FOREIGN KEY ("modelRunId") REFERENCES "MmmModelRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MmmBudgetScenario" ADD CONSTRAINT "MmmBudgetScenario_modelRunId_fkey" FOREIGN KEY ("modelRunId") REFERENCES "MmmModelRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingExperiment" ADD CONSTRAINT "MarketingExperiment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingLeadAttribution" ADD CONSTRAINT "MarketingLeadAttribution_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAiProfile" ADD CONSTRAINT "EmployeeAiProfile_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAiProfile" ADD CONSTRAINT "EmployeeAiProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanFeedbackEvent" ADD CONSTRAINT "HumanFeedbackEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanFeedbackEvent" ADD CONSTRAINT "HumanFeedbackEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessOutcome" ADD CONSTRAINT "BusinessOutcome_feedbackEventId_fkey" FOREIGN KEY ("feedbackEventId") REFERENCES "HumanFeedbackEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessOutcome" ADD CONSTRAINT "BusinessOutcome_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessOutcome" ADD CONSTRAINT "BusinessOutcome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidatePractice" ADD CONSTRAINT "CandidatePractice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePlaybook" ADD CONSTRAINT "RolePlaybook_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkillVersion" ADD CONSTRAINT "AgentSkillVersion_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkillVersion" ADD CONSTRAINT "AgentSkillVersion_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "AgentSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationCase" ADD CONSTRAINT "EvaluationCase_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeProduct" ADD CONSTRAINT "TradeProduct_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAsset" ADD CONSTRAINT "ProductAsset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAsset" ADD CONSTRAINT "ProductAsset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "TradeProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFact" ADD CONSTRAINT "ProductFact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFact" ADD CONSTRAINT "ProductFact_productId_fkey" FOREIGN KEY ("productId") REFERENCES "TradeProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFactConflict" ADD CONSTRAINT "ProductFactConflict_currentFactId_fkey" FOREIGN KEY ("currentFactId") REFERENCES "ProductFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFactConflict" ADD CONSTRAINT "ProductFactConflict_incomingFactId_fkey" FOREIGN KEY ("incomingFactId") REFERENCES "ProductFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFactConflict" ADD CONSTRAINT "ProductFactConflict_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContentJob" ADD CONSTRAINT "ProductContentJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContentJob" ADD CONSTRAINT "ProductContentJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "TradeProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContentSnapshot" ADD CONSTRAINT "ProductContentSnapshot_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContentCostEntry" ADD CONSTRAINT "ProductContentCostEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageLedger" ADD CONSTRAINT "AiUsageLedger_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityQuotaPolicy" ADD CONSTRAINT "CapabilityQuotaPolicy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityQuotaReservation" ADD CONSTRAINT "CapabilityQuotaReservation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContentJobInput" ADD CONSTRAINT "ProductContentJobInput_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContentStep" ADD CONSTRAINT "ProductContentStep_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualGenerationJob" ADD CONSTRAINT "VisualGenerationJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualOutput" ADD CONSTRAINT "VisualOutput_visualJobId_fkey" FOREIGN KEY ("visualJobId") REFERENCES "VisualGenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualQaResult" ADD CONSTRAINT "VisualQaResult_visualOutputId_fkey" FOREIGN KEY ("visualOutputId") REFERENCES "VisualOutput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCopy" ADD CONSTRAINT "ProductCopy_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContentApproval" ADD CONSTRAINT "ProductContentApproval_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApprovalSettings" ADD CONSTRAINT "AgentApprovalSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskDependency" ADD CONSTRAINT "AgentTaskDependency_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskDependency" ADD CONSTRAINT "AgentTaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidDataRevision" ADD CONSTRAINT "BidDataRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidDataRevision" ADD CONSTRAINT "BidDataRevision_supersedesRevisionId_fkey" FOREIGN KEY ("supersedesRevisionId") REFERENCES "BidDataRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceResponse" ADD CONSTRAINT "ComplianceResponse_bidDataRevisionId_fkey" FOREIGN KEY ("bidDataRevisionId") REFERENCES "BidDataRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceResponse" ADD CONSTRAINT "ComplianceResponse_tenderRequirementId_fkey" FOREIGN KEY ("tenderRequirementId") REFERENCES "TenderRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceResponseEvidence" ADD CONSTRAINT "ComplianceResponseEvidence_complianceResponseId_fkey" FOREIGN KEY ("complianceResponseId") REFERENCES "ComplianceResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceResponseEvidence" ADD CONSTRAINT "ComplianceResponseEvidence_productEvidenceId_fkey" FOREIGN KEY ("productEvidenceId") REFERENCES "ProductEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingScenario" ADD CONSTRAINT "PricingScenario_bidDataRevisionId_fkey" FOREIGN KEY ("bidDataRevisionId") REFERENCES "BidDataRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingScenarioLineItem" ADD CONSTRAINT "PricingScenarioLineItem_pricingScenarioId_fkey" FOREIGN KEY ("pricingScenarioId") REFERENCES "PricingScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEvidence" ADD CONSTRAINT "ProductEvidence_bidDataRevisionId_fkey" FOREIGN KEY ("bidDataRevisionId") REFERENCES "BidDataRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAgentEvent" ADD CONSTRAINT "ProjectAgentEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectConflict" ADD CONSTRAINT "ProjectConflict_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFact" ADD CONSTRAINT "ProjectFact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFact" ADD CONSTRAINT "ProjectFact_supersedesFactId_fkey" FOREIGN KEY ("supersedesFactId") REFERENCES "ProjectFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderRequirement" ADD CONSTRAINT "TenderRequirement_bidDataRevisionId_fkey" FOREIGN KEY ("bidDataRevisionId") REFERENCES "BidDataRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;


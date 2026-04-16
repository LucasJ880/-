-- ────────────────────────────────────────────────────────────────────
-- 上线前 baseline 迁移（2026-04-16 生成）
--
-- 背景：项目早期一直用 `prisma db push` 推 schema，
-- 迁移历史与当前 schema 漂移严重。此文件是基于当前 schema.prisma
-- 生成的完整基线，作为未来 migration 的起点。
--
-- 【生产环境首次部署操作】（仅需一次）：
--   DATABASE_URL=<prod_url> npx prisma migrate resolve --applied \
--     "20260416120000_baseline_before_launch"
--
-- 该命令会把此 baseline 标记为"已应用"（不会实际执行 SQL），
-- 之后 `prisma migrate deploy` 只会应用后续新增的 migration。
--
-- 【日常开发工作流】：
--   1. 改 schema.prisma
--   2. `npm run db:migrate:dev -- --name xxx`  生成并应用迁移
--   3. 提交代码，push
--   4. Vercel 的 build 会自动 `prisma migrate deploy`
-- ────────────────────────────────────────────────────────────────────

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "authProvider" TEXT NOT NULL DEFAULT 'email',
    "name" TEXT NOT NULL,
    "nickname" TEXT,
    "avatar" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "wechatOpenId" TEXT,
    "inviteCodeId" TEXT,

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
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "tenderStatus" TEXT,
    "sourceSystem" TEXT,
    "sourcePlatform" TEXT,
    "clientOrganization" TEXT,
    "location" TEXT,
    "estimatedValue" DOUBLE PRECISION,
    "currency" TEXT,
    "solicitationNumber" TEXT,
    "workflowTemplate" TEXT,
    "sourceMetadataJson" TEXT,
    "publicDate" TIMESTAMP(3),
    "questionCloseDate" TIMESTAMP(3),
    "closeDate" TIMESTAMP(3),
    "distributedAt" TIMESTAMP(3),
    "interpretedAt" TIMESTAMP(3),
    "supplierInquiredAt" TIMESTAMP(3),
    "supplierQuotedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "awardDate" TIMESTAMP(3),
    "abandonedAt" TIMESTAMP(3),
    "abandonedStage" TEXT,
    "abandonedById" TEXT,
    "abandonedReason" TEXT,
    "intakeStatus" TEXT NOT NULL DEFAULT 'dispatched',
    "dispatchedAt" TIMESTAMP(3),
    "dispatchedById" TEXT,
    "ownerId" TEXT NOT NULL,

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
    "confirmedAt" TIMESTAMP(3),
    "productionStartAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "expectedInstallDate" TIMESTAMP(3),
    "appointmentId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "creatorId" TEXT NOT NULL,
    "projectId" TEXT,
    "customerId" TEXT,
    "opportunityId" TEXT,

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

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
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
    "fullReportJson" TEXT,
    "reportMarkdown" TEXT,
    "reportStatus" TEXT NOT NULL DEFAULT 'ai_generated',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "reviewScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectIntelligence_pkey" PRIMARY KEY ("id")
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
    "blobUrl" TEXT,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER,
    "contentText" TEXT,
    "parseStatus" TEXT NOT NULL DEFAULT 'pending',
    "parseError" TEXT,
    "aiSummaryJson" TEXT,
    "aiSummaryStatus" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT NOT NULL DEFAULT 'external_link',
    "uploadedById" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "source" TEXT,
    "sourceDetail" TEXT,
    "website" TEXT,
    "tags" TEXT,
    "capabilities" TEXT,
    "aiClassification" JSONB,
    "rating" DOUBLE PRECISION DEFAULT 0,
    "ratingDetail" JSONB,
    "lastContactAt" TIMESTAMP(3),
    "brochureUrl" TEXT,
    "brochureParseStatus" TEXT,
    "brochureParseResult" JSONB,
    "brochureParseWarning" TEXT,

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
CREATE TABLE "ToolExecution" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "stepId" TEXT,
    "toolName" TEXT NOT NULL,
    "toolInput" TEXT,
    "toolOutput" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "idempotencyKey" TEXT NOT NULL,
    "error" TEXT,
    "executedBy" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3),
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolExecution_pkey" PRIMARY KEY ("id")
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

    CONSTRAINT "TradeProspect_pkey" PRIMARY KEY ("id")
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
    "channel" TEXT,
    "language" TEXT,
    "rawMessages" TEXT,
    "sentiment" TEXT,
    "outcome" TEXT,
    "topicTags" TEXT,
    "analysisStatus" TEXT,
    "analysisResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

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
    "orderNumber" TEXT,
    "notes" TEXT,
    "formDataJson" TEXT,
    "shareToken" TEXT,
    "signatureUrl" TEXT,
    "signedAt" TIMESTAMP(3),
    "aiSource" TEXT,
    "viewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "SalesQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesQuoteItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "roomId" TEXT,
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
    "googleEventId" TEXT,
    "googleSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "embedding" vector(1536),
    "tags" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "sourceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "embedding" vector(1536),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "embedding" JSONB,
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "botToken" TEXT,
    "botBaseUrl" TEXT,
    "getUpdatesBuf" TEXT,
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

    CONSTRAINT "WeChatGateway_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "SalesKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "customerId" TEXT,
    "opportunityId" TEXT,
    "interactionId" TEXT,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
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
    "embedding" vector(1536),
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
    "embedding" vector(1536),
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
CREATE UNIQUE INDEX "EmailBinding_userId_key" ON "EmailBinding"("userId");

-- CreateIndex
CREATE INDEX "EmailBinding_email_idx" ON "EmailBinding"("email");

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
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

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
CREATE INDEX "OrganizationMember_orgId_idx" ON "OrganizationMember"("orgId");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_orgId_userId_key" ON "OrganizationMember"("orgId", "userId");

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
CREATE INDEX "AiMessage_threadId_createdAt_idx" ON "AiMessage"("threadId", "createdAt");

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
CREATE INDEX "AgentTaskStep_taskId_stepIndex_idx" ON "AgentTaskStep"("taskId", "stepIndex");

-- CreateIndex
CREATE INDEX "ApprovalRequest_taskId_idx" ON "ApprovalRequest"("taskId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_approverUserId_status_idx" ON "ApprovalRequest"("approverUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ToolExecution_idempotencyKey_key" ON "ToolExecution"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ToolExecution_taskId_idx" ON "ToolExecution"("taskId");

-- CreateIndex
CREATE INDEX "ToolExecution_idempotencyKey_idx" ON "ToolExecution"("idempotencyKey");

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
CREATE INDEX "TradeProspect_nextFollowUpAt_idx" ON "TradeProspect"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "TradeProspect_score_idx" ON "TradeProspect"("score");

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
CREATE UNIQUE INDEX "SalesQuote_shareToken_key" ON "SalesQuote"("shareToken");

-- CreateIndex
CREATE INDEX "SalesQuote_customerId_idx" ON "SalesQuote"("customerId");

-- CreateIndex
CREATE INDEX "SalesQuote_opportunityId_idx" ON "SalesQuote"("opportunityId");

-- CreateIndex
CREATE INDEX "SalesQuote_status_idx" ON "SalesQuote"("status");

-- CreateIndex
CREATE INDEX "SalesQuote_createdAt_idx" ON "SalesQuote"("createdAt");

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
CREATE INDEX "UserMemory_userId_layer_idx" ON "UserMemory"("userId", "layer");

-- CreateIndex
CREATE INDEX "UserMemory_userId_memoryType_idx" ON "UserMemory"("userId", "memoryType");

-- CreateIndex
CREATE INDEX "UserMemory_userId_importance_idx" ON "UserMemory"("userId", "importance");

-- CreateIndex
CREATE INDEX "UserMemory_userId_tags_idx" ON "UserMemory"("userId", "tags");

-- CreateIndex
CREATE INDEX "UserMemory_userId_customerId_idx" ON "UserMemory"("userId", "customerId");

-- CreateIndex
CREATE INDEX "UserMemory_userId_projectId_idx" ON "UserMemory"("userId", "projectId");

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
CREATE INDEX "WeChatMessage_bindingId_createdAt_idx" ON "WeChatMessage"("bindingId", "createdAt");

-- CreateIndex
CREATE INDEX "WeChatMessage_userId_createdAt_idx" ON "WeChatMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WeChatMessage_channel_createdAt_idx" ON "WeChatMessage"("channel", "createdAt");

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

-- AddForeignKey
ALTER TABLE "EmailBinding" ADD CONSTRAINT "EmailBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskActivity" ADD CONSTRAINT "TaskActivity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskActivity" ADD CONSTRAINT "TaskActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagOnTask" ADD CONSTRAINT "TagOnTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagOnTask" ADD CONSTRAINT "TagOnTask_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindsOrder" ADD CONSTRAINT "BlindsOrder_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindsOrder" ADD CONSTRAINT "BlindsOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindsOrder" ADD CONSTRAINT "BlindsOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindsOrder" ADD CONSTRAINT "BlindsOrder_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusLog" ADD CONSTRAINT "OrderStatusLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "BlindsOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindsOrderItem" ADD CONSTRAINT "BlindsOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "BlindsOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarProvider" ADD CONSTRAINT "CalendarProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "PromptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "PromptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptPublishLog" ADD CONSTRAINT "PromptPublishLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptPublishLog" ADD CONSTRAINT "PromptPublishLog_fromEnvironmentId_fkey" FOREIGN KEY ("fromEnvironmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptPublishLog" ADD CONSTRAINT "PromptPublishLog_toEnvironmentId_fkey" FOREIGN KEY ("toEnvironmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptPublishLog" ADD CONSTRAINT "PromptPublishLog_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "KnowledgeBaseVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBaseVersion" ADD CONSTRAINT "KnowledgeBaseVersion_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBaseVersion" ADD CONSTRAINT "KnowledgeBaseVersion_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "KnowledgeBaseVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBaseVersion" ADD CONSTRAINT "KnowledgeBaseVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocumentVersion" ADD CONSTRAINT "KnowledgeDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocumentVersion" ADD CONSTRAINT "KnowledgeDocumentVersion_knowledgeBaseVersionId_fkey" FOREIGN KEY ("knowledgeBaseVersionId") REFERENCES "KnowledgeBaseVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocumentVersion" ADD CONSTRAINT "KnowledgeDocumentVersion_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "KnowledgeDocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocumentVersion" ADD CONSTRAINT "KnowledgeDocumentVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePublishLog" ADD CONSTRAINT "KnowledgePublishLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePublishLog" ADD CONSTRAINT "KnowledgePublishLog_fromEnvironmentId_fkey" FOREIGN KEY ("fromEnvironmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePublishLog" ADD CONSTRAINT "KnowledgePublishLog_toEnvironmentId_fkey" FOREIGN KEY ("toEnvironmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePublishLog" ADD CONSTRAINT "KnowledgePublishLog_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "AgentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentVersion" ADD CONSTRAINT "AgentVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentVersion" ADD CONSTRAINT "AgentVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolRegistry" ADD CONSTRAINT "ToolRegistry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolRegistry" ADD CONSTRAINT "ToolRegistry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "ProjectNotificationRule" ADD CONSTRAINT "ProjectNotificationRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectNotificationRule" ADD CONSTRAINT "ProjectNotificationRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalReference" ADD CONSTRAINT "ExternalReference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIntelligence" ADD CONSTRAINT "ProjectIntelligence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "AiThread" ADD CONSTRAINT "AiThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiThread" ADD CONSTRAINT "AiThread_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AiThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskStep" ADD CONSTRAINT "AgentTaskStep_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentTaskStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentTaskStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFlowTemplate" ADD CONSTRAINT "CustomFlowTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeProspect" ADD CONSTRAINT "TradeProspect_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "TradeCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeMessage" ADD CONSTRAINT "TradeMessage_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "TradeProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeChatMessage" ADD CONSTRAINT "TradeChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TradeChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeQuote" ADD CONSTRAINT "TradeQuote_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "TradeProspect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeQuoteItem" ADD CONSTRAINT "TradeQuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "TradeQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesCustomer" ADD CONSTRAINT "SalesCustomer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOpportunity" ADD CONSTRAINT "SalesOpportunity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOpportunity" ADD CONSTRAINT "SalesOpportunity_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOpportunity" ADD CONSTRAINT "SalesOpportunity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInteraction" ADD CONSTRAINT "CustomerInteraction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInteraction" ADD CONSTRAINT "CustomerInteraction_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInteraction" ADD CONSTRAINT "CustomerInteraction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuote" ADD CONSTRAINT "SalesQuote_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuote" ADD CONSTRAINT "SalesQuote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuote" ADD CONSTRAINT "SalesQuote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementRecord" ADD CONSTRAINT "MeasurementRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementWindow" ADD CONSTRAINT "MeasurementWindow_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "MeasurementRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementPhoto" ADD CONSTRAINT "MeasurementPhoto_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "MeasurementWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMemory" ADD CONSTRAINT "UserMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillExecution" ADD CONSTRAINT "SkillExecution_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "AgentSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeChatBinding" ADD CONSTRAINT "WeChatBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesKnowledgeChunk" ADD CONSTRAINT "SalesKnowledgeChunk_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesKnowledgeChunk" ADD CONSTRAINT "SalesKnowledgeChunk_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesKnowledgeChunk" ADD CONSTRAINT "SalesKnowledgeChunk_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "CustomerInteraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInsight" ADD CONSTRAINT "SalesInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingRecord" ADD CONSTRAINT "CoachingRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingRecord" ADD CONSTRAINT "CoachingRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingRecord" ADD CONSTRAINT "CoachingRecord_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingRecord" ADD CONSTRAINT "CoachingRecord_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "SalesInsight"("id") ON DELETE SET NULL ON UPDATE CASCADE;


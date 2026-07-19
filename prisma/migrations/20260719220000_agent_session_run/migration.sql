-- Phase-1: AgentSession / AgentRun / AgentRunEvent + WeChatMessage 幂等索引

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

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

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

CREATE INDEX "AgentSession_orgId_userId_idx" ON "AgentSession"("orgId", "userId");
CREATE INDEX "AgentSession_orgId_channel_channelConversationId_idx" ON "AgentSession"("orgId", "channel", "channelConversationId");
CREATE INDEX "AgentSession_orgId_channel_channelUserId_status_idx" ON "AgentSession"("orgId", "channel", "channelUserId", "status");

CREATE INDEX "AgentRun_orgId_sessionId_idx" ON "AgentRun"("orgId", "sessionId");
CREATE INDEX "AgentRun_orgId_status_idx" ON "AgentRun"("orgId", "status");
CREATE INDEX "AgentRun_orgId_userMessageId_idx" ON "AgentRun"("orgId", "userMessageId");

CREATE UNIQUE INDEX "AgentRunEvent_runId_sequence_key" ON "AgentRunEvent"("runId", "sequence");
CREATE INDEX "AgentRunEvent_orgId_runId_idx" ON "AgentRunEvent"("orgId", "runId");

ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRunEvent" ADD CONSTRAINT "AgentRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "WeChatMessage_orgId_channel_externalMsgId_idx" ON "WeChatMessage"("orgId", "channel", "externalMsgId");

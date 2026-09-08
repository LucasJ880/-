-- 网站询盘事件收据：最早可靠接收边界的事件身份 + 原始业务载荷
-- 纯新增（CREATE TABLE + 索引），不改动任何既有表/列/数据。
CREATE TABLE "WebsiteInquiryReceipt" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'website',
    "eventId" TEXT NOT NULL,
    "eventIdProvided" BOOLEAN NOT NULL DEFAULT true,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "duplicateOfReceiptId" TEXT,
    "prospectId" TEXT,
    "tradeMessageId" TEXT,
    "customerId" TEXT,
    "opportunityId" TEXT,
    "interactionId" TEXT,
    "salesActionId" TEXT,
    "agentRunId" TEXT,
    "pendingActionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'received',
    "processingSince" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "lastConflictAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WebsiteInquiryReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebsiteInquiryReceipt_orgId_source_eventId_key" ON "WebsiteInquiryReceipt"("orgId", "source", "eventId");
CREATE INDEX "WebsiteInquiryReceipt_orgId_payloadHash_firstSeenAt_idx" ON "WebsiteInquiryReceipt"("orgId", "payloadHash", "firstSeenAt");
CREATE INDEX "WebsiteInquiryReceipt_orgId_status_firstSeenAt_idx" ON "WebsiteInquiryReceipt"("orgId", "status", "firstSeenAt");
CREATE INDEX "WebsiteInquiryReceipt_tradeMessageId_idx" ON "WebsiteInquiryReceipt"("tradeMessageId");
CREATE INDEX "WebsiteInquiryReceipt_opportunityId_idx" ON "WebsiteInquiryReceipt"("opportunityId");

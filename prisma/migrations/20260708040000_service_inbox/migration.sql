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

-- AddForeignKey
ALTER TABLE "ServiceMessage" ADD CONSTRAINT "ServiceMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ServiceConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- CreateIndex
CREATE INDEX "WeChatGraderContext_userId_idx" ON "WeChatGraderContext"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WeChatGraderContext_orgId_userId_channel_key" ON "WeChatGraderContext"("orgId", "userId", "channel");

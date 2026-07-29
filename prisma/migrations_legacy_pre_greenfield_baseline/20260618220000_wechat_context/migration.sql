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

-- CreateIndex
CREATE INDEX "WeChatContext_orgId_channel_idx" ON "WeChatContext"("orgId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "WeChatContext_orgId_channel_externalUserId_key" ON "WeChatContext"("orgId", "channel", "externalUserId");

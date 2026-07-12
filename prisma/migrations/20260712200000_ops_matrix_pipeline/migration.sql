-- 运营矩阵：矩阵账号登记 + 视频资产管道（Aivora → 文案变体 → 发布任务）

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

    CONSTRAINT "PublishJob_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "PublishJob_assetId_accountId_key" ON "PublishJob"("assetId", "accountId");

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "VideoAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MatrixAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

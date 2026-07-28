-- AlterTable
ALTER TABLE "ProductContentJob" ADD COLUMN "estimatedCostCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductContentJob" ADD COLUMN "documentPurpose" TEXT NOT NULL DEFAULT 'INTERNAL_DRAFT';

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

-- CreateIndex
CREATE INDEX "ProductContentSnapshot_orgId_jobId_idx" ON "ProductContentSnapshot"("orgId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductContentSnapshot_jobId_version_key" ON "ProductContentSnapshot"("jobId", "version");

-- CreateIndex
CREATE INDEX "ProductContentCostEntry_orgId_jobId_idx" ON "ProductContentCostEntry"("orgId", "jobId");

-- AddForeignKey
ALTER TABLE "ProductContentSnapshot" ADD CONSTRAINT "ProductContentSnapshot_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContentCostEntry" ADD CONSTRAINT "ProductContentCostEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

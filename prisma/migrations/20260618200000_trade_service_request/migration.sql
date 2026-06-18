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

-- AddForeignKey
ALTER TABLE "TradeServiceAsset" ADD CONSTRAINT "TradeServiceAsset_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TradeServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

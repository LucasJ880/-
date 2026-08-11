-- CreateTable
CREATE TABLE "ProjectEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "eventKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "eventType" TEXT NOT NULL,
    "stage" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "result" TEXT,
    "payload" JSONB,
    "refs" JSONB,
    "relatedDocumentId" TEXT,
    "relatedCostId" TEXT,
    "sourceRef" TEXT,
    "traceId" TEXT,
    "correctionOfEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEventActor" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'participant',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectEventActor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCost" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "costStatus" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(12,3),
    "unit" TEXT,
    "unitRate" DECIMAL(18,4),
    "amountPlanned" DECIMAL(18,2),
    "amountCommitted" DECIMAL(18,2),
    "amountActual" DECIMAL(18,2),
    "currency" TEXT NOT NULL,
    "incurredById" TEXT,
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "supplierId" TEXT,
    "refs" JSONB,
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "correctionOfCostId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderArchiveItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "canonicalUrl" TEXT,
    "captureKey" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "captureMethod" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "parserVersion" TEXT,
    "accessClass" TEXT NOT NULL DEFAULT 'INTERNAL_COMPANY',
    "metadata" JSONB,
    "supersedesSnapshotId" TEXT,
    "projectDocumentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenderArchiveItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectEvent_orgId_projectId_occurredAt_idx" ON "ProjectEvent"("orgId", "projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProjectEvent_projectId_eventType_occurredAt_idx" ON "ProjectEvent"("projectId", "eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "ProjectEvent_projectId_relatedDocumentId_idx" ON "ProjectEvent"("projectId", "relatedDocumentId");

-- CreateIndex
CREATE INDEX "ProjectEvent_projectId_relatedCostId_idx" ON "ProjectEvent"("projectId", "relatedCostId");

-- CreateIndex
CREATE INDEX "ProjectEvent_orgId_actorType_actorId_occurredAt_idx" ON "ProjectEvent"("orgId", "actorType", "actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProjectEvent_traceId_idx" ON "ProjectEvent"("traceId");

-- CreateIndex
CREATE INDEX "ProjectEvent_correctionOfEventId_idx" ON "ProjectEvent"("correctionOfEventId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEvent_projectId_seq_key" ON "ProjectEvent"("projectId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEvent_projectId_eventKey_key" ON "ProjectEvent"("projectId", "eventKey");

-- CreateIndex
CREATE INDEX "ProjectEventActor_orgId_userId_idx" ON "ProjectEventActor"("orgId", "userId");

-- CreateIndex
CREATE INDEX "ProjectEventActor_orgId_actorKey_idx" ON "ProjectEventActor"("orgId", "actorKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEventActor_eventId_actorKey_key" ON "ProjectEventActor"("eventId", "actorKey");

-- CreateIndex
CREATE INDEX "ProjectCost_orgId_projectId_costStatus_idx" ON "ProjectCost"("orgId", "projectId", "costStatus");

-- CreateIndex
CREATE INDEX "ProjectCost_projectId_category_idx" ON "ProjectCost"("projectId", "category");

-- CreateIndex
CREATE INDEX "ProjectCost_orgId_incurredById_incurredAt_idx" ON "ProjectCost"("orgId", "incurredById", "incurredAt");

-- CreateIndex
CREATE INDEX "ProjectCost_correctionOfCostId_idx" ON "ProjectCost"("correctionOfCostId");

-- CreateIndex
CREATE INDEX "TenderArchiveItem_orgId_contentHash_idx" ON "TenderArchiveItem"("orgId", "contentHash");

-- CreateIndex
CREATE INDEX "TenderArchiveItem_projectId_kind_capturedAt_idx" ON "TenderArchiveItem"("projectId", "kind", "capturedAt");

-- CreateIndex
CREATE INDEX "TenderArchiveItem_supersedesSnapshotId_idx" ON "TenderArchiveItem"("supersedesSnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "TenderArchiveItem_orgId_projectId_captureKey_contentHash_key" ON "TenderArchiveItem"("orgId", "projectId", "captureKey", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "TenderArchiveItem_orgId_projectId_captureKey_snapshotVersio_key" ON "TenderArchiveItem"("orgId", "projectId", "captureKey", "snapshotVersion");

-- AddForeignKey
ALTER TABLE "ProjectEventActor" ADD CONSTRAINT "ProjectEventActor_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ProjectEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


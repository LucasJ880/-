-- PROC-1 procurement-records-requests：Tender 采购情报与政府资料申请（只新增 16 张表，不改既有表）
-- 回滚：不 drop（保留空表或按 runbook 前向修复）；暗合并闸 PROCUREMENT_RECORDS_SCHEMA_READY 关时新表零访问。
-- 生成：prisma migrate diff --from-schema-datamodel <HEAD schema> --to-schema-datamodel prisma/schema.prisma --script

-- CreateTable
CREATE TABLE "ProcurementWatch" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "enabledById" TEXT,
    "disabledAt" TIMESTAMP(3),
    "disabledById" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "scheduleJson" JSONB NOT NULL,
    "filtersJson" JSONB NOT NULL,
    "limitsJson" JSONB NOT NULL,
    "sourcesJson" JSONB NOT NULL,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcurementWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementScanRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "slotKey" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "runnerToken" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "progressJson" JSONB,
    "sourceResultsJson" JSONB,
    "countersJson" JSONB,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "requestedById" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ProcurementScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementInstrument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "instrumentClass" TEXT NOT NULL,
    "instrumentSubtype" TEXT,
    "officialNumber" TEXT NOT NULL,
    "normalizedNumber" TEXT NOT NULL,
    "procuringEntityKey" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT,
    "aliasesJson" JSONB,
    "contractingInstitution" TEXT,
    "buyingInstitution" TEXT,
    "recordsHolderInstitution" TEXT,
    "recordsHolderBasis" TEXT,
    "vendorName" TEXT,
    "publishedAt" TIMESTAMP(3),
    "closingAt" TIMESTAMP(3),
    "awardDate" DATE,
    "currentExpiryAt" DATE,
    "optionsExercisedJson" JSONB,
    "remainingOptions" INTEGER,
    "confirmedRetenderDate" DATE,
    "contractValue" DECIMAL(18,2),
    "contractValueBasis" TEXT,
    "currency" TEXT,
    "parentInstrumentId" TEXT,
    "possibleDuplicateOfId" TEXT,
    "triageStatus" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "triagedById" TEXT,
    "triagedAt" TIMESTAMP(3),
    "priorityJson" JSONB,
    "matchJson" JSONB,
    "firstSeenRunId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastChangedAt" TIMESTAMP(3),
    "origin" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcurementInstrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementInstrumentRelation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fromInstrumentId" TEXT NOT NULL,
    "toInstrumentId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "basis" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcurementInstrumentRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementTenderLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcurementTenderLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementSourceEvidence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "instrumentId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceRecordId" TEXT,
    "sourceUrl" TEXT,
    "isOfficial" BOOLEAN NOT NULL,
    "contentHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "parseStatus" TEXT NOT NULL,
    "normalizedJson" JSONB,
    "snapshotJson" JSONB,
    "summary" TEXT,
    "scanRunId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcurementSourceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordsApplicantProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "legalName" TEXT,
    "representativeName" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "canonicalKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNCONFIRMED',
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordsApplicantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordsRuleProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "institutionKey" TEXT NOT NULL,
    "lawLabel" TEXT NOT NULL,
    "officialPortalUrl" TEXT,
    "guidanceUrl" TEXT,
    "channel" TEXT NOT NULL,
    "applicationFeeCents" INTEGER,
    "currency" TEXT,
    "otherFeesRule" TEXT,
    "deadlineValue" INTEGER,
    "deadlineUnit" TEXT,
    "effectiveFrom" DATE,
    "sourceRefsJson" JSONB,
    "fieldGuideJson" JSONB,
    "selfServeSupported" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verificationMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordsRuleProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordsLedgerAttestation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "applicantKey" TEXT,
    "jurisdiction" TEXT NOT NULL,
    "institutionKey" TEXT NOT NULL,
    "coverageFrom" DATE,
    "coverageTo" DATE,
    "method" TEXT NOT NULL,
    "note" TEXT,
    "attestedById" TEXT NOT NULL,
    "attestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "RecordsLedgerAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordsRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "applicantProfileId" TEXT,
    "applicantKey" TEXT,
    "title" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "recipientInstitution" TEXT,
    "recipientInstitutionKey" TEXT,
    "recordsHolderBasis" TEXT,
    "lawLabel" TEXT,
    "pathType" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "ruleProfileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "filesStatus" TEXT NOT NULL DEFAULT 'NONE',
    "analysisStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "governmentOutcome" TEXT,
    "outcomeNote" TEXT,
    "currentVersionId" TEXT,
    "handoffVersionId" TEXT,
    "submittedVersionId" TEXT,
    "submittedTextVerified" BOOLEAN,
    "submissionReference" TEXT,
    "caseNumber" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submissionChannel" TEXT,
    "actualFeeCents" INTEGER,
    "feeCurrency" TEXT,
    "submissionEvidenceLevel" TEXT,
    "submissionVerifiedById" TEXT,
    "submissionVerifiedAt" TIMESTAMP(3),
    "submissionVerificationMethod" TEXT,
    "unknownFactsJson" JSONB,
    "pathChecksJson" JSONB,
    "overlapReason" TEXT,
    "officialDueAt" TIMESTAMP(3),
    "estimatedDueAt" TIMESTAMP(3),
    "estimateBasis" TEXT,
    "internalFollowUpAt" TIMESTAMP(3),
    "transferJson" JSONB,
    "expectedReleasePages" INTEGER,
    "purposeZh" TEXT,
    "gapsZh" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'NORMAL',
    "originNote" TEXT,
    "autoDraftKey" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "archiveReason" TEXT,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordsRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordsRequestVersion" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "explanationZh" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "categoriesJson" JSONB NOT NULL,
    "instrumentRefsJson" JSONB NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "recipientInstitution" TEXT,
    "recipientInstitutionKey" TEXT,
    "channel" TEXT NOT NULL,
    "applicantProfileVersion" INTEGER,
    "applicantSnapshotJson" JSONB,
    "textHash" TEXT NOT NULL,
    "scopeFingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordsRequestVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordsRequestEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveAt" TIMESTAMP(3),
    "evidenceLevel" TEXT,
    "attachmentIdsJson" JSONB,
    "payloadJson" JSONB,
    "noteZh" TEXT,
    "correctsEventId" TEXT,
    "dedupeKey" TEXT,

    CONSTRAINT "RecordsRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordsAttachment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "eventId" TEXT,
    "kind" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storagePathname" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'USER_UPLOAD',
    "acquiredAt" TIMESTAMP(3),
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parseStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "parseError" TEXT,
    "parseAttempts" INTEGER NOT NULL DEFAULT 0,
    "parseStartedAt" TIMESTAMP(3),
    "parsedAt" TIMESTAMP(3),
    "pageCount" INTEGER,
    "sheetRangesJson" JSONB,

    CONSTRAINT "RecordsAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordsAttachmentUnit" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "unitIndex" INTEGER NOT NULL,
    "unitKind" TEXT NOT NULL,
    "unitLabel" TEXT,
    "text" TEXT NOT NULL,
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "parseStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordsAttachmentUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementLineItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "instrumentNumber" TEXT,
    "documentType" TEXT NOT NULL,
    "amountBasis" TEXT NOT NULL,
    "amendmentMode" TEXT,
    "docRef" TEXT,
    "linkedRef" TEXT,
    "docDate" DATE,
    "productDescription" TEXT,
    "specification" TEXT,
    "quantity" DECIMAL(18,4),
    "unit" TEXT,
    "unitPrice" DECIMAL(18,4),
    "amount" DECIMAL(18,2),
    "currency" TEXT,
    "deliveryLocation" TEXT,
    "taxFreightNote" TEXT,
    "isCancellationOrCredit" BOOLEAN NOT NULL DEFAULT false,
    "sourceUnitIndex" INTEGER,
    "sourcePage" INTEGER,
    "sourceSheet" TEXT,
    "sourceRow" INTEGER,
    "rawSnippet" TEXT NOT NULL,
    "extractionMethod" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcurementLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementAnalysis" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "inputAttachmentIdsJson" JSONB NOT NULL,
    "coverageJson" JSONB NOT NULL,
    "resultJson" JSONB NOT NULL,
    "gapsJson" JSONB NOT NULL,
    "assumptionsJson" JSONB NOT NULL,
    "lineItemCount" INTEGER NOT NULL DEFAULT 0,
    "confirmedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProcurementAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcurementWatch_enabled_nextRunAt_idx" ON "ProcurementWatch"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementWatch_orgId_name_key" ON "ProcurementWatch"("orgId", "name");

-- CreateIndex
CREATE INDEX "ProcurementScanRun_orgId_queuedAt_idx" ON "ProcurementScanRun"("orgId", "queuedAt");

-- CreateIndex
CREATE INDEX "ProcurementScanRun_status_heartbeatAt_idx" ON "ProcurementScanRun"("status", "heartbeatAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementScanRun_watchId_slotKey_key" ON "ProcurementScanRun"("watchId", "slotKey");

-- CreateIndex
CREATE INDEX "ProcurementInstrument_orgId_triageStatus_idx" ON "ProcurementInstrument"("orgId", "triageStatus");

-- CreateIndex
CREATE INDEX "ProcurementInstrument_orgId_normalizedNumber_idx" ON "ProcurementInstrument"("orgId", "normalizedNumber");

-- CreateIndex
CREATE INDEX "ProcurementInstrument_orgId_currentExpiryAt_idx" ON "ProcurementInstrument"("orgId", "currentExpiryAt");

-- CreateIndex
CREATE INDEX "ProcurementInstrument_parentInstrumentId_idx" ON "ProcurementInstrument"("parentInstrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementInstrument_orgId_dedupeKey_key" ON "ProcurementInstrument"("orgId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ProcurementInstrumentRelation_orgId_idx" ON "ProcurementInstrumentRelation"("orgId");

-- CreateIndex
CREATE INDEX "ProcurementInstrumentRelation_toInstrumentId_idx" ON "ProcurementInstrumentRelation"("toInstrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementInstrumentRelation_fromInstrumentId_toInstrument_key" ON "ProcurementInstrumentRelation"("fromInstrumentId", "toInstrumentId", "relation");

-- CreateIndex
CREATE INDEX "ProcurementTenderLink_orgId_projectId_idx" ON "ProcurementTenderLink"("orgId", "projectId");

-- CreateIndex
CREATE INDEX "ProcurementTenderLink_instrumentId_idx" ON "ProcurementTenderLink"("instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementTenderLink_projectId_instrumentId_key" ON "ProcurementTenderLink"("projectId", "instrumentId");

-- CreateIndex
CREATE INDEX "ProcurementSourceEvidence_instrumentId_idx" ON "ProcurementSourceEvidence"("instrumentId");

-- CreateIndex
CREATE INDEX "ProcurementSourceEvidence_orgId_sourceType_sourceKey_idx" ON "ProcurementSourceEvidence"("orgId", "sourceType", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementSourceEvidence_orgId_sourceType_sourceKey_conten_key" ON "ProcurementSourceEvidence"("orgId", "sourceType", "sourceKey", "contentHash");

-- CreateIndex
CREATE INDEX "RecordsApplicantProfile_orgId_idx" ON "RecordsApplicantProfile"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordsRuleProfile_orgId_jurisdiction_institutionKey_channe_key" ON "RecordsRuleProfile"("orgId", "jurisdiction", "institutionKey", "channel");

-- CreateIndex
CREATE INDEX "RecordsLedgerAttestation_orgId_jurisdiction_idx" ON "RecordsLedgerAttestation"("orgId", "jurisdiction");

-- CreateIndex
CREATE INDEX "RecordsRequest_orgId_status_idx" ON "RecordsRequest"("orgId", "status");

-- CreateIndex
CREATE INDEX "RecordsRequest_orgId_projectId_idx" ON "RecordsRequest"("orgId", "projectId");

-- CreateIndex
CREATE INDEX "RecordsRequest_orgId_jurisdiction_recipientInstitutionKey_idx" ON "RecordsRequest"("orgId", "jurisdiction", "recipientInstitutionKey");

-- CreateIndex
CREATE UNIQUE INDEX "RecordsRequest_orgId_autoDraftKey_key" ON "RecordsRequest"("orgId", "autoDraftKey");

-- CreateIndex
CREATE INDEX "RecordsRequestVersion_scopeFingerprint_idx" ON "RecordsRequestVersion"("scopeFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "RecordsRequestVersion_requestId_versionNo_key" ON "RecordsRequestVersion"("requestId", "versionNo");

-- CreateIndex
CREATE INDEX "RecordsRequestEvent_requestId_recordedAt_idx" ON "RecordsRequestEvent"("requestId", "recordedAt");

-- CreateIndex
CREATE INDEX "RecordsRequestEvent_orgId_type_idx" ON "RecordsRequestEvent"("orgId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "RecordsRequestEvent_requestId_dedupeKey_key" ON "RecordsRequestEvent"("requestId", "dedupeKey");

-- CreateIndex
CREATE INDEX "RecordsAttachment_orgId_idx" ON "RecordsAttachment"("orgId");

-- CreateIndex
CREATE INDEX "RecordsAttachment_parseStatus_parseStartedAt_idx" ON "RecordsAttachment"("parseStatus", "parseStartedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecordsAttachment_requestId_contentHash_key" ON "RecordsAttachment"("requestId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "RecordsAttachmentUnit_attachmentId_unitIndex_key" ON "RecordsAttachmentUnit"("attachmentId", "unitIndex");

-- CreateIndex
CREATE INDEX "ProcurementLineItem_requestId_reviewStatus_idx" ON "ProcurementLineItem"("requestId", "reviewStatus");

-- CreateIndex
CREATE INDEX "ProcurementLineItem_orgId_instrumentNumber_idx" ON "ProcurementLineItem"("orgId", "instrumentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementLineItem_attachmentId_dedupeKey_key" ON "ProcurementLineItem"("attachmentId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementAnalysis_requestId_versionNo_key" ON "ProcurementAnalysis"("requestId", "versionNo");

-- AddForeignKey
ALTER TABLE "ProcurementScanRun" ADD CONSTRAINT "ProcurementScanRun_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "ProcurementWatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementSourceEvidence" ADD CONSTRAINT "ProcurementSourceEvidence_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "ProcurementInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordsRequestVersion" ADD CONSTRAINT "RecordsRequestVersion_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RecordsRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordsRequestEvent" ADD CONSTRAINT "RecordsRequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RecordsRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordsAttachment" ADD CONSTRAINT "RecordsAttachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RecordsRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordsAttachmentUnit" ADD CONSTRAINT "RecordsAttachmentUnit_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "RecordsAttachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


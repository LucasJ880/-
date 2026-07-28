-- OrgKnowledge：组织通用知识文档 + pgvector 分块（平台知识真相源）

CREATE TABLE "OrgKnowledgeDocument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "tags" TEXT,
    "language" TEXT NOT NULL DEFAULT 'zh',
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "sourcePath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgKnowledgeDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrgKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrgKnowledgeDocument_orgId_status_updatedAt_idx" ON "OrgKnowledgeDocument"("orgId", "status", "updatedAt");
CREATE INDEX "OrgKnowledgeDocument_orgId_category_idx" ON "OrgKnowledgeDocument"("orgId", "category");
CREATE INDEX "OrgKnowledgeChunk_orgId_documentId_idx" ON "OrgKnowledgeChunk"("orgId", "documentId");
CREATE UNIQUE INDEX "OrgKnowledgeChunk_documentId_chunkIndex_key" ON "OrgKnowledgeChunk"("documentId", "chunkIndex");

ALTER TABLE "OrgKnowledgeChunk" ADD CONSTRAINT "OrgKnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "OrgKnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

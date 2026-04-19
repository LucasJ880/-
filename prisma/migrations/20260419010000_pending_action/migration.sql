-- PR4: AI 待审批动作表
CREATE TABLE "PendingAction" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdById" TEXT NOT NULL,
    "threadId" TEXT,
    "messageId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "resultRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingAction_createdById_status_createdAt_idx"
    ON "PendingAction"("createdById", "status", "createdAt");

CREATE INDEX "PendingAction_threadId_idx"
    ON "PendingAction"("threadId");

ALTER TABLE "PendingAction"
    ADD CONSTRAINT "PendingAction_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

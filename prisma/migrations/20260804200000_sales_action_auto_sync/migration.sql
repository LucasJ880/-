-- Phase 4: automatically materialize safe sales signals into the action loop.
ALTER TABLE "SalesAction"
  ADD COLUMN "lastObservedAt" TIMESTAMP(3),
  ADD COLUMN "autoResolvedAt" TIMESTAMP(3);

CREATE TABLE "SalesActionSyncRun" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "trigger" TEXT NOT NULL DEFAULT 'cron',
  "status" TEXT NOT NULL DEFAULT 'running',
  "scannedCount" INTEGER NOT NULL DEFAULT 0,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "autoResolvedCount" INTEGER NOT NULL DEFAULT 0,
  "truncated" BOOLEAN NOT NULL DEFAULT false,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "SalesActionSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalesActionSyncRun_orgId_startedAt_idx" ON "SalesActionSyncRun"("orgId", "startedAt");
CREATE INDEX "SalesActionSyncRun_status_startedAt_idx" ON "SalesActionSyncRun"("status", "startedAt");

ALTER TABLE "SalesActionSyncRun"
  ADD CONSTRAINT "SalesActionSyncRun_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

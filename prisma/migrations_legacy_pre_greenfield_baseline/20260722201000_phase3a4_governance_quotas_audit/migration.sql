-- Phase 3A-4: AuditLog 扩展 + CapabilityQuotaPolicy + CapabilityQuotaReservation

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "traceId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "riskLevel" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_orgId_workspaceId_createdAt_idx"
  ON "AuditLog"("orgId", "workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_traceId_idx" ON "AuditLog"("traceId");

CREATE TABLE IF NOT EXISTS "CapabilityQuotaPolicy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "warningLimit" DECIMAL(18,6),
    "softLimit" DECIMAL(18,6),
    "hardLimit" DECIMAL(18,6),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityQuotaPolicy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CapabilityQuotaPolicy_orgId_metric_enabled_idx"
  ON "CapabilityQuotaPolicy"("orgId", "metric", "enabled");
CREATE INDEX IF NOT EXISTS "CapabilityQuotaPolicy_orgId_workspaceId_metric_idx"
  ON "CapabilityQuotaPolicy"("orgId", "workspaceId", "metric");
CREATE INDEX IF NOT EXISTS "CapabilityQuotaPolicy_orgId_metric_version_idx"
  ON "CapabilityQuotaPolicy"("orgId", "metric", "version");

ALTER TABLE "CapabilityQuotaPolicy"
  DROP CONSTRAINT IF EXISTS "CapabilityQuotaPolicy_orgId_fkey";
ALTER TABLE "CapabilityQuotaPolicy"
  ADD CONSTRAINT "CapabilityQuotaPolicy_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "CapabilityQuotaReservation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "metric" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "committedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "runId" TEXT,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityQuotaReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CapabilityQuotaReservation_idempotencyKey_key"
  ON "CapabilityQuotaReservation"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "CapabilityQuotaReservation_orgId_metric_status_expiresAt_idx"
  ON "CapabilityQuotaReservation"("orgId", "metric", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "CapabilityQuotaReservation_orgId_workspaceId_metric_status_idx"
  ON "CapabilityQuotaReservation"("orgId", "workspaceId", "metric", "status");
CREATE INDEX IF NOT EXISTS "CapabilityQuotaReservation_runId_idx"
  ON "CapabilityQuotaReservation"("runId");

ALTER TABLE "CapabilityQuotaReservation"
  DROP CONSTRAINT IF EXISTS "CapabilityQuotaReservation_orgId_fkey";
ALTER TABLE "CapabilityQuotaReservation"
  ADD CONSTRAINT "CapabilityQuotaReservation_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

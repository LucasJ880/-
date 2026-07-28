-- Forward-fix: PendingAction stable business idempotency for Agent Runtime 2.0
-- Do not edit previously applied migrations.

ALTER TABLE "PendingAction" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

-- Unique per org when key present; multiple NULLs remain allowed in PostgreSQL
CREATE UNIQUE INDEX IF NOT EXISTS "PendingAction_orgId_idempotencyKey_key"
  ON "PendingAction"("orgId", "idempotencyKey");

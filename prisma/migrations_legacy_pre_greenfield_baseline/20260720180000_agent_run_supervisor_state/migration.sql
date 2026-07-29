-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "supervisorState" JSONB;

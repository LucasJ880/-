-- 寄样寄出后盯回复：跟进日 + 人工已跟进，不自动发信

ALTER TABLE "TradeSample" ADD COLUMN "followUpDueAt" TIMESTAMP(3);
ALTER TABLE "TradeSample" ADD COLUMN "followedUpAt" TIMESTAMP(3);

CREATE INDEX "TradeSample_orgId_status_followUpDueAt_idx" ON "TradeSample"("orgId", "status", "followUpDueAt");

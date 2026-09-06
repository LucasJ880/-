-- 询盘 AI 设计段：回复草稿 / 报价建议 / 寄样建议（均为草稿，人确认后才动作）
ALTER TABLE "TradeInquiryAnalysis"
  ADD COLUMN "replyDraft" JSONB,
  ADD COLUMN "quoteSuggestion" JSONB,
  ADD COLUMN "sampleAdvice" JSONB,
  ADD COLUMN "designStatus" TEXT,
  ADD COLUMN "designError" VARCHAR(1000),
  ADD COLUMN "designedAt" TIMESTAMP(3);

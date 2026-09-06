-- 询盘自动分析：每条进线消息一份结构化分析（意图/买家类型/抽取需求/合规提示/红旗）
CREATE TABLE "TradeInquiryAnalysis" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "intent" TEXT,
  "buyerType" TEXT,
  "language" TEXT,
  "extracted" JSONB,
  "compliance" JSONB,
  "redFlags" JSONB,
  "summary" TEXT,
  "researchStatus" TEXT,
  "error" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradeInquiryAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TradeInquiryAnalysis_messageId_key" ON "TradeInquiryAnalysis"("messageId");
CREATE INDEX "TradeInquiryAnalysis_orgId_createdAt_idx" ON "TradeInquiryAnalysis"("orgId", "createdAt");
CREATE INDEX "TradeInquiryAnalysis_prospectId_createdAt_idx" ON "TradeInquiryAnalysis"("prospectId", "createdAt");

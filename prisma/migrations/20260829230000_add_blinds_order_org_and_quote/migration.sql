-- BlindsOrder 补齐 orgId（多租户边界）与 quoteId（签名→工艺单的生成幂等键）
--
-- 前置条件：执行前 BlindsOrder 必须为空表。
--   2026-08-29 核对生产库 SELECT count(*) FROM "BlindsOrder" = 0（该模块尚未在生产使用），
--   因此 orgId 直接建为 NOT NULL 且不带默认值，与 VinylOrder 同形状，无需回填脚本。
--   若届时表非空，本迁移会**明确失败**而不是写入坏数据 —— 这是刻意选的失败模式；
--   真发生了就改为「可空列 + 独立回填脚本（customerId→SalesCustomer.orgId 优先，
--   其次 projectId→Project.orgId，再次 creatorId→用户所属组织）+ 后续收紧」。
--
-- quoteId 可空 + 唯一：历史工单不是报价生成的，Postgres 唯一索引允许多个 NULL。

-- AlterTable
ALTER TABLE "BlindsOrder" ADD COLUMN "orgId" TEXT NOT NULL;
ALTER TABLE "BlindsOrder" ADD COLUMN "quoteId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BlindsOrder_quoteId_key" ON "BlindsOrder"("quoteId");

-- CreateIndex
CREATE INDEX "BlindsOrder_orgId_status_idx" ON "BlindsOrder"("orgId", "status");

-- AddForeignKey
ALTER TABLE "BlindsOrder" ADD CONSTRAINT "BlindsOrder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindsOrder" ADD CONSTRAINT "BlindsOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "SalesQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

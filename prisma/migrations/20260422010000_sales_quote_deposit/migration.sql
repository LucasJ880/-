-- 在 SalesQuote 上新增定金登记字段（签约后销售补录收款情况）
--   - depositAmount / depositMethod / depositCollectedAt 三者同时写入
--   - depositMethod 取值：cash | check | etransfer
--   - 所有字段允许为空：历史数据和线下已收款场景不强制登记
ALTER TABLE "SalesQuote" ADD COLUMN "depositAmount" DOUBLE PRECISION;
ALTER TABLE "SalesQuote" ADD COLUMN "depositMethod" TEXT;
ALTER TABLE "SalesQuote" ADD COLUMN "depositCollectedAt" TIMESTAMP(3);
ALTER TABLE "SalesQuote" ADD COLUMN "depositCollectedById" TEXT;
ALTER TABLE "SalesQuote" ADD COLUMN "depositNote" TEXT;

-- 添加定金阈值与解锁码字段到全局报价设置
ALTER TABLE "QuoteDiscountSettings" ADD COLUMN "depositWarnPct" DOUBLE PRECISION NOT NULL DEFAULT 0.40;
ALTER TABLE "QuoteDiscountSettings" ADD COLUMN "depositMinPct" DOUBLE PRECISION NOT NULL DEFAULT 0.30;
ALTER TABLE "QuoteDiscountSettings" ADD COLUMN "depositOverrideCode" TEXT;

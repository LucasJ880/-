-- 提成估算参数（驾驶舱配置）：毛利率估算系数 + 提成比例
ALTER TABLE "QuoteDiscountSettings"
ADD COLUMN "commissionMarginRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.3;

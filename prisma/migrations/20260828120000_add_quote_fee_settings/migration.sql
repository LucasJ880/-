-- 报价费用设置：最低安装费 + 运费（驾驶舱可配置，电子报价单/AI 报价共用）
ALTER TABLE "QuoteDiscountSettings"
ADD COLUMN "minInstallFee" DOUBLE PRECISION NOT NULL DEFAULT 200,
ADD COLUMN "deliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 75;

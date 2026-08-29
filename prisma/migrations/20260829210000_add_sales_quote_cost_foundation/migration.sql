-- 销售单据成本基础：行级成本快照 + 企业品类成本率配置
ALTER TABLE "SalesQuoteItem" ADD COLUMN "costPrice" DOUBLE PRECISION;
ALTER TABLE "QuoteDiscountSettings" ADD COLUMN "costRatesJson" JSONB;

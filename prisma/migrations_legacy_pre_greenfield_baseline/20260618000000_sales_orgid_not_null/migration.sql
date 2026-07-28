-- Sales CRM 四表 orgId 收紧为 NOT NULL — Phase B
-- 前置：null orgId = 0 / invalid orgId = 0 / 关系 mismatch = 0（已核查）
-- 仅修改列可空性，不动索引/外键/relation/其他表
ALTER TABLE "SalesCustomer" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "SalesOpportunity" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "SalesQuote" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "CustomerInteraction" ALTER COLUMN "orgId" SET NOT NULL;

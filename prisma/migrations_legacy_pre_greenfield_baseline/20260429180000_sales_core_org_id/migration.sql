-- Sales CRM 核心表 orgId（可选）+ 索引 — P2-A.5 D1
ALTER TABLE "SalesCustomer" ADD COLUMN "orgId" TEXT;
CREATE INDEX "SalesCustomer_orgId_idx" ON "SalesCustomer"("orgId");

ALTER TABLE "SalesOpportunity" ADD COLUMN "orgId" TEXT;
CREATE INDEX "SalesOpportunity_orgId_idx" ON "SalesOpportunity"("orgId");

ALTER TABLE "CustomerInteraction" ADD COLUMN "orgId" TEXT;
CREATE INDEX "CustomerInteraction_orgId_idx" ON "CustomerInteraction"("orgId");

ALTER TABLE "SalesQuote" ADD COLUMN "orgId" TEXT;
CREATE INDEX "SalesQuote_orgId_idx" ON "SalesQuote"("orgId");

-- TradeProspect → Sales CRM 转换回写字段
ALTER TABLE "TradeProspect" ADD COLUMN "convertedToSalesCustomerId" TEXT;
ALTER TABLE "TradeProspect" ADD COLUMN "convertedToSalesOpportunityId" TEXT;
ALTER TABLE "TradeProspect" ADD COLUMN "convertedAt" TIMESTAMP(3);
ALTER TABLE "TradeProspect" ADD COLUMN "convertedById" TEXT;

ALTER TABLE "TradeProspect" ADD CONSTRAINT "TradeProspect_convertedById_fkey" FOREIGN KEY ("convertedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SalesOpportunity" ADD COLUMN "sourceTradeProspectId" TEXT;

CREATE INDEX "SalesOpportunity_sourceTradeProspectId_idx" ON "SalesOpportunity"("sourceTradeProspectId");

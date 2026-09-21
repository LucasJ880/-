-- 报价行挂货号 + 寄样单（挂线索/报价，不新建询盘对象）

ALTER TABLE "TradeQuoteItem" ADD COLUMN "productId" TEXT;
ALTER TABLE "TradeQuoteItem" ADD COLUMN "sku" TEXT;

CREATE TABLE "TradeSample" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "prospectId" TEXT,
    "quoteId" TEXT,
    "productId" TEXT,
    "sku" TEXT,
    "productName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "destination" TEXT,
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "trackingNo" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "shippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TradeQuoteItem_productId_idx" ON "TradeQuoteItem"("productId");
CREATE INDEX "TradeSample_orgId_status_createdAt_idx" ON "TradeSample"("orgId", "status", "createdAt");
CREATE INDEX "TradeSample_prospectId_idx" ON "TradeSample"("prospectId");
CREATE INDEX "TradeSample_quoteId_idx" ON "TradeSample"("quoteId");
CREATE INDEX "TradeSample_productId_idx" ON "TradeSample"("productId");

ALTER TABLE "TradeQuoteItem" ADD CONSTRAINT "TradeQuoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "TradeProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TradeSample" ADD CONSTRAINT "TradeSample_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "TradeProspect"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TradeSample" ADD CONSTRAINT "TradeSample_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "TradeQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TradeSample" ADD CONSTRAINT "TradeSample_productId_fkey" FOREIGN KEY ("productId") REFERENCES "TradeProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

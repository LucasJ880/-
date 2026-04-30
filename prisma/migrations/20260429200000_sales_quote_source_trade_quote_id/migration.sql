-- TradeQuote → SalesQuote 追溯与去重（同一外贸报价仅允许一条销售报价）
ALTER TABLE "SalesQuote" ADD COLUMN "sourceTradeQuoteId" TEXT;

CREATE UNIQUE INDEX "SalesQuote_sourceTradeQuoteId_key" ON "SalesQuote"("sourceTradeQuoteId");

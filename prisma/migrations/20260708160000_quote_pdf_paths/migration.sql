-- 报价 PDF 存档：客户以 PDF 为准查看并签字
ALTER TABLE "SalesQuote" ADD COLUMN "pdfPath" TEXT;
ALTER TABLE "SalesQuote" ADD COLUMN "signedPdfPath" TEXT;

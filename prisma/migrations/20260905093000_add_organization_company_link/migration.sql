-- 公司 → 组织层级：Organization 归属 Company（空=独立组织）
ALTER TABLE "Organization" ADD COLUMN "companyId" TEXT;

ALTER TABLE "Organization" ADD CONSTRAINT "Organization_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Organization_companyId_idx" ON "Organization"("companyId");

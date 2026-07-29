-- Phase 2A: 企业规则租户化 + Industry Pack + 规则版本库

-- Organization.industryPackId
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "industryPackId" TEXT;

-- QuoteDiscountSettings: singleton → per-org
ALTER TABLE "QuoteDiscountSettings" ADD COLUMN IF NOT EXISTS "orgId" TEXT;
ALTER TABLE "QuoteDiscountSettings" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "QuoteDiscountSettings" ADD COLUMN IF NOT EXISTS "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "QuoteDiscountSettings" ADD COLUMN IF NOT EXISTS "lineDiscountUnlockCode" TEXT;

-- 为每个现有组织复制一份当前 singleton（若有）配置
DO $$
DECLARE
  singleton_row "QuoteDiscountSettings"%ROWTYPE;
  org_rec RECORD;
  has_singleton BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM "QuoteDiscountSettings" WHERE id = 'singleton'
  ) INTO has_singleton;

  IF has_singleton THEN
    SELECT * INTO singleton_row FROM "QuoteDiscountSettings" WHERE id = 'singleton';
  END IF;

  FOR org_rec IN SELECT id FROM "Organization" LOOP
    IF NOT EXISTS (
      SELECT 1 FROM "QuoteDiscountSettings" WHERE "orgId" = org_rec.id
    ) THEN
      IF has_singleton THEN
        INSERT INTO "QuoteDiscountSettings" (
          id, "orgId", version, "effectiveAt",
          zebra, shangrila, cellular, roller, drapery, sheer, shutters, honeycomb,
          "promoWarnPct", "promoDangerPct", "promoMaxPct",
          "depositWarnPct", "depositMinPct", "depositOverrideCode",
          "lineDiscountUnlockCode", "updatedAt", "updatedBy"
        ) VALUES (
          'qds_' || replace(gen_random_uuid()::text, '-', ''),
          org_rec.id,
          1,
          CURRENT_TIMESTAMP,
          singleton_row.zebra,
          singleton_row.shangrila,
          singleton_row.cellular,
          singleton_row.roller,
          singleton_row.drapery,
          singleton_row.sheer,
          singleton_row.shutters,
          singleton_row.honeycomb,
          COALESCE(singleton_row."promoWarnPct", 0.06),
          COALESCE(singleton_row."promoDangerPct", 0.15),
          COALESCE(singleton_row."promoMaxPct", 0.25),
          COALESCE(singleton_row."depositWarnPct", 0.40),
          COALESCE(singleton_row."depositMinPct", 0.30),
          singleton_row."depositOverrideCode",
          NULL,
          CURRENT_TIMESTAMP,
          singleton_row."updatedBy"
        );
      ELSE
        INSERT INTO "QuoteDiscountSettings" (
          id, "orgId", version, "effectiveAt", "updatedAt"
        ) VALUES (
          'qds_' || replace(gen_random_uuid()::text, '-', ''),
          org_rec.id,
          1,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        );
      END IF;
    END IF;
  END LOOP;

  -- 删除遗留 singleton，避免运行时误读全局行
  DELETE FROM "QuoteDiscountSettings" WHERE id = 'singleton' OR "orgId" IS NULL;
END $$;

ALTER TABLE "QuoteDiscountSettings" ALTER COLUMN "orgId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'QuoteDiscountSettings_orgId_key'
  ) THEN
    ALTER TABLE "QuoteDiscountSettings" ADD CONSTRAINT "QuoteDiscountSettings_orgId_key" UNIQUE ("orgId");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'QuoteDiscountSettings_orgId_fkey'
  ) THEN
    ALTER TABLE "QuoteDiscountSettings"
      ADD CONSTRAINT "QuoteDiscountSettings_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 去掉旧默认 id='singleton'
ALTER TABLE "QuoteDiscountSettings" ALTER COLUMN "id" DROP DEFAULT;

-- OrgBusinessRule
CREATE TABLE IF NOT EXISTS "OrgBusinessRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "configJson" JSONB NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgBusinessRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrgBusinessRule_orgId_ruleKey_version_key"
  ON "OrgBusinessRule"("orgId", "ruleKey", "version");

CREATE INDEX IF NOT EXISTS "OrgBusinessRule_orgId_ruleKey_status_idx"
  ON "OrgBusinessRule"("orgId", "ruleKey", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrgBusinessRule_orgId_fkey'
  ) THEN
    ALTER TABLE "OrgBusinessRule"
      ADD CONSTRAINT "OrgBusinessRule_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AgentApprovalSettings 版本元数据
ALTER TABLE "AgentApprovalSettings" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AgentApprovalSettings" ADD COLUMN IF NOT EXISTS "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AgentApprovalSettings" ADD COLUMN IF NOT EXISTS "updatedById" TEXT;

-- 预置 Industry Pack（按组织 code）
UPDATE "Organization"
SET "industryPackId" = 'window_covering_services_v1'
WHERE "code" = 'sunny-home-deco' AND ("industryPackId" IS NULL OR "industryPackId" = '');

UPDATE "Organization"
SET "industryPackId" = 'home_textile_trade_v1'
WHERE "code" IN ('mengxin-home-textile', 'mengxin') AND ("industryPackId" IS NULL OR "industryPackId" = '');

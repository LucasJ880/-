-- Repair drift from Phase 2A unlock-code hardening:
-- An early apply of 20260721190000_phase2a_org_rules_industry_pack added
-- "lineDiscountUnlockCode"; the migration SQL was later rewritten to
-- "lineDiscountUnlockCodeHash" before merge, so applied DBs still have the old name.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'QuoteDiscountSettings'
      AND column_name = 'lineDiscountUnlockCode'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'QuoteDiscountSettings'
      AND column_name = 'lineDiscountUnlockCodeHash'
  ) THEN
    ALTER TABLE "QuoteDiscountSettings"
      RENAME COLUMN "lineDiscountUnlockCode" TO "lineDiscountUnlockCodeHash";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'QuoteDiscountSettings'
      AND column_name = 'lineDiscountUnlockCodeHash'
  ) THEN
    ALTER TABLE "QuoteDiscountSettings"
      ADD COLUMN "lineDiscountUnlockCodeHash" TEXT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'QuoteDiscountSettings'
      AND column_name = 'lineDiscountUnlockCode'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'QuoteDiscountSettings'
      AND column_name = 'lineDiscountUnlockCodeHash'
  ) THEN
    UPDATE "QuoteDiscountSettings"
    SET "lineDiscountUnlockCodeHash" = "lineDiscountUnlockCode"
    WHERE "lineDiscountUnlockCodeHash" IS NULL
      AND "lineDiscountUnlockCode" IS NOT NULL;
    ALTER TABLE "QuoteDiscountSettings" DROP COLUMN "lineDiscountUnlockCode";
  END IF;
END $$;

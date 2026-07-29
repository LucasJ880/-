-- CreateTable: 全局报价折扣率设置
CREATE TABLE "QuoteDiscountSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "zebra" DOUBLE PRECISION NOT NULL DEFAULT 0.45,
    "shangrila" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "cellular" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "roller" DOUBLE PRECISION NOT NULL DEFAULT 0.45,
    "drapery" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "sheer" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "shutters" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "honeycomb" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "QuoteDiscountSettings_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row so the app can always read without first creating
INSERT INTO "QuoteDiscountSettings" ("id", "updatedAt") VALUES ('singleton', NOW()) ON CONFLICT DO NOTHING;

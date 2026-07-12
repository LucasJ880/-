-- 品牌记忆中枢：每组织一份品牌语料（orgId 唯一，严格隔离）

-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "tagline" TEXT,
    "positioning" TEXT,
    "sellingPoints" TEXT,
    "targetAudience" TEXT,
    "toneOfVoice" TEXT,
    "serviceScope" TEXT,
    "caseStudies" TEXT,
    "forbiddenClaims" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfile_orgId_key" ON "BrandProfile"("orgId");

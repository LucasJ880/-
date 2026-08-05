-- Phase 5A: measure when a sales action was first picked up.
ALTER TABLE "SalesAction" ADD COLUMN "startedAt" TIMESTAMP(3);

-- Phase 5B: persist the high-promotion approval lifecycle and immutable approval snapshot.
ALTER TABLE "SalesQuote"
  ADD COLUMN "promotionApprovalStatus" TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN "promotionApprovalActionId" TEXT,
  ADD COLUMN "promotionApprovalAmount" DOUBLE PRECISION,
  ADD COLUMN "promotionApprovalRatio" DOUBLE PRECISION,
  ADD COLUMN "promotionApprovalMaxPct" DOUBLE PRECISION,
  ADD COLUMN "promotionApprovalRequestedAt" TIMESTAMP(3),
  ADD COLUMN "promotionApprovalExpiresAt" TIMESTAMP(3),
  ADD COLUMN "promotionApprovalRequestedById" TEXT,
  ADD COLUMN "promotionApprovedAt" TIMESTAMP(3),
  ADD COLUMN "promotionApprovedById" TEXT,
  ADD COLUMN "promotionRejectedAt" TIMESTAMP(3),
  ADD COLUMN "promotionRejectedById" TEXT,
  ADD COLUMN "promotionRejectionReason" TEXT;

CREATE UNIQUE INDEX "SalesQuote_promotionApprovalActionId_key"
  ON "SalesQuote"("promotionApprovalActionId");
CREATE INDEX "SalesQuote_orgId_promotionApprovalStatus_createdAt_idx"
  ON "SalesQuote"("orgId", "promotionApprovalStatus", "createdAt");

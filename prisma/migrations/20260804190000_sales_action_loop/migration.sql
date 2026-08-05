CREATE TABLE "SalesAction" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'digital_employee',
    "signalKey" TEXT NOT NULL,
    "activeKey" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "dueAt" TIMESTAMP(3),
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "completedById" TEXT,
    "resolutionNote" TEXT,
    "dismissedReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesAction_activeKey_key" ON "SalesAction"("activeKey");
CREATE INDEX "SalesAction_orgId_status_dueAt_idx" ON "SalesAction"("orgId", "status", "dueAt");
CREATE INDEX "SalesAction_orgId_assignedToId_status_idx" ON "SalesAction"("orgId", "assignedToId", "status");
CREATE INDEX "SalesAction_customerId_status_idx" ON "SalesAction"("customerId", "status");
CREATE INDEX "SalesAction_opportunityId_status_idx" ON "SalesAction"("opportunityId", "status");
CREATE INDEX "SalesAction_signalKey_idx" ON "SalesAction"("signalKey");

ALTER TABLE "SalesAction" ADD CONSTRAINT "SalesAction_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesAction" ADD CONSTRAINT "SalesAction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesAction" ADD CONSTRAINT "SalesAction_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesAction" ADD CONSTRAINT "SalesAction_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesAction" ADD CONSTRAINT "SalesAction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesAction" ADD CONSTRAINT "SalesAction_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

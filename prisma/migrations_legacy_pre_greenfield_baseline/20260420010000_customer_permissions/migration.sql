-- 允许老板（admin）为每个销售单独开关"是否允许修改客户信息"
-- 默认 true 不破坏现有行为
ALTER TABLE "User"
  ADD COLUMN "canEditCustomers" BOOLEAN NOT NULL DEFAULT true;

-- 软删字段：admin 点"删除客户"时设置 archivedAt，列表默认过滤掉
ALTER TABLE "SalesCustomer"
  ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "SalesCustomer_archivedAt_idx"
  ON "SalesCustomer"("archivedAt");

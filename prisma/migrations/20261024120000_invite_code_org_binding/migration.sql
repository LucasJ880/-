-- 厂家入驻向导（PRD F6）：邀请码可绑定企业。注册时加入该企业、不建个人工作区；空 = 旧行为。纯新增（可空列 + 索引）

ALTER TABLE "InviteCode" ADD COLUMN "orgId" TEXT;
ALTER TABLE "InviteCode" ADD COLUMN "orgRole" TEXT;

CREATE INDEX "InviteCode_orgId_idx" ON "InviteCode"("orgId");

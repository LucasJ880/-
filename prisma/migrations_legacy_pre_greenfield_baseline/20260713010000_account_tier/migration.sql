-- 账号分层：matrix（矩阵号，全自动+抽检）/ premium（精品号，发布 100% 人工审核）

-- AlterTable
ALTER TABLE "MatrixAccount" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'matrix';

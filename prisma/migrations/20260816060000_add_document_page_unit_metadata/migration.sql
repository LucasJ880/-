-- Tender Package 非 PDF 纳入分析 — 可引用单元元数据
-- additive-only：两列（一列带默认值、一列可空），无 DROP / 无 rename / 无破坏性 ALTER / 无 backfill。
-- 既有行全部取默认 unitKind='page'，语义与迁移前一致（PDF 页）。

ALTER TABLE "ProjectDocumentPage" ADD COLUMN "unitKind" TEXT NOT NULL DEFAULT 'page';
ALTER TABLE "ProjectDocumentPage" ADD COLUMN "unitLabel" TEXT;

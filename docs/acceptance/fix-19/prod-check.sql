-- FIX-19「系统生成的文件不进招标文件包」生产只读核对
-- 全部是 SELECT，不写任何数据。用生产库的只读连接执行即可（psql -f 本文件，或在控制台逐段执行）。
-- 列名、表名已按仓库 prisma/schema.prisma 核对（ProjectDocument.source 默认值是 'external_link'，所以第 2 条要看）。
-- 跑完请把四段结果原样贴回来（第 1、2 条决定能不能合并，第 3、4 条进报告）。
-- 第 3 条本来是部署后跑，现在先跑一次也无害：得到的是「现在受影响的项目」，部署后再跑一次对照。

BEGIN READ ONLY;

-- ── 1. 来源值分布：确认没有白名单之外、实为上传的来源值 ──────────────────────
SELECT source, "fileType", count(*) AS n,
       count(*) FILTER (WHERE "blobUrl" IS NOT NULL)     AS with_blob,
       count(*) FILTER (WHERE "contentHash" IS NOT NULL) AS with_hash,
       min("createdAt") AS first_at, max("createdAt") AS last_at
FROM "ProjectDocument"
GROUP BY source, "fileType"
ORDER BY source, "fileType";

-- ── 2. 来源不是 upload、却有存储内容或内容指纹、又不在生成 / 报价导入目录下的行 ──
--    预期 0 行。不为 0：FIX-19 先停，看清是哪些行再定（GATE 第 2 条 A）。
SELECT id, "projectId", title, "fileType", source, "createdAt",
       "blobUrl" IS NOT NULL AS has_blob, "contentHash" IS NOT NULL AS has_hash
FROM "ProjectDocument"
WHERE source <> 'upload'
  AND ("blobUrl" IS NOT NULL OR "contentHash" IS NOT NULL)
  AND COALESCE("blobUrl", url) NOT LIKE '%/generated/%'
  AND COALESCE("blobUrl", url) NOT LIKE '%/quote-imports/%'
ORDER BY "createdAt";

-- ── 3. 最新一份分析里纳入了非上传文件的项目（上线后逐个点「重新分析」的名单）──
WITH latest AS (
  SELECT DISTINCT ON ("projectId") id, "projectId", status, "createdAt"
  FROM "TenderAnalysisRun"
  WHERE status <> 'SUPERSEDED'
  ORDER BY "projectId", "createdAt" DESC
)
SELECT p.name, l."projectId", l.id AS run_id, l.status, l."createdAt",
       count(*) AS non_upload_docs,
       string_agg(d.title || ' [' || d.source || ' / ' || rd.role || ']', '; ') AS docs
FROM latest l
JOIN "TenderAnalysisRunDocument" rd ON rd."runId" = l.id
JOIN "ProjectDocument" d ON d.id = rd."documentId"
JOIN "Project" p ON p.id = l."projectId"
WHERE d.source <> 'upload'
GROUP BY p.name, l."projectId", l.id, l.status, l."createdAt"
ORDER BY l."createdAt" DESC;

-- ── 4. 现在被「可分析类型的外部链接」挡住分析的项目 ──────────────────────
--    类型列表与 enqueue-helpers.ts:45-58 一致，并去掉前导的点。上线后这些项目有上传文件就能手动分析。
SELECT d."projectId", p.name, count(*) AS n
FROM "ProjectDocument" d
JOIN "Project" p ON p.id = d."projectId"
WHERE d.source = 'external_link'
  AND lower(ltrim(trim(d."fileType"), '.')) IN (
    'pdf','application/pdf',
    'docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xls','application/vnd.ms-excel',
    'csv','text/csv','txt','text/plain')
  AND d."contentHash" IS NULL AND d."blobUrl" IS NULL
GROUP BY d."projectId", p.name
ORDER BY n DESC;

ROLLBACK;

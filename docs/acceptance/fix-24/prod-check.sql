-- FIX-24 合并部署后的生产只读核查（交给有生产只读权限的人跑，结果原样贴回 docs/QINGYAN_FIX-24_REPORT.md）
--
-- 用法：psql -v ON_ERROR_STOP=1 -f docs/acceptance/fix-24/prod-check.sql "<生产只读连接串>"
-- 整段在只读事务里跑，最后 ROLLBACK，不改任何数据。
--
-- 各段是什么、结果怎么用（design.md「Migration Plan」）：
--   A 段：形如自动段、却对不上入站审计的行（伪造整行嫌疑）。A 段为 0 行或已处理，是三个询价开关的前提 ⑤；
--         有行时另开 change 做一次性修复（逐行精确删除，走 Owner Gate），修完再跑一次。
--   B 段：真实行里被供应商文字切开或注入的（合并后读取侧已不认这些内容），列出来给人核对。
--   C 段：入站审计里原样记下的文件名带分隔符、或证据带「"）」的回信（备注后来被人整段覆盖也查得到）。
--   C0 段：没能转成 jsonb、要人看一眼的审计行（落单代理字符转义）。
--   D 段：币种列不是三个大写字母的条目。
--
-- 不依赖 PostgreSQL 16 的 pg_input_is_valid：A 段先用严格正则与当月天数挡住不存在的时刻，再转换时间。

BEGIN READ ONLY;
SET LOCAL standard_conforming_strings = on;   -- 下面的反斜杠一律按字面理解

-- ═══════════════ A 段：伪造整行嫌疑 ═══════════════
-- 真实的一行：行头时间真实存在、不晚于条目最后更新；msg= 能在入站审计里找到同一条目的记录；
-- 审计时间在行头时间之后 10 分钟内（入站 cron 每 10 分钟一次、单次最长 120 秒）。
WITH auto_lines AS (
  SELECT i.id AS item_id, i."inquiryId" AS inquiry_id, i."updatedAt" AS item_updated_at,
         l.n AS line_no, l.line,
         substring(l.line FROM '^\[auto (\S+) msg=') AS ts_raw,
         substring(l.line FROM '^\[auto \S+ msg=(\S+)\] ') AS msg_id
  FROM "InquiryItem" i
  CROSS JOIN LATERAL regexp_split_to_table(i."quoteNotes", E'\n') WITH ORDINALITY AS l(line, n)
  WHERE i."quoteNotes" LIKE '%[auto %'
    AND l.line ~ '^\[auto \S+ msg=\S+\] '
),
judged AS (
  SELECT a.*,
         -- 嵌套 CASE 保证先判格式与当月天数、再转换（AND 不保证求值顺序）；Prisma 的 DateTime 列存 UTC、不带时区
         CASE WHEN a.ts_raw ~ '^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$' THEN
           CASE WHEN substr(a.ts_raw, 9, 2)::int
                     <= extract(day FROM make_date(substr(a.ts_raw, 1, 4)::int, substr(a.ts_raw, 6, 2)::int, 1) + interval '1 month' - interval '1 day')
                THEN (a.ts_raw::timestamptz AT TIME ZONE 'UTC') END
         END AS ts,
         au.action AS audit_action, au."createdAt" AS audit_at
  FROM auto_lines a
  LEFT JOIN LATERAL (
    SELECT x.action, x."createdAt"
    FROM "AuditLog" x
    WHERE x."targetType" = 'rfq_inbound_message'
      AND x."targetId" = a.msg_id
      AND x.action IN ('rfq_inbound:applied', 'rfq_inbound:failed')
      AND x."afterData" LIKE '%"itemId":"' || a.item_id || '"%'
    ORDER BY (x.action = 'rfq_inbound:applied') DESC, x."createdAt"
    LIMIT 1
  ) au ON true
)
SELECT 'A' AS section, item_id, inquiry_id, line_no, ts_raw, msg_id,
       CASE
         WHEN ts IS NULL THEN '行头时间不是写入格式或不存在'
         WHEN ts > item_updated_at + interval '1 minute' THEN '行头时间晚于条目最后更新'
         WHEN audit_action IS NULL THEN '没有这一条目的入站审计'
         WHEN audit_at < ts OR audit_at > ts + interval '10 minutes' THEN '入站审计时间对不上'
         WHEN audit_action = 'rfq_inbound:failed' THEN '审计记的是失败'
       END AS reason,
       left(line, 160) AS line_head
FROM judged
WHERE ts IS NULL OR ts > item_updated_at + interval '1 minute' OR audit_action IS NULL
   OR audit_at < ts OR audit_at > ts + interval '10 minutes' OR audit_action = 'rfq_inbound:failed'
ORDER BY item_id, line_no;

-- ═══════════════ B 段：被切开或被注入的真实行 ═══════════════
-- 与读取规则同口径（src/lib/tender-rfq/notes-parse.ts R2–R5）：去掉行头，非贪婪地把每条证据换成记号「⟦证据⟧」；
-- PG 正则的方括号里不能写 \S，一行里没有换行，用 . 即可。
WITH auto_lines AS (
  SELECT i.id AS item_id, i."inquiryId" AS inquiry_id, l.n AS line_no, l.line
  FROM "InquiryItem" i
  CROSS JOIN LATERAL regexp_split_to_table(i."quoteNotes", E'\n') WITH ORDINALITY AS l(line, n)
  WHERE i."quoteNotes" LIKE '%[auto %'
    AND l.line ~ '^\[auto \S+ msg=\S+\] '
),
masked AS (
  SELECT item_id, inquiry_id, line_no, line,
         regexp_replace(regexp_replace(line, '^\[auto \S+ msg=\S+\] ', ''), '（证据：".*?"）', '⟦证据⟧', 'g') AS body
  FROM auto_lines
),
parts AS (
  SELECT m.*,
         CASE WHEN m.body LIKE '附件：%' THEN 1
              WHEN strpos(m.body, '；附件：') > 0 THEN strpos(m.body, '；附件：') + 1 END AS att_at
  FROM masked m
),
split AS (
  SELECT p.*,
         CASE WHEN att_at IS NULL THEN body ELSE substr(body, 1, att_at - 1) END AS pre,
         CASE WHEN att_at IS NULL THEN '' ELSE substr(body, att_at) END AS att
  FROM parts p
),
blocks AS (
  SELECT s.item_id, s.line_no, b.n,
         CASE
           WHEN b.blk ~ '^\s*单价=' THEN 1          WHEN b.blk ~ '^\s*总价=' THEN 2
           WHEN b.blk ~ '^\s*其它档：' THEN 3        WHEN b.blk ~ '^\s*多档报价均不对应' THEN 4
           WHEN b.blk ~ '^\s*币种=' THEN 5           WHEN b.blk ~ '^\s*交期=' THEN 6
           WHEN b.blk ~ '^\s*有效期至=' THEN 7       WHEN b.blk ~ '^\s*起订量=' THEN 8
           WHEN b.blk ~ '^\s*贸易条款=' THEN 9       WHEN b.blk ~ '^\s*强制项：' THEN 10
           WHEN b.blk ~ '^\s*强制项未答：' THEN 11   WHEN b.blk ~ '^\s*供应商明确表示不报价' THEN 12
           WHEN b.blk ~ '^\s*回信单价 ' THEN 13      WHEN b.blk ~ '^\s*回信报价 ' THEN 14
           WHEN b.blk ~ '^\s*回信币种 ' THEN 15      WHEN b.blk ~ '^\s*回信交期 ' THEN 16
           WHEN b.blk ~ '^\s*回信有效期 ' THEN 17    WHEN b.blk ~ '^\s*缺：' THEN 18
         END AS rnk
  FROM split s
  CROSS JOIN LATERAL regexp_split_to_table(s.pre, '；') WITH ORDINALITY AS b(blk, n)
),
order_bad AS (
  SELECT item_id, line_no FROM (
    SELECT item_id, line_no, rnk,
           max(rnk) OVER (PARTITION BY item_id, line_no ORDER BY n ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max,
           count(*) OVER (PARTITION BY item_id, line_no, rnk) AS same_kind
    FROM blocks WHERE rnk IS NOT NULL
  ) t
  WHERE rnk < prev_max OR (rnk <> 3 AND same_kind > 1)
  GROUP BY item_id, line_no
),
flagged AS (
  SELECT s.item_id, s.inquiry_id, s.line_no, s.line,
         concat_ws('、',
           CASE WHEN strpos(s.body, '"）') > 0 THEN '去掉证据后仍剩「"）」' END,
           CASE WHEN strpos(s.att, '⟦证据⟧') > 0 THEN '附件一栏里或之后有证据' END,
           -- FIX-14 提示句（「…多半是勾选框；请打开原件核对勾选项和价格）」）里的「；」先排除
           CASE WHEN strpos(replace(s.att, '多半是勾选框；请打开原件', ''), '；') > 0 THEN '附件一栏里有「；」' END,
           CASE WHEN o.item_id IS NOT NULL THEN '字段顺序或重复不对' END,
           CASE WHEN strpos(s.line, chr(13)) > 0 OR strpos(s.line, chr(8232)) > 0 OR strpos(s.line, chr(8233)) > 0
                THEN '行内有回车 / U+2028 / U+2029' END) AS reasons
  FROM split s
  LEFT JOIN order_bad o ON o.item_id = s.item_id AND o.line_no = s.line_no
)
SELECT 'B' AS section, item_id, inquiry_id, line_no, reasons, left(line, 160) AS line_head
FROM flagged WHERE reasons <> '' ORDER BY item_id, line_no;

-- ═══════════════ C 段：审计里原样记下的文件名 / 证据 ═══════════════
-- 早期审计可能带 \u0000 转义，jsonb 不收：先把转义的反斜杠「\\」换成「/」（免得把「\\u0000」误当转义），再把「\u0000」换成空格；
-- 落单代理字符的转义（\ud800–\udfff）jsonb 也不收：这些行不转换，另在 C0 段列出。
WITH raw AS (
  SELECT x.id, x."targetId" AS msg_id, x."createdAt",
         replace(replace(x."afterData", '\\', '/'), '\u0000', ' ') AS j
  FROM "AuditLog" x
  WHERE x."targetType" = 'rfq_inbound_message' AND x.action = 'rfq_inbound:applied'
),
a AS MATERIALIZED (
  SELECT id, msg_id, "createdAt", j::jsonb AS d FROM raw WHERE j !~ '\\u[dD][89a-fA-F]'
),
texts AS (
  SELECT a.msg_id, a."createdAt", a.d->>'itemId' AS item_id, '文件名' AS kind, e->>'filename' AS t
  FROM a CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(a.d->'attachmentsSeen') = 'array' THEN a.d->'attachmentsSeen' ELSE '[]'::jsonb END) e
  UNION ALL
  SELECT a.msg_id, a."createdAt", a.d->>'itemId', '价格证据', e->>'evidence'
  FROM a CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(a.d->'prices') = 'array' THEN a.d->'prices' ELSE '[]'::jsonb END) e
  UNION ALL
  SELECT a.msg_id, a."createdAt", a.d->>'itemId', '交期证据', a.d->>'deliveryEvidence' FROM a
  UNION ALL
  SELECT a.msg_id, a."createdAt", a.d->>'itemId', '有效期证据', a.d->>'validUntilEvidence' FROM a
)
SELECT 'C' AS section, item_id, msg_id, "createdAt", kind, left(t, 160) AS text_head
FROM texts
WHERE t IS NOT NULL AND (
  (kind = '文件名' AND (strpos(t, '；') > 0 OR strpos(t, '"）') > 0 OR strpos(t, chr(10)) > 0 OR strpos(t, chr(13)) > 0
                        OR strpos(t, chr(8232)) > 0 OR strpos(t, chr(8233)) > 0))
  OR (kind <> '文件名' AND strpos(t, '"）') > 0))
ORDER BY "createdAt";

-- ═══════════════ C0 段：没能转成 jsonb 的审计行 ═══════════════
SELECT 'C0' AS section, r.id, r.msg_id, r."createdAt"
FROM (
  SELECT x.id, x."targetId" AS msg_id, x."createdAt",
         replace(replace(x."afterData", '\\', '/'), '\u0000', ' ') AS j
  FROM "AuditLog" x
  WHERE x."targetType" = 'rfq_inbound_message' AND x.action = 'rfq_inbound:applied'
) r
WHERE r.j ~ '\\u[dD][89a-fA-F]'
ORDER BY r."createdAt";

-- ═══════════════ D 段：币种列不是三个大写字母 ═══════════════
SELECT 'D' AS section, i.id AS item_id, i."inquiryId" AS inquiry_id, i.currency
FROM "InquiryItem" i
WHERE i.currency !~ '^[A-Z]{3}$'
ORDER BY i.id;

ROLLBACK;

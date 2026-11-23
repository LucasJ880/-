-- FIX-24 合并部署后的生产只读核查（交给有生产只读权限的人跑）
--
-- 用法：psql -X -v ON_ERROR_STOP=1 -f docs/acceptance/fix-24/prod-check.sql "<生产只读连接串>"
-- 整段在只读事务里跑，最后 ROLLBACK，不改任何数据。用了 psql 的 \echo / \gset / \if，要用 psql（10 及以上）跑。
--
-- 输出只有编号、项目名、询价轮次、供应商名、链接、行号、时间、消息编号、原因与长度；不出价格、不出回信原文与文件名。
-- 名单按项目直接交项目负责人（不进 git）；docs/QINGYAN_FIX-24_REPORT.md 与核查表只写跑的日期与各段行数。
--
-- 各段是什么、结果怎么用（docs/QINGYAN_FIX-24_REPORT.md 第 9 节）：
--   A 段：形如自动段、却对不上入站审计的行（伪造整行嫌疑）。三个询价开关的前提 ⑤：A 段为 0 行；
--         不为 0 时按 TASKFLOW「FIX-24 后续 4」另开 change 删掉伪造行、重跑核查；剩下的每一行写明为什么是真实行
--         （例如写库成功但「已入表」审计写失败，只留下一条「失败」审计），经 Owner Gate 逐行确认，记在核查表验证表第 7 项。
--   B 段：真实行里被供应商文字切开或注入、或格式被改乱的；「比价还采信这次回信吗」一列与读取规则
--         （src/lib/tender-rfq/notes-parse.ts）同口径。
--   C 段：入站审计里原样记下的文件名带分隔符、或证据带「"）」的回信（备注后来被人整段覆盖也查得到）。
--   C0 段：审计原文转不成 jsonb、要开发看一眼的行。
--   D 段：币种列不是三个大写字母的条目。
--
-- 与读取规则的关系：读取侧行头按原始行严格匹配。A 段先把回车、U+2028、U+2029 换成空格再找行头，
-- 所以会多列出「行头里夹着回车」的行——读取侧不认它们，列出来是因为它们只可能是伪造的；
-- B 段与读取侧一样按原始行严格认行头，只对行头之后的正文把这三种字符换成空格。
-- 时间不依赖 PostgreSQL 16 的 pg_input_is_valid：先用严格正则与当月天数挡住不存在的时刻再转换；
-- C 段在 PostgreSQL 16 及以上用 pg_input_is_valid 把不合法的审计原文挪进 C0，更早的版本只挪落单代理字符转义。

BEGIN READ ONLY;
SET LOCAL standard_conforming_strings = on;   -- 下面的反斜杠一律按字面理解

SELECT (current_setting('server_version_num')::int >= 160000) AS pg16 \gset

\echo '── A 段：伪造整行嫌疑（为 0 行才满足开关前提 ⑤）'
WITH items AS (
  SELECT i.id AS item_id, i."inquiryId" AS inquiry_id, i."updatedAt" AS item_updated_at, i."quoteNotes" AS notes,
         p.name AS project_name, pi."roundNumber" AS round_no, s.name AS supplier_name,
         '/projects/' || pi."projectId" || '?tab=bid#rfq-round-' || pi.id AS link
  FROM "InquiryItem" i
  JOIN "ProjectInquiry" pi ON pi.id = i."inquiryId"
  JOIN "Project" p ON p.id = pi."projectId"
  LEFT JOIN "Supplier" s ON s.id = i."supplierId"
  WHERE i."quoteNotes" LIKE '%[auto%'
),
auto_lines AS (
  SELECT it.*, l.n AS line_no, length(l.line) AS line_len,
         translate(l.line, chr(13) || chr(8232) || chr(8233), '   ') AS tline
  FROM items it
  CROSS JOIN LATERAL regexp_split_to_table(it.notes, E'\n') WITH ORDINALITY AS l(line, n)
),
headed AS (
  SELECT a.*,
         substring(a.tline FROM '^\[auto (\S+) msg=') AS ts_raw,
         substring(a.tline FROM '^\[auto \S+ msg=(\S+)\] ') AS msg_id
  FROM auto_lines a
  WHERE a.tline ~ '^\[auto \S+ msg=\S+\] '
),
judged AS (
  SELECT h.*,
         -- 嵌套 CASE 保证先判格式与当月天数、再转换（AND 不保证求值顺序）；[0-9] 不用 \d（ICU 排序规则下 \d 认全角数字）；
         -- Prisma 的 DateTime 列存 UTC、不带时区
         CASE WHEN h.ts_raw COLLATE "C" ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$' THEN
           CASE WHEN substr(h.ts_raw, 9, 2)::int
                     <= extract(day FROM make_date(substr(h.ts_raw, 1, 4)::int, substr(h.ts_raw, 6, 2)::int, 1) + interval '1 month' - interval '1 day')
                THEN (h.ts_raw::timestamptz AT TIME ZONE 'UTC') END
         END AS ts,
         au.action AS audit_action, au."createdAt" AS audit_at
  FROM headed h
  LEFT JOIN LATERAL (
    SELECT x.action, x."createdAt"
    FROM "AuditLog" x
    WHERE x."targetType" = 'rfq_inbound_message'
      AND x."targetId" = h.msg_id
      AND x.action IN ('rfq_inbound:applied', 'rfq_inbound:failed')
      AND x."afterData" LIKE '%"itemId":"' || h.item_id || '"%'
    ORDER BY (x.action = 'rfq_inbound:applied') DESC, x."createdAt"
    LIMIT 1
  ) au ON true
)
SELECT 'A' AS "段", project_name AS "项目", round_no AS "轮次", supplier_name AS "供应商", link AS "链接",
       item_id AS "条目", line_no AS "行号", ts_raw AS "行头时间", msg_id AS "消息编号",
       CASE
         WHEN ts IS NULL THEN '行头时间不是写入格式或不存在'
         WHEN ts > item_updated_at + interval '1 minute' THEN '行头时间晚于条目最后更新'
         WHEN audit_action IS NULL THEN '没有这一条目的入站审计'
         WHEN audit_at < ts OR audit_at > ts + interval '10 minutes' THEN '入站审计时间对不上'
         WHEN audit_action = 'rfq_inbound:failed' THEN '审计记的是失败'
       END AS "原因",
       line_len AS "行长"
FROM judged
WHERE ts IS NULL OR ts > item_updated_at + interval '1 minute' OR audit_action IS NULL
   OR audit_at < ts OR audit_at > ts + interval '10 minutes' OR audit_action = 'rfq_inbound:failed'
ORDER BY item_id, line_no;

\echo '── B 段：被切开、被注入或格式被改乱的真实行（按项目交负责人；「不再采信」的要人核对原回信）'
-- 与读取规则同口径：去掉行头；非贪婪地把每条证据换成记号「⟦证据⟧」；按「；」切块，每块按 JS 的 trim() 去掉首尾空白
-- （含 U+FEFF、NBSP、全角空格），再去掉记号看块的开头。PG 正则的方括号里不能写 \S，一行里没有换行，用 . 即可。
WITH ws AS (
  -- JS String.prototype.trim() 去掉的那些空白
  SELECT '[' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || ' ' || chr(160) || chr(5760) || chr(8192) || '-' || chr(8202)
         || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279) || ']' AS cls
),
items AS (
  SELECT i.id AS item_id, i."quoteNotes" AS notes,
         p.name AS project_name, pi."roundNumber" AS round_no, s.name AS supplier_name,
         '/projects/' || pi."projectId" || '?tab=bid#rfq-round-' || pi.id AS link
  FROM "InquiryItem" i
  JOIN "ProjectInquiry" pi ON pi.id = i."inquiryId"
  JOIN "Project" p ON p.id = pi."projectId"
  LEFT JOIN "Supplier" s ON s.id = i."supplierId"
  WHERE i."quoteNotes" LIKE '%[auto%'
),
auto_lines AS (
  -- 行头与读取侧一样按原始行严格认（时间是写入格式、msg 只含字母数字 - _）；行头不对的只在 A 段列
  SELECT it.*, l.n AS line_no, l.line, length(l.line) AS line_len,
         substring(l.line COLLATE "C" FROM '^\[auto ([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z) msg=[A-Za-z0-9_-]+\] ') AS ts_raw,
         substring(l.line COLLATE "C" FROM '^(\[auto [0-9TZ:.-]+ msg=[A-Za-z0-9_-]+\] )') AS head
  FROM items it
  CROSS JOIN LATERAL regexp_split_to_table(it.notes, E'\n') WITH ORDINALITY AS l(line, n)
),
valid AS (
  -- 时刻要真实存在（与读取侧「能原样还原」同口径）；正文里的回车、U+2028、U+2029 换成空格
  SELECT a.*, translate(substr(a.line, length(a.head) + 1), chr(13) || chr(8232) || chr(8233), '   ') AS body0
  FROM auto_lines a
  WHERE a.ts_raw IS NOT NULL
    AND CASE WHEN a.ts_raw COLLATE "C" ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$'
             THEN substr(a.ts_raw, 9, 2)::int
                  <= extract(day FROM make_date(substr(a.ts_raw, 1, 4)::int, substr(a.ts_raw, 6, 2)::int, 1) + interval '1 month' - interval '1 day')
             ELSE false END
),
masked AS (
  SELECT v.*, regexp_replace(v.body0, '（证据：".*?"）', '⟦证据⟧', 'g') AS body
  FROM valid v
),
-- R3：遮住证据之后剩下的每个「"）」：前面那一截（从上一条证据结束处起）有「；」，
--     且后面那一截（到下一个「"）」或段尾）是空白、有「；」或有证据，就是证据跳出了引号
r3_parts AS (
  SELECT m.item_id, m.line_no, p.k,
         count(*) OVER (PARTITION BY m.item_id, m.line_no) AS nparts,
         string_agg(p.part, '"）') OVER (PARTITION BY m.item_id, m.line_no ORDER BY p.k ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS upto,
         lead(p.part) OVER (PARTITION BY m.item_id, m.line_no ORDER BY p.k) AS after_part
  FROM masked m
  CROSS JOIN LATERAL regexp_split_to_table(m.body, '"）') WITH ORDINALITY AS p(part, k)
),
r3_bad AS (
  SELECT DISTINCT r.item_id, r.line_no
  FROM r3_parts r, ws
  WHERE r.k < r.nparts
    AND strpos(regexp_replace(r.upto, '^.*⟦证据⟧', ''), '；') > 0
    AND (regexp_replace(r.after_part, '^' || ws.cls || '+|' || ws.cls || '+$', '', 'g') = ''
         OR strpos(r.after_part, '；') > 0 OR strpos(r.after_part, '⟦证据⟧') > 0)
),
blocks AS (
  SELECT m.item_id, m.line_no, b.k,
         regexp_replace(b.blk, '^' || ws.cls || '+|' || ws.cls || '+$', '', 'g') AS blk_t
  FROM masked m
  CROSS JOIN LATERAL regexp_split_to_table(m.body, '；') WITH ORDINALITY AS b(blk, k)
  CROSS JOIN ws
),
blocks2 AS (
  SELECT b.*, replace(b.blk_t, '⟦证据⟧', '') AS blk_s FROM blocks b
),
stops AS (
  SELECT item_id, line_no, min(k) AS stop_k FROM blocks2 WHERE strpos(blk_s, '附件：') = 1 GROUP BY item_id, line_no
),
ranked AS (
  SELECT b.item_id, b.line_no, b.k, b.blk_t, st.stop_k,
         CASE
           WHEN strpos(b.blk_s, '单价=') = 1 THEN 1             WHEN strpos(b.blk_s, '总价=') = 1 THEN 2
           WHEN strpos(b.blk_s, '其它档：') = 1 THEN 3           WHEN strpos(b.blk_s, '多档报价均不对应') = 1 THEN 4
           WHEN strpos(b.blk_s, '币种=') = 1 THEN 5              WHEN strpos(b.blk_s, '交期=') = 1 THEN 6
           WHEN strpos(b.blk_s, '有效期至=') = 1 THEN 7          WHEN strpos(b.blk_s, '起订量=') = 1 THEN 8
           WHEN strpos(b.blk_s, '贸易条款=') = 1 THEN 9          WHEN strpos(b.blk_s, '强制项：') = 1 THEN 10
           WHEN strpos(b.blk_s, '强制项未答：') = 1 THEN 11      WHEN strpos(b.blk_s, '供应商明确表示不报价') = 1 THEN 12
           WHEN strpos(b.blk_s, '回信单价 ') = 1 THEN 13         WHEN strpos(b.blk_s, '回信报价 ') = 1 THEN 14
           WHEN strpos(b.blk_s, '回信币种 ') = 1 THEN 15         WHEN strpos(b.blk_s, '回信交期 ') = 1 THEN 16
           WHEN strpos(b.blk_s, '回信有效期 ') = 1 THEN 17       WHEN strpos(b.blk_s, '缺：') = 1 THEN 18
         END AS rnk
  FROM blocks2 b
  LEFT JOIN stops st ON st.item_id = b.item_id AND st.line_no = b.line_no
),
r4_bad AS (
  SELECT DISTINCT item_id, line_no FROM ranked WHERE stop_k IS NOT NULL AND k >= stop_k AND strpos(blk_t, '⟦证据⟧') > 0
),
r5_bad AS (
  SELECT DISTINCT item_id, line_no FROM (
    SELECT item_id, line_no, rnk,
           max(rnk) OVER (PARTITION BY item_id, line_no ORDER BY k ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max,
           count(*) OVER (PARTITION BY item_id, line_no, rnk) AS same_kind
    FROM ranked WHERE rnk IS NOT NULL AND (stop_k IS NULL OR k < stop_k)
  ) t
  WHERE rnk < prev_max OR (rnk <> 3 AND same_kind > 1)
),
att_semicolon AS (
  -- 附件一栏里有「；」（FIX-14 提示句「…多半是勾选框；请打开原件核对勾选项和价格）」自己带的那个除外）
  SELECT DISTINCT item_id, line_no FROM ranked
  WHERE stop_k IS NOT NULL AND k > stop_k AND strpos(blk_t, '请打开原件核对勾选项和价格') <> 1
),
flagged AS (
  SELECT m.*,
         (r3.item_id IS NOT NULL OR r4.item_id IS NOT NULL OR r5.item_id IS NOT NULL) AS dropped,
         concat_ws('；',
           CASE WHEN r3.item_id IS NOT NULL THEN '原回信里引用的一段没有正常收尾，后面的文字混成了报价字段' END,
           CASE WHEN r4.item_id IS NOT NULL THEN '附件一栏里或附件之后出现了引用原回信的格式' END,
           CASE WHEN r5.item_id IS NOT NULL THEN '报价字段的顺序被打乱或重复了（被篡改，或被人手改过）' END,
           CASE WHEN sc.item_id IS NOT NULL THEN '附件文件名里带分号' END,
           CASE WHEN strpos(m.line, chr(13)) > 0 OR strpos(m.line, chr(8232)) > 0 OR strpos(m.line, chr(8233)) > 0
                THEN '这一行里有回车或特殊的换行符号（多半来自附件文件名）' END) AS reasons
  FROM masked m
  LEFT JOIN r3_bad r3 ON r3.item_id = m.item_id AND r3.line_no = m.line_no
  LEFT JOIN r4_bad r4 ON r4.item_id = m.item_id AND r4.line_no = m.line_no
  LEFT JOIN r5_bad r5 ON r5.item_id = m.item_id AND r5.line_no = m.line_no
  LEFT JOIN att_semicolon sc ON sc.item_id = m.item_id AND sc.line_no = m.line_no
)
SELECT 'B' AS "段", project_name AS "项目", round_no AS "轮次", supplier_name AS "供应商", link AS "链接",
       item_id AS "条目", line_no AS "行号",
       CASE WHEN dropped THEN '不再采信' ELSE '照常采信' END AS "比价还采信这次回信吗",
       reasons AS "原因", line_len AS "行长"
FROM flagged WHERE reasons <> '' ORDER BY item_id, line_no;

\echo '── C 段：入站审计里文件名带分隔符、或报价原文引用带「"）」的回信（交负责人对照原回信）'
-- 早期审计可能带 \u0000 转义，jsonb 不收：先把转义的反斜杠「\\」换成「/」（免得把「\\u0000」误当转义），再把「\u0000」换成空格
\if :pg16
WITH raw AS (
  SELECT x.id, x."targetId" AS msg_id, x."createdAt",
         replace(replace(x."afterData", '\\', '/'), '\u0000', ' ') AS j
  FROM "AuditLog" x
  WHERE x."targetType" = 'rfq_inbound_message' AND x.action = 'rfq_inbound:applied'
),
a AS MATERIALIZED (
  SELECT id, msg_id, "createdAt", j::jsonb AS d FROM raw WHERE pg_input_is_valid(j, 'jsonb')
),
\else
WITH raw AS (
  SELECT x.id, x."targetId" AS msg_id, x."createdAt",
         replace(replace(x."afterData", '\\', '/'), '\u0000', ' ') AS j
  FROM "AuditLog" x
  WHERE x."targetType" = 'rfq_inbound_message' AND x.action = 'rfq_inbound:applied'
),
a AS MATERIALIZED (
  -- PostgreSQL 16 之前没有 pg_input_is_valid：只挪开落单代理字符转义（\ud800–\udfff），其它不合法的原文会让这一段报错
  SELECT id, msg_id, "createdAt", j::jsonb AS d FROM raw WHERE j !~ '\\u[dD][89a-fA-F]'
),
\endif
texts AS (
  SELECT a.msg_id, a."createdAt", a.d->>'itemId' AS item_id, '文件名' AS kind, e->>'filename' AS t
  FROM a CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(a.d->'attachmentsSeen') = 'array' THEN a.d->'attachmentsSeen' ELSE '[]'::jsonb END) e
  UNION ALL
  SELECT a.msg_id, a."createdAt", a.d->>'itemId', '价格那条的原文引用', e->>'evidence'
  FROM a CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(a.d->'prices') = 'array' THEN a.d->'prices' ELSE '[]'::jsonb END) e
  UNION ALL
  SELECT a.msg_id, a."createdAt", a.d->>'itemId', '交期那条的原文引用', a.d->>'deliveryEvidence' FROM a
  UNION ALL
  SELECT a.msg_id, a."createdAt", a.d->>'itemId', '有效期那条的原文引用', a.d->>'validUntilEvidence' FROM a
),
hits AS (
  SELECT t.*,
         concat_ws('、',
           CASE WHEN kind = '文件名' AND strpos(t, '；') > 0 THEN '带分号' END,
           CASE WHEN kind = '文件名' AND strpos(t, chr(10)) > 0 THEN '带换行' END,
           CASE WHEN kind = '文件名' AND (strpos(t, chr(13)) > 0 OR strpos(t, chr(8232)) > 0 OR strpos(t, chr(8233)) > 0) THEN '带回车或特殊换行符号' END,
           CASE WHEN strpos(t, '"）') > 0 THEN '带「"）」' END) AS reasons
  FROM texts t WHERE t.t IS NOT NULL
)
SELECT 'C' AS "段", p.name AS "项目", pi."roundNumber" AS "轮次", s.name AS "供应商",
       '/projects/' || pi."projectId" || '?tab=bid#rfq-round-' || pi.id AS "链接",
       h.item_id AS "条目", h.msg_id AS "消息编号", h."createdAt" AS "审计时间", h.kind AS "哪一项", h.reasons AS "原因", length(h.t) AS "长度"
FROM hits h
LEFT JOIN "InquiryItem" i ON i.id = h.item_id
LEFT JOIN "ProjectInquiry" pi ON pi.id = i."inquiryId"
LEFT JOIN "Project" p ON p.id = pi."projectId"
LEFT JOIN "Supplier" s ON s.id = i."supplierId"
WHERE h.reasons <> ''
ORDER BY h."createdAt", h.msg_id, h.kind;

\echo '── C0 段：审计原文转不成 jsonb 的行（交开发查审计原文）'
SELECT 'C0' AS "段", r.id AS "审计编号", r.msg_id AS "消息编号", r."createdAt" AS "审计时间",
       substring(r.j FROM '"itemId":"([^"]+)"') AS "条目",
       CASE WHEN r.j ~ '\\u[dD][89a-fA-F]' THEN '带落单代理字符转义' ELSE '不是合法的 JSON' END AS "原因"
FROM (
  SELECT x.id, x."targetId" AS msg_id, x."createdAt",
         replace(replace(x."afterData", '\\', '/'), '\u0000', ' ') AS j
  FROM "AuditLog" x
  WHERE x."targetType" = 'rfq_inbound_message' AND x.action = 'rfq_inbound:applied'
) r
\if :pg16
WHERE NOT pg_input_is_valid(r.j, 'jsonb')
\else
WHERE r.j ~ '\\u[dD][89a-fA-F]'
\endif
ORDER BY r."createdAt";

\echo '── D 段：币种列不是三个大写字母的条目（交开发，并入「FIX-24 后续 4」的一次性修复）'
SELECT 'D' AS "段", p.name AS "项目", pi."roundNumber" AS "轮次", s.name AS "供应商",
       '/projects/' || pi."projectId" || '?tab=bid#rfq-round-' || pi.id AS "链接",
       i.id AS "条目", length(i.currency) AS "币种长度"
FROM "InquiryItem" i
JOIN "ProjectInquiry" pi ON pi.id = i."inquiryId"
JOIN "Project" p ON p.id = pi."projectId"
LEFT JOIN "Supplier" s ON s.id = i."supplierId"
WHERE i.currency COLLATE "C" !~ '^[A-Z]{3}$'
ORDER BY i.id;

ROLLBACK;

-- FIX-15「一次调用的截止时间」生产只读核对
-- 全部是 SELECT，不写任何数据。时间列是不带时区的 TIMESTAMP(3)，存的是 UTC（多伦多 = UTC − 5）。
-- 跑完请把各段结果原样贴回来：
--   A 段 → 确认 2026-11-22「12-3」的 t8 失败原因（预期：SYNTHESIS_MODEL_FAILED，错误文字里有 429 / no credits）
--   B 段 → t8、风险分析旧分支、规划三类模型调用的真实耗时分布，用来确认 180 / 60 秒（以及规划 90 / 40 秒）

BEGIN READ ONLY;

-- ── A1. 「12-3」那次一键分析：Job、t8、t9、分析记录 ──────────────────────
--    16:27 多伦多 = 21:27 UTC 创建。AgentRun 没有 projectId 列，靠 metadata->>'projectId' 关联。
WITH job AS (
  SELECT r."id", r."status", r."errorCode", r."errorMessage", r."attempts", r."createdAt", r."updatedAt"
  FROM "AgentRun" r
  JOIN "Project" p ON p."id" = r."metadata"->>'projectId' AND p."orgId" = r."orgId"
  WHERE r."runType" = 'workforce_job'
    AND r."metadata"->>'workDomain' = 'tender'
    AND p."name" ILIKE '%12-3 Indoor Canadian Flag%'
    AND r."createdAt" >= TIMESTAMP '2026-11-22 21:20:00'
    AND r."createdAt" <  TIMESTAMP '2026-11-22 21:45:00'
)
SELECT j."id" AS job_id, j."status" AS job_status, j."errorCode" AS job_error_code,
       LEFT(j."errorMessage", 300) AS job_error_message, j."attempts" AS job_attempts, j."updatedAt",
       s."status" AS t8_status, s."attemptCount", s."maxAttempts", s."errorCode" AS t8_error_code,
       LEFT(s."errorMessage", 800) AS t8_error_message, s."startedAt", s."completedAt",
       t9."status" AS t9_status, t9."errorCode" AS t9_error_code,
       tar."status" AS analysis_status, tar."errorCode" AS analysis_error_code
FROM job j
LEFT JOIN "AgentRunStep" s  ON s."runId" = j."id" AND s."stepKey" = 't8_synthesis'
LEFT JOIN "AgentRunStep" t9 ON t9."runId" = j."id" AND t9."stepKey" = 't9_finalize_analysis'
LEFT JOIN "TenderAnalysisRun" tar ON tar."idempotencyKey" = 'tender-workforce:v1:' || j."id"
ORDER BY j."createdAt";

-- ── A2. 同一个 Job 里 t8 的每次尝试（开始、结束、错误原文），按时间排 ──────────
--    每次失败的 tool.failed 都带 error；看第几次、几点、是不是 429 / no credits。
WITH job AS (
  SELECT r."id" FROM "AgentRun" r
  JOIN "Project" p ON p."id" = r."metadata"->>'projectId' AND p."orgId" = r."orgId"
  WHERE r."runType" = 'workforce_job' AND r."metadata"->>'workDomain' = 'tender'
    AND p."name" ILIKE '%12-3 Indoor Canadian Flag%'
    AND r."createdAt" >= TIMESTAMP '2026-11-22 21:20:00' AND r."createdAt" < TIMESTAMP '2026-11-22 21:45:00'
)
SELECT e."sequence", e."createdAt", e."eventType",
       e."payload"->>'stepKey' AS step_key, e."payload"->>'attempt' AS attempt,
       e."payload"->>'toolCallId' AS tool_call_id, e."payload"->>'errorCode' AS error_code,
       LEFT(e."payload"->>'error', 800) AS error_800
FROM job j JOIN "AgentRunEvent" e ON e."runId" = j."id"
WHERE (e."payload"->>'stepKey' = 't8_synthesis')
   OR e."eventType" IN ('job.claimed','job.queued','job.failed','job.waiting_human','run.needs_human','job.completed')
ORDER BY e."sequence";

-- ── A3. 同一时段所有 Job 的模型调用失败里，有没有 429 / no credits（看 16:40:31 多伦多 = 21:40:31 UTC 前后）──
SELECT e."createdAt", e."runId", e."payload"->>'stepKey' AS step_key, LEFT(e."payload"->>'error', 300) AS error_300
FROM "AgentRunEvent" e
WHERE e."eventType" = 'tool.failed'
  AND e."createdAt" >= TIMESTAMP '2026-11-22 21:00:00'
  AND e."createdAt" <  TIMESTAMP '2026-11-23 00:00:00'
ORDER BY e."createdAt";

-- ── B1. t8 综合、t5 风险分析（区分「只读投影」与「旧分支调模型」）每次尝试的耗时分布 ──
--    配对：每条 tool.started 找同一 run、同一 stepKey、sequence 更大的第一条结束事件
--    （tool.completed / tool.failed / tool.yielded；yielded 不带 toolCallId，所以按 stepKey + 顺序配）。
--    没有结束事件的（被 300 秒强制结束、进程被杀）单独记一行 outcome = 'no_end_event'。
--    时间窗默认最近 120 天，按需改。
WITH started AS (
  SELECT e."runId", e."sequence", e."createdAt" AS started_at, e."payload"->>'stepKey' AS step_key
  FROM "AgentRunEvent" e
  JOIN "AgentRun" r ON r."id" = e."runId"
  WHERE e."eventType" = 'tool.started'
    AND e."payload"->>'stepKey' IN ('t8_synthesis', 't5_risk_analysis')
    AND r."runType" = 'workforce_job'
    AND e."createdAt" >= now() - INTERVAL '120 days'
),
paired AS (
  SELECT s.*, x."eventType" AS end_type, x."createdAt" AS ended_at
  FROM started s
  LEFT JOIN LATERAL (
    SELECT e2."eventType", e2."createdAt"
    FROM "AgentRunEvent" e2
    WHERE e2."runId" = s."runId"
      AND e2."sequence" > s."sequence"
      AND e2."payload"->>'stepKey' = s.step_key
      AND e2."eventType" IN ('tool.completed','tool.failed','tool.yielded','tool.started')
    ORDER BY e2."sequence"
    LIMIT 1
  ) x ON true
),
labelled AS (
  SELECT p.*,
         CASE WHEN p.step_key = 't5_risk_analysis' THEN
                CASE WHEN jsonb_path_exists(st."outputJson"::jsonb, '$.**.canonicalProjection ? (@ == true)')
                     THEN 't5_projection(no model)' ELSE 't5_legacy_or_unknown' END
              ELSE 't8_synthesis' END AS kind,
         CASE WHEN p.end_type IS NULL OR p.end_type = 'tool.started' THEN 'no_end_event'
              ELSE replace(p.end_type, 'tool.', '') END AS outcome,
         EXTRACT(EPOCH FROM (p.ended_at - p.started_at)) AS secs
  FROM paired p
  LEFT JOIN "AgentRunStep" st ON st."runId" = p."runId" AND st."stepKey" = p.step_key
)
SELECT kind, outcome, count(*) AS n,
       round(min(secs)::numeric, 1) AS min_s,
       round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY secs))::numeric, 1) AS p50_s,
       round((percentile_cont(0.9)  WITHIN GROUP (ORDER BY secs))::numeric, 1) AS p90_s,
       round((percentile_cont(0.95) WITHIN GROUP (ORDER BY secs))::numeric, 1) AS p95_s,
       round((percentile_cont(0.99) WITHIN GROUP (ORDER BY secs))::numeric, 1) AS p99_s,
       round(max(secs)::numeric, 1) AS max_s,
       count(*) FILTER (WHERE secs > 60)  AS over_60s,
       count(*) FILTER (WHERE secs > 120) AS over_120s,
       count(*) FILTER (WHERE secs > 180) AS over_180s,
       count(*) FILTER (WHERE secs > 240) AS over_240s
FROM labelled
GROUP BY kind, outcome
ORDER BY kind, outcome;

-- ── B2. B1 里耗时最长的 20 次（看是不是集中在某几天 / 某几个 Job）──
WITH started AS (
  SELECT e."runId", e."sequence", e."createdAt" AS started_at, e."payload"->>'stepKey' AS step_key
  FROM "AgentRunEvent" e
  JOIN "AgentRun" r ON r."id" = e."runId"
  WHERE e."eventType" = 'tool.started'
    AND e."payload"->>'stepKey' IN ('t8_synthesis', 't5_risk_analysis')
    AND r."runType" = 'workforce_job'
    AND e."createdAt" >= now() - INTERVAL '120 days'
)
SELECT s."runId", s.step_key, s.started_at, x."eventType" AS end_type,
       round(EXTRACT(EPOCH FROM (x."createdAt" - s.started_at))::numeric, 1) AS secs
FROM started s
LEFT JOIN LATERAL (
  SELECT e2."eventType", e2."createdAt" FROM "AgentRunEvent" e2
  WHERE e2."runId" = s."runId" AND e2."sequence" > s."sequence"
    AND e2."payload"->>'stepKey' = s.step_key
    AND e2."eventType" IN ('tool.completed','tool.failed','tool.yielded','tool.started')
  ORDER BY e2."sequence" LIMIT 1
) x ON true
-- end_type = 'tool.started' 表示这一次没有结束事件（被 300 秒强制结束或进程被杀），secs 是到下一次尝试开始的间隔
ORDER BY secs DESC NULLS FIRST
LIMIT 20;

-- ── B3. 规划耗时：每条 plan.created 与它之前最近一次 job.claimed 的时间差（同一个 Job）──
--    规划在 processor.ts 首个时间片、轮次循环之前；计划写入时发 plan.created（agent-runtime-v2/persist.ts:113）。
--    差值还包含认领后到规划开始前的几次查询（通常不到 1 秒），略偏大。
WITH planned AS (
  SELECT e."runId", e."sequence", e."createdAt" AS planned_at, r."metadata"->>'workDomain' AS domain
  FROM "AgentRunEvent" e
  JOIN "AgentRun" r ON r."id" = e."runId"
  WHERE e."eventType" = 'plan.created' AND r."runType" = 'workforce_job'
    AND e."createdAt" >= now() - INTERVAL '120 days'
),
d AS (
  SELECT p.domain, EXTRACT(EPOCH FROM (p.planned_at - c.claimed_at)) AS secs
  FROM planned p
  JOIN LATERAL (
    SELECT e2."createdAt" AS claimed_at FROM "AgentRunEvent" e2
    WHERE e2."runId" = p."runId" AND e2."sequence" < p."sequence" AND e2."eventType" = 'job.claimed'
    ORDER BY e2."sequence" DESC LIMIT 1
  ) c ON true
)
SELECT coalesce(domain, '(none)') AS domain, count(*) AS n,
       round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY secs))::numeric, 1) AS p50_s,
       round((percentile_cont(0.9)  WITHIN GROUP (ORDER BY secs))::numeric, 1) AS p90_s,
       round((percentile_cont(0.99) WITHIN GROUP (ORDER BY secs))::numeric, 1) AS p99_s,
       round(max(secs)::numeric, 1) AS max_s,
       count(*) FILTER (WHERE secs > 40) AS over_40s,
       count(*) FILTER (WHERE secs > 90) AS over_90s
FROM d
GROUP BY domain
ORDER BY n DESC;

-- ── B4. 规划失败后走任务级重试的 Job 数（job.queued 且带重试原因的；用来看 90 秒上限会多造成多少次重试）──
SELECT r."metadata"->>'workDomain' AS domain, count(DISTINCT e."runId") AS jobs, count(*) AS requeues
FROM "AgentRunEvent" e
JOIN "AgentRun" r ON r."id" = e."runId"
WHERE e."eventType" = 'job.queued' AND r."runType" = 'workforce_job'
  AND e."createdAt" >= now() - INTERVAL '120 days'
  AND NOT EXISTS (SELECT 1 FROM "AgentRunStep" s WHERE s."runId" = e."runId" AND s."createdAt" <= e."createdAt")
GROUP BY 1
ORDER BY 2 DESC;

ROLLBACK;

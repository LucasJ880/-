# Design: org-cockpit-daily-digest

## Context

已核实的现状（2026-10-30，main @ `a2537b8`）：

- `/api/cron/daily-brief`（`vercel.json` `0 * * * *`）每小时唤醒，`orgsAtLocalHour(orgs, now, [7])` 挑本地 07 点的组织；没有组织到点时直接返回 `skipped`，不记运行。`runTrackedAutomation("daily-brief", …)` 记一次运行。
- A-4 `getOrgWorkload(viewer, days, deps)`（`src/lib/cockpit/workload-read-model.ts`）只用 `viewer.orgId`；按组织时区算 `days` 个本地日（含今天、升序）的每行每日计数 `WorkloadCounts`，行 = 七个岗位 + `inbound_sales_trade_show` + `unattributed`。`days` 最小 7。
- `WorkloadCounts` 含 `agentRuns`、`automationRuns`（平台级）、`proposed`、`approved`、`rejected`、`expired`、`cancelled`、`superseded`、`systemFailed`、`executionFailed`、`guardrailBlocked`、`inputTokens`、`outputTokens`、`cost`。
- `AuditLog.userId` 必填（外键到 User）；`Organization.ownerId` 必有。
- Corporate Memory 写入只允许人工（`assertWritableActorType`），本 change 不碰。
- `cockpit/schedule.test.ts` 用正则核对路由源码里 `orgsAtLocalHour(…, [小时])` 与调度表一致；`cockpit/posts.ts` 有类型层穷举断言，新增自动化键必须归岗位，`schedule.ts` 的 `Record<AutomationKey, …>` 必须配调度。
- company.log 的系统审计来源由 `audit-labels.ts` 的 `SYSTEM_AUDIT_ACTIONS` 决定，动作中文名由 `AUDIT_ACTION_LABELS` 决定。

## Goals / Non-Goals

**Goals:**
- 每个组织每个本地日最多一条日结审计，内容只有按岗位的计数，空日不写。
- 复用 A-4 汇总与 daily-brief 的本地时刻门控，不新增 cron / 队列 / schema / LLM。
- 驾驶舱的心跳、调度、岗位归属与 company.log 能看到这个新自动化与它写的审计。

**Non-Goals:**
- MemoryClaim、LLM 摘要、阅读页面、回填历史、推送。

## Decisions

### D1 本地 00 点汇总前一个本地日，01 点补一次
`orgsAtLocalHour(orgs, now, [0, 1])` 选组织；日结的本地日 = `localDayKeys(now, tz, 2)[0]`（前一天，00:xx 与 01:xx 都是同一天）。取 A-4 汇总时 `days = WORKLOAD_MIN_DAYS`（7），从结果 `days` 里按日期找那一列。
- 01 点补一次：只跑 00 点时，一次读取失败、一次漏触发或部署窗口就会让那一天永久缺日结（不回填）；部分时区（如哈瓦那、开罗、圣地亚哥、贝鲁特、亚速尔）夏令时开始那天当地没有 00 点。01 点再跑一次，D3 的锁 + 先查后写保证 00 点已写时只返回 `exists`。代价是每组织每天多一次 A-4 读取。
- 否决 23 点汇总当天：唤醒是整点，23:00 之后落定的结局（审批过期等）会漏。
- 夏令时：`localDayKeys` / `localDayStart` 已按当地 00:00 处理；`isLocalScheduleHour` 在跳过 / 重复的小时与 daily-brief 同一行为（重复的 01 点跑两次，第二次 `exists`）。
- 已知口径：00 点读取之后才提交、时间戳却在前一天的少量记录不会进日结（先写者为准，与 A-4 现算口径一致）。

### D2 内容只取十个计数
`DIGEST_COUNT_FIELDS = agentRuns, proposed, approved, rejected, expired, cancelled, superseded, systemFailed, executionFailed, guardrailBlocked`。不取 `automationRuns`（平台级，与组织无关）、token、成本。每行写 `{ key, name, ...counts }`，全为 0 的行去掉；所有行都去掉时不写审计。`afterData = { day, timezone, rows, truncated, source: "system" }`；`truncated` 透传 A-4 的读取上限标记。
- 否决写成文字摘要：模板文字没有计数之外的信息，徒增长度；计数可由驾驶舱或报表再渲染。

### D3 写入：组织 + 本地日串行化、先查后写
`db.$transaction` 内 `pg_advisory_xact_lock(hashtext('post-daily-digest:<orgId>:<day>'))`，再按 `action = cockpit.post_daily_digest`、`targetType = organization`、`targetId = orgId`、`afterData contains "day":"<day>"` 查已有；无则 `writeAuditLog(tx, …)`，操作人 `org.ownerId`。结果 `written | exists | empty | error`。
- 否决先写后去重：会在并发重试时出现两条。

### D4 新自动化 `post-daily-digest`
- `AUTOMATION_REGISTRY` 加 `{ key: "post-daily-digest", name: "岗位日结（审计记录）", category: "operations", cadence: "每日 00:00（汇总前一天）", timezone: ORG_TIMEZONE }`。
- 岗位归属：`ops_knowledge`（运维与知识：与 practice-miner、审批超时同属"组织运转留痕"）。
- 调度：`{ kind: "local_hours", route: "/api/cron/daily-brief", cron: "0 * * * *", hours: [0, 1], timezone: "org" }`。
- 路由：一次查询取在用组织（多取 `ownerId`），分别用 `[7]` 与 `[0, 1]` 挑出简报组织与日结组织；两组都空才返回 `skipped`；简报部分逻辑不变；日结组织非空时 `runTrackedAutomation("post-daily-digest", …)`，逐组织调用 `runPostDailyDigest`，单个失败计入失败数，运行状态按失败数给 `succeeded` / `partial`，全部失败给 `failed`。
- 顺序：日结在简报**之后**执行（不占简报的 `maxDuration` 时间），整段 `.catch` 收住异常（只记日志、写进响应的 `postDailyDigest`）；简报本身抛错或超时导致日结没跑时由 01 点补。只有日结组织时响应为 `{ skipped: true, reason: "没有组织处于当地 07:00", postDailyDigest }`，有简报组织时在简报原响应上加 `postDailyDigest`。同一时刻一个组织不可能同时处于本地 0 / 1 点与 7 点，两组同时非空只发生在相差 6–7 小时的不同时区组织之间。

### D5 依赖可注入
`runPostDailyDigest(org, now, deps)`，`deps = { workload(orgId, days, now), writeIfAbsent(org, digest) }`；纯函数 `buildPostDailyDigest(workload, day)` 与 `digestDayFor(now, tz)` 单测；隔离库端到端用真实依赖。

### D6 company.log 标签
`AUDIT_ACTION_LABELS["cockpit.post_daily_digest"] = "岗位日结"`；`SYSTEM_AUDIT_ACTIONS` 加入该动作。时间线不读 `afterData` 的计数（A-2 / A-2b 的读取口径不变）。

## 与八条硬纪律

| 条 | 关系 |
|---|---|
| 1 零 schema | 只写 `AuditLog`；`git diff --stat prisma/` 为空 |
| 2 出站先审批 | 不涉及：无出站 |
| 3 禁止第三套队列 | 复用既有 cron，不新增队列 / lease / scheduler |
| 4 脱敏 | 只有计数与岗位名，不含正文 / 客户 / 金额 / 员工 |
| 5 不爬登录页 | 不涉及 |
| 6 邮箱分离 | 不涉及 |
| 7 确定性优先 | 纯模板 / 纯计数，零 LLM |
| 8 测试注册 | 两个新测试注册进 `test-all.sh`，纯函数测试进 `test-ci-unit.sh` |

## Risks / Trade-offs

- [00 点的 daily-brief 定时任务多一组读] → 每组织一次 A-4 汇总（7 天窗口、既有上限），只在本地 0 点与 1 点；组织数小。
- [A-4 读取上限截断] → 透传 `truncated`，与驾驶舱同一口径。
- [操作人显示为所有者] → company.log 来源标 `system`，与系统作废等审计同一做法。

## Migration Plan

部署即生效：下一个本地 00 点开始写前一天的日结。回滚 = 回退本 PR；已写的审计保留（只读记录）。

## 验证方式

- `npx tsx src/lib/cockpit/__tests__/daily-digest.test.ts`：日期选择（含夏令时切换日、跳过 00 点的时区）、只取十个计数、空行 / 空日、payload 无敏感字段、写入结果、单组织失败、路由静态断言。
- 隔离库 `daily-digest-db.isolated.test.ts`：真实依赖写一条、重跑 `exists`、空组织 `empty`、只多一条审计（无 MemoryClaim / 通知 / 审批）。
- `posts.test.ts` / `schedule.test.ts` / `audit-labels.test.ts` 补断言。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate org-cockpit-daily-digest --strict`；全量 `npm test`。

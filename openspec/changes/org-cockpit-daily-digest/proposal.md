# Proposal: org-cockpit-daily-digest

**TASKFLOW：** A-5（`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` §A-5，夜间岗位日结）。
**受影响的 Muse 意图：** 无。不改 `src/lib/muse-bridge/**`。
**已决定（不重开）：**
- D-1：A-5 只做模板版，零 LLM，不改 `openspec/config.yaml` 第 7 条。
- Lucas 2026-10-30：日结写 `AuditLog`（`cockpit.post_daily_digest`），每组织每天一条、只含计数，**不进 MemoryClaim**。Corporate Memory 写入只允许人工（`assertWritableActorType` 拒 system / ai / agent，`MEMORY_WRITE_PERMISSION = CONSERVATIVE_ADMIN_ONLY`），不为日结开系统写入例外。

## Why

任务书 A-5 要的是"每晚把每个岗位当天做了什么留一份记录"。A-4 已经能按岗位、按本地日算出工作量（AI 运行、起草的审批与各种结局、守卫拦截），但只在有人打开驾驶舱时现算，不留痕；过了 A-4 的 30 天窗口就看不到了。日结把前一天的按岗位计数固定成一条审计，company.log 里能看到，之后的复盘与 FDE V2 就绪判断（B-6）有可追溯的日粒度依据。

## What Changes

- **新自动化 `post-daily-digest`（岗位日结）**：挂在既有 `/api/cron/daily-brief` 每小时定时任务里，按组织时区在本地 **00 点**为**前一个本地日**生成日结，**01 点补一次**（00 点失败、漏触发或当地夏令时跳过 00 点时补写；已写则返回"已存在"）；在当次每日简报之后执行；不新增 cron、不新增队列。只在有组织到点时记一次运行（与 daily-brief 的本地时刻门控同一机制）。
- **日结内容**：复用 A-4 的按岗位工作量汇总（`getOrgWorkload` / `computeWorkload`），取前一个本地日那一列，逐行（七个岗位 + 展会询盘子行 + 未归属）只保留计数：AI 运行、起草、批准、驳回、过期、取消、作废、系统失败、执行失败、守卫拦截。不含平台级自动化运行数、token 与成本、任何正文 / 客户 / 金额 / 员工信息。
- **写入**：一条 `AuditLog`，`action = cockpit.post_daily_digest`、`targetType = organization`、`targetId = 组织 id`、操作人挂组织所有者（`AuditLog.userId` 必填），`afterData` 带本地日、时区、各行计数与是否截断。
  - 全部为 0 的行不写；整组织全部为 0 时不写这条审计。
  - 同一组织同一本地日幂等：按组织 + 日加 advisory lock，先查后写；重复触发不重复写。
  - 单个组织失败不影响其它组织与 daily-brief 本身；部分失败记部分成功，全部失败记失败。
- **岗位注册表 / 调度表**：`post-daily-digest` 归「运维与知识」岗位（`ops_knowledge`）；调度为组织时区本地 0 点与 1 点、唤醒 cron 同 daily-brief。
- **company.log 标签**：`cockpit.post_daily_digest` 显示为「岗位日结」，来源标为 `system`。
- **测试**：新增纯函数 + 假依赖测试 `src/lib/cockpit/__tests__/daily-digest.test.ts` 与隔离库端到端 `daily-digest-db.isolated.test.ts`，注册进 `scripts/test-all.sh`（前者同时进 `scripts/test-ci-unit.sh`）；岗位注册表、调度、时间线标签测试补断言。
- **报告与状态**：`docs/QINGYAN_ORG_COCKPIT_A-5_REPORT.md`；任务书 A-5 行 `[G]`；HANDOFF。

**与任务书的偏差（GATE 审核时请逐条确认）：**
1. **写 AuditLog，不写 MemoryClaim**（Lucas 2026-10-30 选推荐项）：Corporate Memory 的写入口径不变（任务书验收"`corporate-memory/access.ts` 的访问控制不变"随之自然满足）。
2. **时间：本地 00 点汇总前一天，而不是 23:30 汇总当天**：daily-brief 的唤醒 cron 是整点（`0 * * * *`），23 点跑会漏掉 23 点之后的结局（例如审批超时任务每 2 小时把过期审批落定），00 点汇总前一个完整的本地日。
3. **只用 A-4 的聚合，不含 A-2 时间线摘要**：时间线条目来自同一批记录（审批、AI 运行、审计），而且是带标签的逐条记录；日结只要计数，A-4 的列已经覆盖。平台级自动化运行（`AutomationRun` 不带组织）不进日结。
4. **操作人挂组织所有者**：`AuditLog.userId` 必填有外键；来源 `system` 由 company.log 标签规则标出，与审批被系统作废等系统审计同一做法。

## Capabilities

### New Capabilities
- `cockpit/post-daily-digest`：岗位日结的触发时刻、内容（只含计数）、写入位置与幂等、空日不写、不进企业记忆、失败隔离。

### Modified Capabilities
- `cockpit/post-registry`：「每个自动化恰好归属一个岗位」的当前数量场景 30 → 31（新增 `post-daily-digest` 归 `ops_knowledge`）。
- `cockpit/posts-overview`：「自动化调度表与线上调度一致」的当前数量场景 30 → 31。
- `cockpit/company-log-labels`：「条目来源」的系统写入审计加上岗位日结。

## Impact

- 新文件：`src/lib/cockpit/daily-digest.ts`、`src/lib/cockpit/__tests__/daily-digest.test.ts`、`src/lib/cockpit/__tests__/daily-digest-db.isolated.test.ts`。
- 改：`src/app/api/cron/daily-brief/route.ts`（多一组本地 0 / 1 点的组织与一次受跟踪运行，排在简报之后）、`src/lib/automation/registry.ts`（注册 `post-daily-digest`）、`src/lib/cockpit/posts.ts`、`src/lib/cockpit/schedule.ts`、`src/lib/cockpit/audit-labels.ts` 及其测试、`scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 数据库：零 schema；只写 `AuditLog`。`vercel.json` 不改。
- 不新增 LLM 调用、不出站、不发通知。

## Out of scope

- 写入 Corporate Memory（MemoryClaim）；LLM 摘要版（D-1）。
- 日结的阅读页面或接口（company.log 已能看到这条审计）；回填历史日结。
- 推送到微信 / Muse；触发任何动作；回写 settingsJson。

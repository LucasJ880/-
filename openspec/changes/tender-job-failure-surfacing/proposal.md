# Proposal：招标分析失败立刻告诉人（CHAIN-0c）

TASKFLOW：CHAIN-0c（Phase F（续）— 情报串联；任务书 `docs/QINGYAN_CHAIN_TENDER_INTEL_CHAIN_TASKBRIEF.md` 2026-11-19 13:05 修订版）。核对基线：main `a764c06`。判断点 8 按推荐 A（Lucas 2026-11-19「这个更新你全权负责……按照你推荐的去做」）。

## Why

2026-11-19「12-01 21C31-254242」的一键 AI 分析第 3 步失败后，项目页 1 小时 40 分钟一直显示「分析中」、没有任何通知，AI 任务详情的「需要人工处理」框里也没有原因：项目上的分析记录只在第 9 步「终态化」或人手动重新发起 / 取消时才会改状态，Job 自己失败或卡住时没有任何地方去改它，于是既有的失败通知也从不触发。

## What Changes

- 招投标域的 AI 分析 Job 在处理器里**确实写成**「失败」或「需要人工处理」（含租约超时且重试耗尽的清扫）之后，把项目上对应的分析记录收尾为「AI 分析未完成」，原因写「卡在第 N 步〈步骤名〉：〈原因〉」。
- 收尾即触发既有的失败通知（站内通知给项目负责人与发起人，同一分析只一次）；通知内容带上卡在哪一步。
- 每个 Job 只收尾一次，写一条审计 `tender.workforce.failed_surfaced`。收尾出错不影响 Job 自己的状态写入。非招投标 Job 不受影响。
- 原因只用确定性的中文说法：步骤名 + 由错误码查表得到的原因（招投标工具已知的失败标记再细分，如「模型调用全部失败」）；不把原始错误文本、英文堆栈印给用户。
- AI 任务详情页：「需要人工处理」框在没有结构化说明时显示「卡在第 N 步〈步骤名〉：〈原因〉」；失败的 Job 多一张「任务未能完成」卡显示同样的原因；什么都没有时写「系统未记录原因」，不留空白。
- 项目页「AI 数字员工 · 投标分析」卡片：分析未完成时显示原因，按钮仍是既有的「重新分析」。

不加开关：修「失败不提示」不应该能关掉。

## 受影响的 Muse 意图

不改 `src/lib/muse-bridge/**`。`status` 意图读到的分析状态会从「分析中」及时变成「AI 分析未完成」（文案沿用既有的状态显示表）；其余意图不涉及。

## Out of scope

- 查明并修复 2026-11-19 第 3 步失败本身的原因（要生产日志；若是模型侧另立 change）。
- 「AI 分析暂停、可原地恢复」的新状态（判断点 8 的 B）。
- legacy 自动分析队列（`/api/cron/tender-auto-analysis`）的失败提示：它已有自己的失败通知（2026-08-15 那次之后加的），不在本次。
- 手动恢复（`resume.ts`）路径里的失败写入：只会发生在 Job 已停在「需要人工处理」之后，那时本次已经收尾过。
- 新的通知类型、邮件补位、新的事件类型、schema、定时任务、队列、模型调用。

## Capabilities

### New Capabilities

- `tender/analysis-failure-surfacing`：招投标 AI 分析 Job 失败 / 卡住时，项目上的分析记录、失败通知、AI 任务详情与项目卡片上的原因显示。

### Modified Capabilities

<!-- 无：既有主规格里没有规定 Job 失败时分析记录怎样变化 -->

## Impact

- 新增：`src/lib/tender-workforce/job-failure-surfacing.ts`（纯函数：原因拼装与错误码表；服务：收尾）、`src/lib/workforce-runtime/domain-hooks.ts`（按 `workDomain` 动态加载域收尾，避免静态反向依赖）。
- 修改：`src/lib/workforce-runtime/processor.ts`（slice 结果为失败 / 需要人工处理且未丢租约时、清扫写失败后调用钩子）；`src/lib/tender-auto-analysis/alerts.ts`（失败原因表补 Job 错误码，摘要带「卡在第 N 步」）；`src/lib/workforce-runtime/read-model/`（步骤快照带错误码；详情视图多「停在哪一步」）；`src/app/(main)/workforce/[id]/page.tsx`；`src/lib/tender-workforce/trigger-service.ts`（项目卡片接口带原因）；`src/components/tender-analysis/agent-card.tsx`。
- 测试：新增纯函数测试与隔离库端到端；读模型与项目卡片相关测试补用例。
- 不动：`prisma/schema.prisma`、`vercel.json`、`src/lib/agent-runtime/**`（事件类型不加）、`src/lib/muse-bridge/**`、`src/lib/tender-workforce/analysis-run-service.ts` 的既有函数（只调用）。

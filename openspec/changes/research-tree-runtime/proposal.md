# Proposal：调研树的骨架（TREE-2）

TASKFLOW：TREE-2（Phase F（续）— 情报调研树）。任务书 `docs/QINGYAN_TREE_RESEARCH_TREE_TASKBRIEF.md`「TREE-2」一节（Evan 2026-11-22 拍板第 2、5、9 项）。不触碰 muse-bridge，无受影响的 Muse 意图（只复用 `muse-bridge/contract.ts` 的出站敏感词判断函数，不改它）。

## Why

TREE-1 只给了「读一页」的能力，还没有任何东西会去用它：现在没有「主干派活、分支去查、汇总回树干」的任务，也没有把每次搜索、读页、模型请求都扣在额度里的循环。本 change 搭出这棵树的骨架，后面的子代理（TREE-3）、交叉验证（TREE-4）、页面（TREE-5）才有地方挂。

## What Changes

- 新增人发起接口 `POST /api/projects/[id]/research-tree`（照 FIX-21 的写法：第一步、不带条件地调用项目写权限守卫）：开关关时返回 404、不建 Job；只收招投标项目；同一项目已有没结束的调研 Job 时复用它，不另起。
- 新增调研 Job 的建法：独立的 Job，`workDomain` 为 tender，带平铺的调研标记（`researchTree`、`researchTreeVersion`、`researchTrigger`）与 `researchProjectId`，**不设** `metadata.projectId`——一键招标分析的卡片、复用、取消与失败收尾都认不出它，它失败不会把项目标成「AI 分析未完成」。只有这一个发起服务写调研标记（守卫测试）。
- 新增服务端写死的六步图（每步显式 `workerKey: "tender_worker"`，模型不参与编图）：第一波 ① 条款、② 往期同标、③ 同类项目（限量）；第二波两步按「分叉规则」确定性地决定做不做（② 没查到 → ③ 全量；③ 不足 3 条 → 放宽到数量不限、近 6 年、加上美国）；最后一步是树干汇总。
- 新增分支工具 `tender_research_branch`：一个有上限的循环——模型提出下一步（搜索 / 读页 / 结束）与针对上一页的事实，代码执行并扣减额度（每支搜索 16、读页 12、模型请求 30；常量，组织设置只能调低），直到结束或额度用完；读页被挡时不结束，换来源接着查，同一站这一支不再读。每次模型请求、搜索与读页都受这一片的截止时间约束，快到截止就让出、下一片接着做。
- 强制安全：网页与搜索摘要只作为不可信资料交给模型，模型只能选三种动作；读页只许读本支搜索结果里的网址；搜索词与网址带敏感词、或带本项目的估值 / 我方报价 / 中标价数字一律不发；事实只收「摘录逐字出现在本支读到的页面里、值里的数字都在摘录里」的。
- 新增交接单 `research-handoff/v1`（放在现有交接信封的业务输出里）：`found[]`、`notFound[]`（没有 / 未接通 / 被挡 / 到上限）、`suggestedBranches[]`、`usage`；一支失败、被挡或到上限都照常交单，不影响别的支与树干。
- 新增树干工具 `tender_research_trunk`：确定性汇总，把每支的状态、条数、未查到的原因、用量、「待反查」的中标方名与「未追的线索」写进情报室 `summaryJson.researchTree`（只放摘要，不放金额与摘录）。
- 登记两个工具进 `tender-workforce/tools.ts` 的执行集合（不进全局目录、不进 LLM 规划面与一键分析的确定性面）。
- 加续跑：每一轮先记一条审计（`research.branch_step`）再发请求，续跑时从审计恢复已用额度与本支可读网址；靠运行时租约保证同一 Job 同一时间只有一处在处理（测试）。

## Out of scope

- 三个子代理的专门做法（条款员的关键词规则与一次模型调用、往期同标员的联邦合同数据、单价与可比度）——TREE-3。本 change 里条款一支只交「未接通」，另两支用同一个通用循环与通用目标。
- 交叉验证与核对员（TREE-4）；证据表、报价区间、页面与卡片、读取接口、「重新查」（TREE-5）；补页（TREE-6）；资料申请与澄清问题（TREE-7、TREE-8）。
- 「确认招标要求时自动起一次」（判断点 2）：要动确认入口，放到 TREE-5 与卡片一起做；本 change 的发起服务已接受这个发起方式。
- 不读本支搜索结果以外的网址（不跟页面里的链接，TREE-1 只返回纯文本）。
- 不改数据库结构、不改任务运行时（`src/lib/workforce-runtime/**`、`src/lib/agent-runtime-v2/**`、`src/lib/agent-runtime/**`）、不改 `vercel.json`、不改 `tender-workforce/job-failure-surfacing.ts` 与 `trigger-service.ts`、不改一键分析的 9 节点图。
- 不发任何对外邮件、不建待批卡、不改报价、不写供应商库、不写授标权威记录。

## Capabilities

### New Capabilities

- `tender/research-tree`：情报调研树——谁能起、Job 长什么样、图怎么分叉、一支怎么查与怎么停、交回什么、树干汇总什么、什么时候什么都不做。

### Modified Capabilities

无。

## Impact

- 新增：`src/lib/tender-research-tree/**`（发起服务、图、分支循环、树干、分叉规则与额度纯函数、审计游标、依赖注入）、`src/app/api/projects/[id]/research-tree/route.ts`，及测试（注册进 `scripts/test-all.sh`，纯函数测试另进 `scripts/test-ci-unit.sh`）。
- 修改：`src/lib/tender-workforce/tools.ts`（只加两个工具名、两个描述、两个处理函数的引用）；写死「9 个工具」的四份既有测试改成「原来 9 个分析工具不变 + 两个调研工具」；`t5-seg2-v2-spine.test.ts` 的 `runFence` 使用点名单加一项；`src/lib/web-reader/index.ts` 加一个网址归一函数的导出。
- 文档：`docs/QINGYAN_TREE-2_REPORT.md`、`docs/QINGYAN_TREE_HANDOFF.md`、`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 状态列。
- 零 schema、零依赖、零出站发送；新增模型调用只在分支循环里（硬纪律第 7 条例外二已登记的每支 30 次）。

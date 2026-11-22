# Proposal：招标一键分析失败后，从失败的这一步继续（FIX-20b）

TASKFLOW：FIX-20b（FIX-20 拆出的后半，2026-11-22）。依赖 FIX-20 `tender-job-synthesis-degrade`：「关键步骤」的定义要排除已经会降级的综合汇总，失败原因也取自 FIX-20 的写法。本 change 必须在 FIX-20 之后合并。

受影响的 Muse 意图：无。不改 `src/lib/muse-bridge/**`；继续后第 9 步终态化成功时，照既有规则发 `analysis.ready`，内容不变。

## Why

一键分析的关键步骤失败后，现在只能点「重新分析」：新建 Job 和新的分析记录，从第 1 步重跑（`src/lib/tender-workforce/trigger-service.ts:160-168`、`analysis-run-service.ts:57-59,180-186`），已经跑完的第 3 步（生产实测 13 分钟）连同它的检查点一起作废。手动恢复的唯一入口也不接受这种停下：Job 失败算终态，需要人工处理也只放行身份失效类（`src/lib/workforce-runtime/resume.ts:112-126,163-175`）。

## What Changes

- **新增「可继续」的确定性判定。** 同时满足以下条件才可继续：
  - 是本项目最新一个、由确定性计划执行的招投标 Job；
  - 状态为「需要人工处理」或「失败」，且停下的错误码属于执行类；
  - 有失败的步骤，而且每一个失败步骤的原因都属于执行失败。这些步骤是关键步骤（综合汇总以外的每一步），或者是 FIX-20 之前就停在综合汇总上的旧 Job 的那一步；
  - 没有执行中或等待审批的步骤；
  - 分析记录为「AI 分析未完成」，且不是用户取消；
  - 投标文件包的指纹与这次分析开始时相同；
  - 继续之后剩余的执行次数，至少够每个未完成步骤跑一次。
- **新增「从失败的这一步继续」动作。** 在一个事务里做三件事，每一项都用条件更新，任一项没命中就整体回滚：
  - 失败的步骤改回「待开始」，尝试次数清零，清掉错误；
  - Job 改回排队（尝试次数 0、立即可认领、清掉错误），并在 Job 元数据里把「继续次数」加 1；
  - 分析记录改回「AI 数字员工分析中」，清掉错误与失败时间。

  提交后写一条用户可见的 `job.resumed` 事件（触发来源为「从失败的这一步继续」），并写一条审计 `tender.workforce.continued`。已完成步骤的产出与第 3 步的检查点原样复用。
- **新增接口 action `continue`**（`POST /api/projects/[id]/tender-analysis/agent`，带 `jobId`），权限与「重新分析」相同（项目写权限）。不可继续时返回 409 和一句中文原因。
- **返回 `continuable`（项目卡片接口 `GET`）。** 可继续时，「AI 数字员工 · 投标分析」卡片在「重新分析」左边显示主按钮「从失败的这一步继续」。
- **改为按「轮」收尾与通知。** 收尾与失败通知改为每一轮只做一次：一轮是从发起、或从一次「继续」开始，到停下为止。失败通知的去重键带上继续次数，继续之后再停下会收到新的一条。停下时若可继续，通知末句写「可在项目里点「从失败的这一步继续」，或重新发起分析。」
- **新增测试，注册进 `scripts/test-all.sh`。**
  - 纯函数测试 `src/lib/tender-workforce/__tests__/continue-eligibility.test.ts`，同时进 `scripts/test-ci-unit.sh`。
  - 隔离库测试 `src/lib/tender-workforce/__tests__/continue-from-failed-db.isolated.test.ts`。

## Capabilities

### New Capabilities

- `tender/analysis-continue-from-failed`：招投标一键分析失败后什么时候可以继续、继续做什么、入口与权限、卡片与通知怎样提示。

### Modified Capabilities

- `tender/analysis-failure-surfacing`：「只对招投标 Job、每个 Job 只收尾一次」改为每一轮只收尾一次。

## Impact

- 代码：
  - `src/lib/tender-workforce/trigger-service.ts`：新增可继续判定与继续动作，状态投影加 `continuable`。
  - `src/app/api/projects/[id]/tender-analysis/agent/route.ts`：新 action。
  - `src/components/tender-analysis/agent-card.tsx`：按钮。
  - `src/lib/tender-workforce/job-failure-surfacing.ts`、`analysis-run-service.ts`：按轮收尾，把继续次数与可继续传给通知。
  - `src/lib/tender-auto-analysis/alerts.ts`：失败通知的去重键与末句，只改失败通知那几个函数（`:34-128`），不碰完成通知。
- 测试：新增上面两个文件；扩 `job-failure-surfacing-db.isolated.test.ts`（每轮一次）、`job-failure-surfacing.test.ts`（卡片源码断言）。
- 合并顺序：FIX-20 → FIX-18（招标分析只留一个入口，也改这张卡片与这个接口）→ 本 change。
- 无 schema、无开关、无新队列、无新模型调用。合并即生效。

## Out of scope

- 作业页（`/workforce/[id]`）上的「继续」按钮：作业接口是只读的（`src/app/api/workforce/jobs/[id]/route.ts:13-18`），本次只在项目卡片提供入口。
- 由模型规划出计划的招投标 Job（旧的兼容路径）、非招投标 Job：不提供继续。
- 契约损坏类的失败（交接数据缺失或损坏、任务说明损坏、执行策略缺失、权限被拒）：不提供继续，只能「重新分析」或走既有的身份恢复。
- 继续时换用新上传的文件：文件包变了就不可继续，只能重新分析。
- 改 `resumeWorkforceJob`（审批恢复与身份恢复的单一入口）的状态规则：不改。
- 继续后立即推进一个时间片：不做，等下一次定时触发（≤ 2 分钟），与「开始 AI 分析」相同。
- 不另写补救脚本处理 2026-11-22「12-3」这个 Job。它停在第 8 步综合汇总，错误码属于执行失败，所以 FIX-20 与本 change 都上线后，卡片上会出现「从失败的这一步继续」：先充值再点，第 8 步就会重跑；没充值也会按 FIX-20 降级。

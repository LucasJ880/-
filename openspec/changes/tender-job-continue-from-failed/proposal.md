# Proposal：招标一键分析失败后，从失败的这一步继续（FIX-20b）

TASKFLOW：FIX-20b（FIX-20 拆出的后半，2026-11-22）。依赖 FIX-20 `tender-job-synthesis-degrade`：「关键步骤」的定义要排除已经会降级的综合汇总，执行失败码集合与失败原因也取自 FIX-20。依赖 FIX-18 `tender-analysis-single-entry`：发起权限判定（`canStart`）与项目级互斥锁沿用它的。本 change 排在 FIX-20、FIX-18 之后合并。

受影响的 Muse 意图：无。不改 `src/lib/muse-bridge/**`；继续后第 9 步终态化成功时，照既有规则发 `analysis.ready`，内容不变。

## Why

一键分析的关键步骤失败后，现在只能点「重新分析」：新建 Job 和新的分析记录，从第 1 步重跑（`src/lib/tender-workforce/trigger-service.ts:160-168`、`analysis-run-service.ts:57-59,180-186`），已经跑完的第 3 步（生产实测 13 分钟）连同它的检查点一起作废。手动恢复的唯一入口也不接受这种停下：Job 失败算终态，需要人工处理也只放行身份失效类（`src/lib/workforce-runtime/resume.ts:112-126,163-175`）。

## What Changes

- 新增「可继续」的确定性判定，八条同时满足才可继续：
  - 是本项目最新一个、由服务端确定性计划执行的招投标 Job；
  - 状态为「需要人工处理」，停下的错误码是依赖无法推进或结果没有通过校验；
  - 至少有一个失败步骤，而且每个失败步骤的错误码都属于执行失败；
  - 没有执行中或等待审批的步骤；
  - 分析记录为「AI 分析未完成」，且不是用户取消；
  - 投标文件包的指纹与这次分析开始时相同；
  - 这个 Job 已继续的次数少于 2 次（按审计记录的条数数出）；
  - 失败步骤清零后，剩余的执行次数够每个未完成步骤跑一次。
- 新增「从失败的这一步继续」动作：失败步骤改回未执行、尝试次数清零；Job 改回排队；分析记录改回「AI 数字员工分析中」；写一条用户可见的恢复事件与一条审计 `tender.workforce.continued`。几项要么全部生效，要么都不生效，已完成步骤的产出与第 3 步的检查点原样复用。
- 让继续与「开始 / 重新分析」、旧管线发起互斥：拿同一把项目锁，锁内再确认它仍是最新一次、项目里没有别的分析在跑。
- 新增接口 action `continue`（`POST /api/projects/[id]/tender-analysis/agent`，带 `jobId`）：要求项目写权限，并且当前用户能用卡片发起（组织开关与用户级开关都过，同 FIX-18 的 `canStart`）。
- 给不可继续的请求返回 409 和九句固定中文原因之一；一键分析开关或用户级开关没过时返回 403，原因与「开始 AI 分析」相同。
- 在项目卡片接口 `GET` 返回 `continuable`，只对能用卡片发起的人为 true。
- 在项目卡片上可继续时显示主按钮「从失败的这一步继续」，「重新分析」降为次按钮。
- 让继续之后跑完的那次分析也触发卡片的「分析结束」回调，下方审阅面板随之刷新。
- 把收尾与失败通知改为每一轮只做一次：一轮从发起、或从一次继续开始，到停下为止；第 n 轮通知的去重键带上轮次。
- 在停下时可继续的失败通知末句写「可在项目里点「从失败的这一步继续」，或重新发起分析。」。
- 新增纯函数测试 `src/lib/tender-workforce/__tests__/continue-eligibility.test.ts`，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- 新增隔离库测试 `src/lib/tender-workforce/__tests__/continue-from-failed-db.isolated.test.ts`，注册进 `scripts/test-all.sh`。

## Capabilities

### New Capabilities

- `tender/analysis-continue-from-failed`：招投标一键分析失败后什么时候可以继续、继续做什么、与其它发起入口怎样互斥、入口与权限、卡片与通知怎样提示。

### Modified Capabilities

- `tender/analysis-failure-surfacing`：「只对招投标 Job、每个 Job 只收尾一次」改为每一轮只收尾一次；「项目卡片显示原因」加上可继续时的主按钮（在 FIX-18 改过的版本上改）。

## Impact

- 代码：
  - `src/lib/workforce-runtime/resume.ts`：新增一个独立导出函数，在一个事务里做 Job 与失败步骤的条件重置、写恢复事件，并在同一事务里调用调用方给的域回调；`resumeWorkforceJob` 的状态规则与冻结测试不动。这个文件已是运行时基线登记的 Job / 步骤写入方，不改基线，见 design D2、D3。
  - 新增 `src/lib/tender-workforce/continue-eligibility.ts`：可继续判定的纯函数。
  - `src/lib/tender-workforce/trigger-service.ts`：读取判定所需的数据、项目锁与锁内复查、分析记录改回分析中与审计（经域回调）、状态投影加 `continuable`。
  - `src/app/api/projects/[id]/tender-analysis/agent/route.ts`：新 action。
  - 项目卡片：`src/components/tender-analysis/agent-card.tsx` 与 FIX-18 抽出的 `src/lib/tender-workforce/agent-card-view.ts`。
  - `src/lib/tender-workforce/job-failure-surfacing.ts`、`analysis-run-service.ts`：按轮收尾，把轮次与可继续传给通知。
  - `src/lib/tender-auto-analysis/alerts.ts`：只改失败通知那几个函数（`:34-128`），不碰完成通知。
- 测试：新增上面两个文件；扩 `job-failure-surfacing-db.isolated.test.ts`（每轮一次）、`job-failure-surfacing.test.ts`（卡片断言，FIX-18 之后对它的纯函数做用例）。
- 合并顺序：FIX-20 → FIX-18 → 本 change。
- 无 schema、无开关、无新队列、无新模型调用；不改运行时架构基线。合并即生效。

## Out of scope

- 作业页（`/workforce/[id]`）上的「继续」按钮：作业接口是只读的（`src/app/api/workforce/jobs/[id]/route.ts:13-18`），本次只在项目卡片提供入口。
- 「失败」状态的 Job（处理器重试耗尽、租约超时清扫）不提供继续，理由见 design D1 与 G1。
- 由模型规划出计划的招投标 Job（旧的兼容路径）、非招投标 Job：不提供继续。
- 契约损坏类的失败（交接数据缺失或损坏、任务说明损坏、执行策略缺失、权限被拒）：不提供继续，只能「重新分析」或走既有的身份恢复。
- 继续时换用新上传的文件：文件包变了就不可继续，只能重新分析。
- 改 `resumeWorkforceJob`（审批恢复与身份恢复的单一入口）的状态规则：不改。
- 继续后立即推进一个时间片：不做，等下一次定时触发（≤ 2 分钟），与「开始 AI 分析」相同。
- 不另写补救脚本处理 2026-11-22「12-3」这个 Job。它停在第 8 步综合汇总、Job 为需要人工处理，FIX-20 与本 change 都上线后、文件包没变时，卡片上会出现「从失败的这一步继续」：先充值再点，第 8 步就会重跑；没充值也会按 FIX-20 降级。

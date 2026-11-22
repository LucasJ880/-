# Proposal：招标分析只留一个入口（FIX-18）

TASKFLOW：FIX-18
来源：Evan 2026-11-22 定。起因是 2026-11-22 16:27 生产上对同一文件包并行跑了两单（是哪两个入口的组合目前只是推断，核实方法写进报告，见 tasks 8）。

## Why

「招标要求」页签上同时有卡片的「重新分析」（一键分析）和分析面板的「重新分析当前投标文件包」（旧的自动分析），两条流程互不检查对方，上传后的自动入队又是第三个入口，2026-11-22 16:27 生产上同一文件包因此并行跑了两单。卡片的「重新分析」没有底色和边框（样式引用的 `primary` 颜色没定义），点下去到新任务出现之间卡片还显示「上次 AI 分析已取消」。

## 需求原文（Evan 2026-11-22）

1. 组织开了一键分析时，界面只留卡片上的一个按钮；旧按钮不显示。
2. 上传后的自动分析与这个按钮走同一条流程，或者在开了一键分析的组织里不自动发起——两种做法在 design 里比较后给推荐，Evan 定。
3. 服务端加互斥兜底：同一项目已有一单在跑时，另一条入口不再新建，返回一句白话说明。
4. 按钮点下去到新任务出现之间，卡片显示「正在启动」，不显示「上次 AI 分析已取消」。（并入同义的体验问题：点「重新分析」后，旧任务已取消、新任务未出现的这段时间，卡片显示「上次 AI 分析已取消」，没有「正在启动」的提示。）
5. 卡片上的「重新分析」没有底色和边框（样式引用的 primary 颜色没定义），一并修成正常按钮。

没开一键分析的组织行为不变。

## What Changes

- 隐藏分析面板的「重新分析当前投标文件包」和空态的「分析投标文件」：条件是组织开了一键分析，并且当前用户能用卡片发起，也就是组织开关和用户级开关都过（这条理解留给 GATE 第 2 条确认）。卡片接口还没返回时两个按钮都不显示；接口失败时按「不能用卡片发起」处理，照常显示。
- 改空态说明：旧按钮隐藏时，「暂无分析记录。可对当前项目已上传的投标 PDF 包发起分析（无需重新上传）。」换成「暂无分析记录。请在上方「AI 数字员工 · 投标分析」卡片上发起分析。」
- 收起卡片对过不了用户级开关的人显示的发起按钮：组织开了一键分析、但当前用户过不了用户级开关时，卡片照常显示状态，不显示「开始 AI 分析 / 重新分析」，改写一行「你的账号还没开通 AI 数字员工分析，请用本页下方的分析按钮」。这时面板的旧按钮照常显示。
- 扩充卡片接口 `GET …/tender-analysis/agent`，多返回三项：
  - `canStart`：当前用户能不能用卡片发起；
  - `starting`：这个项目是否有一单正在启动；
  - `packageHint`：文件提示，取值为文件已就绪，或「有 N 个能读的文件还没纳入上次分析」。
- 让两条流程在发起时拿同一把事务级锁，各自先查对方：
  - 一键分析发起（开始 / 重新分析）时，如果旧的自动分析有一单在跑，就返回 409、码 `ACTIVE_JOB_EXISTS` 和一句白话；旧管线那一单、本项目已有的一键分析作业都不动。
  - 旧的自动分析发起时，如果一键分析有一单在跑（包括等人处理的），就返回 409、码 `ACTIVE_RUN_EXISTS` 和一句白话，不新建记录。旧管线的发起包括：重新分析当前投标文件包、分析投标文件、上传后自动入队、单条记录的重新分析接口。
- 停掉旧管线失败后的自动重试：一键分析发起时，旧的自动分析里「已失败、但定时任务还会重试」的那一单先标为已被替代，再新建一键分析（留给 GATE 第 4 条确认）。
- 取消开了一键分析的组织里的自动发起：上传后、文件处理完后，都不再自动发起任何分析（做法 B，留给 GATE 第 1 条定）。同时删掉「自动入队改派一键分析」那段代码和每项目固定的 requestId。上传时照常写文件的内容指纹。
- 在卡片上显示「正在启动…」：从点下去到新任务出现之间都显示，按钮同时变成不可点的「正在启动…」。自己点的，按请求是否还在路上判断；别人点的，按接口的 `starting` 判断。
- 在「取消已提交、新单没建成」时，让卡片重新读取并显示「上一单已取消，新的分析没能启动」和接口给的失败原因。
- 抽出一个纯函数，统一算卡片的状态文案、提示、按钮，以及面板旧按钮是否显示；卡片、面板和测试都用它。
- 改卡片按钮样式：「开始 AI 分析 / 重新分析」改成和「向业主提问」一样的主按钮（主题色底、对比色字、悬停加深）；「取消」改成有边框的次按钮。卡片里没定义的 `text-muted-foreground`，以及会变成深灰底的 `hover:bg-muted`，都换成主题里已定义的颜色。
- 把单条记录重新分析接口 `POST …/tender-analysis/runs/:runId/reanalyze` 遇到「已有一单在进行」时的状态码从 400 改成 409（留给 GATE 第 3 条）。
- 新增测试：
  - 纯逻辑和接线测试 `src/lib/tender-workforce/__tests__/single-entry.test.ts`，进 CI 子集；
  - 隔离库测试 `src/lib/tender-workforce/__tests__/single-entry-db.isolated.test.ts`，覆盖两条入口并发、锁被占时接口报告正在启动、没开一键分析的组织行为不变；
  - 改写 `obs-p2p3-single-pipeline.test.ts` 里的 P3-01、P3-02、P3-05；
  - `enqueue-outcome.test.ts` 补两条原因码；
  - `job-failure-surfacing.test.ts` 里卡片相关的三条断言改为读纯函数。

## Capabilities

### New Capabilities

- `tender/analysis-single-entry`：项目页招标分析的发起入口有哪几个、谁看得到；两条分析流程之间的互斥；开了一键分析的组织上传后不自动发起；卡片「正在启动」与启动失败时的显示；卡片按钮样式。

### Modified Capabilities

- `tender/analysis-failure-surfacing`：「项目卡片显示原因」一条里的「按钮 SHALL 仍为「重新分析」」，改为只对能用卡片发起的人成立。

## Impact

- 服务端：
  - `src/lib/tender-workforce/trigger-service.ts`（发起时查旧管线、停旧管线的重试、卡片接口多返回三项）；
  - 新增 `src/lib/tender-workforce/single-entry.ts`（锁、「在跑」的判定、能不能发起、文案）；
  - `src/lib/tender-auto-analysis/enqueue-package.ts`（旧管线两个发起函数查一键分析；自动入队按做法 B 改）；
  - `src/lib/tender-auto-analysis/enqueue.ts`（上传逐文件入队按做法 B 改）；
  - `src/lib/tender-auto-analysis/enqueue-outcome.ts`（两条原因码）；
  - `src/app/api/projects/[id]/tender-analysis/agent/route.ts`（GET 把当前用户传给状态函数）；
  - `src/app/api/projects/[id]/tender-analysis/runs/[runId]/reanalyze/route.ts`（409）。
- 前端：
  - 新增 `src/lib/tender-workforce/agent-card-view.ts`（纯函数，客户端可用）；
  - `src/components/tender-analysis/agent-card.tsx`；
  - `src/components/tender-analysis/analysis-panel.tsx`（行号按 FIX-13 #546 合并后的样子：卡片挂载 424、475 行，「分析投标文件」441–448 行，「重新分析当前投标文件包」558–567 行）。
- 测试与注册：`scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 依赖：要等 FIX-13 先合并。卡片的「还没纳入」提示复用 FIX-13 `src/lib/tender-auto-analysis/exclusion-text.ts` 里的同一句话。
- 不涉及 schema、新队列、新模型调用、新开关、`vercel.json`。

## 受影响的 Muse 意图

无。不改 `src/lib/muse-bridge/**`，Muse 通道没有发起招标分析的意图。

## Out of scope

- 旧的自动分析管线本身：`src/lib/tender-auto-analysis/worker.ts`、`/api/cron/tender-auto-analysis`、`/api/cron/agent-runs` 都不退役、不改。
- 没开一键分析的组织：界面、上传后自动入队、旧按钮都不变。例外只有两条：
  - 单条记录重新分析接口的 400 改 409（GATE 第 3 条）；
  - 一键分析作业还在跑、组织开关中途被关掉时，旧入口会被挡住（以前只有上传后自动入队会被挡）。
- 卡片发起按钮对没有项目写权限的人照旧显示，点了 403。旧按钮今天同样如此，不改。
- 卡片在「需要你处理」时没有「取消」按钮（`agent-card.tsx:222`，只在排队、分析中显示），不改。
- FIX-20 计划在卡片上加的「从失败的这一步继续」不在本次。
- 一键分析完成后不替换更早的待审结果，多份待审记录并存，面板只显示最新一份：不改。
- 旧管线重新分析会把所有来源的待审结果标为已被替代（`enqueue-package.ts:487-500`），保留这个行为，理由见 design D8。
- 「下一步」卡片的「去重新分析」（`src/lib/tender-next-step/web-next-step.ts:261`）只指到页面位置，不改。
- 进度条 `src/components/tender-analysis/analysis-progress-banner.tsx` 只读旧管线记录，不改。
- 全站另有 24 个文件引用了没定义的 `bg-primary`：本次只改卡片，其余另开任务。
- 启动失败原因里带内部码（`trigger-service.ts:219` 的「启动失败：<内部码>」）：不改。
- 16:27 那两单到底是哪两个入口：本次不下结论，报告里写核实方法。
- 数据迁移：不做。已经并存的两单不回头处理。

# Proposal：招标分析只留一个入口（FIX-18）

TASKFLOW：FIX-18
来源：Evan 2026-11-22 定。起因是 2026-11-22 16:27 生产上对同一文件包并行跑了两单（是哪两个入口的组合目前只是推断，核实方法写进报告，见 tasks 5.2）。

## Why

「招标要求」页签上卡片的「重新分析」（一键分析）、分析面板的「重新分析当前投标文件包」（旧的自动分析）和上传后的自动入队是三个互不检查对方的入口，2026-11-22 16:27 生产上同一文件包因此并行跑了两单。卡片的「重新分析」没有底色和边框，点下去到新任务出现之间卡片还显示「上次 AI 分析已取消」。

## 需求原文（Evan 2026-11-22）

> 1. 组织开了一键分析时，界面只留卡片上的一个按钮；旧按钮不显示。2. 上传后的自动分析与这个按钮走同一条流程，或者在开了一键分析的组织里不自动发起——两种做法你在 design 里比较后给推荐，我来定。3. 服务端加互斥兜底：同一项目已有一单在跑时，另一条入口不再新建，返回一句白话说明。4. 按钮点下去到新任务出现之间，卡片显示「正在启动」，不显示「上次 AI 分析已取消」。5. 卡片上的「重新分析」现在没有底色和边框（样式引用的 primary 颜色没定义），一并修成正常按钮。没开一键分析的组织行为不变。

并入的同义问题：点「重新分析」后，旧任务已取消、新任务未出现的这段时间，卡片显示「上次 AI 分析已取消」，没有「正在启动」的提示。归入第 4 条。

## What Changes

- 隐藏分析面板的「重新分析当前投标文件包」和空态的「分析投标文件」：条件是组织开了一键分析，并且当前用户能用卡片发起（组织开关和用户级开关都过，GATE 第 2 条）。
- 让分析记录列表接口 `GET …/tender-analysis/runs?latest=1` 多带一个 `agentCardEnabled`（只看组织开关）：没开一键分析的组织，面板拿到自己的数据就照常显示旧按钮，不等卡片（GATE 第 6 条）。
- 让开了一键分析的组织里，面板在卡片回报之前不显示旧按钮，空态只写「暂无分析记录。」；卡片接口失败时按「不能用卡片发起」处理、照常显示旧按钮（GATE 第 5 条）。
- 改空态说明：能用卡片发起的人看到「暂无分析记录。请在上方「AI 数字员工 · 投标分析」卡片上发起分析。」。
- 收起卡片对过不了用户级开关的人显示的发起按钮，改写一行「你的账号还没开通 AI 数字员工分析，请用本页下方的分析按钮」；这些人照常看到面板的旧按钮。
- 扩充卡片接口 `GET …/tender-analysis/agent`，多返回 `canStart`、`starting`、`packageHint` 三项：
  - 没开一键分析的组织直接返回 `false` / `false` / `null`，不多查任何东西；
  - 三项各自容错，算不出来时取 `false` / `false` / `null`，接口其余部分照常返回。
- 让一键分析的发起在动任何记录之前先判「能不能用卡片发起」：过不了的人调发起或重新分析接口时直接 403，不再先取消正在跑的单。
- 让两条流程的所有发起都拿同一把事务级锁，各自在锁内查对方：
  - 一键分析发起（开始 / 重新分析）时，旧的自动分析有一单在跑，返回 409、码 `ACTIVE_JOB_EXISTS` 和一句白话；
  - 旧的自动分析发起时，一键分析有一单在跑，返回 409 和一句白话：`…/package` 接口码 `ACTIVE_RUN_EXISTS`，单条记录重新分析接口码 `active_run`，自动入队以原因 `workforce_active` 结束；
  - 组织关了一键分析时，等人处理、等审批的一键分析作业不算在跑；「AI 数字员工分析中」的领域记录只有它的作业还在跑时才算。
- 给所有拿这把锁的事务定死等锁上限 10 秒、事务上限 20 秒、取连接上限 5 秒；等锁超时返回 409「这个项目正有一单分析在启动，过几秒再看。」，不再报 500。
- 停掉旧管线失败后的自动重试：一键分析发起时，旧的自动分析里「已失败、定时任务还会重试」的那一单先标为已被替代，再新建一键分析（GATE 第 4 条）。
- 取消开了一键分析的组织里的自动发起：上传后、文件处理完后都不再自动发起任何分析（做法 B，GATE 第 1 条），删掉「自动入队改派一键分析」那段代码和每项目固定的 requestId；上传时照常写文件的内容指纹。
- 显示「正在启动…」：从点下去到新任务出现之间，卡片的状态行和按钮都是「正在启动…」（按钮不可点）；别人点的，按接口的 `starting` 判断。
- 让卡片在「取消已提交、新单没建成」时重新读取，显示「上一单已取消，新的分析没能启动」和接口给的失败原因。
- 把「有 N 个能读的文件还没纳入这次分析，重新分析后会一起纳入。」挪到卡片上：能用卡片发起的人在卡片上看到这句，面板不再重复；其他人照旧在面板上看到。
- 抽出卡片与面板入口的显示纯函数：卡片的状态文案、提示、按钮，面板旧按钮、空态说明、「还没纳入」那句是否显示，都由它算；FIX-20 先合并时加到卡片上的重试句、受阻句、「综合汇总未生成」那句一并搬进来。
- 改卡片按钮样式：「开始 AI 分析 / 重新分析 / 正在启动…」改成和「向业主提问」一样的主按钮，「取消」改成有边框的次按钮；卡片里只用主题里定义过的颜色。
- 把单条记录重新分析接口 `POST …/runs/:runId/reanalyze` 遇到「已有一单在进行」时的状态码从 400 改成 409，码值仍是 `active_run`（GATE 第 3 条）。
- 新增测试并改写既有测试：
  - 纯逻辑与接线测试 `src/lib/tender-workforce/__tests__/single-entry.test.ts`，进 CI 子集；
  - 隔离库测试 `src/lib/tender-workforce/__tests__/single-entry-db.isolated.test.ts`；
  - 改写 `obs-p2p3-single-pipeline.test.ts` 的 P3-01 到 P3-05；`enqueue-outcome.test.ts` 补三条原因码；`job-failure-surfacing.test.ts` 的卡片断言改为对纯函数做用例；FIX-13 `package-coverage.test.ts` 里面板「还没纳入」那条接线断言改写（意思不变）。

## Capabilities

### New Capabilities

- `tender/analysis-single-entry`：项目页招标分析的发起入口有哪几个、谁看得到；两条分析流程之间的互斥、等锁超时与被挡住时怎么回答；开了一键分析的组织上传后不自动发起；卡片「正在启动」、启动失败与文件提示的显示；卡片按钮样式。

### Modified Capabilities

- `tender/analysis-failure-surfacing`：「项目卡片显示原因」里的「按钮 SHALL 仍为「重新分析」」，改为只对能用卡片发起的人成立。
- `tender/analysis-package-coverage`（FIX-13）：「分析面板提醒还没纳入的能读文件」改为能用卡片发起的人在卡片上看到这句，面板不重复。

## Impact

- 服务端：
  - 新增 `src/lib/tender-workforce/single-entry-rules.ts`（纯函数，不连库：四句文案、两条流程「在跑」的判定、活跃阻断集）；
  - 新增 `src/lib/tender-workforce/single-entry.ts`（连库：拿锁与等锁上限、试拿锁、查两边在跑、能不能用卡片发起）；
  - `src/lib/tender-workforce/trigger-service.ts`（发起前判能不能发起、锁内查旧管线、停旧管线的重试、卡片接口多三项）；
  - `src/lib/tender-auto-analysis/enqueue-package.ts`（旧管线两个发起函数拿锁、查一键分析；自动入队按做法 B 改）；
  - `src/lib/tender-auto-analysis/enqueue.ts`（上传逐文件入队按做法 B 改）；
  - `src/lib/tender-auto-analysis/enqueue-outcome.ts`（三条原因码；失败时优先用结果自带的文案）；
  - `src/app/api/projects/[id]/tender-analysis/agent/route.ts`（GET 把当前用户传给状态函数）；
  - `src/app/api/projects/[id]/tender-analysis/runs/route.ts`（多带 `agentCardEnabled`）；
  - `src/app/api/projects/[id]/tender-analysis/runs/[runId]/reanalyze/route.ts`（409）。
- 前端：
  - 新增 `src/lib/tender-workforce/agent-card-view.ts`（纯函数，客户端可用）；
  - `src/components/tender-analysis/agent-card.tsx`；
  - `src/components/tender-analysis/analysis-panel.tsx`（行号按 main `13c7ed33`，即 FIX-13 合并后：卡片挂载 424、475 行，「分析投标文件」441–448 行，「还没纳入」那句 516–520 行，「重新分析当前投标文件包」558–567 行）。
- 测试与注册：`scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 相邻改动与合并顺序：FIX-13（已合并）→ FIX-17 → FIX-19 → FIX-20 → FIX-18 → FIX-20b → FIX-22 → FIX-16，理由见 design「相邻改动与合并顺序」。归档要等 FIX-13 的归档 PR 先合并（本次对它的能力写了 MODIFIED）。
- 不涉及 schema、新队列、新模型调用、新开关、`vercel.json`。

## 受影响的 Muse 意图

无。不改 `src/lib/muse-bridge/**`，Muse 通道没有发起招标分析的意图。

## Out of scope

- 旧的自动分析管线本身：`src/lib/tender-auto-analysis/worker.ts`、`/api/cron/tender-auto-analysis`、`/api/cron/agent-runs` 都不退役、不改。
- 没开一键分析的组织：界面、上传后自动入队、旧按钮不变。可见的例外有下面四条，全部列在 GATE 第 6 条：
  - 单条记录重新分析接口的 400 改 409（GATE 第 3 条；这个接口界面上没有调用方）；
  - 组织开关关掉时还在跑（排队到修复）的一键分析作业，会挡住旧入口直到它跑完；等人处理、等审批的不挡；
  - 两个旧入口同时发起时改为先后执行（以前各走各的），等锁超过 10 秒的那个返回 409「正在启动」；
  - 面板首次加载完成之前，空态的「分析投标文件」不再先闪出来一下（以前加载期间就显示）。
- 卡片发起按钮对没有项目写权限的人照旧显示，点了 403。旧按钮今天同样如此，不改。
- 卡片在「需要你处理」时没有「取消」按钮（`agent-card.tsx:222`，只在排队、分析中显示），不改。
- 组织开关关掉后卡片不显示，等人处理的作业没有界面能取消（作业中心只读）：本次让它不再挡旧入口，不给它加界面。
- FIX-20b 的「从失败的这一步继续」不在本次。
- 一键分析完成后不替换更早的待审结果，多份待审记录并存，面板只显示最新一份：不改（FIX-22 处理两处读同一份）。
- 旧管线重新分析会把所有来源的待审结果标为已被替代（`enqueue-package.ts:487-500`），保留这个行为，理由见 design D8。
- 「下一步」卡片的「去重新分析」（`src/lib/tender-next-step/web-next-step.ts:261`）只指到页面位置，不改。
- 进度条 `src/components/tender-analysis/analysis-progress-banner.tsx` 只读旧管线记录，不改，也不读新加的 `agentCardEnabled`。
- 全站另有 24 个文件引用了没定义的 `bg-primary`：本次只改卡片，其余另开任务。
- 启动失败原因里带内部码（`trigger-service.ts:219` 的「启动失败：<内部码>」）：不改。
- 16:27 那两单到底是哪两个入口：本次不下结论，报告里写核实方法。
- 数据迁移：不做。已经并存的两单不回头处理。

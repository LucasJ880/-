# Tasks：招标分析只留一个入口（FIX-18）

前提：FIX-13（#546）已合并进 main，本分支已合入 main。tasks 按 GATE 第 1 条推荐的做法 B 写；GATE 选 A 时第 4 条按 design 「留给 GATE」第 1 条改写。

## 1. 测试先行（不改业务代码）

- [ ] 1.1 记基线，再写两个测试，在改动前的代码上各跑一遍。
  - 基线：跑一遍要触碰的模块已注册的测试，记下各自的通过数。范围是 `scripts/test-all.sh` 里 `src/lib/tender-workforce/`、`src/lib/tender-auto-analysis/`、`src/lib/navigation/__tests__/entry-visibility.test.ts`、`src/components/project-detail/__tests__/tender-detail-ia.test.ts` 的条目。
  - 写 `src/lib/tender-workforce/__tests__/single-entry.test.ts`（纯函数、颜色类对照、接线断言，按 design D13 第 1 层），注册进 `scripts/test-all.sh` 和 `scripts/test-ci-unit.sh`。
  - 写 `src/lib/tender-workforce/__tests__/single-entry-db.isolated.test.ts`（D13 第 2 层的 8 组用例），注册进 `scripts/test-all.sh`：隔离库执行，没有隔离库时跳过。
  - verify：
    - 改动前 `npx tsx src/lib/tender-workforce/__tests__/single-entry.test.ts` 退出码非 0，输出里报出 `primary`、`auto-enqueue:`、发起时没有查旧管线；
    - 隔离库上互斥、自动入队、`starting` 的用例失败；
    - `bash scripts/check-test-registry.sh` OK；
    - 基线通过数和两份红的输出存进报告。

## 2. 服务端互斥

- [ ] 2.1 新增 `src/lib/tender-workforce/single-entry.ts`，并改一键分析的发起与卡片接口。
  - `single-entry.ts` 放五样东西：
    - 共享锁，沿用现有的键；
    - 两条流程「在跑」的判定（D5）；
    - 能不能用卡片发起的判定（D1）；
    - 两句 409 文案；
    - 活跃阻断集常量，由 `trigger-service.ts` 转导出，`t1b-pure.test.ts` 的引用不用改。
  - `trigger-service.ts` 的发起：拿锁之后、取消旧单之前，先查旧管线；按 D6 停掉失败待重试的那一单；旧管线在跑时返回 `ACTIVE_JOB_EXISTS`。
  - 卡片的状态函数多返回 `canStart`、`starting`（试拿锁）、`packageHint`（就绪判定与覆盖计数，复用 FIX-13 的提示句）。
  - `agent/route.ts` 的 GET 把当前用户传进状态函数，仍然不直接连数据库。
  - verify：隔离库测试的第 1、2、5、6 组和「响应里没有这些字段」通过；`npx tsx src/lib/tender-workforce/__tests__/t1b-pure.test.ts` 通过。
- [ ] 2.2 改旧管线的发起，让它查一键分析。
  - `enqueue-package.ts` 的重新分析：先拿共享锁再锁 Project 行，锁内查一键分析在跑，在跑就返回 `active_run` 和那句文案。
  - 入队：把「查对方 → 按指纹查本方 → 新建」包进持锁的短事务，在跑就返回 `workforce_active`，不带任何记录号。
  - 原来的回落兜底并入这一判定。
  - `enqueue-outcome.ts` 码表补 `workforce_active`（`ACTIVE_RUN_EXISTS` / 409）。
  - `runs/[runId]/reanalyze/route.ts` 把 `active_run` 映射成 409（按 GATE 第 3 条的结果）。
  - verify：隔离库测试的第 3、4 组和「旧管线重新分析照旧替换未批准的结果」通过，并发用例连跑 3 次都是每轮恰好 1 单；`enqueue-outcome.test.ts`（补了 `workforce_active` 一条）和 `ready-gate.test.ts` 通过。

## 3. 自动入队（做法 B）

- [ ] 3.1 让开了一键分析的组织上传后不自动发起。
  - `enqueueTenderPackageIfReady`：自动开关开且组织开了一键分析时，返回 `agent_card_manual`；删掉改派一键分析的代码和固定 requestId；`EnqueuePackageResult.pipeline` 字段一并去掉。
  - `enqueue.ts`：上传逐文件入队在组织开了一键分析时返回 `agent_card_manual`，内容指纹照写。
  - 码表补 `agent_card_manual`（`AUTO_DISABLED` / 200 / ok / 文案）。
  - 改写 `obs-p2p3-single-pipeline.test.ts`：P3-01 改为「一键分析组织不自动发起」；P3-02 去掉；P3-05 改为「没有固定 requestId」；P3-03、P3-04 保留。
  - verify：隔离库测试的第 7、8 组通过；`obs-p2p3-single-pipeline.test.ts`、`enqueue-outcome.test.ts`（补了 `agent_card_manual` 一条）通过；隔离库上 `t1b-integration.test.ts` 的 T1B-14 不改断言即通过。

## 4. 卡片与面板

- [ ] 4.1 新增纯函数 `src/lib/tender-workforce/agent-card-view.ts`（D11），并改卡片 `agent-card.tsx`。
  - 纯函数覆盖：状态行、说明、按钮、文件提示、「正在启动…」、「上一单已取消，新的分析没能启动」、过不了用户级开关时的那一行、面板旧按钮是否显示。
  - 卡片改动：
    - 只调用这个纯函数；
    - 点下去即进入正在启动；
    - 请求失败后也重新读取；
    - `starting` 为真时每 8 秒轮询；
    - 每次读完把 `canStart` 回报给面板，失败时回报 false；
    - 按钮与颜色按 D12 改；
    - 「查看执行详情」那一行不动。
  - `job-failure-surfacing.test.ts:82-84` 三条卡片断言改为读纯函数文件，意思不变。
  - verify：`single-entry.test.ts` 的纯函数、颜色类、卡片接线部分通过；`job-failure-surfacing.test.ts`、`src/lib/navigation/__tests__/entry-visibility.test.ts` 通过。
- [ ] 4.2 改面板 `analysis-panel.tsx`：收下卡片的回报。
  - 两个旧按钮（FIX-13 后 441–448、558–567 行）只在纯函数说显示时渲染；
  - 空态说明按 spec 换句；
  - 其余操作（批准、批量确认、编辑）不动。
  - verify：`single-entry.test.ts` 的面板接线部分通过；`src/components/project-detail/__tests__/tender-detail-ia.test.ts` 通过；`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0。

## 5. 验收

- [ ] 5.1 跑全部门禁并截图。
  - verify：
    - `npm test` 对照既有失败清单没有新增；
    - `npm run test:ci` PASS；
    - `npm run typecheck` 退出码 0；
    - `npm run lint:baseline` PASS；
    - `bash scripts/check-test-registry.sh` OK；
    - `bash scripts/test-runtime-architecture.sh` 通过；
    - `OPENSPEC_TELEMETRY=0 openspec validate tender-analysis-single-entry --strict` valid；
    - 1.1 记下的模块测试通过数不减；
    - 本地夹具组织截图 5 张，存 `docs/acceptance/fix-18/`，内容按 design「验证方式」。
- [ ] 5.2 写 `docs/QINGYAN_FIX-18_REPORT.md`，并在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 FIX 序列里加 FIX-18 一行，状态 `[~]`。
  - 报告内容：
    - 四个入口与改动后的去向；
    - 两句 409 文案；
    - 改动前、改动后的测试输出；
    - 门禁结果与截图；
    - GATE 四条的结论；
    - 「没开一键分析的组织旧按钮晚出现」的实测；
    - 16:27 并行两单的核实方法（不下结论，标为推断）。
  - 16:27 的核实方法有三条：
    - 查该项目 16:27 前后的 TenderAnalysisRun：`analysisVersion`、`status`、`createdById`、`createdAt`、`supersedesRunId`；
    - 查招投标作业 AgentRun：`metadata.requestId` 是 UUID 的是卡片发起的，以 `auto-enqueue:` 开头的是自动入队；再看 `createdAt`、`metadata.initiatedByUserId`；
    - 查 Vercel 日志：16:27 前后的 `POST /api/projects/<id>/tender-analysis/package`（看 action）、`POST …/tender-analysis/agent`、`POST …/files`，以及 `[tender-auto-analysis] auto-enqueue outcome` 日志行。
  - verify：报告文件存在、含上面各节；TASKFLOW 里 FIX-18 状态为 `[~]`；FIX-12 那一行不动（由归档 PR #545 修）。

## Workflow follow-up

- `/opsx:verify tender-analysis-single-entry`。
- 开 PR 前做多维审查，至少四个维度：正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案；本次再加「并发与锁」「权限（能不能发起的判定）」两个维度。每条意见核实后再修，修完重跑测试；PR 正文写「多维审查」一节。
- 合并后通知一次已开一键分析的组织：上传后不再自动分析，请在卡片上点「开始 AI 分析」（做法 B 时）。
- PR 合并后 `/opsx:archive tender-analysis-single-entry --yes`：独立小 PR；TASKFLOW 里 FIX-18 改成 `[x]`；至少派一个子 agent 核对主规格与 delta 一致。

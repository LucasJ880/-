# Tasks：招标分析只留一个入口（FIX-18）

前提：FIX-13（#546）已合并（main `13c7ed33`），FIX-17、FIX-19、FIX-20 按 design「相邻改动与合并顺序」先合并，本分支已合入合并后的 main。tasks 按「留给 GATE」各条的推荐写（第 1 条 B、第 2 条 ①、第 3 条 409 码值不变、第 4 条停掉重试、第 5 条照常显示、第 6 条 A）；第 1 条选 A 时，3.1 按 design「留给 GATE」第 1 条改写；第 6 条选 B 时，2.1 去掉列表接口的字段、4.2 改为一律等卡片回报。

## 1. 测试先行（不改业务代码）

- [ ] 1.1 记基线，再写两个测试，在改动前的代码上各跑一遍。
  - 基线：跑一遍要触碰的模块已注册的测试，记下各自的通过数。范围是 `scripts/test-all.sh` 里 `src/lib/tender-workforce/`、`src/lib/tender-auto-analysis/`（含 FIX-13 的 `package-coverage.test.ts`、`requirement-batch-confirm.test.ts`）、`src/lib/navigation/__tests__/entry-visibility.test.ts`、`src/components/project-detail/__tests__/tender-detail-ia.test.ts`、`src/lib/tender-next-step/__tests__/web-next-step.test.ts`、`src/lib/tender-submission-checklist/__tests__/checklist.test.ts` 的条目。
  - 写 `src/lib/tender-workforce/__tests__/single-entry.test.ts`（纯函数、颜色类、接线断言，按 design D14 第 1 层），注册进 `scripts/test-all.sh` 和 `scripts/test-ci-unit.sh`。
  - 写 `src/lib/tender-workforce/__tests__/single-entry-db.isolated.test.ts`（D14 第 2 层的 11 组用例；夹具文件写 `source: "upload"`），注册进 `scripts/test-all.sh`：隔离库执行，没有隔离库时跳过。新模块用动态 import，改动前以「找不到模块 / 字段」的失败报出，不整个崩掉。
  - verify：
    - 改动前 `npx tsx src/lib/tender-workforce/__tests__/single-entry.test.ts` 退出码非 0，输出里报出 `primary`、`auto-enqueue:`、发起时没有查旧管线、没有 `lock_timeout`、卡片在 `enabled=false` 时不回报；
    - 隔离库上互斥、等锁超时、自动入队、`starting`、关了开关的用例失败；
    - `bash scripts/check-test-registry.sh` OK；
    - 基线通过数和两份红的输出存进报告。

## 2. 服务端互斥

- [ ] 2.1 新增 `single-entry-rules.ts` 与 `single-entry.ts`，改一键分析的发起、卡片接口与列表接口。
  - `src/lib/tender-workforce/single-entry-rules.ts`（不连库）：四句文案（D7）；两条流程「在跑」的判定（D5，输入是查出来的行与组织开关）；活跃阻断集常量，由 `trigger-service.ts` 转导出，`t1b-pure.test.ts` 的引用不用改。
  - `src/lib/tender-workforce/single-entry.ts`（连库）：按 D4 不变式拿锁（第一条 `SET LOCAL lock_timeout = '10s'`、第二条拿锁、55P03 转成「正在启动」）；一条语句的试拿锁（D10）；查两边在跑；能不能用卡片发起（D1，调用 `job.ts` 用的同一组函数）。
  - `trigger-service.ts` 的发起：requestId 重放之后、拿锁之前判能不能用卡片发起，过不了返回 403、不碰任何记录；事务写明 `{ maxWait: 5_000, timeout: 20_000 }`；拿锁之后、取消旧单之前先查旧管线；按 D6 停掉失败待重试的那一单；旧管线在跑或等锁超时时返回 `ACTIVE_JOB_EXISTS` 与对应文案；锁内新加的读写走事务连接。
  - 卡片的状态函数多一个可选的当前用户参数，多返回 `canStart`、`starting`、`packageHint`（D13）：组织没开一键分析时直接 `false` / `false` / `null`；三项各自兜底。FIX-20 已加的字段保留。
  - `agent/route.ts` 的 GET 把当前用户传进状态函数，仍然不直接连数据库；`runs/route.ts` 在 `?latest=1` 的响应里加 `agentCardEnabled`（D2）。
  - verify：隔离库测试第 1、2、5、6、10 组与第 8 组里卡片接口、列表接口的断言通过；`npx tsx src/lib/tender-workforce/__tests__/t1b-pure.test.ts` 通过；`single-entry.test.ts` 的发起、锁、试拿锁、卡片接口短路与兜底的接线断言通过。
- [ ] 2.2 改旧管线的发起，让它拿同一把锁、查一键分析。
  - `enqueue-package.ts` 的重新分析：事务写明 `{ maxWait: 5_000, timeout: 20_000 }`；按 D4 先拿共享锁再锁 Project 行；锁内按 D5 查一键分析在跑，在跑返回 `active_run` 与组织开着或关着的那句；等锁超时返回 `active_run` 与「正在启动」那句；持锁段全部走事务连接。
  - 入队：把「查对方 → 按指纹查本方 → 新建」包进同样写法的短事务，在跑返回 `workforce_active` 并带对应文案、不带任何记录号；等锁超时返回 `start_in_progress`；去掉撞唯一键后再查的那段；「替换飞行中的旧单」留在锁外。原来的回落兜底并入这一判定。
  - `enqueue-outcome.ts`：码表补 `workforce_active`、`start_in_progress`（`ACTIVE_RUN_EXISTS` / 409）；入队失败结果自带文案时优先用它；文案从 `single-entry-rules.ts` 引用。
  - `runs/[runId]/reanalyze/route.ts`：`active_run` 回 409，码值不变（GATE 第 3 条）。
  - verify：隔离库测试第 3、4、9、11 组与第 5 组里旧管线的两个入口通过，并发用例连跑 3 次都是每轮恰好 1 单、输的一方码与文案对；`enqueue-outcome.test.ts`（补了 `workforce_active`、`start_in_progress` 与「优先用结果自带文案」）和 `ready-gate.test.ts` 通过。

## 3. 自动入队（做法 B）

- [ ] 3.1 让开了一键分析的组织上传后不自动发起。
  - `enqueueTenderPackageIfReady`：自动开关开且组织开了一键分析时，返回 `agent_card_manual`；删掉改派一键分析的代码和固定 requestId；`EnqueuePackageResult.pipeline` 字段一并去掉。
  - `enqueue.ts`：上传逐文件入队在组织开了一键分析时返回 `agent_card_manual`，内容指纹照写。
  - 码表补 `agent_card_manual`（`AUTO_DISABLED` / 200 / ok / 文案）。
  - 改写 `obs-p2p3-single-pipeline.test.ts`（D14）：P3-01「一键分析组织不自动发起」；P3-02 去掉；P3-03「对方在跑由共享判定挡住」；P3-04「旧管线不退役，没开一键分析的组织照常调用入队函数」；P3-05「源码里没有固定 requestId」。
  - verify：隔离库测试第 7 组与第 8 组的两条自动路径通过；`obs-p2p3-single-pipeline.test.ts`、`enqueue-outcome.test.ts`（补了 `agent_card_manual`）通过；`single-entry.test.ts` 里「两处短路以组织开关为条件」通过；隔离库上 `t1b-integration.test.ts` 的 T1B-14 不改断言即通过。

## 4. 卡片与面板

- [ ] 4.1 新增纯函数 `src/lib/tender-workforce/agent-card-view.ts`（D11），并改卡片 `agent-card.tsx`。
  - 纯函数覆盖：状态行、说明、按钮、文件提示、「正在启动…」、「上一单已取消，新的分析没能启动」、过不了用户级开关时的那一行；面板这一侧的 D2 表（旧入口、空态说明、「还没纳入」那句）；FIX-20 已加的重试句、受阻句、「综合汇总未生成」那句逐字搬进来。
  - 卡片改动：
    - 只调用这个纯函数；
    - 点下去即进入正在启动，读到作业号等于请求返回的作业号时结束；
    - 请求失败后也重新读取；
    - `starting` 为真时每 8 秒轮询；
    - 每次读完把 `canStart` 回报给面板：`enabled=false` 的提前返回之前、非 2xx、抛异常时都回报 false；
    - 按钮与颜色按 D12 改；
    - 「查看执行详情」那一行不动。
  - `job-failure-surfacing.test.ts:82-84` 的三条卡片断言（连同 FIX-20 加的卡片断言）改为对纯函数做用例，意思不变。
  - verify：`single-entry.test.ts` 的纯函数、颜色类、卡片接线部分通过；`job-failure-surfacing.test.ts`、`src/lib/navigation/__tests__/entry-visibility.test.ts` 通过。
- [ ] 4.2 改面板 `analysis-panel.tsx`：收下列表带回的 `agentCardEnabled` 与卡片的回报。
  - 两个旧按钮（441–448、558–567 行）、空态说明（:435-439）、覆盖清单里「还没纳入」那句（516–520 行）只按纯函数的结果渲染；「还没纳入」仍只算一次。
  - 改写 FIX-13 `package-coverage.test.ts:272-278` 那条接线断言：只算一次、参数不颠倒、按纯函数的结果显示；其余断言不动。
  - 其余操作（批准、批量确认、编辑）与 `id="tender-analysis"` 不动。
  - verify：`single-entry.test.ts` 的面板接线部分通过；`npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts`、`src/components/project-detail/__tests__/tender-detail-ia.test.ts`、`src/lib/tender-next-step/__tests__/web-next-step.test.ts`、`src/lib/tender-submission-checklist/__tests__/checklist.test.ts`、`src/lib/tender-auto-analysis/__tests__/requirement-batch-confirm.test.ts` 通过；`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0。

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
    - 入口与改动后的去向；
    - 四句文案与各入口的码；
    - 改动前、改动后的测试输出；
    - 门禁结果与截图；
    - GATE 六条的结论；
    - 「没开一键分析的组织」例外的实测（面板加载期间与加载后、两个旧入口同时发起）；
    - 与 FIX-20 的卡片文案迁移、与 FIX-13 接线断言的改写；
    - Risks 里「事务超时后建作业才提交」「持锁事务占一条连接」两条的说明；
    - 16:27 并行两单的核实方法（不下结论，标为推断）。
  - 16:27 的核实方法有三条：
    - 查该项目 16:27 前后的 TenderAnalysisRun：`analysisVersion`、`status`、`createdById`、`createdAt`、`supersedesRunId`；
    - 查招投标作业 AgentRun：`metadata.requestId` 是 UUID 的是卡片发起的，以 `auto-enqueue:` 开头的是自动入队；再看 `createdAt`、`metadata.initiatedByUserId`；
    - 查 Vercel 日志：16:27 前后的 `POST /api/projects/<id>/tender-analysis/package`（看 action）、`POST …/tender-analysis/agent`、`POST …/files`，以及 `[tender-auto-analysis] auto-enqueue outcome` 日志行。
  - verify：报告文件存在、含上面各节；TASKFLOW 里 FIX-18 状态为 `[~]`；FIX-12 那一行不动（由归档 PR #545 修）。

## Workflow follow-up

- `/opsx:verify tender-analysis-single-entry`。
- 开 PR 前做多维审查，至少四个维度：正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案；本次再加「并发与锁」「权限（能不能发起的判定）」两个维度。每条意见核实后再修，修完重跑测试；PR 正文写「多维审查」一节。
- 合并后由人用既有渠道通知一次已开一键分析的组织：上传后不再自动分析，请在卡片上点「开始 AI 分析」（做法 B 时）。系统不为此发邮件。
- PR 合并后 `/opsx:archive tender-analysis-single-entry --yes`：独立小 PR，要在 FIX-13 的归档 PR 合并之后（本次对 `tender/analysis-package-coverage` 写了 MODIFIED）；TASKFLOW 里 FIX-18 改成 `[x]`；至少派一个子 agent 核对主规格与 delta 一致。

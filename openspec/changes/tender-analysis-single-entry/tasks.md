# Tasks：招标分析只留一个入口（FIX-18）

开工前提：

- 合并顺序（2026-11-22 统一）：#548 FIX-17 → FIX-21 → FIX-19 → FIX-14 → FIX-20 → FIX-15 → FIX-18 → FIX-20b → FIX-22 → FIX-16。FIX-13（#546）已合并、已归档（#547，main `01e444b9`）。
- **FIX-15 合并后把 main 合入本分支，并核对 FIX-19 / FIX-20 / FIX-21 合并后相邻文件的行号，再开工**（`git merge origin/main`）。要核的：
  - FIX-19：`package.ts`、`package-ready.ts`、`package-coverage.ts`（来源口径）、`files/route.ts`（design Context 引了 `:178-191`）、`t1b-integration.test.ts` 的夹具；
  - FIX-20：`trigger-service.ts`（卡片接口加了三个字段）、`agent-card.tsx`（加了三句）、`job-failure-surfacing.test.ts`（加了卡片断言）；
  - FIX-21：本次要改的 `tender-analysis/agent/route.ts`、`runs/route.ts`、`runs/[runId]/reanalyze/route.ts`，与它的目录守卫测试 `src/lib/projects/__tests__/project-routes-guard.test.ts`；
  - 顺带核 FIX-15 改过的 `src/lib/tender-workforce/tools.ts`（design Context 引了 `:501-509`），以及各 change 在 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 加的注册行；
  - 对不上的先改四件套、跑 `OPENSPEC_TELEMETRY=0 openspec validate tender-analysis-single-entry --strict`，再动代码；
  - 同时记下 `grep -c "| 待定 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的条数（main `01e444b9` 上为 0；先合并的 change 登记过的，以合入后的条数为准），作为 5.2 的「原有」条数。
- FIX-19 合并后招标文件包只认 `source = "upload"` 的文件：`single-entry-db.isolated.test.ts` 里当招标文件建的每一份 `ProjectDocument` 一律写 `source: "upload"`；本次 `src` 非测试代码里不写这个字面量。
- FIX-21 合并后，`src/app/api/projects/[id]/` 下每个接口第一步不带条件地调用项目级守卫、紧接着检查结果（目录守卫测试，进 CI 子集）。本次改的三个接口保持这个写法：守卫与检查那两行不动，新加的取当前用户、读组织开关都放在检查之后；本次不新增这个目录下的接口。
- design「留给 GATE」六条已定（按推荐，Lucas 2026-11-22 授权）：第 1 条 B、第 2 条 ①、第 3 条改 409 码值不变、第 4 条停掉重试、第 5 条照常显示、第 6 条 A。tasks 就按这些写，不留分支。

## 1. 测试先行（不改业务代码）

- [ ] 1.1 记基线，再写两个测试，在改动前的代码上各跑一遍。
  - 基线：跑一遍要触碰的模块已注册的测试，记下各自的通过数。范围是 `scripts/test-all.sh` 里 `src/lib/tender-workforce/`、`src/lib/tender-auto-analysis/`（含 FIX-13 的 `package-coverage.test.ts`、`requirement-batch-confirm.test.ts`）、`src/lib/navigation/__tests__/entry-visibility.test.ts`、`src/components/project-detail/__tests__/tender-detail-ia.test.ts`、`src/lib/tender-next-step/__tests__/web-next-step.test.ts`、`src/lib/tender-submission-checklist/__tests__/checklist.test.ts`、`src/lib/projects/__tests__/project-routes-guard.test.ts`（FIX-21）的条目。
  - 写 `src/lib/tender-workforce/__tests__/single-entry.test.ts`（纯函数、颜色类、接线断言，按 design D14 第 1 层），注册进 `scripts/test-all.sh` 和 `scripts/test-ci-unit.sh`。
  - 写 `src/lib/tender-workforce/__tests__/single-entry-db.isolated.test.ts`（D14 第 2 层的 11 组用例；当招标文件建的每一份 `ProjectDocument` 都写 `source: "upload"`），注册进 `scripts/test-all.sh`：隔离库执行，没有隔离库时跳过。新模块用动态 import，改动前以「找不到模块 / 字段」的失败报出，不整个崩掉。
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
  - `agent/route.ts` 的 GET 把当前用户传进状态函数，仍然不直接连数据库；`runs/route.ts` 在 `?latest=1` 的响应里加 `agentCardEnabled`（D2）。两个接口第一步调守卫、下一条语句检查结果的写法不动，新加的代码都在检查之后（FIX-21 目录守卫测试）。
  - verify：隔离库测试第 1、2、5、6、10 组与第 8 组里卡片接口、列表接口的断言通过；`npx tsx src/lib/tender-workforce/__tests__/t1b-pure.test.ts` 与 `npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts` 通过；`single-entry.test.ts` 的发起、锁、试拿锁、卡片接口短路与兜底的接线断言通过。
- [ ] 2.2 改旧管线的发起，让它拿同一把锁、查一键分析。
  - `enqueue-package.ts` 的重新分析：事务写明 `{ maxWait: 5_000, timeout: 20_000 }`；按 D4 先拿共享锁再锁 Project 行；锁内按 D5 查一键分析在跑，在跑返回 `active_run` 与组织开着或关着的那句；等锁超时返回 `active_run` 与「正在启动」那句；持锁段全部走事务连接。
  - 入队：把「查对方 → 按指纹查本方 → 新建」包进同样写法的短事务，在跑返回 `workforce_active` 并带对应文案、不带任何记录号；等锁超时返回 `start_in_progress`；去掉撞唯一键后再查的那段；「替换飞行中的旧单」留在锁外。原来的回落兜底并入这一判定。
  - `enqueue-outcome.ts`：码表补 `workforce_active`、`start_in_progress`（`ACTIVE_RUN_EXISTS` / 409）；入队失败结果自带文案时优先用它；文案从 `single-entry-rules.ts` 引用。
  - `runs/[runId]/reanalyze/route.ts`：`active_run` 回 409，码值不变（GATE 第 3 条已定）；守卫与检查那两行不动。
  - verify：隔离库测试第 3、4、9、11 组与第 5 组里旧管线的两个入口通过，并发用例连跑 3 次都是每轮恰好 1 单、输的一方码与文案对；`enqueue-outcome.test.ts`（补了 `workforce_active`、`start_in_progress` 与「优先用结果自带文案」）、`ready-gate.test.ts` 与 `project-routes-guard.test.ts` 通过。

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
    - `npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts`（FIX-21 目录守卫）通过；
    - `OPENSPEC_TELEMETRY=0 openspec validate tender-analysis-single-entry --strict` valid；
    - 1.1 记下的模块测试通过数不减；
    - 本地夹具组织截图 5 张，存 `docs/acceptance/fix-18/`，内容按 design「验证方式」。
- [ ] 5.2 写 `docs/QINGYAN_FIX-18_REPORT.md` 与 `docs/acceptance/fix-18/prod-check.sql`，并在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 FIX 序列里加 FIX-18 一行，状态 `[~]`，同时登记后续任务。
  - 报告内容：
    - 入口与改动后的去向；
    - 四句文案与各入口的码；
    - 改动前、改动后的测试输出；
    - 门禁结果与截图；
    - GATE 六条的结论：已定（按推荐，Lucas 2026-11-22 授权），第 1 条 B、第 2 条 ①、第 3 条改 409 码值不变、第 4 条停掉重试、第 5 条照常显示、第 6 条 A；
    - 「没有开关，合并即在生产生效」：不加开关，部署后两条流程立刻互斥，开了一键分析的组织上传后立刻不再自动发起，卡片与面板立刻按新规则显示；部署前已在并行跑的两单不回头处理；要撤回只能 revert 本 PR；
    - 「合并后要人做的事」（design「Migration Plan」四步照写）：
      - 查开关的生产值：有 Vercel 环境变量读权限的人（Lucas 指定）只读 `TENDER_WORKFORCE_ANALYSIS_ENABLED` 与组织名单、`TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED`、`WORKFORCE_RUNTIME_ENABLED` 与三个名单，结果贴回报告；
      - 通知：名单就是读出的一键分析组织，Lucas 定由谁用既有渠道说一次「上传后不再自动分析，请在卡片上点「开始 AI 分析」」，系统不发邮件；
      - 只读查询：部署后交 Lucas 跑 `docs/acceptance/fix-18/prod-check.sql`，结果原样贴回报告；
      - 要重新分析的项目名单与谁来点：本次不改分析内容，不整批重新分析；第 1、2 条查出的项目按项目去重交 Lucas 定哪些重新分析，项目负责人在「招标要求」页点（能用卡片发起的人点卡片「重新分析」，其他人与没开一键分析的组织点「重新分析当前投标文件包」）；
    - 「没开一键分析的组织」例外的实测（面板加载期间与加载后、两个旧入口同时发起）；
    - 与 FIX-20 的卡片文案迁移、与 FIX-13 接线断言的改写；
    - Risks 里「事务超时后建作业才提交」「持锁事务占一条连接」两条的说明；
    - 16:27 并行两单的核实方法（不下结论，标为推断）；
    - 没做的：下面登记的 7 条后续任务，各一句。
  - 16:27 的核实方法有三条：
    - 查该项目 16:27 前后的 TenderAnalysisRun：`analysisVersion`、`status`、`createdById`、`createdAt`、`supersedesRunId`；
    - 查招投标作业 AgentRun：`metadata.requestId` 是 UUID 的是卡片发起的，以 `auto-enqueue:` 开头的是自动入队；再看 `createdAt`、`metadata.initiatedByUserId`；
    - 查 Vercel 日志：16:27 前后的 `POST /api/projects/<id>/tender-analysis/package`（看 action）、`POST …/tender-analysis/agent`、`POST …/files`，以及 `[tender-auto-analysis] auto-enqueue outcome` 日志行。
  - `docs/acceptance/fix-18/prod-check.sql`：`BEGIN READ ONLY` 开头、`ROLLBACK` 结尾，中间只有 SELECT，按 design「Migration Plan」第 3 步写三条：
    1. 部署时同一项目两条流程都有进行中的单（非一键分析版本、PENDING / EXTRACTING / ANALYZING 的 `TenderAnalysisRun`，与同一项目处于活跃阻断集的招投标作业 `AgentRun`）；
    2. 同一项目有两份及以上 REVIEW_REQUIRED 的 `TenderAnalysisRun`；
    3. 16:27 那个项目前后的 `TenderAnalysisRun` 与招投标作业（上面核实方法的前两条）。
  - `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：FIX 序列里加 FIX-18 一行，状态 `[~]`。同时登记 7 条后续任务，各一行，编号写「待定」，状态 `[ ]`：
    1. 全站另有 24 个文件引用主题里没定义的 `bg-primary` / `text-primary-foreground`，这些地方的底色与字色不生效（`git grep -l "bg-primary" -- src` 除卡片外的 24 个；主题映射 `src/app/globals.css:207-252` 里没有 `primary`）；
    2. 一键分析启动失败时，卡片给用户看的原因是「启动失败：<内部码>」，带着内部错误码（`src/lib/tender-workforce/trigger-service.ts:219`）；
    3. 卡片的「开始 AI 分析 / 重新分析」与面板的旧按钮对没有项目写权限的成员照样显示，点了才 403（发起接口要写权限：`tender-analysis/agent/route.ts:45`、`tender-analysis/package/route.ts:29`；`agent-card.tsx`、`analysis-panel.tsx` 不看写权限）；
    4. 卡片在「需要你处理」时没有「取消」按钮，只在排队、分析中显示（`src/components/tender-analysis/agent-card.tsx:222`）；账号没开通的人遇到别人发起、正在等人处理的作业时因此没有出路（design Risks 第 1 条）；
    5. 组织关掉一键分析开关后，等人处理、等审批的招投标作业没有任何界面能处理或取消：卡片不渲染（`agent-card.tsx:154`），作业中心只读（`src/app/api/workforce/jobs/[id]/route.ts:29` 只有 GET）；
    6. 一键分析完成后不把更早的待审结果标为已被替代，同一项目会并存多份「等待审核」，面板只读最新一份（FIX-22 之后矩阵也只读这一份），较早的那份一直待审、页面上看不到（只有旧管线重新分析做替换，`src/lib/tender-auto-analysis/enqueue-package.ts:487-500`）；
    7. 一键分析发起里取消旧单与建作业不走持锁事务的连接（`cancelAgentRun`，`src/lib/agent-runtime/run.ts:572-596`；`createWorkforceJob`，`src/lib/workforce-runtime/job.ts:223-313`）：事务超时后锁先释放、建作业随后才提交，这段窗口里旧管线入口可能另建一单；连接池紧时持锁事务与它里面的工作各占一条连接；取消已提交而建作业失败时不回滚（design Risks 第 2–4 条）。
  - verify：
    - 报告文件存在、含上面各节，其中有「没有开关，合并即在生产生效」与「合并后要人做的事」两节；
    - `docs/acceptance/fix-18/prod-check.sql` 存在，除 `BEGIN READ ONLY` / `ROLLBACK` 外只有 SELECT；
    - `grep -n "^| FIX-18 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行、状态为 `[~]`；FIX-12 那一行不动（由归档 PR #545 修）；
    - `grep -c "| 待定 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 不少于（开工前提记下的条数 + 7）。

## Workflow follow-up

- `/opsx:verify tender-analysis-single-entry`。
- 开 PR 前做多维审查，至少四个维度：正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案；本次再加「并发与锁」「权限（能不能发起的判定）」两个维度。每条意见核实后再修，修完重跑测试；PR 正文写「多维审查」一节。
- 合并后要人做的事按 design「Migration Plan」四步做（查开关值、通知一键分析组织、跑只读查询、定要不要重新分析）；通知用既有渠道，系统不为此发邮件。PR 正文写明「没有开关，合并即在生产生效」。
- PR 合并后 `/opsx:archive tender-analysis-single-entry --yes`：独立小 PR；本次对 `tender/analysis-package-coverage` 写了 MODIFIED，FIX-13 的归档 #547 已合并（main `01e444b9`），主规格在；TASKFLOW 里 FIX-18 改成 `[x]`；至少派一个子 agent 核对主规格与 delta 一致。

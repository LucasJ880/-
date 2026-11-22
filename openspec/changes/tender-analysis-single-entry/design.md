# Design：招标分析只留一个入口（FIX-18）

## Context

动机见 proposal 的 Why。下面只写决定做法要用到的现状，都对过代码。行号以 main `13c7ed33`（已含 FIX-12 #540、FIX-13 #546）为准；除 `analysis-panel.tsx`、`project-file-manager.tsx` 外，所引文件在 FIX-13 前后行号相同。排在本次之前合并的 FIX-19、FIX-20、FIX-21、FIX-15 会让其中一些行号移动，开工前按合入后的 main 复核（tasks 开工前提）。

**谁算「开了一键分析」**

- 卡片显示的 `enabled` 只看组织开关：`TENDER_WORKFORCE_ANALYSIS_ENABLED`，加上可选的组织名单（`src/lib/tender-workforce/flags.ts:29-47`，状态函数在 `trigger-service.ts:301` 调用）。只读环境变量，不查库。
- 真正建作业时还要过用户级开关 `isWorkforceRuntimeEnabled`（`src/lib/workforce-runtime/job.ts:150-159`）：
  - 它要求 `WORKFORCE_RUNTIME_ENABLED` 打开；组织、用户、角色三个名单里，**每个配了的名单都必须命中**，并且三个名单至少配了一个（`workforce-runtime/flags.ts:34-61`）。比如配了组织名单和用户名单，那么在组织名单里、但不在用户名单里的人也过不了。
  - 角色按岗位派生（`src/lib/rbac/effective-platform-role.ts:50-62`），派生要查库。
  - 过不了的人点卡片会得到 403「Workforce Runtime 未开启，无法启动 AI 分析」（`trigger-service.ts:209-220`，`agent/route.ts:96-98`）。
  - 这个判定发生在取消旧单之后（取消在 :160-168，建作业在 :182）：过不了的人点「重新分析」，会先把正在跑或等人处理的那单取消，再拿到 403。
- 卡片的发起接口和旧管线的发起接口都要求项目写权限（`agent/route.ts:45`，`package/route.ts:29`）；卡片读接口与分析记录列表接口只要求读权限（`agent/route.ts:31`，`runs/route.ts:20`）。

**发起入口**

创建旧管线记录的代码只有两处（`enqueue-package.ts:250` 入队、`:452` 重新分析），创建一键分析作业的只有 `startTenderWorkforceAnalysis` 一处。界面和接口上的入口都落到这三处：

1. 卡片「开始 AI 分析 / 重新分析」（`agent-card.tsx:232-239`）→ `POST …/agent` → `startTenderWorkforceAnalysis`（`trigger-service.ts:107-231`）。执行顺序：
   - 先查 requestId，不看状态（:130-141）；
   - 再在事务里拿 `pg_advisory_xact_lock(hashtext('tender-workforce-start:<org>:<project>'))`（:143-149），事务超时 20 秒（:229），等锁没有上限；
   - 查本项目正在进行的作业（:151，用的是全局连接，不是事务；集合在 :40-51，含 `needs_human`）；
   - 如果是重新分析，先取消旧单（:160-168，`cancelAgentRun` 自己开事务，`run.ts:572-596`），再新建（:182-208，`createWorkforceJob` 用全局连接，`job.ts:223-313`）；
   - 不看旧管线的任何记录。
2. 面板「重新分析当前投标文件包」（`analysis-panel.tsx:558-567`）→ `POST …/package {action:"reanalyze"}` → `reanalyzeTenderPackage`（`enqueue-package.ts:354-539`）：
   - 显示条件只有最新记录（不分来源，`runs/route.ts:27-31`）不是 SUPERSEDED；
   - 事务用 Prisma 默认值（`:406` 没传参数：等连接 2 秒、事务 5 秒）；锁的是 Project 行（:408-410）；
   - 只查旧管线的 PENDING / EXTRACTING / ANALYZING（:412-422），不查一键分析作业，也不查 `AGENT_ANALYZING`；
   - 建完后把所有来源的 REVIEW_REQUIRED 标为 SUPERSEDED（:487-500）。
   - 单条记录接口 `POST …/runs/:runId/reanalyze` 走同一个函数（`review.ts:216-255`）。它把 `active_run` 回成 400，码直接用内部码 `active_run`（`reanalyze/route.ts:28-35`），不走码表；`src/**/*.tsx` 里没有调用方。
3. 面板空态「分析投标文件」（`analysis-panel.tsx:441-448`），和卡片的「开始 AI 分析」同时显示 → `POST …/package {action:"enqueue"}` → `enqueueTenderPackageAnalysis`（`package/route.ts:93-97`，`enqueue-package.ts:155-331`）：
   - 没有锁，没有事务；
   - 按文件包指纹复用 PENDING / EXTRACTING / ANALYZING / REVIEW_REQUIRED（:62-84, 226-243），不含 `AGENT_ANALYZING`；
   - 建记录撞唯一键时再查一次（:285-304）；
   - 路由对抛出的异常没有 try/catch。
4. 上传后自动入队，分两条路，看 `TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED`（`auto-flags.ts:37-48`；文件头注释 :7 写明默认关，「生产保持既有行为（上传路由内 per-file 入队）」）：
   - 开关关：上传路由逐文件调 `enqueueTenderPackageAnalysis`（`files/route.ts:178-191` → `enqueue.ts:100-105`），完全不看一键分析。
   - 开关开：上传时只写内容指纹（`enqueue.ts:47-52, 96-98`），文件处理完由 `process-next` 调 `enqueueTenderPackageIfReady`，每一次返回 done 都会调（`process-next/route.ts:164-167, 206, 225`）。
   - `enqueueTenderPackageIfReady` 在组织命中一键分析开关时改派一键分析（`enqueue-package.ts:587-621`），参数是固定的 `requestId: auto-enqueue:<projectId>` 和 `restart:false`。改派失败或抛异常时回落旧管线（:622-630, 652-656）。回落前只查 `AGENT_ANALYZING`（:634-650）。
5. 没有界面调用方的接口：`POST …/package {action:"auto"}`（`package/route.ts:47-67`）走 `enqueueTenderPackageIfReady`；单条记录重新分析接口见第 2 条。

**由此带出的两个缺陷**（只从代码推出，生产未核实）

- 缺陷 1：requestId 重放不看状态，而自动入队的 requestId 每个项目固定一个。所以第一张自动单建出来以后，这个项目以后的自动触发都返回这张旧单，新传的文件不会被自动分析。
- 缺陷 2：如果项目只被卡片分析过、而且已经完成，第一次自动触发不会命中重放，进行中的作业集合也是空的，于是会对同一个文件包再跑一单完整的 9 步分析（`deterministic-plan.ts:105-210`）。

**「在跑」的现有口径**

- 一键分析：
  - 作业状态在活跃阻断集里（`trigger-service.ts:40-51`）。等人处理、等审批的作业只能由人恢复（`workforce-runtime/resume.ts:45-48`），不会自己结束；作业中心只有读接口（`src/app/api/workforce/jobs/[id]/route.ts:29` 只有 GET），取消只能在项目卡片上点，而卡片在组织开关关掉时不渲染（`agent-card.tsx:154`）。
  - 领域记录 `AGENT_ANALYZING` 要等第一步执行时才创建（`tools.ts:501-509` → `analysis-run-service.ts:96-233`，记录里写了文件包指纹）。作业进入 `needs_human` 或失败后，领域记录会被收尾成 `AGENT_FAILED`（`job-failure-surfacing.ts:61, 83-86`）；作业完成而收尾步骤没跑到时，领域记录会一直停在 `AGENT_ANALYZING`（历史上出现过，见 `plan-compile.ts:95-98` 的注释）。
- 旧管线：
  - PENDING / EXTRACTING / ANALYZING（`enqueue-helpers.ts:16-20`）。
  - FAILED 且尝试次数少于 5 次的记录会被定时任务再次认领（`worker.ts:44, 976-1001`），认领时按状态做条件更新（`worker.ts:259-282`），退避 15 / 60 / 180 / 600 秒（`worker.ts:79`）。

**卡片现状**

- 状态文案只看接口数据、不看 `busy`（`agent-card.tsx:160-182`）；`CANCELLED` 对应「上次 AI 分析已取消」（:176-178）。
- 读接口失败时直接返回、不改状态（:84、:87-89）；发起请求失败时只显示错误、不重新读取（:130-135）。
- 只在排队 / 分析中轮询（:54, 99-104）。
- 发起按钮用 `bg-primary` / `text-primary-foreground`（:236），「取消」用 `hover:bg-muted`（:227），说明文字用 `text-muted-foreground`（:192-193, 205, 211, 216, 246）。
- 用仓库的 Tailwind 4.2.2 编译 `src/app/globals.css` 实测：`bg-primary`、`text-primary-foreground`、`text-muted-foreground` 不生成任何样式；`hover:bg-muted` 生成 `background-color: var(--muted)`，即 `#6e7d76` 深灰。主题映射在 `globals.css:207-252`。

**面板现状（FIX-13 合并后）**

- 首次加载前 `data` 为空，面板先渲染空态，「分析投标文件」按钮在加载期间就显示（`analysis-panel.tsx:409-450`）。
- 「还没纳入」那句：`const notYetHint = data.coverage ? notYetAnalyzedHint(…)`（:454-456），在覆盖清单里显示（:516-520），只在投标包 AI 体验开着时显示（:487）。FIX-13 的接线断言读这一段源码（`package-coverage.test.ts:260-288`）。
- 分析记录列表接口 `?latest=1` 只返回 `{ run }`（`runs/route.ts:78-80`）；进度条每 4 秒轮询它（`analysis-progress-banner.tsx:68-72`）。

**取消和建单不在一个数据库事务里**：所以「旧单已取消、新单还没建」这段时间对其它读取可见，建单失败时取消也不会回滚。

**连接池**：持锁的事务占一条连接，里面的工作又走别的连接，这种写法在并发数到连接上限时会让所有请求在取连接超时后失败；`docs/QINGYAN_CHANNELS_TO_SPINE.md:31` 记录过，WhatsApp 入站因此弃用了这种锁。一键分析发起今天就是这种写法。`docs/QINGYAN_TENDER_T2_P16_PROFITABILITY_REPORT.md` 记录过并发负载下交互事务耗时被拉到 89.8 秒。

**生产上几个开关的实际值，仓库里查不到**（`docs/QINGYAN_TENDER_FLOW_BASELINE.md:172` 列为待确认问题）。

## Goals / Non-Goals

**Goals**

- 开了一键分析、并且能用卡片发起的人，在页面上只看到卡片上的一个发起按钮。
- 两条流程在服务端互斥：同一项目同一时间至多一单在跑，并发点两个入口也一样；等锁超时时回一句白话，不回 500。
- 开了一键分析的组织，上传后不再自动发起（做法 B，GATE 第 1 条已定）。
- 卡片在启动期间显示「正在启动…」，启动失败时说清楚旧单已取消。
- 卡片按钮是正常的主按钮和次按钮，卡片里只用主题里定义过的颜色。
- 没开一键分析的组织，界面与自动入队不变；可见的例外逐条列在 GATE 第 6 条（已定 A）。

**Non-Goals**（具体到文件）

- 不改 `src/lib/workforce-runtime/**`：`job.ts`、`processor.ts`、`flags.ts`、`resume.ts`、`read-model/**`。
- 不改 `src/lib/agent-runtime/run.ts`（`cancelAgentRun`、`createAgentRun`）。
- 不改 `src/lib/tender-auto-analysis/worker.ts`、`src/app/api/cron/**`、`vercel.json`。
- 不改 `src/lib/tender-workforce/tools.ts`、`analysis-run-service.ts`、`flags.ts`、`job-failure-surfacing.ts`。
- 不改 `src/app/api/projects/[id]/files/route.ts` 与 `files/process-next/route.ts`：两处的行为变化都落在它们调用的 `enqueue.ts` / `enqueue-package.ts` 里；FIX-17 在 process-next 里加的权限检查在调用之前，两边不冲突。
- 不改 `src/app/api/projects/[id]/tender-analysis/package/route.ts`（码表在 `enqueue-outcome.ts` 里改）与 `runs/[runId]/route.ts`。
- 不改 `src/lib/tender-auto-analysis/package-ready.ts`、`package-coverage.ts`、`package.ts`（只调用；FIX-19 改它们的来源口径）。
- 不改 `src/components/tender-analysis/analysis-progress-banner.tsx`、`analyst-synthesis-view.tsx`、`src/components/project-detail/tabs/*.tsx`、`src/components/project-files/project-file-manager.tsx`。
- 不改 `src/lib/tender-next-step/**`、`src/lib/muse-bridge/**`。
- 不改 `src/app/globals.css`（不新定义 `primary`）、`src/components/ui/button.tsx`。
- 不改 `src/lib/tender-auto-analysis/exclusion-text.ts`（FIX-13 的文案，只引用）。
- 不改 `prisma/**`。

## Decisions

### D1 「能用卡片发起」= 组织开关和用户级开关都过；发起前先判（GATE 第 2 条，已定 ①）

判定方法：组织开关，加上与建作业时相同的用户级开关（`job.ts:150-159` 的同一组函数，角色按岗位派生）。项目写权限不算在内：两个入口都要写权限，它决定不了该显示哪个入口。

- 卡片接口按当前用户算一次，返回 `canStart`。
- 一键分析发起时，在 requestId 重放之后、拿锁之前判一次，过不了直接返回 403「Workforce Runtime 未开启，无法启动 AI 分析」，不取消任何单、不碰任何记录。建作业里的那次判定（`job.ts:150-159`）原样保留。
- 被否决：只看组织开关（卡片现在的 `enabled`）。过不了用户级开关的人会遇到：旧按钮被藏起来，卡片按钮点了 403，页面上没有一个能用的按钮。
- 被否决：再加上项目写权限。只读成员 `canStart` 会是 false，于是看到旧按钮，而旧按钮同样 403，没有任何好处，还让只读成员看到两套按钮。
- 被否决：发起时不提前判，靠建作业里那次。过不了的人用接口发「重新分析」，会先取消正在跑的单再拿到 403。

### D2 面板怎么知道显示哪个入口：自己的列表数据带组织开关，卡片回报能不能发起（GATE 第 5 条已定照常显示，第 6 条已定 A）

面板有两路信号：

- 面板自己的列表请求 `GET …/runs?latest=1` 多带回 `agentCardEnabled`，与卡片接口的 `enabled` 同一判定（只读环境变量，不查库，`runs/route.ts:20-23` 已有组织号）。
- 卡片每次读完接口，把 `canStart` 回报给面板；接口失败、不是 2xx、或者 `enabled=false` 时回报 false。回报发生在卡片任何提前返回之前。

面板按下面的表决定旧入口（两个旧按钮、「还没纳入」那句）与空态说明：

| 面板列表数据 | 卡片回报 | 旧入口 | 空态说明 |
|---|---|---|---|
| 还没回来 | 任意 | 不显示 | 「暂无分析记录。」 |
| `agentCardEnabled=false` | 任意（包括还没回报） | 显示 | 原句「暂无分析记录。可对当前项目已上传的投标 PDF 包发起分析（无需重新上传）。」 |
| `agentCardEnabled=true` | 还没回报 | 不显示 | 「暂无分析记录。」 |
| `agentCardEnabled=true` | `true` | 不显示 | 「暂无分析记录。请在上方「AI 数字员工 · 投标分析」卡片上发起分析。」 |
| `agentCardEnabled=true` | `false`（含接口失败） | 显示 | 原句 |
| 列表请求失败（拿不到开关） | 按卡片回报，未回报时不显示 | 同左 | 同左 |

面板没挂卡片时（`showRunControls` 为假），旧入口按今天的条件；这个组合今天只在「提交」页签出现，它走 `quietEmpty` 安静空态、运行头部不渲染（`analysis-panel.tsx:410-416`、`:477`），不受影响。卡片在空态和有数据两种分支里挂在不同位置（:424、:475），切换时会重新挂载、重新回报；回报值存在面板里，切换期间旧入口不闪。

- 卡片接口失败时怎么办，有两种做法（GATE 第 5 条，已定照常显示）：
  - 照常显示旧按钮（推荐）：开了一键分析的组织里，卡片接口一失败，能用卡片发起的人会看到旧按钮，点了走旧管线（互斥照常挡）。
  - 隐藏旧按钮，在面板上写「分析入口没有加载出来，点这里重试」：开了一键分析的组织里不会走到旧管线；但卡片接口失败时，过不了用户级开关的人也没有按钮。
  - 推荐照常显示（已按此定）：卡片接口的三个新字段各自容错（D10、D13），接口只在登录失效、数据库不可用时才失败，这时旧按钮同样点不成；而隐藏的做法让本来就只能用旧按钮的人在失败时也没有入口。
- 被否决：只靠卡片回报，列表不带开关。没开一键分析的组织，旧按钮要等卡片那次请求回来才出现，是 Evan「行为不变」之外的一处可见变化。
- 被否决：把 `canStart` 也放进列表接口。进度条在旧管线跑的时候每 4 秒轮询这个接口（`analysis-progress-banner.tsx:68-72`），每次都得派生岗位、查权限；`agentCardEnabled` 只读环境变量，不多查库。
- 被否决：面板自己再请求一次 `GET …/agent`。面板每次操作后都会重新加载，会多出重复请求，而且两次结果可能不一致。
- 被否决：开了一键分析的组织里，回报之前先显示旧按钮。会先闪一下旧按钮，而且这一下是点得到的。
- 代价：面板首次加载完成之前，空态的「分析投标文件」不再先显示（今天加载期间就显示）。列进 GATE 第 6 条的例外。

### D3 过不了用户级开关的人：卡片只显示状态，不显示发起按钮

组织开了一键分析时，卡片照常渲染，这样别人发起的作业对这个人也可见，旧管线被挡住时的 409 文案也可以指向卡片。只是不显示「开始 AI 分析 / 重新分析」，改写一行「你的账号还没开通 AI 数字员工分析，请用本页下方的分析按钮」。「取消」按钮的显示条件不变（排队 / 分析中显示），因为取消接口不看开关（`trigger-service.ts:237-270`）。

- 被否决：对这些人整张卡片不渲染。他们会看不到别人发起的作业，旧入口被 409 挡住时文案里说的卡片也找不到。

### D4 两条流程拿同一把事务级锁，锁的用法写成不变式

锁的键沿用一键分析现有的 `tender-workforce-start:<org>:<project>`，`<org>` 一律取项目自己的组织号（三边都是：`orgIdOf` 读 `project.orgId`，`api-access.ts:38-40`；入队用 `project.orgId`，`enqueue-package.ts:171`）。拿锁、试拿锁、等锁超时的处理只写在 `single-entry.ts` 一处。

**不变式**（FIX-20b 的「继续」同样遵守）：

1. 这把锁是事务里的第一把锁：事务的第一条语句是 `SET LOCAL lock_timeout = '10s'`，第二条是拿锁，之后才读写任何表。
2. 已经持有 Project 行、调查室行或分析记录行锁的事务，不再申请这把锁。今天锁 Project 行的路径有：项目删除（`projects/[id]/route.ts:350-359`）、提交记录（`tender-submission/service.ts:102`）、`lockProject` 及经它的调查室摘要写入（`quote-engine/tender-bid.ts:121-123`，11 个文件调用）；它们都不申请这把锁，也不在事务里调用本次的发起函数。
3. 拿这把锁的事务一律写明 `{ maxWait: 5_000, timeout: 20_000 }`：取连接最多等 5 秒，整个事务最多 20 秒，等锁最多 10 秒。
4. 等锁超过 10 秒，数据库报 SQLSTATE 55P03，发起函数把它转成「正在启动」的 409（D7），不抛出。
5. 旧管线持锁的那一段，所有读写都走这个事务的连接；一键分析这边，锁内新加的「查旧管线」「停旧管线重试」也走事务连接。`cancelAgentRun`、`createWorkforceJob` 仍走自己的连接（Non-Goals），这是今天就有的写法，风险写在 Risks。

各入口的做法：

- 旧管线重新分析：在现有事务里先拿这把锁，再锁 Project 行，再查一键分析在跑。
- 旧管线入队：把「查对方 → 按指纹查本方 → 新建记录」包进一个持锁的短事务，取代原来无锁的那一段（`enqueue-package.ts:226-304`）。文件清单、指纹、页数这些（可能要读 Blob 回填指纹，`package.ts:183-198`）都在锁外先算好。持锁之后不会再有两个入队并发撞唯一键，原来撞键后再查的那段兜底（:285-304）删掉：在同一个事务里撞键后再查，会因事务已中止而报 25P02。建完之后的「替换飞行中的旧单」（:306-319）留在锁外，行为不变。
  - 撞唯一键还有一种与并发无关的情形：文件包指纹回到旧值，同指纹的旧记录已被替代或已批准，查重只看进行中的状态（:62-84）查不到它，新建时撞唯一键（FIX-19 登记的后续任务「指纹回到旧值时旧流程自动入队撞唯一键」）。今天的兜底也只查进行中状态，查不到就原样抛错；本次删掉兜底后照旧抛错，结果与今天相同。修查重不在本次，由那一条后续任务做（它写明排在本次之后）。
- 一键分析发起：沿用现有事务，加上 `lock_timeout` 与 `maxWait`。建作业的写入不碰 Project 行（AgentRun 没有指向 Project 的外键）。

为什么没有死锁：每个拿这把锁的事务在拿锁之前不持有任何行锁（不变式 1），锁 Project 行的路径都不申请这把锁（不变式 2），所以等待关系里不会出现环。

- 被否决：一键分析也锁 Project 行。启动事务最长 20 秒，这期间所有锁 Project 行的写入都会被挡住，包括 FIX-10 / 11 的调查室摘要写入和提交记录。
- 被否决：只查不锁。两个入口几乎同时点下去时，两边都查不到对方，各建一单。
- 被否决：旧管线用试拿锁、拿不到直接 409。同一项目连传几份文件时，逐文件入队会互相挡住；双击也会得到 409 而不是复用。
- 被否决：不设等锁上限，只把事务超时调长。等的一方一直占一条连接，超时后照样是 500。
- 被否决：新建锁表或租约。违反硬纪律 1、3。

### D5 「在跑」的口径

- 一键分析在跑（旧管线发起时查）：本项目有一张招投标作业处于活跃阻断集（排队、规划、执行、校验、修复、等审批、等人处理）。两条例外：
  - 组织开关关着时，等审批、等人处理不算。这时卡片不显示，作业中心只读，没有人能处理或取消这张作业；算作在跑会让旧入口一直被挡。
  - 「AI 数字员工分析中」的领域记录本身不再单独算；只有它对应的作业（按领域记录的幂等键 `tender-workforce:v1:<jobId>` 找到，`analysis-run-service.ts:57-59`）还在活跃阻断集里才算，这时已被上一条覆盖。作业已结束而领域记录停在「分析中」的，不挡旧入口。
- 旧管线在跑（一键分析发起时查）：本项目有一条非一键分析版本的记录，状态是 PENDING / EXTRACTING / ANALYZING。旧管线「失败待重试」的那种按 D6 处理。
- 判定写成纯函数，放在 `single-entry-rules.ts`，输入是查出来的行与组织开关，CI 单测直接用。
- 被否决：等人处理（`needs_human` / `awaiting_approval`）在组织开着时也不算在跑。这样的作业被人处理后会接着跑，跟旧管线并行；一键分析自己也把它算作活跃，只有显式「重新分析」才会替换它（`trigger-service.ts:36-38`）。
- 被否决：组织开关关着时，让卡片在有阻断作业时照样显示状态和「取消」。组织关开关的意思就是不让这个组织看到卡片，为这种少见的情形改卡片的显示条件，收益不抵改动。
- 被否决：沿用今天回落前的口径，只看领域记录 `AGENT_ANALYZING`。作业排队到第一步执行之前没有领域记录；等人处理的作业，领域记录已经是 `AGENT_FAILED`；停住的领域记录会永久挡住旧入口。

### D6 一键分析发起时，停掉旧管线失败后的自动重试（GATE 第 4 条，已定）

持锁时，把本项目「FAILED、尝试次数少于 5、非一键分析版本」的旧记录按状态条件改成 SUPERSEDED（同时清掉租约与下次重试时间，写法同 `enqueue-package.ts:135-146`）。定时任务认领时也按状态条件更新（`worker.ts:259-282`），谁先改到谁赢。如果改不到，说明定时任务刚认领、它已经在跑，按 D5 返回 409。改完再新建作业。

- 被否决：把它当成在跑，直接挡住。页面上写着「分析失败」，用户却点不了，最长要等 5 次重试用完（退避间隔加起来约 14 分钟）。
- 被否决：不处理。之后的重试会跟一键分析并行，正是这次事故的样子。

### D7 四句文案与状态码

| 情形 | 入口 | HTTP | 码 | 文案 |
|---|---|---|---|---|
| 一键分析被旧管线挡 | 卡片发起 | 409 | `ACTIVE_JOB_EXISTS` | 「这个项目已经有一单招标文件分析在进行，进度见本页顶部「招标文件分析」一栏；那一单结束后再点。」 |
| 旧管线被一键分析挡，组织开着 | `…/package` 两个 action | 409 | `ACTIVE_RUN_EXISTS` | 「AI 数字员工正在分析这个项目（或在等人处理），进度见「AI 数字员工 · 投标分析」卡片；那一单结束后再发起。」 |
| 同上 | 单条记录重新分析 | 409 | `active_run` | 同上 |
| 旧管线被一键分析挡，组织关着 | 同上两类 | 409 | 同上两类 | 「AI 数字员工还有一单分析没跑完，跑完后再发起。」 |
| 等锁超过 10 秒 | 卡片发起 | 409 | `ACTIVE_JOB_EXISTS` | 「这个项目正有一单分析在启动，过几秒再看。」 |
| 同上 | `…/package` / 单条记录 | 409 | `ACTIVE_RUN_EXISTS` / `active_run` | 同上 |
| 旧管线自己已有一单在跑 | 单条记录重新分析 | 409（原 400） | `active_run` | 既有的「当前分析仍在进行中，请等待完成后再重新分析」 |

- 卡片发起的路由已经把 `ACTIVE_JOB_EXISTS` 映射成 409（`agent/route.ts:99-100`），只是今天没有任何地方返回它；路由不改。
- `…/package` 的重新分析走既有的 `active_run`，带上面的文案；规范化时优先用后端给的文案（`enqueue-outcome.ts:229-238`）。
- `…/package` 的入队与自动入队用原因码：
  - `workforce_active`：今天不在码表里，会被归成 UNKNOWN / 400；补进码表，映射为 `ACTIVE_RUN_EXISTS` / 409。入队结果自带组织开着或关着的那句文案，规范化时失败结果优先用结果自带的文案（今天入队结果没有文案字段，既有原因的输出不变）；码表里的默认文案是组织开着那句。
  - `start_in_progress`：等锁超时，映射为 `ACTIVE_RUN_EXISTS` / 409 /「正在启动」那句。
- 单条记录接口只把 `active_run` 的状态码改成 409，码值仍用内部码 `active_run`，不走码表（GATE 第 3 条，已定）。
- 面板兜底提示表里已有 `ACTIVE_RUN_EXISTS`（`analysis-panel.tsx:83`）；面板优先显示后端文案（`:385-391`），不改。
- 所有被挡的响应都不带对方记录的 id、发起人、内部错误原文。今天回落路径的 `workforce_active` 会带回一键分析领域记录的 id（`enqueue-package.ts:644-649`）；互斥挪进入队函数以后，上传路由也会拿到这个原因，而文件抽屉会把上传响应里的 runId 当成进度条的种子（`project-file-manager.tsx:299-313`），所以这次不再带 id。
- 文案只在 `single-entry-rules.ts` 定义一次（纯文件，`enqueue-outcome.ts` 引用它后仍不连库）。
- 被否决：新开码。前端兜底表和路由映射都已有现成的码，新码要两边都加，没有收益。
- 被否决：两边用同一句话。用户需要知道去哪里看那一单的进度，两条流程的进度显示在不同的地方；组织关着时卡片不显示，不能指向卡片。

### D8 旧管线重新分析照旧替换未批准的结果，不分来源

`enqueue-package.ts:487-500` 不改。互斥之后，这一步只会发生在一键分析没有在跑的时候，被替换的是已经结束、还没批准的结果，和替换旧管线自己的结果是同一个意思：新的一份顶替没批的那份。开了一键分析、能用卡片发起的人看不到这个按钮；能走到这里的只有过不了用户级开关的人，以及没开一键分析的组织。

- 被否决：只替换旧管线版本的待审结果。两份待审记录会并存，面板只显示最新的那份（`runs/route.ts:27-31`），旧的一键分析结果就成了一条永远「待审」、却看不见的记录。
- 被否决：禁止替换一键分析的结果。过不了用户级开关的人想重新分析时，只能新增一条并存的记录，结果同上。

### D9 上传后的自动分析：两种做法（GATE 第 1 条，已定 B）

**已定（按推荐，Lucas 2026-11-22 授权）：B**——开了一键分析的组织上传后、文件处理完后都不自动发起，卡片提示「文件已就绪」或「还没纳入」那句。下面两种做法的比较与后果保留备查。

**做法 A：自动分析也走卡片那条流程**

要补的地方：

- 删掉固定 requestId（缺陷 1 消失，新文件可以触发）。
- 是否发起改按「最近一次没被取消的一键分析，是否已经覆盖当前文件包」判断。领域记录里存了文件包指纹（`analysis-run-service.ts:201`），旧管线复用本来就按指纹判断（`enqueue-package.ts:62-84`），所以这一条可以直接比指纹，不必另立规则（缺陷 2 消失）。
- 上传逐文件那条路（自动开关关）也改派过来，并且要改成等文件包就绪再发起：逐文件触发会在文件还没传完、没解析完时就起一单，就绪门今天只在自动开关开的那条路上有。
- 改派失败时不再回落旧管线，否则又成了两条流程。
- 上传人过不了用户级开关时不发起，在卡片上提示。
- 自动单记在上传人名下；元数据今天写死 `trigger:"user"`、`source:"tender_ui"`（`trigger-service.ts:190, 203`），要加一个参数才能和手动点的分开。

**做法 B：开了一键分析的组织不自动发起**

- `enqueueTenderPackageIfReady`（自动开关开）在组织命中一键分析开关时返回原因 `agent_card_manual`；
- 上传逐文件那条路（自动开关关）同样返回 `agent_card_manual`，内容指纹照写，一键分析第一步要用它；
- 删掉改派代码与固定 requestId；
- 卡片在还没跑过时提示「文件已就绪，点「开始 AI 分析」」，有能读的新文件没纳入时显示 FIX-13 的那句（D13）；
- 原因码 `agent_card_manual` 进码表：`AUTO_DISABLED` / 200 / ok，文案「已开通 AI 数字员工分析：上传后不自动分析，请在「AI 数字员工 · 投标分析」卡片上发起」；
- 没开一键分析的组织走原路。

**两种做法在两种自动开关下，开了一键分析的组织上传后会怎样**

| 自动开关 | 今天 | 做法 A | 做法 B |
|---|---|---|---|
| 关（文件头注释写明是生产默认，`auto-flags.ts:7`；生产实际值没核实） | 每次上传，上传接口逐文件对旧管线入队，不看一键分析；同一文件包按指纹复用，有新文件就起一单新的旧管线分析。用户再在卡片上点，就是两条并行。 | 每次上传后，等文件包就绪，自动起一单一键分析（同一指纹不重跑）。上传后不用点。 | 上传后什么都不发起，卡片提示「文件已就绪」。**每次上传后自动出分析结果这件事没有了**，要人点「开始 AI 分析」或「重新分析」。 |
| 开 | 文件处理完改派一键分析，但每个项目只成功一次（缺陷 1）；项目只被卡片分析过时，会对同一包再跑一单（缺陷 2）。 | 新文件处理完自动起一单，同一指纹不重跑。 | 不发起。失去的是「第一次上传后自动跑」（之后今天本来也不会自动跑）。 |

利弊：

- A 的利：两种开关下都保留「上传即分析」；和卡片共用锁和「在跑」口径。
- A 的弊：
  - `process-next` 每次返回 done 都会触发，指纹判断错一次就是一单完整的 9 步分析的钱；
  - 逐文件那条路要补就绪门，改动面最大：`enqueue.ts`、`enqueueTenderPackageIfReady`、指纹判断、发起函数的触发来源参数，规格与测试也更多；
  - 上传人过不了用户级开关时只能不跑，这一点和 B 一样。
- B 的利：字面上就是单一入口，「谁发起、何时花钱」只有一个答案；改动小，只是在两处入口按组织开关短路；「下一步」卡片对还没分析的项目本来就写「还没有发起分析 → 去分析」（`web-next-step.ts:263`）。
- B 的弊：
  - 多点一次；
  - 自动开关关着的一键分析组织（按代码注释是生产默认），每次上传都不再自动分析；
  - 自动开关开着的一键分析组织，第一次上传后不再自动跑；
  - 两种情形都要在合并后由人通知这些组织。

**推荐 B 的理由**（已按此定）：需求第 1 条要的是「只留卡片上的一个按钮」，B 让发起只有人点这一种；A 要在两条自动路径上各补一道判断（指纹、就绪），任何一道写错都是一单额外的完整分析。B 的代价是实打实的：自动开关关着时，一键分析组织每次上传后不再自动出结果。要保留「上传即分析」就得选 A；已定 B，A 不做。

### D10 「正在启动」：客户端与服务端各管一段

- 客户端：点下去就进入「正在启动」，一直到请求失败，或者请求成功后重新读取到新的作业（作业号等于请求返回的作业号）为止。期间状态行是「正在启动…」，按钮不可点、文字是「正在启动…」。
- 服务端：卡片接口用同一个键试拿锁，拿不到时 `starting=true`。卡片把它当成「正在启动…」，并且像排队 / 分析中那样每 8 秒轮询。旧管线新建时也持这把锁，这时报告「正在启动」也是实情：确实有一单正在建。
  - 试拿锁写成一条单独的语句 `SELECT pg_try_advisory_xact_lock(hashtext($key)) AS locked`，不包在交互事务里：这条语句自成一个事务，拿到的锁在语句结束时就释放，取连接与事务超时的失败也少一层。
  - 用 `$queryRaw` 读回布尔值（现有拿锁写的是 `$executeRaw`，`trigger-service.ts:148-149`，因为那个函数不返回值）；键的写法与发起时完全相同（单个 bigint 形式）。
  - 不用会话级的 `pg_try_advisory_lock`：连接池里的连接会带着锁被别的请求复用。
  - 两个人恰好同一瞬间读卡片时，一方可能读到对方试拿的那一下而误报「正在启动」，下一次轮询（8 秒）就恢复，不另处理。
  - 试拿出错时 `starting=false`，接口其余部分照常返回。
- 取消已提交、新单没建成：卡片改成失败后也重新读取。这时状态行是「上一单已取消，新的分析没能启动」，下面一行红字是接口给的原因，按钮仍是「重新分析」。别人看到的是「上次 AI 分析已取消」，这也是实情。
- 被否决：先建新单、再取消旧单。取消一旦失败就是两单并行（正是这次要消除的事故）；还要临时多占一格并发配额（`run.ts:126-142`，默认上限 10）。
- 被否决：在旧单的领域记录里写「正在重启」标记。排队阶段没有领域记录；建单失败后标记会一直留着，卡片会永远停在「正在启动」。
- 被否决：只做客户端。别的标签页、别的人在这段时间仍会看到「上次 AI 分析已取消」。
- 被否决：把取消和建单放进同一个数据库事务。要改 `run.ts` 和 `job.ts` 的连接用法，属于 workforce runtime 的改动（Non-Goals）。
- 被否决：查 `pg_locks` 判断锁是否被占，不去试拿。要把 `hashtext` 的结果拆成 classid / objid 两半去比，写法容易错；试拿那一下的影响只有微秒级。

### D11 卡片与面板入口的显示逻辑抽成纯函数

新文件 `src/lib/tender-workforce/agent-card-view.ts`（FIX-20、FIX-20b 的四件套按这个路径写），只依赖数据，不碰数据库，客户端可以引用。

- 输入：卡片接口数据（含 FIX-20 加的 `retrying`、`blockedReason`、`synthesisNotGenerated`；FIX-20 排在本次之前合并）、客户端是否正在启动、最近一次启动的错误；面板这一侧另有列表带回的 `agentCardEnabled`、卡片回报、是否挂了卡片。
- 输出：状态行、语气、要显示的说明、是否显示发起 / 取消按钮、按钮文字、文件提示；面板旧入口是否显示、空态说明、「还没纳入」那句是否显示。
- 卡片和面板都只调用它。FIX-20 加在 `agent-card.tsx` 里的重试句、受阻句与「综合汇总未生成」那句逐字搬进来，FIX-20 对卡片源码的断言改为对纯函数做用例，意思不变。
- 被否决：逻辑留在组件里。卡片要等 `useEffect` 读完接口才渲染（`agent-card.tsx:153-154`），用服务端静态渲染测不到任何状态。

### D12 按钮和颜色

- 发起按钮与「正在启动…」：主题色底、对比色字、悬停加深，与 `requirements-tab.tsx:53` 的「向业主提问」用同一组颜色与形状类（`rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)] hover:bg-accent-hover`，另加 `disabled:opacity-50`；「向业主提问」多出的 `inline-flex items-center gap-1.5` 是给图标用的，卡片按钮没有图标，不加）。glass 主题下 `.bg-accent` 的字色会自动换成 `--on-accent`（`globals.css:187-190`）。
- 「取消」：`rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-foreground/[0.04] disabled:opacity-50`，悬停色和通用 Button 的 ghost 变体一样（`button.tsx:17`）。
- 说明文字：`text-muted-foreground` 全部改成 `text-muted`（`--color-muted`，`globals.css:215`）。
- 被否决：在 `globals.css` 里定义 `--color-primary`。另外 24 个文件也引用了 `bg-primary`，它们会一起变色，变成全站主题改动（这 24 个文件登记为后续任务第 1 条，tasks 5.2）。
- 被否决：换成通用 `Button` 组件。它的默认高度是 `min-h-9`，`sm` 也是 `h-8`（`button.tsx:8, 22`），卡片里的按钮会变高。

### D13 文件提示：卡片接管「还没纳入」那句

- 只对能用卡片发起的人，并且本项目没有一单在跑、也不在启动时计算：
  - `{"kind":"not_yet_analyzed","count":N}`：与面板今天的判定完全相同——取面板显示的那份分析记录（最新一条，不分来源，`runs/route.ts:27-31`），用 FIX-13 的覆盖计数（`package-coverage.ts:180-218`，只查库）算出能读的比纳入的多 N 个，并且投标包 AI 体验开着（同面板 :487 的条件）。卡片显示 FIX-13 的同一句（`exclusion-text.ts:27-31`）。
  - `{"kind":"ready"}`：上面不成立，本项目从来没有一键分析作业，文件包已就绪（`package-ready.ts` 的就绪判定，只查库）。卡片显示「文件已就绪，点「开始 AI 分析」」。
  - 其余为 `null`。
- 面板那句随旧入口一起显示或隐藏（D2 的表）：能用卡片发起的人只在卡片上看到它，其他人照旧在面板上看到。FIX-13 的接线断言（`package-coverage.test.ts:272-278`）改写为「只算一次、参数不颠倒、按纯函数的结果显示」，意思不变。
- 不调 `getTenderPackageDocuments`：它会读 Blob 并回写指纹（`package.ts:183-198`），读接口不做写入。
- 出错时 `packageHint=null`，接口其余部分照常返回。
- 被否决：卡片和面板各显示一遍。同一页上出现两句一样的话。
- 被否决：卡片按「最近一次一键分析」算数。面板显示的可能是另一份记录（过不了用户级开关的同事刚用旧管线分析过），两处的 N 会不一样；按同一份记录算，挪过去前后数字不变。

### D14 测试两层

1. `src/lib/tender-workforce/__tests__/single-entry.test.ts`：纯逻辑加源码接线，不用数据库，进 `scripts/test-all.sh` 和 `scripts/test-ci-unit.sh`。
   - 纯函数：
     - 卡片各状态：客户端正在启动、服务端正在启动、已取消加启动失败、已取消没有错误、被挡住而没有取消、文件已就绪、还没纳入、过不了用户级开关；FIX-20 加的三句。
     - 面板 D2 表的每一行，包括 `agentCardEnabled=false` 时卡片还没回报也显示旧入口与原句、列表没回来时不显示。
     - D5 的判定：组织开着 / 关着 × 每个作业状态；领域记录「分析中」而作业已结束。
   - 颜色：枚举卡片源码里每个颜色类（`bg-` / `text-` / `border-` 后跟主题名或色阶，排除 `text-xs`、`text-sm` 这类字号类和 `border-b` 这类方向类），断言主题名在 `globals.css` 的 `--color-*` 里有定义，或者是 Tailwind 自带的色阶名（如 `blue-600`）；断言没有 `primary`、`muted-foreground`、`bg-muted`；断言发起按钮的类包含 D12 那一组。
   - 接线：
     - 面板两个旧按钮、空态说明、「还没纳入」那句都由纯函数的结果决定，面板读列表带回的 `agentCardEnabled`；
     - 卡片在三处都回报 false：`enabled=false` 的提前返回之前、非 2xx、抛异常；
     - 卡片请求失败后也会重新读取；
     - 一键分析发起：判能不能发起在取消之前，查旧管线在取消之前；
     - 拿共享锁的三处（一键分析发起、旧管线重新分析、旧管线入队）：前两条语句依次是 `SET LOCAL lock_timeout` 与拿锁，事务参数写了 `maxWait` 与 `timeout`；重新分析先拿共享锁再锁 Project 行；旧管线持锁段里没有 `db.` 调用；
     - 卡片接口的试拿锁是一条不在事务里的 `$queryRaw`，用的是 `pg_try_advisory_xact_lock`，源码里没有会话级的 `pg_try_advisory_lock`；
     - 卡片接口在 `enabled=false` 时不派生角色、不试拿锁、不算文件提示；三个新字段各在自己的出错兜底里；
     - 做法 B 的两处短路都以组织开关为条件；
     - `enqueue-package.ts` 里不再有 `auto-enqueue:`，也不再调用一键分析的发起函数；
     - 卡片接口路由不直接连数据库；
     - 四句文案只在 `single-entry-rules.ts` 定义一次，`single-entry-rules.ts` 与 `agent-card-view.ts` 不引用 `@/lib/db`；
     - 本次新增的 `src` 非测试代码里没有 `source: "upload"` 字面量（FIX-19 的守卫要求）。
2. `src/lib/tender-workforce/__tests__/single-entry-db.isolated.test.ts`：隔离库，进 `scripts/test-all.sh`，没有隔离库时跳过。写法照 `job-failure-surfacing-db.isolated.test.ts`，夹具用 `seedWorkforceFixture`；夹具里当招标文件建的每一份 `ProjectDocument` 一律写 `source: "upload"`（FIX-19 合并后招标文件包、就绪与覆盖只认 `source = "upload"` 的文件；没写来源的落成默认 `external_link`，不进文件包，「旧管线照常新建」「文件提示」等用例会失败）。用例分组：
   1. 旧管线 PENDING 时，一键分析开始和重新分析都返回 409、码与文案正确；作业数不变，已有的一键分析作业没被取消，旧记录仍是 PENDING。
   2. 旧管线 FAILED、尝试 2 次时，发起成功，那一单变成 SUPERSEDED；尝试 5 次的不动；先把它改成 EXTRACTING 再发起，返回 409。
   3. 一键分析作业在排队、等人处理时（组织开着），`…/package` 的重新分析与入队返回 409、码 `ACTIVE_RUN_EXISTS`；单条记录接口返回 409、码 `active_run`；文案都是组织开着那句；不新建记录，响应里没有作业号和 `runId`。旧管线自己有一单 PENDING 时，单条记录接口返回 409、码 `active_run`、既有文案。
   4. 并发两组：一键分析「开始」对旧管线「重新分析」；一键分析「重新分析」对旧管线「入队」。每组 10 轮，单双轮调换先发的一方，每轮先删掉本项目的记录与作业。每轮结束时两条流程的进行中记录合计恰好 1，输的一方拿到 D7 表里对应的码与文案（不是限流、不是 500）。
   5. 持锁：另开一个事务拿住锁 6 秒，期间发起三个入口（一键分析开始、旧管线重新分析、旧管线入队），三者在锁释放后照常判定，没有 500；拿住 12 秒，三者在约 10 秒时返回「正在启动」的 409；持锁期间卡片接口 `starting=true`，释放后变回 false。
   6. 名单里的用户 `canStart=true`，名单外的为 false；列表接口在开了一键分析的组织里 `agentCardEnabled=true`；名单外的人对一张等人处理的作业调「重新分析」，返回 403，作业仍是等人处理；文件提示的两种情况，以及「还没纳入」的 N 与 FIX-13 覆盖计数一致。
   7. 开了一键分析的组织：自动开关开时文件处理完不新建任何记录，原因是 `agent_card_manual`；自动开关关时上传逐文件同样不新建，内容指纹已写。
   8. 没开一键分析的组织：两种自动路径照常新建旧管线记录；重新分析、入队照常；卡片接口 `enabled=false`、`canStart=false`、`starting=false`、`packageHint=null`；列表接口 `agentCardEnabled=false`。
   9. 组织关了开关：一键分析作业等人处理时，旧管线重新分析照常新建；作业排队时，返回 409、组织关着那句。作业已完成、领域记录停在「分析中」时，旧入口照常新建。
   10. 卡片接口与列表接口的响应里搜不到用户级开关名单里的任何一项、当前用户的岗位与派生角色、锁的键前缀 `tender-workforce-start:`；卡片接口里搜不到别人发起时带的请求号。
   11. 没有一单在跑、最新的是一份一键分析产生的待审结果时，名单外的人点「重新分析当前投标文件包」，新建一条 PENDING，那份待审结果变成 SUPERSEDED。
- 既有测试的改动：
  - `obs-p2p3-single-pipeline.test.ts`：
    - P3-01 改为「一键分析组织不自动发起」；
    - P3-02 去掉；
    - P3-03 改为「对方在跑由共享判定挡住」：入队与重新分析都调用 `single-entry` 的判定（原断言要求 `enqueue-package.ts` 里同时有 `reason: "workforce_active"` 和版本常量，判定挪走后会变红）；
    - P3-04 改为「旧管线不退役」：没开一键分析的组织照常调用入队函数（原断言要求源码里有「回落 legacy」，这几个字只在要删除那段代码的日志里，`enqueue-package.ts:623, 628`）；
    - P3-05 改为「源码里没有固定 requestId」。
  - `enqueue-outcome.test.ts`：补 `workforce_active`、`start_in_progress`、`agent_card_manual` 三条，以及「失败结果自带文案时优先用它」。
  - `job-failure-surfacing.test.ts:82-84` 的三条卡片断言（连同 FIX-20 加的卡片断言）改为对纯函数做用例，意思不变。
  - FIX-13 `package-coverage.test.ts:272-278` 那条面板接线断言改写（D13），其余不动。
  - 状态函数多一个可选的当前用户参数，不传时 `canStart=false`、`packageHint=null`；`t1b-integration.test.ts`、`job-failure-surfacing-db.isolated.test.ts` 的调用处不用改。`t1b-integration.test.ts` 的 T1B-14 不改，继续守「开关关时旧入口照常」。
- 被否决：只写源码断言。证明不了锁真的互斥，也证明不了被挡时数据库没被改。
- 被否决：「没开一键分析的组织行为不变」只靠隔离库测试守。CI（`.github/workflows/ci.yml:99`）只跑 `test:ci`，隔离库测试不在里面；面板显示条件、卡片回报、短路条件这些写漏一处就会让所有没开一键分析的组织失去旧按钮或自动入队，必须在 CI 里有断言。

## 相邻改动与合并顺序

定的顺序（2026-11-22 统一）：**#548 FIX-17 → FIX-21 → FIX-19 → FIX-14 → FIX-20 → FIX-15 → FIX-18 → FIX-20b → FIX-22 → FIX-16**。FIX-13（#546）已合并，它的归档 #547 也已合并（main `01e444b9`）。本次排在 FIX-15 之后：FIX-15 合并后把 main 合入本分支，并核对 FIX-19 / FIX-20 / FIX-21 合并后相邻文件的行号，再开工（tasks 开工前提）。

| change | 它改什么 | 与本次的交集 | 怎么协调 |
|---|---|---|---|
| FIX-13 `document-parse-nul-and-reason`（#546 已合并，main `13c7ed33`；归档 #547 已合并，main `01e444b9`） | 面板覆盖清单与「还没纳入」那句（`analysis-panel.tsx:487-535`）、`exclusion-text.ts`、`package-coverage.ts` | 本次让「还没纳入」那句按纯函数结果显示，并对它的能力 `tender/analysis-package-coverage` 写 MODIFIED；改写它的一条接线断言 | 本次按它合并后的行号写。它的主规格 `tender/analysis-package-coverage` 已随 #547 进 main，本次的 MODIFIED 有主规格可改，归档不用再等 |
| FIX-17 `project-files-access-guard`（PR #548） | `files/[fileId]/route.ts`、`files/process-next/route.ts` 加项目读权限检查 | 无共同代码文件；都在 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 加注册行 | 第一个合并。它之后，有读权限的人经 process-next 也会触发自动入队；本次在开了一键分析的组织里去掉了这条自动发起，没开的组织不变 |
| FIX-21 `project-intel-bidpackage-access` | 情报与一键投标方案的六个接口补项目权限守卫；新增目录守卫测试 `src/lib/projects/__tests__/project-routes-guard.test.ts`（进 CI 子集），查 `src/app/api/projects/[id]/` 下每个处理函数第一步不带条件地调用项目级守卫、紧接着检查结果 | 本次改的三个接口 `tender-analysis/agent/route.ts`、`tender-analysis/runs/route.ts`、`tender-analysis/runs/[runId]/reanalyze/route.ts` 都在这个目录里；无共同代码文件；都在两个注册脚本加行 | 先合并。**本次改或加 `src/app/api/projects/[id]/` 下的接口，写法照它的目录守卫测试：每个处理函数第一步不带条件地调用项目级守卫（这三个接口用 `requireTenderAnalysisRead` / `requireTenderAnalysisWrite`，它们转调 `requireProjectReadAccess` / `requireProjectWriteAccess`），下一条语句就用 `isAccessError` 检查结果并返回。** 新加的取当前用户（`access.user`）、算 `agentCardEnabled` 都放在这条检查之后。三个接口今天就是这个写法（main `13c7ed33`），本次不动守卫那两行，也不新增接口；`npm run test:ci` 会跑这个测试（tasks 5.1） |
| FIX-19 `tender-package-exclude-generated` | 招标文件包、就绪、覆盖只认 `source = "upload"` 的文件（`package.ts`、`package-ready.ts`、`package-coverage.ts`）；守卫测试要求 `src` 非测试代码里没有 `source: "upload"` 字面量；`t1b-integration.test.ts` 夹具补来源 | 本次的文件提示调用就绪与覆盖函数；本次隔离库夹具的文件要写来源；它登记的后续任务「指纹回到旧值时旧流程自动入队撞唯一键」落在本次改的 `enqueue-package.ts` | 先合并。本次隔离库夹具里当招标文件建的每一份 `ProjectDocument` 一律写 `source: "upload"`；本次的 `src` 代码只调用它的函数，不写字面量；T1B-14 本次不改。撞唯一键那一条本次不修（D4），它写明排在本次之后 |
| FIX-14 `extracted-text-nul-other-paths` | 询价回信、采购附件、AI 对话附件与标题、产品资料、成本表导入写库前清理 U+0000 | 无共同代码文件；都在两个注册脚本与 TASKFLOW 加行 | 先合并。合入后按新的注册行位置加本次的两条 |
| FIX-20 `tender-job-synthesis-degrade` | 卡片接口加 `retrying`、`blockedReason`、`synthesisNotGenerated`，卡片上加重试句、受阻句、「综合汇总未生成」那句（写在 `agent-card.tsx`）；`job-failure-surfacing.test.ts` 加卡片断言 | 同一个卡片组件、同一个状态函数、同一个测试文件 | 先合并。本次抽纯函数时把它的三句逐字搬进 `agent-card-view.ts`，它的卡片源码断言改为对纯函数做用例，报告里写明这次迁移。本次对卡片接口响应只做「不含某些内容」的断言，不断言键的全集，它加的字段不受影响 |
| FIX-15 `workforce-invocation-deadline` | workforce 运行时的调用截止：`workforce-runtime/processor.ts`、`agent-runtime-v2/` 的规划与核验、`src/lib/tender-workforce/tools.ts`、`api/cron/agent-runs/route.ts`、`self-trigger.ts` | 无共同代码文件；本文 Context 引了 `tools.ts:501-509`；它不加新的作业状态，D5 的活跃阻断集不受影响；都在两个注册脚本加行 | 先合并，是本次开工前最后一个。合入后核对 `tools.ts` 的行号。它登记的后续任务里「旧管线 FINALIZE 没有时限」「旧管线认领门槛还是 45 秒」两条写着「FIX-18 若下线旧管线入口就不再需要」：本次不下线旧管线（Out of scope），这两条照旧需要 |
| FIX-20b `tender-job-continue-from-failed` | 卡片接口加 `continuable`，POST 加 `continue`，在同一把锁里复查，复用 `canStart` 与卡片纯函数 | 同一把锁、同一个接口、同一个纯函数 | 后合并。它拿锁时遵守 D4 的不变式（第一条语句设等锁上限、锁是第一把锁、写明事务参数、等锁超时回「正在启动」）；它的「在跑」复查用 D5 的口径；它对「项目卡片显示原因」的 MODIFIED 在本次的版本上改 |
| FIX-22 `tender-requirements-tab-converge` | 面板去掉要求列表、「批准分析」移到矩阵顶部，面板只留进度部分 | 同一个面板文件、同一个按钮栏 | 后合并。它保留本次的两个旧按钮、卡片回报、列表带回的 `agentCardEnabled` 与「还没纳入」那句的显示条件；它说的「覆盖清单一字不改」指本次之后的版本。本次 `single-entry.test.ts` 的面板断言按「由纯函数结果决定」写，不绑行号与位置，它重排后不改断言即通过 |
| FIX-16 `tender-analysis-incomplete-notes` | 面板运行头部下面加「这次分析有几处没做完」 | 它引用覆盖清单下面的两句提示（FIX-13 后 `:511-520`） | 最后合并。本次之后，「还没纳入」那句对能用卡片发起的人改在卡片上显示；它 rebase 时按这个改引用，它自己的那一块不受影响 |

## 与八条硬纪律的关系

1. 零 schema：遵守。不新增 model、字段、migration。状态只用既有的字符串值（SUPERSEDED）；锁是 PostgreSQL 的事务级 advisory lock，不建表。
2. 出站动作先审批：不涉及，系统不对外发送任何东西。合并后通知已开一键分析的组织，由人用既有渠道去说，不由系统发邮件。
3. 禁止第三套队列：遵守。
   - 不新增队列、调度、租约、worker 名单；两条流程仍由既有的 `/api/cron/agent-runs` 和 `/api/cron/tender-auto-analysis` 消费。
   - 用的锁是事务级互斥，事务结束就释放，不是租约，同一把锁已经在 `trigger-service.ts:149` 用着。
   - 新文件名 `single-entry.ts`、`single-entry-rules.ts`、`agent-card-view.ts` 不含架构守卫禁止的词（`runtime-architecture/guards.ts:96-105`）；`tender-auto-analysis` 和 `tender-workforce` 之间的引用不在禁止方向表里（`guards.ts:137-176`）。
4. 脱敏：不涉及 Muse 通道。与它同方向的一条：409 响应、卡片接口与列表接口不带对方记录的 id、开关名单、岗位、锁的键（规格里有 SHALL NOT）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。
   - 不新增模型调用。
   - 「在跑」「能不能发起」「文件提示」都是查表、计数。
   - 做法 B 去掉了自动发起，模型调用只会少，不会多。
8. 测试注册：遵守。两个新测试都注册进 `scripts/test-all.sh`，纯逻辑那个也进 `scripts/test-ci-unit.sh`；`bash scripts/check-test-registry.sh` 通过，`ci/test-registry-baseline.txt` 不加行。

## 验证方式

- `npx tsx src/lib/tender-workforce/__tests__/single-entry.test.ts`：改动前退出码非 0（报出 `primary`、`auto-enqueue:`、没有查旧管线、没有 `lock_timeout` 等），改动后为 0。
- `NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… DIRECT_URL=… npx tsx src/lib/tender-workforce/__tests__/single-entry-db.isolated.test.ts`：改动前，互斥、等锁超时、自动入队、`starting`、关了开关的用例失败；改动后全部通过，连跑 3 次结果一致。
- `npx tsx` 逐个跑：`src/lib/tender-auto-analysis/__tests__/obs-p2p3-single-pipeline.test.ts`、`enqueue-outcome.test.ts`、`ready-gate.test.ts`、`package-coverage.test.ts`、`requirement-batch-confirm.test.ts`、`src/lib/tender-workforce/__tests__/t1b-pure.test.ts`、`job-failure-surfacing.test.ts`、`src/lib/navigation/__tests__/entry-visibility.test.ts`、`src/components/project-detail/__tests__/tender-detail-ia.test.ts`、`src/lib/tender-next-step/__tests__/web-next-step.test.ts`、`src/lib/tender-submission-checklist/__tests__/checklist.test.ts`、`src/lib/projects/__tests__/project-routes-guard.test.ts`（FIX-21 目录守卫），全部通过。隔离库上 `t1b-integration.test.ts` 通过，T1B-14 不改断言。
- `npm test` 对照既有失败清单没有新增；`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh` 通过；`openspec validate tender-analysis-single-entry --strict` valid。
- 本地截图（夹具组织）：
  1. 开了一键分析的项目页上只有卡片按钮，覆盖清单下面没有「还没纳入」那句、卡片上有；
  2. 「正在启动…」；
  3. 「上一单已取消，新的分析没能启动」；
  4. 过不了用户级开关的人看到的卡片和旧按钮；
  5. 没开一键分析的组织，页面与改动前相同（旧按钮与面板数据同时出现）。

## Risks / Trade-offs

- [过不了用户级开关的人，遇到一张别人发起、正在等人处理的作业] → 旧入口被 409 挡住，卡片上没有给他们的按钮，只能找能发起的人点「重新分析」。文案写明「或在等人处理」，并指向卡片。卡片在等人处理时没有「取消」按钮，登记为后续任务第 4 条（tasks 5.2）。
- [一键分析发起的事务超时（20 秒），而建作业还在别的连接上跑] → 锁先释放，建作业随后才提交；这期间进来的旧管线入口查不到它，可能各建一单。今天的写法就有这个窗口；建作业正常不到 2 秒，本次把等锁上限定在 10 秒，让排在后面的入口先放弃，不能完全消除，报告里写明；根治要让取消与建作业走持锁事务的连接，登记为后续任务第 7 条（tasks 5.2）。
- [一键分析发起仍是「持锁事务占一条连接、工作走别的连接」] → 连接池紧张时，排队等锁的请求各占一条连接；本次给等锁设了 10 秒上限、取连接 5 秒上限，旧管线持锁段只用一条连接，报告里写明；与上一条同一个根，同在后续任务第 7 条。
- [「重新分析」在取消旧单之后建作业失败（配额用完、计划落库失败）] → 卡片显示「上一单已取消，新的分析没能启动」和原因；D6 标成「已被替代」的旧管线记录不回退。用户级开关的失败已在取消之前挡住（D1）。取消与建作业不在一个事务里，同在后续任务第 7 条。
- [没开一键分析的组织，面板首次加载完成前不再先显示「分析投标文件」] → 列进 GATE 第 6 条的例外。
- [卡片接口每次多查几项：岗位派生、试拿锁、文件就绪、覆盖计数] → 只对开了一键分析的组织计算；只在卡片加载和排队 / 分析中 / 正在启动时轮询（8 秒一次）；文件提示只在没有一单在跑时计算。
- [做法 B 改变了一键分析组织上传后的行为] → 合并后由人通知（Migration Plan 第 2 步）；卡片上有「文件已就绪」提示。自动开关关着时影响的是每一次上传（D9 的表）。
- [一键分析作业跑到一半组织开关被关掉] → 排队到修复的作业会挡住旧入口，直到它跑完（这些状态会自己结束）；等人处理、等审批的不挡（D5）。

## Migration Plan

没有数据迁移。**没有开关，合并即在生产生效**：部署后两条流程立刻互斥，开了一键分析的组织上传后立刻不再自动发起，卡片与面板立刻按新规则显示。已经在跑的旧管线记录照常由定时任务消费，已经建出的一键分析作业照常跑；部署前就已经在并行跑的两单不回头处理，互斥只管部署后的新发起。回滚就是 revert 这一个 PR。

合并后要人做的事（报告「合并后要人做的事」一节照写）：

1. 查开关的生产值。有 Vercel 环境变量读权限的人（Lucas 指定）只读、不改，读下面几项，结果贴回报告：
   - `TENDER_WORKFORCE_ANALYSIS_ENABLED` 与它的组织名单（`src/lib/tender-workforce/flags.ts:29-47`）：哪些组织开了一键分析，也就是第 2 步要通知的名单；开关开着、组织名单为空时是全部组织；
   - `TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED`（`auto-flags.ts:37-48`）：做法 B 的代价落在 D9 表的哪一行，决定通知里怎么说；
   - `WORKFORCE_RUNTIME_ENABLED` 与它的组织 / 用户 / 角色名单（`workforce-runtime/flags.ts:34-61`）：这些组织里哪些人看到的是「你的账号还没开通 AI 数字员工分析」、要用面板下方的旧按钮。
2. 通知。名单就是第 1 步读出的一键分析组织。Lucas 定由谁用既有渠道说一次：上传后不再自动分析，请在「AI 数字员工 · 投标分析」卡片上点「开始 AI 分析」或「重新分析」；账号没开通的人照旧用面板下方的按钮。系统不为此发邮件。
3. 只读查询。实现时写 `docs/acceptance/fix-18/prod-check.sql`（`BEGIN READ ONLY` 开头、`ROLLBACK` 结尾，中间只有 SELECT），部署后交有生产只读权限的人（Lucas）跑，结果原样贴回报告：
   - 第 1 条：部署时同一项目两条流程都有进行中的单——非一键分析版本、状态 PENDING / EXTRACTING / ANALYZING 的 `TenderAnalysisRun`，与同一项目处于活跃阻断集的招投标作业（`AgentRun`，按 `metadata.projectId` 与 `metadata.workDomain = 'tender'` 认项目）。这些是互斥上线前就在并行的，两单都跑完后会多出一份待审结果；
   - 第 2 条：同一项目有两份及以上 REVIEW_REQUIRED 的 `TenderAnalysisRun`（多份待审并存，后续任务第 6 条）；
   - 第 3 条：2026-11-22 16:27 并行两单那个项目在 16:27 前后的 `TenderAnalysisRun` 与招投标作业（tasks 5.2 的前两条核实方法），再配合 Vercel 日志判断是哪两个入口。
4. 要重新分析的项目名单与谁来点。本次不改分析内容，不需要为本次整批重新分析。第 1、2 条查出的项目按项目去重交 Lucas，由 Lucas 定哪些重新分析（整份重做，会再调用模型）；定下的由项目负责人在「招标要求」页点：能用卡片发起的人点卡片上的「重新分析」，账号没开通的人和没开一键分析的组织点「重新分析当前投标文件包」。卡片的「重新分析」不会把更早的待审结果标为已被替代（后续任务第 6 条），并存的旧待审记录要等那一条修好才会消失；面板只显示最新一份，不影响使用。

## 留给 GATE

六条已按推荐定：Lucas 2026-11-22 约 23:20 UTC 把项目全权交给本会话（「都按照你的推荐来」）。第 1 条 B、第 2 条 ①、第 3 条改 409 码值不变、第 4 条停掉重试、第 5 条照常显示、第 6 条 A。六条都与原推荐相同，Decisions、规格与 tasks 本来就按推荐写，不用改写；下面的选项与后果保留备查。

1. **上传后的自动分析：做法 A 还是做法 B**（D9）
   - **已定（按推荐，Lucas 2026-11-22 授权）：B**——开了一键分析的组织上传后、文件处理完后都不自动发起，卡片提示「文件已就绪」或「还没纳入」那句。D9、规格「开了一键分析的组织上传后不自动发起」「卡片提示文件已就绪或有文件没纳入」、tasks 3.1 已按 B 写。代价照下面 B 的后果：自动开关关着的一键分析组织每次上传后都不再自动分析；生产上自动开关的值合并后查（Migration Plan 第 1 步），并由人通知这些组织（第 2 步）。
   - A：上传或处理完自动发起一键分析，按文件包指纹判断是否已经分析过，去掉固定 requestId，逐文件那条路补就绪门，不回落旧管线。后果：两种自动开关下都保留「上传即分析」；但两条自动路径各多一道判断，写错一次就是一单额外的完整分析；自动单记在上传人名下；上传人过不了用户级开关时不跑。tasks 3.1 改为实现 A，规格里「开了一键分析的组织上传后不自动发起」和「卡片提示文件已就绪或有文件没纳入」两条要改写。
   - B：开了一键分析的组织不自动发起，卡片提示「文件已就绪，点「开始 AI 分析」」。后果：多点一次；**自动开关关着的一键分析组织（按代码注释是生产默认），每次上传后都不再自动分析**；自动开关开着的，第一次上传后不再自动跑；合并后要由人通知这些组织。
   - **推荐 B**，理由见 D9 末。生产上自动开关的实际值没有核实，它决定 B 的代价落在 D9 表的哪一行。
2. **「组织开了一键分析」的判定**（D1）
   - **已定（按推荐，Lucas 2026-11-22 授权）：①**——组织开关加用户级开关。D1、D3、规格「能用卡片发起的人只看到卡片上的发起按钮」「过不了用户级开关的人看状态、用旧按钮」已按 ① 写；后果照 ①：过不了用户级开关的人看旧按钮，他们用旧管线重新分析时会把一键分析产生的待审结果标为已被替代（D8）。
   - ① 组织开关加用户级开关：过不了用户级开关的人看旧按钮；他们用旧管线重新分析时，会把一键分析产生的待审结果标为已被替代（D8）。
   - ② 只看组织开关：过不了用户级开关的人两个按钮都用不了。
   - ③ 再加项目写权限：只读成员看到点不了的旧按钮。
   - **推荐 ①**：页面上每个人都至少有一个点得成的入口；需求原文「组织开了一键分析时旧按钮不显示」对能用卡片发起的人严格成立。
3. **单条记录重新分析接口 `POST …/runs/:runId/reanalyze` 遇到「已有一单在进行」时**
   - **已定（按推荐，Lucas 2026-11-22 授权）：改 409，码值仍是 `active_run`**。D7、规格「单条记录重新分析接口遇到旧管线自己在跑时返回 409」、tasks 2.2 已按此写；没开一键分析的组织里这个接口从 400 变成 409，列在第 6 条的例外里。
   - 改 409、码值仍是 `active_run`（不改成码表里的 `ACTIVE_RUN_EXISTS`）：满足需求第 3 条；没开一键分析的组织里，旧管线自己挡自己时也从 400 变成 409；码值不变，读码的调用方不受影响。这个接口在界面上没有调用方。
   - 保持 400：没开一键分析的组织完全不变，但同一件事 `…/package` 回 409、这个接口回 400。
   - **推荐改 409、码值不变**。
4. **一键分析发起时，旧管线「失败、还会自动重试」的那一单怎么办**（D6）
   - **已定（按推荐，Lucas 2026-11-22 授权）：停掉重试（标为已被替代），然后发起**。D6、规格「一键分析发起时停掉旧管线失败后的自动重试」、tasks 2.1 已按此写；那一单之后不再自动重试，标记不回退。
   - 停掉重试（标为已被替代），然后发起：用户点了就能跑；那一单的自动重试不再发生。
   - 当作在跑，挡住：用户看到「分析失败」却点不了，直到 5 次重试用完，单是重试间隔加起来就约 14 分钟。
   - **推荐停掉重试**。
5. **卡片接口失败时，开了一键分析的组织里旧按钮怎么办**（D2）
   - **已定（按推荐，Lucas 2026-11-22 授权）：照常显示旧按钮**。D2 的表、规格「卡片接口失败时旧按钮照常显示」、tasks 4.1 / 4.2 已按此写；能用卡片发起的人在接口失败时会看到旧按钮，点了走旧管线，互斥照常挡。
   - 照常显示旧按钮：能用卡片发起的人在接口失败时会看到旧按钮，点了走旧管线（互斥照常挡，不会并行）。
   - 隐藏旧按钮，写「分析入口没有加载出来，点这里重试」：不会走到旧管线；但失败时过不了用户级开关的人也没有入口。
   - **推荐照常显示**：三个新字段各自容错后，接口只在登录失效或数据库不可用时失败，这时旧按钮同样点不成；隐藏的做法让本来只能用旧按钮的人失去入口。
6. **没开一键分析的组织「行为不变」的例外**（D2、D4、D5、D7）
   - **已定（按推荐，Lucas 2026-11-22 授权）：A**——面板从自己的列表数据读组织开关（`agentCardEnabled`），旧按钮与面板数据同时出现，不等卡片。D2、规格「分析记录列表接口带组织开关」「没开一键分析的组织页面与自动入队不变」、tasks 2.1 / 4.2 已按 A 写；剩下的四条可见例外照下面 A 列的写进报告并实测（tasks 5.2）。
   - A：面板从自己的列表数据读组织开关（`agentCardEnabled`），旧按钮与面板数据同时出现，不等卡片。剩下的可见例外：
     1. 单条记录重新分析接口 400 改 409（第 3 条）；
     2. 组织开关关掉时还在跑（排队到修复）的一键分析作业挡住旧入口，直到它跑完；
     3. 两个旧入口同时发起时先后执行，等锁超过 10 秒的那个返回 409「正在启动」；
     4. 面板首次加载完成之前，空态的「分析投标文件」不再先显示。
   - B：列表接口不带开关，面板一律等卡片回报。在 A 的四条之外再多一条：没开一键分析的组织，旧按钮要等卡片那次请求回来才出现（实测时间写进报告）。
   - **推荐 A**：Evan 明说没开一键分析的组织行为不变；A 只多一个只读环境变量的布尔字段，进度条不读它。

tasks 一共 8 条，在上限内，不用拆分。

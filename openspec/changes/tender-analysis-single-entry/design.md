# Design：招标分析只留一个入口（FIX-18）

## Context

动机见 proposal 的 Why。下面只写决定做法要用到的现状，都对过代码。行号以 main `2ef4f9c8` 为准；`analysis-panel.tsx` 的行号按 FIX-13（#546）合并后的样子写。

**谁算「开了一键分析」**

- 卡片显示的 `enabled` 只看组织开关：`TENDER_WORKFORCE_ANALYSIS_ENABLED`，加上可选的组织名单（`src/lib/tender-workforce/flags.ts:29-47`，状态函数在 `trigger-service.ts:301` 调用）。
- 真正建作业时还要过用户级开关 `isWorkforceRuntimeEnabled`（`src/lib/workforce-runtime/job.ts:150-159`）。
  - 它要求 `WORKFORCE_RUNTIME_ENABLED` 打开，并且组织 / 用户 / 角色三个名单里至少有一个非空且命中（`workforce-runtime/flags.ts:34-61`）。
  - 角色按岗位派生（`src/lib/rbac/effective-platform-role.ts:50-62`）。
  - 用户级开关没过的人，点卡片会得到 403「Workforce Runtime 未开启，无法启动 AI 分析」（`trigger-service.ts:209-220`，`agent/route.ts:96-98`）。
- 卡片的发起接口和旧管线的发起接口都要求项目写权限（`agent/route.ts:45`，`package/route.ts:29`）。卡片读接口只要求读权限（`agent/route.ts:31`）。

**入口有四个，外加一个没有界面调用方的接口**

1. 卡片「开始 AI 分析 / 重新分析」（`agent-card.tsx:232-239`）→ `POST …/agent` → `startTenderWorkforceAnalysis`（`trigger-service.ts:107-231`）。执行顺序：
   - 先查 requestId，不看状态（:130-141）；
   - 再拿 `pg_advisory_xact_lock(hashtext('tender-workforce-start:<org>:<project>'))`（:143-149）；
   - 查本项目正在进行的作业（:151，集合在 :40-51，含 `needs_human`）；
   - 如果是重新分析，先取消旧单（:160-168），再新建（:182-208）。
   - 不看旧管线的任何记录。
2. 面板「重新分析当前投标文件包」（FIX-13 后 `analysis-panel.tsx:558-567`）→ `reanalyzeTenderPackage`（`enqueue-package.ts:354-539`）：
   - 显示条件只有最新记录（不分来源，`runs/route.ts:27-31`）不是 SUPERSEDED；
   - 锁的是 Project 行（:408-410）；
   - 只查旧管线的 PENDING / EXTRACTING / ANALYZING（:412-422），不查一键分析作业，也不查 `AGENT_ANALYZING`；
   - 建完后把所有来源的 REVIEW_REQUIRED 标为 SUPERSEDED（:487-500）。
   - 单条记录接口 `POST …/runs/:runId/reanalyze` 走同一个函数（`review.ts:216-255`）。它遇到 `active_run` 回 400（`reanalyze/route.ts:28-35`），`src/**/*.tsx` 里没有调用方。
3. 面板空态「分析投标文件」（FIX-13 后 `analysis-panel.tsx:441-448`），和卡片的「开始 AI 分析」同时显示 → `POST …/package {action:"enqueue"}` → `enqueueTenderPackageAnalysis`（`package/route.ts:93-97`，`enqueue-package.ts:155-331`）：
   - 没有锁；
   - 只按文件包指纹复用 PENDING / EXTRACTING / ANALYZING / REVIEW_REQUIRED（:62-84, 226-243），不含 `AGENT_ANALYZING`。
4. 上传后自动入队，分两条路，看 `TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED`（`auto-flags.ts:37-48`）：
   - 开关关：上传路由逐文件调 `enqueueTenderPackageAnalysis`（`files/route.ts:178-191` → `enqueue.ts:100-105`），完全不看一键分析。
   - 开关开：上传时只写内容指纹（`enqueue.ts:47-52, 96-98`），文件处理完由 `process-next` 调 `enqueueTenderPackageIfReady`。这个调用在每一次返回 done 时都会发生（`process-next/route.ts:164-167, 206, 225`）。
   - `enqueueTenderPackageIfReady` 在组织命中一键分析开关时改派一键分析（`enqueue-package.ts:587-621`），参数是固定的 `requestId: auto-enqueue:<projectId>` 和 `restart:false`。改派失败或抛异常时回落旧管线（:622-630, 652-656）。回落前只查 `AGENT_ANALYZING`（:634-650）。

**由此带出的两个缺陷**（只从代码推出，生产未核实）

- 缺陷 1：requestId 重放不看状态，而自动入队的 requestId 每个项目固定一个。所以第一张自动单建出来以后，这个项目以后的自动触发都返回这张旧单，新传的文件永远不会被自动分析。
- 缺陷 2：如果项目只被卡片分析过、而且已经完成，第一次自动触发不会命中重放，进行中的作业集合也是空的，于是会对同一个文件包再跑一单完整的 9 步分析（`deterministic-plan.ts:105-210`）。

**「在跑」的现有口径**

- 一键分析：
  - 作业状态在活跃阻断集里（`trigger-service.ts:40-51`）。
  - 领域记录 `AGENT_ANALYZING` 要等第一步执行时才创建（`tools.ts:501-509` → `analysis-run-service.ts:96-233`）。
  - 作业进入 `needs_human` 或失败后，领域记录会被收尾成 `AGENT_FAILED`（`job-failure-surfacing.ts:61, 83-86`）。
- 旧管线：
  - PENDING / EXTRACTING / ANALYZING（`enqueue-helpers.ts:16-20`）。
  - 另外，FAILED 且尝试次数少于 5 次的记录也会被定时任务再次认领（`worker.ts:44, 976-1001`）。认领时按状态做条件更新（`worker.ts:259-282`）。

**卡片现状**

- 状态文案只看接口数据、不看 `busy`（`agent-card.tsx:160-182`）；`CANCELLED` 对应「上次 AI 分析已取消」（:176-178）。
- 请求失败时只显示错误、不重新读取（:130-135）。
- 只在排队 / 分析中轮询（:54, 99-104）。
- 发起按钮用 `bg-primary` / `text-primary-foreground`（:236），「取消」用 `hover:bg-muted`（:227），说明文字用 `text-muted-foreground`（:192-193, 205, 211, 216, 246）。
- 用仓库的 Tailwind 4.2.2 编译 `src/app/globals.css` 实测：
  - `bg-primary`、`text-primary-foreground`、`text-muted-foreground` 不生成任何样式；
  - `hover:bg-muted` 生成 `background-color: var(--muted)`，即 `#6e7d76` 深灰。
  - 主题映射在 `globals.css:207-252`。

**取消和建单不在一个数据库事务里**

- `cancelAgentRun` 自己开事务并提交（`src/lib/agent-runtime/run.ts:572-596`）。
- `createWorkforceJob` 用的是全局连接（`job.ts:223-313`）。
- 所以「旧单已取消、新单还没建」这段时间对其它读取可见；建单失败时取消也不会回滚。

**生产上几个开关的实际值，仓库里查不到**（`docs/QINGYAN_TENDER_FLOW_BASELINE.md:172` 把它列为待确认问题）。

## Goals / Non-Goals

**Goals**

- 开了一键分析、并且能用卡片发起的人，在页面上只看到卡片上的一个发起按钮。
- 两条流程在服务端互斥：同一项目同一时间至多一单在跑，并发点两个入口也一样。
- 开了一键分析的组织，上传后不再自动发起（按推荐的做法 B；如果 GATE 选 A，见末节）。
- 卡片在启动期间显示「正在启动…」，启动失败时说清楚旧单已取消。
- 卡片按钮是正常的主按钮和次按钮，卡片里只用主题里定义过的颜色。
- 没开一键分析的组织，界面与自动入队不变。

**Non-Goals**（具体到文件）

- 不改 `src/lib/workforce-runtime/**`：`job.ts`、`processor.ts`、`flags.ts`、`read-model/**`。
- 不改 `src/lib/agent-runtime/run.ts`（`cancelAgentRun`、`createAgentRun`）。
- 不改 `src/lib/tender-auto-analysis/worker.ts`、`src/app/api/cron/**`、`vercel.json`。
- 不改 `src/lib/tender-workforce/tools.ts`、`analysis-run-service.ts`、`flags.ts`、`job-failure-surfacing.ts`。
- 不改 `src/app/api/projects/[id]/files/route.ts` 与 `files/process-next/route.ts`：两处的行为变化都落在它们调用的 `enqueue.ts` / `enqueue-package.ts` 里；FIX-17 会在 process-next 里加权限守卫，两边不冲突。
- 不改 `src/app/api/projects/[id]/tender-analysis/package/route.ts`（码表在 `enqueue-outcome.ts` 里改）和 `runs/route.ts`。
- 不改 `src/components/tender-analysis/analysis-progress-banner.tsx`、`analyst-synthesis-view.tsx`、`src/components/project-detail/tabs/*.tsx`。
- 不改 `src/lib/tender-next-step/**`、`src/lib/muse-bridge/**`。
- 不改 `src/app/globals.css`（不新定义 `primary`）、`src/components/ui/button.tsx`。
- 不改 `src/lib/tender-auto-analysis/exclusion-text.ts`（FIX-13 的文案，只引用）。
- 不改 `prisma/**`。

## Decisions

### D1 「能用卡片发起」= 组织开关和用户级开关都过（GATE 第 2 条）

判定方法：组织开关，加上与建作业时相同的用户级开关；角色按岗位派生，和 `job.ts:154` 同一个算法。项目写权限不算在内：两个入口都要写权限，它决定不了该显示哪个入口。

- 被否决：只看组织开关（卡片现在的 `enabled`）。过不了用户级开关的人会遇到：旧按钮被藏起来，卡片按钮点了 403，页面上没有一个能用的按钮。
- 被否决：再加上项目写权限。只读成员 `canStart` 会是 false，于是看到旧按钮，而旧按钮同样 403，没有任何好处，还让只读成员看到两套按钮。

### D2 面板怎么知道：卡片读完接口回报，回报之前旧按钮不显示

卡片每次读完接口，都把 `canStart` 回报给面板；接口失败或不是 2xx 时回报 false。面板在收到回报之前不渲染两个旧按钮。面板没挂卡片时（`showRunControls` 为假），旧按钮照旧，可这个组合今天不存在：「招标要求」页签挂卡片，「提交」页签走 `quietEmpty` 安静空态。卡片在空态和有数据两种分支里挂在不同位置，切换时会重新挂载、重新回报；回报值存在面板里，切换期间旧按钮不闪。

- 被否决：面板自己再请求一次 `GET …/agent`。面板每次操作后都会重新加载，会多出重复请求，而且两次结果可能不一致。
- 被否决：把字段加到 `GET …/runs?latest=1`。进度条在旧管线跑的时候每 4 秒轮询这个接口（`analysis-progress-banner.tsx:68-72`），每次都得多查岗位与权限；而且列表接口会混进入口判定。
- 被否决：回报之前先显示旧按钮。开了一键分析的组织会先闪一下旧按钮，而且这一下是点得到的。
- 代价：没开一键分析的组织，旧按钮要等卡片那次请求回来才出现。这次请求和面板自己的加载并行，面板有数据时要连发两次请求，所以通常感觉不到。这一点写进报告。

### D3 过不了用户级开关的人：卡片只显示状态，不显示发起按钮

组织开了一键分析时，卡片照常渲染，这样别人发起的作业对这个人也可见，旧管线被挡住时的 409 文案也可以指向卡片。只是不显示「开始 AI 分析 / 重新分析」，改写一行「你的账号还没开通 AI 数字员工分析，请用本页下方的分析按钮」。「取消」按钮的显示条件不变（排队 / 分析中显示），因为取消接口不看开关（`trigger-service.ts:237-270`）。

- 被否决：对这些人整张卡片不渲染。他们会看不到别人发起的作业，旧入口被 409 挡住时文案里说的卡片也找不到。

### D4 两条流程拿同一把事务级锁

锁的键沿用一键分析现有的 `tender-workforce-start:<org>:<project>`，一键分析这一侧不用改。

- 旧管线重新分析：在现有事务里先拿这把锁，再锁 Project 行。
- 旧管线入队：把「查对方 → 按指纹查本方 → 新建记录」包进一个持锁的短事务。文件清单、指纹、页数这些（可能要读 Blob 回填指纹，`package.ts:183-198`）都在锁外先算好。
- 一键分析这边只拿这把锁，建作业的写入不碰 Project 行（AgentRun 没有指向 Project 的外键）。所以没有「一边持锁 A 等 B、另一边持锁 B 等 A」的情况。
- 被否决：一键分析也锁 Project 行。启动事务最长 20 秒（`trigger-service.ts:229`），这期间所有锁 Project 行的写入都会被挡住，包括 FIX-10 / 11 的调查室摘要写入和提交记录。
- 被否决：只查不锁。两个入口几乎同时点下去时，两边都查不到对方，各建一单。
- 被否决：新建锁表或租约。违反硬纪律 1、3。

### D5 「在跑」的口径

- 一键分析在跑：本项目有一张招投标作业处于现有的活跃阻断集（排队、规划、执行、校验、修复、等审批、等人处理），或者有一条「AI 数字员工分析中」的领域记录。
- 旧管线在跑：本项目有一条非一键分析版本的记录，状态是 PENDING / EXTRACTING / ANALYZING。旧管线「失败待重试」的那种按 D6 处理。
- 被否决：等人处理（`needs_human` / `awaiting_approval`）不算在跑。这样的作业被人处理后会接着跑，跟旧管线并行；一键分析自己也把它算作活跃，只有显式「重新分析」才会替换它（`trigger-service.ts:36-38`）。
- 被否决：只看领域记录 `AGENT_ANALYZING`（今天回落前就是这么查的）。作业排队到第一步执行之前没有领域记录；等人处理的作业，领域记录已经是 `AGENT_FAILED`。

### D6 一键分析发起时，停掉旧管线失败后的自动重试（GATE 第 4 条）

持锁时，把本项目「FAILED、尝试次数少于 5、非一键分析版本」的旧记录按状态条件改成 SUPERSEDED。定时任务认领时也按状态条件更新（`worker.ts:259-282`），谁先改到谁赢。如果改不到，说明定时任务刚认领、它已经在跑，按 D5 返回 409。改完再新建作业。

- 被否决：把它当成在跑，直接挡住。页面上写着「分析失败」，用户却点不了，最长要等 5 次重试用完（退避 15 秒、60 秒、180 秒、600 秒，`worker.ts:79`）。
- 被否决：不处理。之后的重试会跟一键分析并行，正是这次事故的样子。

### D7 两句 409 文案与状态码

- 一键分析被旧管线挡住：HTTP 409，正文 `{ "error": "这个项目已经有一单招标文件分析在进行，进度见本页顶部「招标文件分析」一栏；那一单结束后再点。", "code": "ACTIVE_JOB_EXISTS" }`。路由已经把 `ACTIVE_JOB_EXISTS` 映射成 409（`agent/route.ts:99-100`），只是今天没有任何地方返回它。
- 旧管线被一键分析挡住：HTTP 409，码 `ACTIVE_RUN_EXISTS`，文案为「AI 数字员工正在分析这个项目（或在等人处理），进度见「AI 数字员工 · 投标分析」卡片；那一单结束后再发起。」
  - 重新分析走既有的 `active_run`，带这句文案；规范化时优先用后端给的文案（`enqueue-outcome.ts:229-238`）。
  - 入队走原因 `workforce_active`：今天它不在码表里，会被归成 UNKNOWN / 400，这次补进码表，映射为 `ACTIVE_RUN_EXISTS` / 409 / 这句文案。
  - 面板兜底提示表里已有 `ACTIVE_RUN_EXISTS`（FIX-13 后 `analysis-panel.tsx:83`）。
- 两种响应都不带对方记录的 id、发起人、内部错误原文。今天回落路径的 `workforce_active` 会带回一键分析领域记录的 id（`enqueue-package.ts:644-649`）。互斥挪进入队函数以后，上传路由也会拿到这个原因，而文件抽屉会把上传响应里的 runId 当成进度条的种子（`project-file-manager.tsx:298-312`），所以这次不再带 id。
- 被否决：新开两个码。前端兜底表和路由映射都已有现成的码，新码要两边都加，没有收益。
- 被否决：两边用同一句话。用户需要知道去哪里看那一单的进度，两条流程的进度显示在不同的地方。

### D8 旧管线重新分析照旧替换未批准的结果，不分来源

`enqueue-package.ts:487-500` 不改。互斥之后，这一步只会发生在一键分析没有在跑的时候，被替换的是已经结束、还没批准的结果，和替换旧管线自己的结果是同一个意思：新的一份顶替没批的那份。开了一键分析、能用卡片发起的人看不到这个按钮；能走到这里的只有过不了用户级开关的人，以及没开一键分析的组织。

- 被否决：只替换旧管线版本的待审结果。两份待审记录会并存，面板只显示最新的那份（`runs/route.ts:27-31`），旧的一键分析结果就成了一条永远「待审」、却看不见的记录。
- 被否决：禁止替换一键分析的结果。过不了用户级开关的人想重新分析时，只能新增一条并存的记录，结果同上。

### D9 上传后的自动分析：两种做法（GATE 第 1 条，推荐 B）

**做法 A：自动分析也走卡片那条流程**

要补的地方：

- 删掉固定 requestId。这样缺陷 1 就没了，新文件可以触发。
- 是否发起改按「最近一次没被取消的一键分析，是否已经覆盖当前文件包」来判断（能读的文件都在那次的文件清单里，口径与卡片提示相同）。这样缺陷 2 就没了：同一个文件包分析过就不再跑。
- 上传逐文件那条路（自动开关关）也改派过来。
- 改派失败时不再回落旧管线，否则又成了两条流程。
- 上传人过不了用户级开关时不发起，在卡片上提示。

利：

- 上传后不用再点。
- 和卡片共用锁和「在跑」口径，天然收敛。

弊：

- `process-next` 每次返回 done 都会触发，所以「覆盖判断」必须准；判断错一次，就是一单完整的 9 步分析的钱。
- 自动单记在上传人名下，元数据写的是 `trigger:"user"`、`source:"tender_ui"`（`trigger-service.ts:190, 203`），和手动点的分不开。
- 上传人过不了用户级开关时，只能「不跑」，回落旧管线又会破坏单一流程。
- 改动面最大，要改 `enqueue.ts`、`enqueueTenderPackageIfReady` 和覆盖判断，规格与测试也更多。

**做法 B（推荐）：开了一键分析的组织不自动发起**

做法：组织命中一键分析开关时，两条自动路径都不发起任何分析：

- `enqueueTenderPackageIfReady`（自动开关开）返回原因 `agent_card_manual`；
- 上传逐文件那条路（自动开关关）同样返回 `agent_card_manual`，内容指纹照写，一键分析第一步要用它。

配套改动：

- 删掉改派代码与固定 requestId。
- 卡片在还没跑过时提示「文件已就绪，点「开始 AI 分析」」。
- 跑过、但有能读的新文件没纳入时，复用 FIX-13 的那句「有 N 个能读的文件还没纳入这次分析，重新分析后会一起纳入。」
- 原因码 `agent_card_manual` 进码表：`AUTO_DISABLED` / 200 / ok，文案「已开通 AI 数字员工分析：上传后不自动分析，请在「AI 数字员工 · 投标分析」卡片上发起」。
- 没开一键分析的组织走原路。

两个缺陷怎么消除：

- 缺陷 1：带固定 requestId 的那段代码删掉了。新文件由人点「重新分析」纳入：重新分析建的新作业在第一步按当前文件包建清单（`tools.ts:501-509` → `analysis-run-service.ts:96-233`），卡片会提示有几个文件没纳入。
- 缺陷 2：不再自动发起，这条路径不存在了。

利：

- 字面上就是单一入口，不会有意外的模型费用。
- 改动小，只是在两处入口按组织开关短路。
- 失去的东西很少：因为缺陷 1，今天一键分析组织里每个项目的自动发起本来就只会成功一次，B 去掉的只是「第一次上传后自动跑」。

弊：

- 多点一次。
- 已开自动开关的一键分析组织，行为会变：第一次上传后不再自动跑。这一点要在合并后通知用户。
- 进度条只读旧管线记录，在这些组织里一直是空的（本来就是）。

**推荐 B 的理由**：需求第 1 条要的是「只留卡片上的一个按钮」，B 让「谁发起、何时花钱」只有一个答案；A 的覆盖判断是一条新的、出错就要花钱的规则，上传人身份的问题也只能靠「不跑」来回避，而那正是 B 的行为。

### D10 「正在启动」：客户端与服务端各管一段

- 客户端：点下去就进入「正在启动」，一直到请求失败，或者请求成功后重新读取到新的作业为止。期间状态行是「正在启动…」，按钮不可点、文字是「正在启动…」。
- 服务端：卡片接口在一个只读的短事务里用同一个键试拿锁（`pg_try_advisory_xact_lock`），拿不到时 `starting=true`。卡片把它当成「正在启动…」，并且像排队 / 分析中那样每 8 秒轮询。旧管线新建时也持这把锁，这时报告「正在启动」也是实情：确实有一单正在建。
- 取消已提交、新单没建成：卡片改成失败后也重新读取。这时状态行是「上一单已取消，新的分析没能启动」，下面一行红字是接口给的原因，按钮仍是「重新分析」。别人看到的是「上次 AI 分析已取消」，这也是实情。
- 被否决：先建新单、再取消旧单。取消一旦失败就是两单并行（正是这次要消除的事故）；还要临时多占一格并发配额（`run.ts:126-142`，默认上限 10）。
- 被否决：在旧单的领域记录里写「正在重启」标记。排队阶段没有领域记录；建单失败后标记会一直留着，卡片会永远停在「正在启动」。
- 被否决：只做客户端。别的标签页、别的人在这段时间仍会看到「上次 AI 分析已取消」。
- 被否决：把取消和建单放进同一个数据库事务。要改 `run.ts` 和 `job.ts` 的连接用法，属于 workforce runtime 的改动（Non-Goals）。

### D11 卡片的显示逻辑抽成纯函数

新文件 `src/lib/tender-workforce/agent-card-view.ts`，只依赖数据，不碰数据库，客户端可以引用。输入是接口数据、客户端是否正在启动、最近一次启动的错误；输出是状态行、语气、要显示的说明、是否显示发起 / 取消按钮、按钮文字、文件提示，以及面板旧按钮是否显示。卡片和面板都只调用它。

- 被否决：逻辑留在组件里。卡片要等 `useEffect` 读完接口才渲染（`agent-card.tsx:153-154`），用服务端静态渲染测不到任何状态。

### D12 按钮和颜色

- 发起按钮：`rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)] hover:bg-accent-hover disabled:opacity-50`，和 `requirements-tab.tsx:53` 的「向业主提问」一样。glass 主题下 `.bg-accent` 的字色会自动换成 `--on-accent`（`globals.css:187-190`）。
- 「取消」：`rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-foreground/[0.04] disabled:opacity-50`，悬停色和通用 Button 的 ghost 变体一样（`button.tsx:17`）。
- 说明文字：`text-muted-foreground` 全部改成 `text-muted`（`--color-muted`，`globals.css:215`）。
- 被否决：在 `globals.css` 里定义 `--color-primary`。另外 24 个文件也引用了 `bg-primary`，它们会一起变色，变成全站主题改动。
- 被否决：换成通用 `Button` 组件。它的默认高度是 `min-h-9`，`sm` 也是 `h-8`（`button.tsx:8, 22`），卡片里的按钮会变高。

### D13 测试两层

1. `src/lib/tender-workforce/__tests__/single-entry.test.ts`：纯逻辑加源码接线，不用数据库，进 `scripts/test-all.sh` 和 `scripts/test-ci-unit.sh`。
   - 纯函数：各状态下的卡片输出，包括客户端正在启动、服务端正在启动、已取消加启动失败、已取消没有错误、文件已就绪、还没纳入、过不了用户级开关；还有面板旧按钮是否显示的四种情况（能发起 / 不能 / 未回报 / 没挂卡片）。
   - 颜色：枚举卡片源码里每个颜色类（`bg- / text- / border-` 加主题名），断言主题名在 `globals.css` 的 `--color-*` 里有定义，或者是 Tailwind 自带的色阶名（如 `blue-600`）；断言没有 `primary`、`muted-foreground`、`bg-muted`；断言发起按钮的类和 D12 一致。
   - 接线：
     - 面板两个旧按钮和空态说明都由纯函数的结果决定；
     - 卡片请求失败后也会重新读取；
     - `enqueue-package.ts` 里不再有 `auto-enqueue:`，也不再调用一键分析的发起函数；
     - 一键分析发起时先查旧管线，再取消旧单；
     - 旧管线重新分析先拿共享锁，再锁 Project 行；
     - 卡片接口路由不直接连数据库；
     - 两句 409 文案在源码里只定义一次。
2. `src/lib/tender-workforce/__tests__/single-entry-db.isolated.test.ts`：隔离库，进 `scripts/test-all.sh`，没有隔离库时跳过。写法照 `job-failure-surfacing-db.isolated.test.ts`，夹具用 `seedWorkforceFixture`。用例：
   1. 旧管线 PENDING 时，发起和重新分析都返回 409、码与文案正确；作业数不变，已有的一键分析作业没被取消。
   2. 旧管线 FAILED、尝试 2 次时，发起成功，那一单变成 SUPERSEDED；尝试 5 次的不动。
   3. 一键分析作业在排队、等人处理时，旧管线的重新分析、入队、单条记录接口都返回 409（单条记录接口按 GATE 第 3 条的结果），不新建记录；响应里不带作业 id。
   4. 并发：`Promise.all` 同时发起两条入口，重复 10 轮，每轮结束时两条流程的进行中记录加起来恰好 1。
   5. 另开一个事务拿着锁时，卡片接口 `starting=true`；释放后变回 false。
   6. 名单里的用户 `canStart=true`，名单外的为 false；文件提示的两种情况。
   7. 开了一键分析的组织：自动开关开时文件处理完不新建任何记录，原因是 `agent_card_manual`；自动开关关时上传逐文件同样不新建，内容指纹已写。
   8. 没开一键分析的组织：两种自动路径照常新建旧管线记录；重新分析照常；卡片接口 `enabled=false`、`canStart=false`。
- 既有测试的改动：
  - `obs-p2p3-single-pipeline.test.ts`：P3-01 改为「一键分析组织不自动发起」；P3-02 去掉；P3-05 改为「源码里没有固定 requestId」；P3-03 和 P3-04 保留。
  - `enqueue-outcome.test.ts`：补 `workforce_active` 和 `agent_card_manual` 两条。
  - `job-failure-surfacing.test.ts:82-84` 的三条卡片断言改为读纯函数文件，意思不变。
  - `t1b-integration.test.ts` 的 T1B-14 不改，继续守「开关关时旧入口照常」。
- 被否决：只写源码断言。证明不了锁真的互斥，也证明不了被挡时数据库没被改。

## 与八条硬纪律的关系

1. 零 schema：遵守。不新增 model、字段、migration。状态只用既有的字符串值（SUPERSEDED）；锁是 PostgreSQL 的事务级 advisory lock，不建表。
2. 出站动作先审批：不涉及，没有任何对外发送。
3. 禁止第三套队列：遵守。
   - 不新增队列、调度、租约、worker 名单；两条流程仍由既有的 `/api/cron/agent-runs` 和 `/api/cron/tender-auto-analysis` 消费。
   - 用的锁是事务级互斥，事务结束就释放，不是租约，同一把锁已经在 `trigger-service.ts:149` 用着。
   - 新文件名 `single-entry.ts`、`agent-card-view.ts` 不含架构守卫禁止的词（`runtime-architecture/guards.ts:96-105`）；`tender-auto-analysis` 和 `tender-workforce` 之间的引用不在禁止方向表里（`guards.ts:137-176`）。
4. 脱敏：不涉及 Muse 通道。与它同方向的一条：409 响应和卡片接口不带对方记录的 id、开关名单、岗位（规格里有 SHALL NOT）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。
   - 不新增模型调用。
   - 「在跑」「能不能发起」「文件提示」都是查表、计数。
   - 做法 B 去掉了自动发起，模型调用只会少，不会多。
8. 测试注册：遵守。两个新测试都注册进 `scripts/test-all.sh`，纯逻辑那个也进 `scripts/test-ci-unit.sh`；`bash scripts/check-test-registry.sh` 通过，`ci/test-registry-baseline.txt` 不加行。

## 验证方式

- `npx tsx src/lib/tender-workforce/__tests__/single-entry.test.ts`：改动前退出码非 0（报出 `primary`、`auto-enqueue:`、没有查旧管线等），改动后为 0。
- `NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… DIRECT_URL=… npx tsx src/lib/tender-workforce/__tests__/single-entry-db.isolated.test.ts`：改动前，互斥、自动入队、`starting` 的用例失败；改动后全部通过，连跑 3 次结果一致。
- `npx tsx src/lib/tender-auto-analysis/__tests__/obs-p2p3-single-pipeline.test.ts`、`enqueue-outcome.test.ts`、`ready-gate.test.ts`、`src/lib/tender-workforce/__tests__/t1b-pure.test.ts`、`job-failure-surfacing.test.ts`、`src/lib/navigation/__tests__/entry-visibility.test.ts`、`src/components/project-detail/__tests__/tender-detail-ia.test.ts` 全部通过。隔离库上 `t1b-integration.test.ts` 通过，T1B-14 不改断言。
- `npm test` 对照既有失败清单没有新增；`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh` 通过；`openspec validate tender-analysis-single-entry --strict` valid。
- 本地截图（夹具组织）：
  1. 开了一键分析的项目页上只有卡片按钮；
  2. 「正在启动…」；
  3. 「上一单已取消，新的分析没能启动」；
  4. 过不了用户级开关的人看到的卡片和旧按钮；
  5. 没开一键分析的组织，页面与改动前相同。

## Risks / Trade-offs

- [过不了用户级开关的人，遇到一张别人发起、正在等人处理的作业] → 旧入口被 409 挡住，卡片上没有给他们的按钮，只能找能发起的人点「重新分析」。文案写明「或在等人处理」，并指向卡片。
- [没开一键分析的组织，旧按钮晚一点出现] → 晚的是卡片那一次请求的时间（D2）；它和面板自己的加载并行，报告里附截图。
- [卡片接口每次多查几项：岗位派生、试拿锁、文件就绪、覆盖计数] → 只在卡片加载和排队 / 分析中轮询（8 秒一次）时发生；文件提示只在没有一单在跑时计算。
- [试拿锁的那一下会让同时发起的请求等几毫秒] → 试拿是立即返回的，事务里没有别的语句。
- [做法 B 改变了已开自动开关的一键分析组织的行为] → 合并后通知一次；卡片上有「文件已就绪」提示。
- [一键分析作业跑到一半组织开关被关掉] → 旧入口会被挡住，直到那一单结束；这是互斥本来要的行为。

## Migration Plan

没有数据迁移，没有新开关，合并即生效。已经在跑的旧管线记录照常由定时任务消费；已有的自动作业不受影响。回滚就是 revert 这一个 PR。

## 留给 GATE

1. **上传后的自动分析：做法 A 还是做法 B**（D9）
   - A：上传或处理完自动发起一键分析，按「最近一次一键分析是否覆盖当前文件包」判断，去掉固定 requestId，不回落旧管线。后果：上传后不用点；但多了一条判断错就要花钱的规则；自动单记在上传人名下；上传人过不了用户级开关时不跑。tasks 第 4 条改为实现 A，规格里「开了一键分析的组织上传后不自动发起」和「卡片的文件提示」两条要改写。
   - B：开了一键分析的组织不自动发起，卡片提示「文件已就绪，点「开始 AI 分析」」。后果：多点一次；已开自动开关的组织，第一次上传后不再自动跑。
   - **推荐 B**，理由见 D9 末。
2. **「组织开了一键分析」的判定**（D1）
   - ① 组织开关加用户级开关：过不了用户级开关的人看旧按钮。
   - ② 只看组织开关：过不了用户级开关的人两个按钮都用不了。
   - ③ 再加项目写权限：只读成员看到点不了的旧按钮。
   - **推荐 ①**。
3. **单条记录重新分析接口 `POST …/runs/:runId/reanalyze` 遇到「已有一单在进行」时的状态码**
   - 改 409：和 `…/package` 一致，也满足需求第 3 条；没开一键分析的组织里，旧管线自己挡自己时也从 400 变成 409。这个接口在界面上没有调用方。
   - 保持 400：没开一键分析的组织完全不变，但同一件事两个接口回不同的码。
   - **推荐改 409**。
4. **一键分析发起时，旧管线「失败、还会自动重试」的那一单怎么办**（D6）
   - 停掉重试（标为已被替代），然后发起：用户点了就能跑；那一单的自动重试不再发生。
   - 当作在跑，挡住：用户看到「分析失败」却点不了，直到 5 次重试用完，单是重试间隔加起来就约 14 分钟。
   - **推荐停掉重试**。

tasks 一共 8 条，在上限内，不用拆分。

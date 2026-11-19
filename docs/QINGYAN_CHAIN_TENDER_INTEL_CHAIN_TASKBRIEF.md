# CHAIN 招标情报串联「分析完自己往下走，人只决定发不发」— 任务书

> 入库：2026-11-19（任务书原文，未改字）；同日 13:05 修订版替换（新增 CHAIN-0c 与判断点 8、CHAIN-0 第 1 项改为已验证、CHAIN-0b 入后续队列）。四件套与实现中发现的出入记在各 change 的 design.md「审核关注点」，不回改本文。

TASKFLOW：在 Phase F 下新增一节「Phase F（续）— 情报串联」（登记到 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`）：CHAIN-0（运维核查，不是 change）+ CHAIN-0c、CHAIN-1、CHAIN-2、CHAIN-3、CHAIN-4a、CHAIN-4b 六个 change，一个 change = 一个 PR，按下文「上线顺序」合并。本任务书合并时同步放一份到 `docs/QINGYAN_CHAIN_TENDER_INTEL_CHAIN_TASKBRIEF.md`。
与 TI-0 的关系：本任务书实现 `docs/tender-intelligence-gap-analysis.md` §12 里还没开始的 **TI-5（只读适配器：官方授标来源）**、**N5（进口线索接到供应商线索）** 和 **TI-7 的「寻源到询价的交接」**，不重做 TI-1～TI-4c；Gate A 的 10 项拍板（§10a）全部继续有效。
需求方：Sunny 线（Evan，2026-11-19）：「确认招标要求的文件解析时间非常久」；「多部门功能很多，但是没有串联起来——分析完成后应该自主查找上一个中标者或者类似项目、预计中标价格、推荐型号；找到中标者后反查对方的海关数据，看谁是对方的供货商」；「查到供货商后自动分析，形成询价邮件，把我们上传的文件重新编排、隐藏敏感信息，生成新的 PDF 附件，人工只选择发还是不发」。
状态：判断点 1–8 待拍板。CHAIN-0 不写代码，可先做。CHAIN-0c（2026-11-19 生产事件，见下）只有判断点 8 与它有关，未拍板前按 A 实现，排第一。
修订：2026-11-19 13:05 —— 生产核查后改 CHAIN-0 第 1 项为「已配置、已验证」；新增 CHAIN-0c；CHAIN-0b 入后续队列。

## 2026-11-19 生产事件（CHAIN-0c 的起因）

- 项目「12-01 21C31-254242」10:19 发起一键 AI 投标分析（确定性编排，9 步）。10:20 第 1 步「校验输入」、第 2 步「解析投标文件」完成——**解析本身只用了约 1 分钟**。
- 第 3 步「Canonical V2 包级分析」10:32 让出一次并续跑（Vercel 运行日志：`[cron.agent-runs] continuation trigger { depth: 0, childDepth: 1, attempted: true, outcome: 'accepted', httpStatus: 200 }`），10:42 任务时间线记「任务未能完成」，第 3 步「未成功」，第 4–9 步未开始，详情页「需要人工处理」框内**没有任何原因**。
- 需求方确认：10:42 之后项目页一直显示「分析中」，**没有收到任何通知**，直到约 12:25 打开 AI 任务详情才发现失败。用户感受到的「解析时间非常久」，主要是这 1 小时 40 分钟的「失败了却显示分析中」。
- 第 3 步的失败原因尚未查明（待 Vercel 10:15–10:45 Warning / Error 日志），见「不确定处」。
依据（均在 `github.com/LucasJ880/-` main `15bb79c`（2026-11-16）核对，只读代码，未运行应用，看不到 Vercel 上的实际环境变量）：

- **分析慢的机制**：分析由 `/api/cron/agent-runs` 推进，`vercel.json` 里是 `*/2`（每 2 分钟一班）；每班活跃预算 240 秒（`src/lib/workforce-runtime/constants.ts` `AGENT_RUNS_INVOCATION_BUDGET_MS`），干不完就让出等下一班。观察期包 1 的报告（`docs/QINGYAN_TENDER_OBS_P1_LATENCY_REPORT.md` §1）实测 163 页首单 35.6 分钟，其中约 10–15 分钟是等班空转。修复「让出后立即自触发下一班」已在 main（`src/lib/workforce-runtime/self-trigger.ts`），但开关 `WORKFORCE_CONTINUATION_SELF_TRIGGER_URL` **未配置即关闭**。另外 `WORKFORCE_JOB_MAX_PARALLEL_TASKS` 缺省 1、上限 4（`parallel.ts:34-35`）；分窗并发 3、每窗 ≤4 页 / 9,000 字（`tender-understanding/analyzer.ts:55`、`manifest.ts:77-78`）是代码常量。
- **情报自动流已有，但只查联邦、且被三道门挡着**：`runExternalIntelForProject`（`src/lib/tender-intel/orchestrate.ts:119`）在分析完成后自动检索授标、自动观察入库（`createOrObserveAwardRecord`，`orchestrate.ts:223-238`）、自动生成策略草案。门：`TENDER_EXTERNAL_INTEL_ENABLED` 必须**恰好等于 `"1"`**（`canadabuys.ts:18-22`，写 `true` 不生效）；入库还要 `T4_AWARD_INTELLIGENCE_SCHEMA_READY`（`award-flags.ts:36-40`）；Web 检索要 `TAVILY_API_KEY`。数据源只有联邦「Contracts over $10,000」（`canadabuys.ts:31`）；省级是 `PROVINCIAL_MANUAL`（`procurement-records/watch-config.ts:57`）。`SYSTEM_VERIFIED` 白名单只放行 `CANADABUYS_OPEN_DATA` + 编号（`awards.ts:240-247`）。
- **供应商情报已有排名与型号，但只能手动跑**：`SupplierCandidate`（供应商 × `SupplierOffering` 型号，技术 / 商务 / 可靠性 / 进口风险分、强制闸 `mandatoryGateResult`、`recommendation` 主选 / 备选）只经 `/api/supplier-intel/runs/**` 由界面发起，分析完成后没有任何地方自动建 run；主开关 `SUPPLIER_INTEL_ENABLED` 默认关（`supplier-intel/flags.ts`）。
- **进口线索只有契约，没有数据**：TI-3a `src/lib/tender-competition/import-leads.ts`（`LEAD_UNVERIFIED` / `CONFIRMED_CURRENT`，只能人工用 12 个月内证据升级）；来源 `LICENSED_TRADE_DATA` 恒为「未接通」（`source-status.ts:24-36`）。差距分析 §7 方案甲已定落点：`SupplierDiscoverySignal.platform` 加一个目录值、运单细节进 `rawMetadataJson`。
- **询价自动流已有，三个开关都默认关**：`TENDER_RFQ_AUTO_DRAFT_ENABLED`（RFQ-AUTO-2）、`TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED`（RFQ-AUTO-1）、`TENDER_RFQ_SUPPLIER_GROUPS_ENABLED`（RFQ-AUTO-5）。自动起草的收件人只取操作者本人的常用供应商 / 分组（`tender-rfq/service.ts:121` `pickRfqSuppliers`），不看供应商情报的推荐。
- **询价邮件没有附件**：`SendEmailParams`（`src/lib/google-email.ts:364-378`）没有附件字段；`tender-rfq/execute.ts:67` 只发纯文本正文。
- **现有「供应商询价与符合性确认表」会把招标身份带给供应商**：`generate-docs.ts` 给 `supplier_rfq` 传 `solicitationNumber`、`clientOrganization`、`closeDate`，`tender-doc-html.ts:76-84` 的抬头原样印出「项目编号 / 采购方 / 投标截止」；询价邮件标题是 `询价：${projectName}`（`tender-rfq/build.ts:290`）。敏感词拦截（`bid-workflow/china-supplier-brief.ts:27-34`、`projects/generate/pdf-common.ts:25`）只拦价格 / 毛利 / 预算 / 竞争对手 / 客户联系方式，**不拦招标编号、采购方名称、交货地址**。供应商拿到编号就能绕过我们直接投标。
- **中文 PDF 管道已有**：`src/lib/pdf/html-to-pdf.ts`（服务端 Chromium + Noto Sans SC，输出魔数校验，失败显式降级），CJK-PDF 包已上线。

外部事实（2026-11-19 网页核对）：
- 加拿大不公开提单级海关数据；美国海运提单数据公开（19 CFR 103.31），但进口商可申请保密。所以「中标者 → 海关 → 供货商」只在中标者（或其美国关联公司）走海运进口美国、且没申请保密时才查得到。差距分析 §0 第 4 条、§9 风险 1 已有同样结论。
- Alberta 政府在 APC 上公布授标后的中标供应商、授标日期与合同价格（alberta.ca「Contract opportunities with the Government of Alberta」）。APC 公告页可匿名浏览，文件下载要登录（经 Ariba）——本任务书只碰匿名可见的公告字段。

## 一条规则

**查的、算的全自动；对外发的一律人批；查不到的照实说。**
分析完成 / 批准之后，授标检索、型号推荐、预计价格、进口线索、询价起草、附件生成都由系统自己往下走，不再要人逐项点；任何发给组织外的邮件仍是一张待批卡（硬纪律第 2 条一字不改），人只决定发、改还是不发。来源没接通时显示「未接通」，接通了没结果显示「已查询，没有结果」，两者不混（沿用 `readSource` 口径）；不编数据，不把线索说成事实。

## Why

- 能力都做出来了，但散在五个开关和三个手动入口后面：用户感受到的是「功能很多，没串起来」，实际上多半是没开、没接上。
- 两个硬缺口挡住了闭环：省级授标查不到（Sunny 投的 Alberta / Ottawa 标恰好都是省级 / 市级），询价发不出脱敏附件；另有一处现存的身份泄露要先堵。

## CHAIN-0 开关核查与提速（运维，不写代码；有 Vercel 生产权限的人做）

按顺序核对，每一项记下「原值 → 新值 → 日期」写进 `docs/QINGYAN_CHAIN-0_ENV_CHECK.md`：

| # | 环境变量 | 作用 | 建议 |
|---|---|---|---|
| 1 | `WORKFORCE_CONTINUATION_SELF_TRIGGER_URL` | 分析让出后立即续跑，消除 2 分钟空等 | **已配置、已验证（2026-11-19）**：生产 Production 环境已有此变量；10:32 运行日志 `outcome: 'accepted'`、`httpStatus: 200`。无需改动 |
| 2 | `WORKFORCE_JOB_MAX_PARALLEL_TASKS` | 同一分析任务内并行的步骤数 | 1 → 2，观察一单再定是否到 3；上限 4 |
| 3 | `TENDER_EXTERNAL_INTEL_ENABLED` | 授标检索总门 | 必须是 `1`（不是 `true`） |
| 4 | `T4_AWARD_INTELLIGENCE_SCHEMA_READY` | 授标自动入库 | 核对迁移已在生产后开 |
| 5 | `TAVILY_API_KEY` | Web 检索、市场价格基准 | 确认存在 |
| 6 | `SUPPLIER_INTEL_ENABLED`（+ 组织白名单） | 供应商情报 | 只对 Sunny 开 |
| 7 | `TENDER_RFQ_AUTO_DRAFT_ENABLED`、`TENDER_RFQ_SUPPLIER_GROUPS_ENABLED`、`TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED` | 询价自动起草 / 分组 / 一次批准管整轮 | **等 CHAIN-4b 合并后再开**（否则自动起草出来的东西仍会带项目名） |

验证：
- 第 1 项生效的证据：Vercel → Logs → Runtime Logs 搜 `continuation trigger`，有 `outcome: 'accepted'` 即生效（2026-11-19 已见）；`not accepted` + `httpStatus: 3xx` = 网址会跳转，`401` = `CRON_SECRET` 不一致。目标：160 页级别的标包 ≤ 20 分钟。
- 注意：续跑只覆盖一键 AI 分析（`/api/cron/agent-runs`）。上传后自动分析的 legacy 队列 `/api/cron/tender-auto-analysis`（同为 `*/2`、240 秒）没有续跑，见后续队列 CHAIN-0b。
- 第 3–5 项生效的证据：项目情报室 `summaryJson.externalIntelStatus.status = "ran"`，`awardCandidates` 有计数。用 TBS 24062-27-057（联邦标）测。
- 扫描版 PDF 的页面会被标 `OCR_REQUIRED`（`tender-auto-analysis/page-parse.ts:38`），不会自动识别文字。这影响的是读不全，不是速度；本任务书不处理，见「后续队列」CHAIN-6。

## What（六个 change）

### CHAIN-0c `tender-job-failure-surfacing`：分析失败立刻告诉人（排第一）

**现状（代码核对）**
- 项目上的分析状态（`TenderAnalysisRun.status`）由第 9 步「Canonical V2 状态终态化」改成「待审阅」。中途某步失败时第 9 步不会执行，状态停在 `AGENT_ANALYZING`（界面「AI 数字员工分析中」）。
- 把它改成「AI 分析未完成」（`AGENT_FAILED`）的唯一函数 `failWorkforceTenderAnalysisRun`（`src/lib/tender-workforce/analysis-run-service.ts:420`）只在两处被调用：用户重新发起（`trigger-service.ts:162`）和用户取消（`trigger-service.ts:263`）。**Job 自己失败或卡住时没有任何地方调用它。**
- 失败通知 `notifyTenderRunFailed`（`tender-auto-analysis/alerts.ts:58`）已支持 `AGENT_FAILED`，并且就在 `failWorkforceTenderAnalysisRun` 里调用——所以状态不变，通知也就不发。
- Job 进入失败 / 卡住的写入点在 `src/lib/workforce-runtime/processor.ts`：重试耗尽 → `failed`（`requeueWorkforceJobAfterError`）、运行中陈旧耗尽 → `failed`（`stale_running_exhausted`）、其它 `failed` 分支、以及几处 `needs_human`。

**改动**
- 新增一个只对招投标 Job 生效的收尾函数（放 `src/lib/tender-workforce/`）：Job 的 fenced 状态写入成功、且新状态是 `failed` 或 `needs_human` 时调用。它做三件事：
  1. 调用既有 `failWorkforceTenderAnalysisRun`，`errorCode` 用 Job 的错误码，`errorMessage` 写「卡在第 N 步〈步骤名〉：〈错误信息前 300 字〉」。
  2. 由上一步自然触发既有失败通知（站内通知给项目负责人与发起人，沿用 `resolveFailureRecipients`）。
  3. 写一条 AuditLog `tender.workforce.failed_surfaced`，以 jobId 幂等（同一个 Job 只收尾一次）。
- 收尾失败不影响 Job 本身的状态写入（try/catch，记 console.warn），不新增重试、队列或定时任务。
- 详情页「需要人工处理」框（`src/app/(main)/workforce/[id]/page.tsx`）显示失败步骤名与错误信息；没有时写「系统未记录原因」，不留空白。
- 项目页分析卡片在 `AGENT_FAILED` 时显示原因与「重新发起分析」按钮（重新发起已有，`trigger-service.ts` restart）。
- `needs_human` 是否也收尾为失败见判断点 8。
- 实现前先用 `12-01 21C31-254242` 这个 Job 的 AgentRun / 事件记录确认本次走的是哪条写入（`job.failed` 还是 `job.waiting_human`），把它写进 design.md 的复现段，并作为第一个测试用例。

**测试**
- 纯函数：错误信息拼装（步骤名、截断、无信息时的兜底文案）；只对 `workDomain = tender` 的 Job 生效。
- 隔离库：注入一个第 3 步必然失败的工具 → Job 失败后，`TenderAnalysisRun.status = AGENT_FAILED`、`errorMessage` 含步骤名、发起人收到一条失败通知；重放同一收尾不产生第二条通知；非招投标 Job 失败时不触发。
- 回归：正常完成路径、用户取消、重新发起的行为与现在一致（现有测试不改期望值）。

### CHAIN-4b `rfq-supplier-identity-guard`：询价不再带出招标身份（先做，堵现存泄露）

- 新增纯函数 `buildProjectIdentityDenyList(project)`（放 `src/lib/bid-workflow/`）：从项目取招标编号、采购方名称（含 `normalizeBuyerName` 规范化形式）、项目名称、截标日期字符串、交货地址（询价单的 `destination`）；`Project` 上没有采购方联系人字段，分析事实里若抽到采购方联系人邮箱 / 电话也一并加入（实现前核对事实结构里有没有，见「不确定处」），生成本项目专属的禁出清单；长度 < 4 的词条不进清单（防误杀）。
- 所有发给供应商的产物在输出前过这份清单：`tender-rfq/build.ts` 的询价单（正文与标题）、`generate-docs.ts` 的 `supplier_rfq` 两条路径、CHAIN-4a 的附件。命中即 **build 失败并说明命中了哪一类**（沿用 `build.ts` 纪律 3「整个文档失败，不是 scrub」），不做局部替换。
- `supplier_rfq` 抬头去掉「项目编号 / 采购方 / 投标截止」；询价邮件标题与询价单里的项目称呼改为**中性询价名称**（判断点 6）。`tender-doc-html.ts` 的 `headerBlock` 增加「对外」模式，内部备忘录不变。
- 另加一条格式检查：供应商侧产物里出现邮箱地址或电话号码格式（我方发件人、签名、回复地址除外）即失败——既有敏感词表只认「客户邮箱 / contactEmail」这类字面词，认不出真实地址。
- 既有敏感词表（`china-supplier-brief.ts`）不改，只在它之后再过一道项目专属清单。
- 测试：禁出清单生成（含短词剔除、规范化）；询价单 / `supplier_rfq` HTML 命中各类标识即失败；内部备忘录照旧印出编号；改前的 `supplier_rfq` 快照在新代码上必须失败（先红后绿）。

### CHAIN-4a `rfq-supplier-attachment`：询价邮件带一份重排的 PDF 附件

**生成什么（判断点 5）**
- 不碰原件、不在原件上涂黑：从**已确认、属于供应商侧类别**的要求（`build.ts` 已筛好的 `lineItems`，带要求编号、中文与原文规格、数量、单位、交期、样品、认证）重新排一份「询价单 / 符合性确认表」HTML，经 `html-to-pdf.ts` 出 PDF。内容只来自这份白名单，所以原件里的编号、机构、地址、评分标准、我方信息天然带不出去。
- 附件出 PDF 前过 CHAIN-4b 的禁出清单 + 既有敏感词表；命中即不生成，卡上写明原因，不降级为「去掉附件照发」。
- 附件 ≤ 5 MB；超限不生成并说明。

**发送管道**
- `SendEmailParams` 增加可选 `attachments: { filename, mimeType, data: Buffer }[]`，`buildRawEmail` 支持 `multipart/mixed`；不传附件时生成的原始邮件与现在逐字节相同（快照测试）。
- 附件字节的 SHA-256 写进发询价卡的载荷，并进入既有 `hashRfqPayloadItems` 的哈希；执行器发送前重新生成并比对，不一致即拒发（批准的就是这份字节，人批之后附件不能变）。
- 审批卡上显示附件文件名、页数、大小和「预览」链接（服务端按载荷重新生成，只读）。
- 催单 / 追问（RFQ-AUTO-1 的后续模板邮件）不带附件，模板指纹不变。

**测试**：MIME 拼装（有 / 无附件、中文文件名 RFC 2231 编码）；哈希不一致拒发；附件生成失败时卡上原因；隔离库：起草 → 批准 → 执行器发出带附件的邮件（注入假 Gmail），附件哈希与卡一致。

### CHAIN-1 `tender-award-source-apc`：Alberta 授标进同一条自动流

- **design 阶段第一步（不通过就停）**：用一个已授标的公开 posting（如 Sunny 投过的 Alberta 露营装备 RFQ）确认：匿名访问的公告数据里有没有中标方、金额、授标日期、编号；有没有 Cloudflare 验证或登录要求。任何一项要登录或有人机验证 → 本 change 停止，回报，**不绕**（硬纪律第 5 条）。同时核对 APC 的使用条款是否允许程序化读取。
- 新增 `src/lib/tender-intel/apc.ts`：按 `deriveAwardQueries` 已产出的关键词检索 APC 公开的授标公告（`is_award_notice`），每次检索最多 N 条、单次超时 10 秒，失败不影响联邦检索。
- `orchestrate.ts` 在联邦检索之后调用；结果经既有 `createOrObserveAwardRecord` 入库，`sourceType` 新增目录值 `ALBERTA_APC_PUBLIC`（`AWARD_SOURCE_TYPES` 是 TS 常量、列是字符串，零 schema），幂等键 `apc:{reference_number}`。
- 信任级按判断点 2。
- 只取公告上的结构化字段（中标方、金额、币种、日期、编号、采购单位、标题），`evidenceSnippet` 存原文摘录；不下载任何文件。
- 测试：解析夹具（真实公告 JSON 存为夹具，公司名代号化，沿用 Gate A 第 9 项）；幂等重放；APC 报错 / 超时时联邦结果照常入库、`externalIntelStatus` 写明 APC 失败原因；白名单变更的回归钉。

### CHAIN-2 `tender-auto-supplier-run`：批准分析后自动给出「推荐型号 + 预计价格」

- **触发点**：与 RFQ-AUTO-2 同一处（`maybeAutoDraftRfq` 的调用处，判断点 1），在起草询价**之前**，为项目自动建一个供应商情报 run（`createProjectSearchRun`），来源只用内部来源（记忆 / 历史成功 / 已存供应商）；外部检索门开着时同时跑外部发现。每个项目每份分析只自动建一次。
- **推荐型号**：取 run 里强制闸 `PASS`、`recommendation ∈ {PRIMARY, BACKUP}` 的前 3 个候选，显示供应商 + 型号（`SupplierOffering.name / sku`）+ 分数分解 + 哪几条强制要求有证据、哪几条没有。全部是既有确定性评分（`deterministic-match.ts`），不新增 LLM。没有合格候选时写明「没有通过强制闸的候选」及卡在哪几条。
- **预计价格**：情报页签新增一张只读卡，把已有的三样并排：① 可比授标统计（同采购方同范围 ≥3 样本时的区间，来自授标投影）；② M4 市场价格基准（原币、不换汇）；③ 比价矩阵里人工选定那家的落地价（FLOW-H2 已有）。三者口径不同，**不合并成一个数**、不推导「建议报价」（硬纪律第 4、7 条；目标报价由人定）。任一样缺就写缺。
- **进入询价**：按判断点 4，把合格候选并入 RFQ-AUTO-2 的收件人。
- 落点：沿用情报室既有「供应链」槽位与新卡，不新开页签（差距分析 §0 第 6 条）。
- 测试：触发真值表（开关 × 是否已有 run × 分析状态）；候选筛选（闸未过 / 无邮箱 / 已归档不进）；价格卡三栏缺项文案；源码断言本 change 无新增 LLM 调用点。

### CHAIN-3 `tender-import-leads-connector`：中标者 → 进口线索 → 供货商候选

- **输入**：项目授标投影里的历史中标者（`AwardRecord.winnerName`，CHAIN-1 后含 Alberta）。
- **数据来源（判断点 3）**：第一步只做「人工导入」——用户把自己在第三方网站查到的结果以 CSV / 粘贴导入（字段：进口商、出口商、日期、品名、数量、来源网址），系统解析；适配器接口 `ImportLeadProvider` 同时留好，接授权 API 时只加一个实现。**系统不抓任何第三方网站**。
- **匹配**：中标者名称与导入记录的进口商名称按 TI-3a 的三档比对（同名 / 建议 / 无关），只有「同名」自动挂上；「建议」显示给人确认，不自动合并（验收项 A4）。
- **落库**：`SupplierDiscoverySignal`，`platform` 新增目录值 `TRADE_DATA`，`sourceOrigin = PROVIDER` 或 `USER_SUBMITTED`，运单明细进 `rawMetadataJson`；状态一律 `LEAD_UNVERIFIED`，界面固定显示 `IMPORT_LEAD_CAVEAT_ZH`。
- **自动汇总（确定性，判断点 7）**：每个出口商显示出货次数、最近一票日期、品名与本标供应商侧要求的关键词重合度、是否超过 12 个月；按「最近 12 个月票数」排序。不调模型、不打「推荐」标签。
- **变成询价对象**：「加入供应商库」一键建 `Supplier`（来源 `trade_data`），缺邮箱就停在这一步让人补——提单数据通常没有邮箱，系统不去网上找邮箱。建好且有邮箱后，下次起草询价时按判断点 4 进入候选。
- 测试：CSV 解析（缺列、日期格式、重复行）；三档比对；12 个月窗口；隔离库：导入 → 线索 → 建供应商 → 出现在询价抽屉候选；源码断言 `src/lib/tender-competition/**` 无对外 HTTP。

## 判断点（请拍板）

1. **串联从哪一刻开始**：A（推荐）批准分析 / 确认要求时（与 RFQ-AUTO-2 同一触发点）——要求已经人工确认，型号匹配和询价单用的是确认过的规格；B 分析一完成就跑，更早，但匹配基于 AI 草稿，确认后要重跑一次。
2. **Alberta 授标的信任级**：A（推荐）扩白名单：`ALBERTA_APC_PUBLIC` + 编号也可落 `SYSTEM_VERIFIED`，历史中标 / 对手 / 可比价格自动点亮（政府公开披露、带编号，和联邦同一性质）；B 落 `NEEDS_REVIEW`，人确认后才进统计。A 要改 T4 冻结服务的白名单一行（`awards.ts:240-247`），需要你明确批准。
3. **海关数据从哪来**：A（推荐）先做人工导入 + 留好接口，用 2–3 个真实标验证线索有没有用，再决定买哪家；B 现在就接一家授权数据 API（要付费授权，且合同要允许程序化使用），差距分析 §10a 已写「付费数据每一项单独授权」。两种都不抓第三方网站。
4. **推荐的供应商要不要自动进询价收件人**：A 不自动进，只在询价抽屉里预勾选并写明来源；B（推荐）进自动起草的收件人，但只限：已在供应商库、有邮箱、主选或备选、强制闸通过；与常用供应商 / 分组合并去重，总数仍 ≤ 8；卡上逐家写来源（常用 / 分组 / 情报推荐 / 进口线索）。B 符合「人只决定发不发」——批卡时可以删掉任何一家。注意 B 改变了 RFQ-AUTO-5 报告里「不按评分推荐」的口径，开关独立（`TENDER_RFQ_INTEL_RECIPIENTS_ENABLED`，默认关）。
5. **附件里放什么**：A（推荐）只放重排的询价单 PDF（白名单字段）；B 另外允许人逐页勾选原标书里的图纸 / 规格页一起发，系统检查页面文字不含禁出清单。B 的风险是图签、页眉页脚常印着编号和机构名，扫描页的文字查不出来。
6. **对供应商怎么称呼这个项目**：A（推荐）用中性询价名称，如「RFQ-SUNNY-2026-031 · 户外睡袋及睡垫」（组织代码 + 年份 + 序号 + 品类，品类取自确认要求的类别），不出项目名；B 维持现状用项目名，只拦编号和机构名。项目名经常就是招标标题，B 等于把标题给出去。
7. **「自动分析供应商」要不要用模型**：A（推荐）全部确定性：票数、最近日期、品名关键词重合度、是否过期；B 为每个出口商调一次模型写画像，要为硬纪律第 7 条开例外。
8. **分析卡住（`needs_human`）时项目状态怎么显示**（CHAIN-0c）：A（推荐）和失败一样收尾为「AI 分析未完成」并通知，处理方式是「重新发起分析」——用户从项目页就能看到并行动；B 新增一个「AI 分析暂停，需要处理」的状态值，可以原地恢复。B 要改所有读这个状态的地方（显示文案、下一步判定、提交前检查），而且招投标 Job 卡住后能不能原地恢复要另外核对。

## Impact

- 修改（CHAIN-0c）：新增 `src/lib/tender-workforce/job-failure-surfacing.ts`；`src/lib/workforce-runtime/processor.ts`（失败 / 卡住写入成功后调用收尾）；`src/app/(main)/workforce/[id]/page.tsx`（原因显示）；项目页分析卡片 `src/components/tender-analysis/agent-card.tsx`（失败原因与重新发起）。不加开关（修「失败不提示」不应该能关掉）。
- 修改（CHAIN-4b）：新增 `src/lib/bid-workflow/project-identity-deny.ts`；`src/lib/tender-rfq/build.ts`（标题、项目称呼、出前检查）；`src/lib/projects/generate/generate-docs.ts`、`tender-doc-html.ts`（对外抬头模式）。
- 修改（CHAIN-4a）：`src/lib/google-email.ts`（`SendEmailParams.attachments`、`buildRawEmail` multipart）；`src/lib/tender-rfq/types.ts`、`round-pure.ts`（载荷哈希含附件摘要）、`execute.ts`（发前重算比对）；新增 `src/lib/tender-rfq/attachment.ts`；审批卡组件（附件行与预览）；一个只读预览路由。
- 修改（CHAIN-1）：新增 `src/lib/tender-intel/apc.ts`；`orchestrate.ts`；`awards.ts`（`AWARD_SOURCE_TYPES` 加值；判断点 2 取 A 时改白名单）；`procurement-records/watch-config.ts`（Alberta 从 `PROVINCIAL_MANUAL` 改为已接通）。
- 修改（CHAIN-2）：`src/lib/tender-rfq/auto-draft-service.ts`（起草前建 run、合并收件人）；`src/lib/supplier-intel/project-run-service.ts`（系统发起的 run，actor=system）；情报页签新增价格对照卡与推荐型号块。
- 修改（CHAIN-3）：新增 `src/lib/tender-competition/import-lead-import.ts`、`import-lead-provider.ts`；`supplier-intel/constants.ts`（`SIGNAL_PLATFORMS` 加 `TRADE_DATA`）；情报页签「供应链」槽位从规划位改为真实数据；一个导入路由。
- 零 schema：`AwardRecordSource.sourceType`、`SupplierDiscoverySignal.platform` 都是字符串列；新数据落既有表与 JSON 位（差距分析 §7 方案甲）。
- 新增环境变量（默认关）：`TENDER_APC_AWARDS_ENABLED`、`TENDER_AUTO_SUPPLIER_RUN_ENABLED`、`TENDER_RFQ_ATTACHMENT_ENABLED`、`TENDER_RFQ_INTEL_RECIPIENTS_ENABLED`、`TENDER_IMPORT_LEADS_ENABLED`；均沿用「主开关 + 组织白名单」写法。CHAIN-4b 不加开关（修泄露不应该能关掉）。
- 八条硬纪律：
  1. 零 schema：遵守，见上。
  2. 出站先审批：遵守，且更严——附件字节进审批哈希，批准后不能变；本任务书不新增任何免审批发送。
  3. 不新增队列 / cron：遵守。CHAIN-1 挂在既有外部情报编排里，CHAIN-2 挂在既有自动起草触发点，CHAIN-3 由人导入触发。
  4. 脱敏：CHAIN-4b 加强对供应商侧的脱敏；价格卡只给有财务查看权的人看我方落地价（沿用 TI-4a 的财务访问规则）；Muse 通道不涉及。
  5. 不爬登录页：CHAIN-1 只读匿名公告且有「遇登录 / 人机验证即停」的前置核查；CHAIN-3 不抓任何网站。
  6. 邮箱分离：不涉及，发件仍走 `resolveSender`。
  7. 确定性优先：六个 change 零新增 LLM 调用（判断点 7 取 B 才需要例外）。
  8. 测试注册：每个 change 遵守。

## 上线顺序

1. **CHAIN-0**（运维，当天可做）：第 1 项已开；再开 2–6 项，第 7 项等 CHAIN-4b。
2. **CHAIN-0c**（失败要提示；不加开关，合并即生效）。
3. **CHAIN-4b**（堵泄露，最高优先级；不加开关，合并即生效）。合并后再开 CHAIN-0 第 7 项的三个询价开关。
4. **CHAIN-4a**（附件；staging 用测试邮箱收一封，打开 PDF 核对中文与内容后开生产）。
5. **CHAIN-1**（前置核查通过才写代码）。
6. **CHAIN-2**（依赖 `SUPPLIER_INTEL_ENABLED` 已开）。
7. **CHAIN-3**（依赖 CHAIN-2 的收件人合并；判断点 3 取 B 时，接 API 另开一个 change）。

每个 change 合并后 archive 一个小 PR，并把「Phase F（续）— 情报串联」状态列改为实际值；各出一份报告 `docs/QINGYAN_CHAIN-<n>_REPORT.md`。

## Out of scope

- 在原件上涂黑 / 改写原件；原标书页面作为附件（判断点 5 取 B 时另立）。
- 任何免审批发送、自动批准；催单 / 追问带附件。
- Ottawa（bids&tenders）、MERX 等其他省市的授标来源：先看 CHAIN-1 的做法能否复用，逐个核查是否匿名可读再另立。
- 抓取 ImportYeti 或任何第三方贸易数据网站；美国以外的海关数据；自动在网上查找供应商邮箱。
- 「建议报价」或任何把三种价格口径合并成一个数的推导。
- 扫描件 OCR（见后续队列 CHAIN-6）。
- 成本输入落库（TI Phase C 余项，仍等 Owner 定存储方案）。
- Muse / 微信通道里的任何新入口。

## 验收

**提速（CHAIN-0）**
- 一份 150 页以上的标包：总耗时 ≤ 20 分钟；事件里让出到下一次认领的间隔 ≤ 15 秒。

**失败提示（CHAIN-0c）**
- 重现一次第 3 步失败：2 分钟内（下一次定时任务）项目页从「分析中」变为「AI 分析未完成」，写明卡在哪一步、什么原因；发起人与项目负责人各收到一条站内通知；AI 任务详情页「需要人工处理」框里有同样的原因。
- 点「重新发起分析」可以重新跑；正常跑完的分析不受影响，仍进入「待审阅」。

**泄露（CHAIN-4b）**
- 用 TBS 24062-27-057 起草询价：邮件标题、正文、「供应商询价与符合性确认表」里都没有 `24062-27-057`、`Treasury Board`、截标日期；内部决策备忘录里照旧有。
- 人为在一条已确认要求里写进采购方名称再起草 → 起草失败，卡上写「命中：采购方名称」。

**附件（CHAIN-4a）**
- 批准后收到的邮件带一个 PDF，中文正常、条目与卡上预览一致；改动一条已确认要求后再执行这张旧卡 → 拒发，提示附件已变化需重新起草。

**Alberta 授标（CHAIN-1）**
- 以 Sunny 投过的 Alberta 露营装备 RFQ 同类关键词跑情报：历史中标槽位出现带 APC 编号与来源链接的记录；APC 不可达时联邦结果照常、状态里写明 APC 失败原因。

**推荐型号与价格（CHAIN-2）**
- 批准分析后无需任何点击，情报页签出现推荐型号（最多 3 个，带强制闸证据）与价格对照卡；三栏缺哪一栏写明缺；没有财务查看权的人看不到我方落地价一栏。

**进口线索（CHAIN-3）**
- 导入一份 CSV，中标者「同名」的出口商自动挂上并显示「线索，未证实当前供货」；「建议」档只出现在待确认列表；对一家线索点「加入供应商库」并补邮箱后，下一次起草询价的卡上它出现在收件人里，来源写「进口线索」。

**工程**
- `npm run test:ci`、`npm run typecheck`、架构守卫通过；新增测试全部在 `scripts/test-all.sh` 注册。
- Prisma schema 无 diff；`vercel.json` 无 diff；源码断言六个 change 无新增 LLM 调用点。
- `openspec validate <change>` 通过。

## 不确定处（实现前先核对，结果写进各自的 design.md）

- **2026-11-19 事件第 3 步的失败原因未查明**。按代码，最可能是：`ANALYSIS_EMPTY`（本次模型调用全部失败——密钥、额度或 GPT-6 Astra 不可用）、`429` 限流、单窗口 180 秒超时、或重试耗尽。待取 Vercel 运行日志（2026-11-19 10:15–10:45，Warning / Error）与该 Job 的 AgentRun `errorCode / errorMessage`。原因若是模型侧，CHAIN-0c 只能让失败被看见，修不了失败本身，另立。
- 生产上第 2–7 项环境变量的现值，代码里看不到；尤其 `TENDER_EXTERNAL_INTEL_ENABLED` 是否恰好为 `1`。
- APC 匿名公告的数据里是否稳定带中标方与金额；小额货物类授标是否都公布；APC 使用条款是否允许程序化读取。第三方页面显示 APC 有匿名 JSON 接口、文件下载要登录，但这需要实现者亲自核对，不能以第三方描述为准。
- `Supplier.contactEmail` 的填充率；填得少时判断点 4 的 B 实际能加进来的供应商很少。
- 供应商情报 run 的耗时：若一次 run 超过自动起草所在请求的时间预算，要改成「先起草、run 完成后在卡上补充推荐」，不能为此新增队列。
- 附件预览路由的权限：只允许能看这张审批卡的人预览。
- 分析事实（`tender-understanding/contract.ts`）里没有专门的联系人字段；采购方联系人邮箱 / 电话若只出现在要求原文里，禁出清单抓不到；既有敏感词表只匹配「客户邮箱 / contactEmail」这类字面词，抓不到真实的邮箱地址和电话号码。所以 CHAIN-4b 另加一条：供应商侧产物里出现任何邮箱地址或电话号码格式（我方发件人与签名除外）即失败。实现时用 TBS 标包实测一次。
- 人工导入的 CSV 来自第三方网站时，其使用条款是否允许导入到内部系统，由使用者自行确认；界面上写明。

---

## 附录 · 后续队列（不属于本任务书的 change）

| ID | Why | What | 前置 |
|---|---|---|---|
| CHAIN-0b 自动分析也接续跑 | 上传后自动分析的 legacy 队列 `/api/cron/tender-auto-analysis` 同样 `*/2` + 240 秒、让出后空等，没有续跑 | 复用 `self-trigger.ts` 的机制接到该路由（同一开关、同样五层防风暴） | 先确认 Sunny 是否还在走这条管线：Vercel Request Logs 看 `/api/cron/tender-auto-analysis` 在上传后是否有连续多条、每条接近 240 秒的记录 |
| CHAIN-5 授权贸易数据 API | 人工导入验证有价值之后，省掉手工查 | 为 `ImportLeadProvider` 接一家授权数据源；每次调用计费上限、按项目记用量 | 判断点 3 改 B；付费授权；合同允许程序化使用 |
| CHAIN-6 扫描件 OCR | 扫描版标书的 `OCR_REQUIRED` 页读不出文字，要求会漏 | 对 `OCR_REQUIRED` 页做 OCR 后重进分窗；候选：docling（MIT）、liteparse（Apache-2.0）；不用 AGPL 的 PyMuPDF / mupdf.js | 评估 Vercel 上的运行方式与耗时 |
| CHAIN-7 其他省市授标来源 | Ottawa、Ontario 等标查不到历史中标 | 逐个核查 bids&tenders、Ontario Tenders Portal 等是否有匿名可读的授标数据，能读的按 CHAIN-1 接入 | CHAIN-1 上线 |
| CHAIN-8 原件页面作附件 | 有的供应商必须看图纸才能报价 | 人逐页勾选原标书页面，系统检查页面文字不含禁出清单，扫描页一律要人确认 | 判断点 5 改 B；CHAIN-6 |

## 开源参考（2026-11-19 在 GitHub 检索；许可证以各仓库 LICENSE 文件为准，动手前再核一次）

- 敏感信息识别：`data-privacy-stack/presidio`（原微软项目，MIT）——本任务书用「白名单重排 + 项目专属禁出清单」，不需要它；留作 CHAIN-8 的第二道检查候选。
- PDF 真删除文字：PyMuPDF / `ArtifexSoftware/mupdf.js` 为 AGPL，闭源 SaaS 不引入。
- 授标数据采集框架：`open-contracting/kingfisher-collect`（BSD-3，OCDS 标准）——是否有加拿大省级数据源未核对，CHAIN-7 时再看。
- 海关数据：GitHub 上只有爬 ImportYeti 的脚本（如 `hughie21/Customs-Crawler`），违反对方条款和硬纪律第 5 条，不用。
- 11-11 的开源调研（`docs/QINGYAN_TENDER_FLOW_OSS_SURVEY.md`）结论不变：没有项目覆盖「读标书 → 询价 → 比价」整条链。

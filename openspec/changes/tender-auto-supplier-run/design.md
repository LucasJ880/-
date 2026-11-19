# Design：批准分析后自动给出寻源建议（CHAIN-2）

## Context

- 供应商情报（`src/lib/supplier-intel/**`，开关 `SUPPLIER_INTEL_ENABLED` + 组织白名单）：
  - `createProjectSearchRun(actor, { projectId, allowLlm })`（`project-run-service.ts:34`）只建一个 `PLANNED` 的搜索运行，需求来自当前有效分析（`sourceConfig.canonicalAnalysisRunId` 记是哪一份）；建检索简报时默认调一次模型（`search-brief.ts` `expandWithLlm`），只有 `allowLlm === false` 才跳过。
  - 执行只在 `POST /api/supplier-intel/runs/[id]/discover` 里同步做：认领 → `startSearchRun` → `executeSupplierSearchRun` → 释放；内部来源是记忆 / 历史成功 / 已存供应商（`internal-adapters.ts`），外部来源需要 `TENDER_EXTERNAL_INTEL_ENABLED` + `TAVILY_API_KEY`。发现与评分都不调模型。
  - **发现建出的候选没有型号、强制闸为「待定」、没有分数**。强制闸与分数只在每个「供应商 × 型号」单独的评估运行里，靠逐条要求的判定（人工，或只覆盖「点名认证」「数值阈值」两类的确定性规则）得出。主选 / 备选不落库，由 `loadProjectSupplierRanking`（`project-supplier-ranking.ts:70`）读时按已完成的评估算出。
- 价格三种来源：可比授标 `deriveAwardIntelligence(listAwardsForOrg)` 的 `comparablePricing.groups`（采购方 × 口径 × 币种、≥3 样本；组里只有采购方原文）；市场价格基准存在 `BidIntelligenceRoom.summaryJson.marketPricing`（外部情报编排写入，今天没人读）；FLOW-H2 `loadCompareCostSuggestionSafe` 给比价矩阵选定那家的落地价（内部不查财务权限）。财务权限 `resolveFinancePrivilege(...).canReadAll`。
- 自动起草询价 `maybeAutoDraftRfq` 在四个审核接口里同步调用；收件人只来自操作者的常用供应商或分组（主规格明文禁止按评分增补）。

## Goals / Non-Goals

**Goals**：分析批准后不用点就有候选池；情报页签直接看到推荐型号与三栏价格；可选地把推荐并进自动起草的收件人。

**Non-Goals（不动的）**：`src/lib/supplier-intel/**` 的评估、强制闸、评分、排名规则（只调用）；`src/lib/tender-intel/award-intelligence.ts`、`market-pricing.ts`、`orchestrate.ts`（只读结果）；`src/lib/tender-pricing/**`（只调用）；`src/lib/muse-bridge/**`；手动 / Muse 发起的询价；Prisma schema、`vercel.json`、cron。

## Decisions

### D1 自动建池：挂在审核接口里，在自动起草之前（判断点 1 A）

新增 `maybeAutoSupplierRun({ orgId, projectId, runId, userId })`，四个审核接口在 `maybeAutoDraftRfq` 之前各加一行调用（重复批准不调）。条件：开关、供应商情报开着、分析是当前有效且已批准、还没有以这份分析为需求来源的非评估、未取消的搜索运行。建池人 = 触发审核动作的人（审核动作本来就要项目写权限，`createProjectSearchRun` 也会再断言一次）。

- 否决：分析一完成就建（判断点 1 B）——匹配基于 AI 草稿，确认后要重跑。
- 否决：挂进 `maybeAutoDraftRfq` 里——那受自动起草开关管，两件事应各自可开关。

### D2 只用内部来源、不调模型

`createProjectSearchRun(actor, { projectId, allowLlm: false })` + `executeSupplierSearchRun(actor, runId, { adapters: [], includeInternalPool: true, finalize: true })`：外部适配器为空，外部查询数恒为 0；简报走确定性生成。

- **与任务书的出入**：任务书写「外部检索门开着时同时跑外部发现」。外部检索要几十秒，放在「批准」请求里会让人等；任务书也写了「超过请求时间预算就要改」。外部检索仍由人在供应链页点一次。
- 否决：起草之后异步补跑外部——需要队列或定时任务（硬纪律第 3 条）。

### D3 并发只留最早那个

建完后查同一份分析的非评估、未取消运行，按建立时间排；自己不是最早的就 `cancelSearchRun` 自己、不执行。不加锁表、不加新字段。

- 否决：咨询锁——Prisma 连接池下会话级锁不可靠，事务级锁又跨不过 `createProjectSearchRun` 内部的多个事务。

### D4 推荐型号读既有排名，没有就照实说

**与任务书的出入**：任务书设想自动建的运行就能给出「强制闸通过、主选 / 备选」。实际上发现只产出强制闸「待定」的候选，结论要靠评估（见 Context）。所以推荐型号读 `loadProjectSupplierRanking` 的主选 / 备选前 3（只来自已完成的评估），强制要求证据数从这些候选的 `mandatoryGateJson.items` 里数「判定通过且证据可采信」的条数。没有可推荐时分三种原因照实写，并给去供应链页的链接。

- 否决：自动评估——确定性规则只覆盖两类要求，强制闸要求全部强制条款通过，自动评估几乎得不出「通过」，还会在评估运行里留下大量「待定」。
- 否决：把发现出来的候选按「相似度」排个前 3——那是新评分，违背「不另行评分」，也会误导人以为是推荐。

### D5 价格对照三栏，不合并

一个纯函数按原始数据组装三栏与缺项文案（`sourcing-suggestions-pure.ts`），服务层只取数（`sourcing-suggestions.ts`）。可比授标在服务层按 `normalizeBuyerName` 把组里的采购方原文与项目采购方比对；市场基准只读 `summaryJson.marketPricing`；落地价只在 `canReadAll` 时取，并且没有权限时响应里不放这个键。

- 否决：把三栏折算成一个「参考价」——硬纪律第 4、7 条，任务书 Out of scope。
- 否决：复用情报槽位里的「可比价格」卡——那张是组织级、不按项目采购方过滤，且只有一种口径。

### D6 情报推荐并入自动起草的收件人（判断点 4 B，独立开关）

新开关 `TENDER_RFQ_INTEL_RECIPIENTS_ENABLED`（默认关）。`auto-draft-service` 在算出操作者名单之后、判定之前，用同一份排名取主选 / 备选的供应商（按名次），过滤在用且有邮箱、去掉已在名单里的，追加到 8 家为止；判定用合并后的家数。卡摘要与结果说明加一句「其中 N 家来自供应商情报推荐：…」。纯合并规则放 `src/lib/tender-rfq/intel-recipients.ts`。

- 否决：只在询价抽屉里预勾选（判断点 4 A）——不符合「人只决定发不发」。
- 否决：把推荐放到名单前面——操作者保存的顺序是既有约定，推荐只能补在后面。

## 与八条硬纪律的关系

1. 零 schema：遵守。只用既有表与 JSON 位；审计进 `AuditLog`。
2. 出站先审批：遵守。自动建池零出站；并入的收件人仍在待批卡上，人批了才发。
3. 不新增队列 / cron：遵守。全在既有审核请求里同步做，外部检索不放进来。
4. 脱敏：遵守。寻源建议不输出毛利率、估值、我方报价；落地价按既有财务权限，只给 `canReadAll`；不涉及 Muse 通道。
5. 不爬登录页：遵守。内部来源只查库；不做外部检索。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。建池 `allowLlm: false`；推荐读既有排名；价格只读已存结果；零新增模型调用（源码断言）。
8. 测试注册：新增 `src/lib/tender-intel/__tests__/sourcing-suggestions.test.ts`、`src/lib/tender-rfq/__tests__/intel-recipients.test.ts`、隔离库 `src/lib/tender-intel/__tests__/sourcing-suggestions-db.isolated.test.ts`，注册进 `scripts/test-all.sh`，前两个与隔离库进 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-intel/__tests__/sourcing-suggestions.test.ts`：开关真值表；推荐与三种原因的组装与文案；三栏缺项文案；市场基准截前 5；不合并（响应键白名单）；源码断言（`allowLlm: false`、`adapters: []`、四个审核接口在自动起草之前调用、无模型调用、卡上口径说明）。
- `npx tsx src/lib/tender-rfq/__tests__/intel-recipients.test.ts`：合并顺序、去重、8 家上限、未就绪不并入、开关真值表。
- `NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/sourcing-suggestions-db.isolated.test.ts`：批准后建池 / 每份分析一次 / 未批准不建 / 开关关闭 / 建池出错不影响批准 / 外查与模型调用为 0 / 审计；推荐（有评估、没评估）；可比授标区间；财务权限；接口权限；情报推荐并入自动起草（开、关）。
- 既有：`auto-draft-pure.test.ts`、`auto-draft-db.isolated.test.ts`、`supplier-groups-db.isolated.test.ts`、供应商情报的既有测试不改期望。
- 门禁：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-auto-supplier-run --strict`、`git diff origin/main -- prisma/ vercel.json` 为空。

## Risks / Trade-offs

- 内部来源里「已存供应商」不看简报，候选池约等于本组织在用的供应商（上限 100）——这是供应商情报既有行为；推荐只看评估结果，不受影响。
- 「批准」多出建池的时间（全是查库与逐个候选的事务，供应商多时几秒）。
- 推荐依赖人做评估；没评估时卡上照实说并给链接。

## Migration Plan

两个开关默认关，合并后行为不变。先对 Sunny 打开 `TENDER_AUTO_SUPPLIER_RUN_ENABLED`（需 `SUPPLIER_INTEL_ENABLED` 已开，CHAIN-0 第 6 项），看几单寻源建议；情报推荐并入收件人等评估做起来、推荐稳定后再开。回滚：关开关。

## 审核关注点与拍板结果（Lucas 2026-11-19「之后是 CHAIN-1、2、3……你全权负责」，按推荐）

- 与任务书的两处出入：自动建池不做外部检索（D2）；推荐型号读既有评估、没评估就照实说（D4）。
- 判断点 1 取 A、判断点 4 取 B（独立开关）。

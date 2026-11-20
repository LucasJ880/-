# Design：中标者 → 进口线索 → 供货商候选（CHAIN-3）

## Context

- TI-3a（`src/lib/tender-competition/`，主规格 `tender/competition-leads`）已有：进口线索契约 `createImportLead`（新建恒为 `LEAD_UNVERIFIED`、缺证据不收、运单超过 12 个月标历史，`import-leads.ts`）、`IMPORT_LEAD_CAVEAT_ZH`；公司名三档比对 `compareCompanyNames` / `suggestAliases` / `decideAlias` / `isSameEntity`（`company-identity.ts`）；来源状态 `readSource`（`LICENSED_TRADE_DATA` 恒未接通，`source-status.ts`）。全部纯函数，目录有守卫：`tender-competition/__tests__/amount-measures.test.ts` 要求恰好 5 个 `.ts`、禁 `@/lib/db` / 网络 / 模型。
- 授标记录：`listAwardsForBuyer`（`tender-intel/awards.ts`）按规整后的采购方在库里筛；CHAIN-2 已写好「剔除我方结果」的判法（记录最早的来源键 `own-result:` / `tender-result-winner:`，或中标方 = 本组织名，`tender-intel/sourcing-suggestions.ts`）。
- 供应商发现信号 `SupplierDiscoverySignal`：`platform` / `contentType` / `sourceOrigin` 都是字符串列，`rawMetadataJson` 是 JSON 位，`status` 只认 `NEW / REVIEWED / LINKED / REJECTED`（`signal-service.ts` 状态机），`linkedSupplierId` 可空。平台目录 `SIGNAL_PLATFORMS`（`supplier-intel/constants.ts`）在服务层 fail-closed 校验，显示名在 `workspace-labels.ts` `platformDisplay`。
- 供应商 `Supplier`：`source` 自由串、`contactEmail` 可空、无唯一约束；询价入口（`tender-rfq/web-entry.ts`）列本组织最近 100 家在用的供应商，没有邮箱的不能选。
- 情报页签的「供应链情报」槽（`org-award-intel-slots.tsx:367`）现在是一句规划占位；槽在三列网格里，放不下表格。

## Goals / Non-Goals

**Goals**：人工导入 → 自动比对中标者 → 汇总出口商 → 一键进供应商库，全程不出站、不调模型；接授权数据源时只加一个数据源实现。

**Non-Goals（不动的）**：`src/lib/tender-competition/**`（只调用，不改、不加文件）；`src/lib/supplier-intel/signal-service.ts`、`discovery-service.ts`、评估与排名；`src/lib/tender-intel/award-intelligence.ts` 的供应链投影（仍是 UNKNOWN，不改冻结服务）；`src/lib/tender-bid-readiness/**`；`src/lib/muse-bridge/**`；Prisma schema、`vercel.json`、cron。

## Decisions

### D1 新目录 `src/lib/tender-import-leads/`，不进 `tender-competition/`

任务书写新文件放 `tender-competition/`，但该目录的守卫测试要求恰好 5 个文件且禁 db。放进去就得改既有测试的期望（还要放开 db 禁令），等于拆掉 TI-3a「线索层不碰库」的保证。所以：纯函数（解析、匹配、汇总、数据源接口）与服务都放新目录，只 import TI-3a 的纯函数。

- 否决：改守卫测试、把服务塞进 `tender-competition/`——违背既有规格「线索层不对外」的源码断言。

### D2 数据源接口只有「人工粘贴」一种实现（判断点 3 A）

`ImportLeadProvider { id; sourceKind; labelZh; collect(input) }`，`manualPasteProvider` 的 `collect` 只解析传进来的文字。授权数据源仍按 `readSource(LICENSED_TRADE_DATA)` 显示未接通。接 API 时加一个实现 + 改来源配置，不动匹配与汇总。

- 否决：现在就接一家授权 API（判断点 3 B，需付费授权与合同审查）。

### D3 解析：认表头、不猜日期

逗号分隔复用 `procurement-records/sources-pure.ts` 的 `parseCsv`（RFC 4180）；表头一行含制表符时按制表符拆（从表格直接复制出来的样子）。列按表头别名认（中英，不分大小写；`findColumn` 同文件）。日期只认年在前的三种写法；`03/04/2025` 这类月日不明的直接报错，不猜。来源网址或批次「来源说明」至少一个——`createImportLead` 要证据引用，证据引用 = 来源网址，没有则 = 「来源说明 · 第 N 行」。

- 否决：按 `MM/DD/YYYY` 猜——美国提单网站常用这个格式，但加拿大用户也会贴 `DD/MM/YYYY`，猜错就是错的日期进了 12 个月窗口。

### D4 匹配：中标者来自授标记录，剔除我方结果，三档照 TI-3a

中标者 = `listAwardsForBuyer(项目采购方)` 中 `ACTIVE`、核实状态有依据（`HUMAN_CONFIRMED` / `SYSTEM_VERIFIED`）的中标方，按 CHAIN-2 同一规则剔除我方结果，按规整后名称去重。每行：`isSameEntity`（同名或已确认别名）→ 挂上；`compareCompanyNames` 为建议且这一对没被否决 → 待确认；其余不导入，只报行数（不把无关记录塞进库里）。T4 没接通、项目没有采购方、没有他人中标记录 → 整批不导入，照实说。

- 否决：无关的行也存下来——会把用户整张表都存进来，汇总里出现与本标无关的出口商。

### D5 落库：一行一条信号，线索状态进 JSON 位

`SupplierDiscoverySignal`：`platform = TRADE_DATA`（加进目录，平台名「进口记录（人工导入）」）、`contentType = USER_SUBMITTED`、`sourceOrigin = USER_SUBMITTED`（接 API 时为 `PROVIDER`）、`projectId`、`accountName = 出口商`、`title = 出口商 → 进口商`、`contentUrl = 来源网址`、`status = NEW`；`rawMetadataJson = { kind: "import_lead_v1", lead（createImportLead 的结果）, quantityRaw, importerRaw, winnerName, match: MATCHED | SUGGESTED, basis?, pairKey?, dedupeKey, batchId, sourceLabel }`。去重键 = 规整后「进口商 | 出口商 | 日期 | 品名」；同项目已有同键 → 跳过。被否决那一对的信号 → `REJECTED`；加入供应商库 → `LINKED` + `linkedSupplierId`。

- 否决：信号状态直接写 `LEAD_UNVERIFIED`——信号状态机只认四个值，其它模块按它筛；线索状态是另一层含义。
- 否决：新建表——硬纪律第 1 条。

### D6 别名裁决记在审计里（只追加）

裁决写一条审计 `tender.import_lead_alias_decided`，`afterData = AliasDecision`（两个名称、`pairKey`、裁决、裁决人、时间，即 `decideAlias` 的结果）。读裁决 = 本组织该动作的审计按时间取每个 `pairKey` 最新的一条（上限 2000 条）。同供应商分组（RFQ-AUTO-5）的做法：只追加，有人有时有据，不需要并发合并 `settingsJson`。裁决按组织生效（是不是同一家公司与项目无关）。

- 否决：存 `Organization.settingsJson`——多人并发裁决要锁与合并，还会和其它写 settingsJson 的模块抢同一行。

### D7 加入供应商库：同名关联、否则新建，没邮箱就停

规整后同名的供应商（本组织、任何状态）已存在 → 关联它；否则 `db.supplier.create({ name: 出口商原文, source: "trade_data", sourceDetail: "进口线索：{中标者} 的出口商（{来源说明}）", status: "active", contactEmail: null, createdById })`。该出口商在本项目的所有挂上的信号 → `LINKED`。不调既有 `createSupplier`（它不去重）；不查邮箱。在一个事务里做，并用 `pg_advisory_xact_lock(org + 规整名)` 防并发点两次建出两家。

### D8 汇总：确定性计数，关键词只比英文词

按规整后出口商分组：票数、近 12 个月票数（`isOlderThanCurrentWindow` 为假且不在未来）、最近一票、是否过期、对应中标者、供应商链接与有无邮箱。关键词：品名与本项目当前分析里已确认、面向供应商的要求（`normalizeSupplierFacingCategory` 非空）的原文，各取英文词（≥3 字母，小写，去掉一张固定的虚词表，词尾 `s` 去掉再比），取交集按字母序前 5 个。排序见规格。

- 否决：相似度打分或模型画像（判断点 7 B，要为硬纪律第 7 条开例外）。

### D9 界面：槽里放摘要，完整面板在槽位网格下面

槽在三列网格里，放不下导入框与表格：槽里只放摘要 + 「导入 / 查看进口线索」；点开后在网格下方整行显示 `ImportLeadsPanel`。接口 404（开关关）→ 槽里仍是原来的规划占位句，槽的状态徽标不变；开关开时不显示徽标（「AI 推断」「暂无数据」都不适用于人工导入的线索），状态写在面板里。

## 与八条硬纪律的关系

1. 零 schema：遵守。用既有 `SupplierDiscoverySignal`、`Supplier`、`AuditLog`；明细进 JSON 位。
2. 出站先审批：遵守。没有任何对外发送；加入供应商库不发信，之后询价照旧走待批卡。
3. 不新增队列 / cron：遵守。全由人点触发，请求内同步完成。
4. 脱敏：不涉及我方价格；不输出对手投标价、成本、毛利推断（规格 SHALL NOT）；不涉及 Muse。
5. 不爬登录页：遵守，且更严——系统不访问任何第三方网站，用户贴的网址只存不开（源码断言新目录与路由无 `fetch` / http 客户端）。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。解析、匹配、汇总全是确定性规则，零模型调用（源码断言）。
8. 测试注册：新增 `src/lib/tender-import-leads/__tests__/import-leads.test.ts` 与隔离库 `import-leads-db.isolated.test.ts`，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-import-leads/__tests__/import-leads.test.ts`：开关真值表；解析（逗号 / 制表符 / 引号、表头别名、缺列、空、超行数、超大小、逐行错误文案、同批重复、行号）；匹配三档（含已确认 / 已否决别名、剔除后为空的三种说明）；汇总（12 个月窗口、排序、关键词、日期未知）；线索状态与说明、响应键白名单（无推荐 / 价格字段）；源码断言（新目录与三个路由无网络与模型调用、`tender-competition/` 仍是 5 个文件、槽在开关关时保留占位句、面板写明线索说明与需要的列）。
- `NODE_ENV=test npx tsx src/lib/tender-import-leads/__tests__/import-leads-db.isolated.test.ts`：开关关 404；导入 → 信号（平台、状态、元数据）→ 再导入全部跳过；疑似同一家确认 / 否决 → 汇总变化、否决后再导入按无关；加入供应商库（新建无邮箱 → 询价入口有它；再点只关联；同名已有 → 关联不新建）；审计三种；权限（别的组织 404、未登录 401、被移出组织 404、只读成员写 403）；外部请求 0（拦截全局 fetch 计数）。
- 既有不改期望：`tender-competition/__tests__/*.test.ts`、`supplier-intel/__tests__/discovery-priority.test.ts`、`submission-parser.test.ts`。
- 门禁：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-import-leads-connector --strict`；`git diff origin/main -- prisma/ vercel.json` 为空。

## Risks / Trade-offs

- 数据靠用户自己去别处查：美国提单只在中标者（或其美国关联公司）海运进口美国且没申请保密时才有；加拿大不公开提单（任务书外部事实）。面板写明来源与线索说明。
- 名称比对只认同名与两条确定性依据：中标者在提单上用了完全不同的法人名时对不上，只能靠人看「对不上 N 行」再处理。
- `SIGNAL_PLATFORMS` 加了 `TRADE_DATA`：供应链页的信号列表会显示这些信号（平台名「进口记录（人工导入）」）；找厂优先级的可操作性表不加这一项（冻结表，按缺省 0 分），这些信号本来也不进找厂排序。
- 别名裁决读审计：组织裁决很多时只取最近 2000 条（每对取最新）。

## Migration Plan

开关默认关，合并后行为不变。先对 Sunny 打开 `TENDER_IMPORT_LEADS_ENABLED`，用 2–3 个真实标验证线索有没有用（判断点 3 A 的目的），再决定买不买授权数据。回滚：关开关（已导入的信号与已建的供应商留着，不影响其它功能）。

## 审核关注点与拍板结果（Lucas 2026-11-19「之后是 CHAIN-1、2、3……你全权负责」，按推荐）

- 判断点 3 取 A、判断点 7 取 A。
- 与任务书的出入：新文件不放 `tender-competition/`（D1）；无关的行不导入（D4）；别名裁决存审计（D6）。

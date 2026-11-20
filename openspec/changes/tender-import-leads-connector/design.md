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

### D3 解析：整格认表头、日期写法由人选

两种分隔都按 RFC 4180 解析（引号、转义引号、引号里换行、CRLF、BOM）：表头一行含制表符按制表符拆，否则按逗号拆——表格软件复制含换行的单元格时同样加引号（第一版对制表符逐行拆，审查实测会把一条记录拆成两条）。整行空白的丢掉（两种分隔一致）。「第 N 条记录」= 表头下面第 N 条（空行不算），不说「第 N 行」——引号里换行时行号对不上。表头只按别名整格匹配（不用 `findColumn` 的前缀兜底：`shipper` 前缀会误中 `Shipper Address`），同一种列匹配到两列 → 整批报错。日期：缺省只认年在前的三种写法；这一批选了「月/日/年」或「日/月/年」才按所选读斜杠 / 点 / 连字符分隔、四位年份的写法；表格导出带的「 0:00」时间去掉；两位年份不认；统一补零成 `YYYY-MM-DD` 再交给 `createImportLead`（它只认补零写法）。「在未来」= 晚于 UTC 今天再加一天（UTC 午夜前后，中国或加拿大的「今天」不会被误判）。超过 2048 字的来源网址只存前 2048 字、不当链接（用没截断的原文判断）。来源网址或批次「来源说明」至少一个——证据引用 = 来源网址，没有则 = 「{来源说明} · 第 N 条记录」。长度：名称 ≤ 300、品名 ≤ 1000、数量 ≤ 100、网址 ≤ 2048。

- 否决：按 `MM/DD/YYYY` 猜——美国提单网站常用这个格式，但加拿大用户也会贴 `DD/MM/YYYY`，猜错就是错的日期进了 12 个月窗口；由人每批选一次仍是确定性的。
- 否决：前缀匹配表头（见上）。

### D4 匹配：中标者来自授标记录，剔除我方结果，三档照 TI-3a

中标者 = 把 CHAIN-2 寻源建议里「本采购方的他人授标」从 `sourcing-suggestions.ts` 导出为共用函数 `listOthersAwardsForBuyer`（先看 `isT4AwardSchemaReady`，`listAwardsForBuyer` 按规整采购方在库里筛（上限 200 条，最新的），按最早来源键与本组织名剔除我方结果），再取其中 `ACTIVE`、核实状态有依据（`HUMAN_CONFIRMED` / `SYSTEM_VERIFIED`）的中标方，按规整后名称去重。寻源建议改用它，行为不变（既有测试不改期望）。每条记录对每个中标者：`isSameEntity`（同名或已确认别名）→ 挂上；`compareCompanyNames` 为建议且这一对没裁决过 → 待确认；一条记录既与一个中标者同名、又与另一个是建议时，以同名为准、不再列建议。全都无关 → 不导入，结果列出这些进口商名称（最多 10 个）与条数。T4 没接通、项目没有采购方、没有他人中标记录 → 整批不导入，照实说。

- 否决：无关的记录也存下来——会把用户整张表都存进来，汇总里出现与本标无关的出口商。

### D4b 不把进口线索的供应商自动加进自动起草（与任务书验收项的出入）

任务书验收写「加入供应商库并补邮箱后，下一次起草询价的卡上它出现在收件人里，来源写『进口线索』」。判断点 4 B 给自动起草加推荐的条件是「首选 / 备选、强制闸通过」——进口线索只是线索（TI-3a：不代表当前供货），没评估过就进自动起草的收件人，等于把未证实的线索直接变成询价对象。本次做到：加入后它出现在询价入口的供应商列表里（补上邮箱后可选），供应商页的来源显示「进口线索」，人勾选后进卡；评估成首选 / 备选后经 CHAIN-2 进自动起草。询价入口本身不显示供应商来源（不改 `tender/rfq-web-entry`）。

- 否决：自动起草时把有邮箱的进口线索供应商也并进来——绕过评估与强制闸，与判断点 4 B 的条件冲突。

### D5 落库：一条记录一条信号，存后不改；挂上与否在读的时候算

`SupplierDiscoverySignal`：`platform = TRADE_DATA`（加进目录，平台名「进口记录（人工导入）」）、`contentType = USER_SUBMITTED`、`sourceOrigin = MANUAL_ENTRY`（显示「人工录入」；不用 `USER_SUBMITTED`，那个的说明是「仅解析了分享链接与文字，未读取完整视频或帖子」，对不上；接 API 时为 `PROVIDER`）、`projectId`、`accountName = 出口商`、`title = 出口商 → 进口商`、`contentUrl` = 来源网址（只有 `http(s)` 且 ≤ 2048 字时，否则为空、原文留在明细里——信号列表把它渲染成链接）、`status = NEW`；`rawMetadataJson = { kind: "import_lead_v1", lead（createImportLead 的结果）, importerRaw, quantityRaw, sourceUrlRaw, dedupeKey, batchId, sourceLabel }`（表结构注释称这里是快照，存后不改）。去重键 = 规整后「进口商 | 出口商 | 日期 | 品名 | 数量 | 来源网址」（只到「日期 | 品名」会把同一天同品名的两票并成一票，票数偏少）；同项目已有同键 → 跳过。

读的时候：对每条信号，按当前的中标者与最新裁决重新算「挂上 / 待确认 / 否决」——确认或否决不改信号。信号在供应链页被人驳回（`REJECTED`）→ 不计入；被关联（`LINKED`）→ 汇总显示它关联的供应商。加入供应商库走既有 `linkSignalToSupplier`（状态机、行锁、`resolutionJson: HUMAN_LINKED`、审计都按既有规则），只处理还是 `NEW / REVIEWED` 的。

- 否决：信号状态直接写 `LEAD_UNVERIFIED`——信号状态机只认四个值，其它模块按它筛；线索状态是另一层含义。
- 否决：裁决时改写 `rawMetadataJson` 或把信号标 `REJECTED`——绕过信号状态机（`LINKED` / `REJECTED` 是终态），供应链页那边的人也可能同时在改。
- 否决：新建表——硬纪律第 1 条。

### D6 别名裁决记在审计里，每一对一条

裁决写一条审计 `tender.import_lead_alias_decided`，`targetType = import_lead_alias`、`targetId = "alias:" + sha256(pairKey) 前 32 位`，`afterData` = `decideAlias` 的结果（两个名称、`pairKey`、裁决、裁决人、时间；审计的 `afterData` 是字符串，读时解析）。读：先算出本项目所有候选对的 `targetId`，按 `[targetType, targetId]` 索引一次查回（没有条数上限，不会让很久以前否决的一对重新冒出来）。写：事务内 `pg_advisory_xact_lock(org + targetId)`，已有裁决 → 409；只接受本项目当前待裁决的一对。裁决按组织生效（是不是同一家公司与项目无关），写权限按本项目（能修改本项目的人），规格写明。

- 否决：存 `Organization.settingsJson`——多人并发裁决要锁与合并，还会和其它写 settingsJson 的模块抢同一行。
- 否决：按动作取最近 N 条——有上限就会丢掉旧的否决。

### D7 加入供应商库：同名关联、否则新建，没邮箱就停

只接受本项目汇总里（挂上的）的出口商。规整后同名的供应商（本组织、任何状态；库里没有唯一约束，可能有几家）已存在 → 按固定顺序取一家关联：在用且有邮箱 → 在用 → 最近更新；取到的已停用时照实说。否则新建 `{ name: 出口商原文, source: "trade_data", sourceDetail: "进口线索：{中标者} 的出口商（{来源说明}）", status: "active", contactEmail: null, createdById }`。这家出口商已有线索关联过供应商 → 直接用那一家（「关联新导入的 N 条」走这里）。同名在本组织里全量比（库里没有规整名的列；第一版按第一个词前缀筛、只取 200 条，审查指出「&」、全角字、单字母、常见地名开头的都会漏掉、建出重复）。查与建在一个事务里，`pg_advisory_xact_lock(org + 规整名)` 防并发点两次建出两家；之后逐条 `linkSignalToSupplier`（只处理 `NEW / REVIEWED`）。不调既有 `createSupplier`（它不去重）；不查邮箱。关联了线索的供应商按既有删除守卫不能删（规格写明）。

- 否决：每次都新建——同一家出口商在几个项目里各建一家，询价入口出现重复。
- 否决：已有同名就报错让人去找——多一步，且「同名」规则是确定的，可以照实关联并说明。

### D8 汇总：确定性计数，关键词只比英文词

按规整后出口商分组：票数、近 12 个月票数（`isOlderThanCurrentWindow` 为假且不在未来）、最近一票、是否过期、对应中标者、供应商链接与有无邮箱。关键词：品名与本项目当前分析里已确认、面向供应商的要求（`normalizeSupplierFacingCategory` 非空）的原文，各取英文词（≥3 字母，小写，去掉一张固定的虚词表，词尾 `s` 去掉再比），取交集按字母序前 5 个。排序见规格。

- 否决：相似度打分或模型画像（判断点 7 B，要为硬纪律第 7 条开例外）。

### D9 界面：槽里放摘要，完整面板在槽位网格下面

槽在三列网格里，放不下导入框与表格：槽里只放摘要 + 「导入 / 查看进口线索」；点开后在网格下方整行显示 `ImportLeadsPanel`。接口 404（开关关）→ 槽里仍是原来的规划占位句，槽的状态徽标不变；开关开时不显示徽标（「AI 推断」「暂无数据」都不适用于人工导入的线索），状态写在面板里。不能修改的人（`canEdit` 为假）看不到导入框与按钮。错误按原因归并（「日期认不出：第 2、3、5 条记录」）。

- 否决：在槽里直接放完整面板——三列网格里的一格放不下表格。
- 否决：另开一个页面——用户要在看投标情报的同时对照中标者。

### D10 其它页面的显示

`trade_data` 加进 `SUPPLIER_SOURCE_LABELS`（`inquiry/types.ts`）与供应商页、列表、筛选里各自的来源名称表（四处，值「进口线索」）。`discovery-priority-service.ts` 的 `prioritizeSignal` 对 `TRADE_DATA` 返回空（找厂优先级是给公开网页 / 平台线索排调研顺序的，不适用于运单记录）。既有主规格 `procurement/watch-scan` 写「需登录或付费的商业提单库不接入」——本功能同样不接入，只收人贴进来的文字，面板写明。

- 否决：信号不进 `SIGNAL_PLATFORMS`、另起一张表——硬纪律第 1 条；且差距分析 §7 方案甲已定落点。
- 否决：让这类线索也算找厂优先级——可操作性表是冻结的，运单记录不是厂家页面，给出的分数没有意义。

### D10b 在供应商页补上邮箱与启用（第一轮审查：使用流畅）

「加入供应商库」之后最要紧的一步是补邮箱，但供应商详情页只能改评分，联系信息只能在列表页的编辑框里改（询价入口的「补邮箱」也链到详情页，同样走不通）。在详情页联系信息里加「补上邮箱 / 修改」与「启用」，用既有 `PATCH /api/suppliers/[id]`（`updateSupplier` 本来就收 `contactEmail`、`status`）。

- 否决：链到列表页 `?edit=`——列表页没有这个入口参数，要另改列表页；详情页本来就是各处链过去的地方。

### D11 并发与上限

导入：比对在事务外（只用这一批的进口商与这几对的裁决），事务内 `pg_advisory_xact_lock(org + 项目 + "import-leads")` 包住「按这一批的去重键在库里查（`rawMetadataJson->>'dedupeKey' = ANY(...)`）→ 数本项目已存条数 → 写信号」，连点两次不会写出重复。每个项目最多 5000 条，到了上限整批拒绝（读视图也只读这么多，所以不会有读不到的）。请求体先看声明的长度，超了不读。加入供应商库、裁决见 D6、D7。

- 否决：唯一约束——零 schema（硬纪律第 1 条）。
- 否决：把已存的全部读出来在内存里查重——第一版就是这样，被审查指出过了读视图的条数上限就查不到。

### D12 比对的成本：每个名称只规整一次

TI-3a 的 `compareCompanyNames` / `aliasPairKey` 每比一对都要把两个名称从头规整一遍；2000 条长名称 × 200 个中标者时一次读视图要几十秒（第一轮审查：安全实测）。比对器先把中标者规整好，进口商按规整后名称记住，规则与 TI-3a 逐字相同（测试里与 `compareCompanyNames` / `aliasPairKey` 逐对对照）；同样规模实测不到 0.1 秒。

- 否决：限制名称长度或中标者个数来压成本——治标；而且照样会在大一点的组织里变慢。

## 与八条硬纪律的关系

1. 零 schema：遵守。用既有 `SupplierDiscoverySignal`、`Supplier`、`AuditLog`；明细进 JSON 位；裁决查询用既有 `AuditLog [targetType, targetId]` 索引。
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
- 历史中标者取本采购方最新的 200 条授标（`listAwardsForBuyer` 的上限）：同一采购方授标极多时更早的中标者比不到（规格写明）。
- 别名裁决对全组织生效、不能撤回，能修改本项目的人就能裁（第一轮审查：安全，残留风险）：裁决前的确认框写明范围；要不要提高到组织管理员或做撤回，留给 GATE 拍板。
- 投标准备度的「进口线索」阶段（主规格 `tender/stage-policy`「用户录入了进口线索 → 执行」）还不读这里导入的记录（`tender-bid-readiness/workspace-view.ts` 不加 `IMPORT_LEADS`）：本次 Out of scope，记入交接作后续。
- 关联了线索的供应商不能删（既有删除守卫）：点错了「加入供应商库」要在供应链页处理那几条线索。

## Migration Plan

开关默认关，合并后行为不变。先对 Sunny 打开 `TENDER_IMPORT_LEADS_ENABLED`，用 2–3 个真实标验证线索有没有用（判断点 3 A 的目的），再决定买不买授权数据。回滚：关开关（已导入的信号与已建的供应商留着，不影响其它功能）。

## 审核关注点与拍板结果（Lucas 2026-11-19「之后是 CHAIN-1、2、3……你全权负责」，按推荐）

- 判断点 3 取 A、判断点 7 取 A。
- 与任务书的出入：新文件不放 `tender-competition/`（D1）；无关的记录不导入（D4）；进口线索的供应商不自动进自动起草的收件人（D4b，验收项改为「出现在询价入口、来源显示进口线索」）；别名裁决存审计（D6）。
- 实现后第一轮多维审查（正确性、安全、规格一致、使用流畅四个子 agent）已并入 D3、D5、D7、D10b、D11、D12，逐条处理见 `docs/QINGYAN_CHAIN-3_REPORT.md`。
- 开工前计划审查（一个子 agent，只给四件套与代码）11 条已并入：信号走既有关联流程、挂上与否读时算（D5）；裁决按对查、加锁、409（D6）；去重键加数量与网址；抽出剔除我方结果的共用函数（D4）；其它页面的显示（D10）；表头整格匹配、日期写法由人选、记录编号口径、长度上限（D3）；多中标者与同名多家的规则（D4、D7）；判定顺序与并发（D11）；D7、D9 补否决的备选。

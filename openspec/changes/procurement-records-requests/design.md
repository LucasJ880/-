# Design — procurement-records-requests（PROC-1）

## Context

- Tender 现状：`Project(workDomain=tender)` 是投标项目；`/projects/intelligence/*` 是情报中枢，其中「情报监控」「周期采购」为 notEnabled 占位；`tender-intel/canadabuys.ts` 已用 open.canada CKAN 合同数据集（资源 `fac950c0-00d5-4ec1-a4d3-9cbebf98a305`，仓库 2026-08-20 实证字段）做供应商价格带；`tender-intel/watch.ts` 对公开页做哈希变更检测，挂在每小时的 `tender-watch` cron。
- 文件：`putPrivateBlob` / `readBlobStream`（私有 Blob），`upload-guard`，unpdf / xlsx 解析，页级 `OCR_REQUIRED` 约定（`ProjectDocumentPage`）。
- 调度：`runTrackedAutomation`（AutomationRun，陈旧 running 30 分钟自动关闭）；`getLocalTimeParts`（Intl 时区）。
- 鉴权：`requireOrgRole`、`requireProjectRead/WriteAccess`、`resolveRequestOrgIdForUser`（显式 orgId 必须是本人 active 成员；平台管理员须显式指定）。
- 暗合并：`T4_AWARD_INTELLIGENCE_SCHEMA_READY` 闸（关时新表零访问）；生产构建前 `predeploy-migration-gate` 校验 `EXPECTED_ACTIVE_MIGRATIONS` 已全部应用。
- 本会话网络策略拒绝官方域名，适配器只能以官方开放数据格式实现并用 fixture 测试；真实只读运行待放行后执行。

## Goals / Non-Goals

**Goals**：任务书第三节 A–D 的 V1 闭环——定时扫描 → 候选 → 历史合同 → 公开资料 / 既有披露 → 申请卡 → 自助提交 → 回执与案件 → 来信与期限 → 披露文件 → 有来源的分析。

**Non-Goals**（具体到模块）：
- `src/lib/muse-bridge/**`、`src/lib/pending-actions/**`、`src/lib/tender-rfq/**` 不改。
- `src/lib/tender-intel/canadabuys.ts`、`watch.ts`、`awards.ts` 不改（只 import 复用）；`AwardRecord` 不写。
- `ProjectDocument` / `ProjectDocumentPage` 不复用为披露附件（避免触发招标文件自动分析与在项目文件列表暴露回执）。
- 既有 Prisma model 不加字段、不加关系；新表对既有表只用逻辑引用（字符串 id + 索引）。
- `vercel.json` 不加 cron；`.claude/launch.json`、`docs/` 既有文件不动。

## Decisions

### D1 持久化：新增表（触碰硬纪律 1，待拍板）
新增 16 张表（全部 `Procurement*` / `Records*` 前缀），一个增量迁移只 `CREATE TABLE` / `CREATE INDEX`，不改既有表：

| 表 | 作用 | 幂等 / 并发锚点 |
|---|---|---|
| ProcurementWatch | 监控配置、时区、排程、上限、启用人、最近运行 / 最近成功 / 下次运行 | `@@unique([orgId, name])` |
| ProcurementScanRun | 单轮运行：槽位、状态、心跳、来源结果、计数、截断 | `@@unique([watchId, slotKey])` |
| ProcurementInstrument | 采购工具（招标 / 合同或 SO/SA / call-up）、三方机构、到期 / options / 重招、优先级、分诊 | `@@unique([orgId, dedupeKey])` |
| ProcurementInstrumentRelation | call-up → SO、招标 → 合同、前序、相关历史 | `@@unique([fromInstrumentId, toInstrumentId, relation])` |
| ProcurementTenderLink | Tender 项目 ↔ 采购工具（当前 / 前序 / 相关） | `@@unique([projectId, instrumentId])` |
| ProcurementSourceEvidence | 来源 URL、抓取时间、发布日期、来源 ID、内容哈希、快照、解析状态 | `@@unique([orgId, sourceType, sourceKey, contentHash])` |
| RecordsApplicantProfile | 申请人 / 公司 / 代表人 / 地址 / 邮箱，版本与确认 | — |
| RecordsRuleProfile | 机关申请路径、费用、时限、来源、核实 | `@@unique([orgId, jurisdiction, institutionKey, channel])` |
| RecordsLedgerAttestation | 历史台账导入 / 真实用户确认无历史 | — |
| RecordsRequest | 申请主体、机关、路径、渠道、三条状态、处理结果、提交与案件编号、期限、转交 | `@@unique([orgId, autoDraftKey])`（自动草拟卡） |
| RecordsRequestVersion | 正文、中文说明、范围、申请人快照、text hash、scope fingerprint | `@@unique([requestId, versionNo])` |
| RecordsRequestEvent | 案件时间线（只追加；更正指向旧事件） | `@@unique([requestId, dedupeKey])` |
| RecordsAttachment | 回执 / 来信 / 披露文件 / 付款凭证 / 截图 | `@@unique([requestId, contentHash])` |
| RecordsAttachmentUnit | 页 / 工作表文本单元 | `@@unique([attachmentId, unitIndex])` |
| ProcurementLineItem | 提取明细（Decimal）与来源位置、复核 | `@@unique([attachmentId, dedupeKey])` |
| ProcurementAnalysis | 分析版本、覆盖、按口径结果、缺口、假设 | `@@unique([requestId, versionNo])` |

金额：`Decimal(18,2)` / 数量与单价 `Decimal(18,4)`，计算一律转整数分（BigInt）后相加；费用用整数分 `Int?`。日期范围用 `@db.Date`；时间戳 UTC，显示 America/Toronto。

否决：①全部塞进 `Organization.settingsJson` / AuditLog（零 schema）——申请台账需要唯一约束防并发重复、Decimal 金额、按机关 / 编号检索与只追加事件，JSON 大字段无法提供行级并发与约束，且整组织 JSON 并发写会互相覆盖；②复用 `AwardRecord` 存合同——其 `winnerName` 必填、语义是授标而非招标候选 / call-up，且其写入口有 T3 人工确认纪律，混用会污染授标情报。

暗合并：`PROCUREMENT_RECORDS_SCHEMA_READY`（默认关，fail-closed）关时所有新接口返回 `available:false, reason:"SCHEMA_NOT_READY"`，cron 步骤跳过，新表零访问。迁移登记进 `EXPECTED_ACTIVE_MIGRATIONS` 后，生产构建会被迁移闸挡住直到受控迁移完成——这是有意的：合并前必须先走 Owner Gate 的迁移流程（见 Migration Plan）。

### D2 扫描执行：挂在 `tender-watch` cron + 运行行认领
- `tender-watch` 每小时 :25 UTC 运行；在现有公告盯梢步骤之后追加 `runTrackedAutomation("procurement-watch", …)`，maxDuration 120 → 300，扫描步骤墙钟预算缺省 150 秒。
- 认领：到期槽位 → `INSERT ProcurementScanRun(watchId, slotKey)`，唯一约束保证两个 worker 只有一个拿到；拿到后 `updateMany(where status=QUEUED|过期心跳, data runnerToken)` 条件更新。心跳每个来源完成后刷新；心跳超过 10 分钟视为失联，下一轮条件更新接管（attempt+1），按 `progressJson.completedSources` 跳过已完成来源。预算耗尽时把运行放回 QUEUED（「待续」），下一轮续上。
- 手动「立即扫描」：接口只建 QUEUED 运行（槽位 `manual:<uuid>`；同一监控已有未失联的 QUEUED/RUNNING 则直接返回该运行），用 `after()` 在响应后执行；`after()` 未执行时 cron 兜底接手超过 2 分钟的 QUEUED。前端轮询运行状态与来源进度。
- 所有写入都落在唯一键上（instrument dedupeKey、evidence 内容哈希、autoDraftKey、通知 sourceKey），重跑 / 并发 / 接管不会产生重复采购工具、申请卡或通知。
否决：①新建 `procurement-scan` cron 或队列表——违反硬纪律 3；②复用 workforce runtime 的 job/lease——它是 Agent 任务的执行面（server plan / handoff），为一个只读抓取任务引入其 plan 编译与审批链过重，且其自触发模块只允许 `agent-runs` 路由使用；③在前端请求里同步抓取——会超时，任务书明令禁止。

### D3 多伦多排程（夏令时）
排程存本地墙钟（`weekdays:[1,4]`，`hour:8`，`minute:0`，`timezone:"America/Toronto"`）。纯函数用 Intl 求某本地日期 08:00 对应的 UTC 瞬间（两次偏移迭代，处理 DST 切换日；不存在的本地时间向后顺延，重复的取第一次），得到「最近已到期槽位」与「下一槽位」。槽位键 `scheduled:YYYY-MM-DDTHH:mm@America/Toronto` 用本地时间，跨 DST 稳定。只补跑最近一个错过的槽位，且槽位须晚于启用时间。cron 每小时一次，因此实际开跑在本地 08:25 前后（UI 写「08:00 后的首个整点 25 分」）。
否决：把排程写成 UTC cron（`0 13 * * 1,4`）——冬夏令时会差一小时，任务书明令禁止固定 UTC 偏移。

### D4 官方来源适配器（只读、fetch 可注入）
| 来源键 | 端点（缺省，可 env 覆盖） | 能力 | 本会话状态 |
|---|---|---|---|
| `CANADABUYS_TENDER_NOTICES` | `https://canadabuys.canada.ca/opendata/pub/newTenderNotice-nouvelAvisAppelOffres.csv`、`openTenderNotice-ouvertAvisAppelOffres.csv`（`PROCUREMENT_CANADABUYS_NOTICE_URLS`） | 自动发现新候选 | 网络拒绝，未实测 |
| `OPEN_CANADA_CONTRACTS` | CKAN `datastore_search`，资源 `fac950c0-…`（`EXTERNAL_INTEL_CONTRACTS_RESOURCE_ID` 共用） | 关键词发现、按 `procurement_id` / `standing_offer_number` 刷新已知合同与 call-up | 网络拒绝，字段为仓库既有实证 |
| `OPEN_CANADA_ATI_SUMMARIES` | CKAN `datastore_search`，资源 `PROCUREMENT_ATI_SUMMARIES_RESOURCE_ID`（未配置 → SKIPPED「未配置资源 ID」） | 既有披露摘要检索 | 未配置 + 网络拒绝 |
| `CANADABUYS_CONTRACT_HISTORY_PAGE` | 种子 / 已关注合同的公开页 URL | 页面哈希变更检测（不解析字段） | 网络拒绝 |
| 省市门户 / MERX / Bonfire / Ariba | — | 仅人工链接导入 | — |

CSV 列按前缀匹配（如 `referenceNumber-`、`solicitationNumber-`、`title-titre-eng`）；必需列缺失 → `PARSE_FAILED`，不当零结果。每个来源返回 `{status, fetched, matched, newCandidates, truncated, note}`；失败不清空既有数据、不把未知字段改 0。所有抓取受外部情报总闸 `TENDER_EXTERNAL_INTEL_ENABLED` 约束（未开 → 各来源 UNAVAILABLE 并写明原因，零外部请求）；定时入口另经 `requireCronSecret` 的非生产隔离（`QINGYAN_ALLOW_CRON_NON_PROD`）。手动「立即扫描」只读公开数据，受总闸约束，不另走 cron 隔离。
否决：用 Tavily / Firecrawl / 二级聚合站——不是官方来源，任务书禁止伪装成官方结果。

### D5 采购工具身份与去重
- 规范编号：大写、去空白 / 连字符 / 点，去 CanadaBuys 修订后缀（`-001` 进 alias，记 `AMENDMENT_SUFFIX`）。
- 规范机构：固定别名表（PSPC / PWGSC / TPSGC / SPAC / Public Services and Procurement Canada…→ `PSPC`；CSC、DND、CORCAN 等），未命中用规范化原文。
- 类别：`SOLICITATION` / `AWARD_INSTRUMENT`（合同、SO、SA 同一类，子类型另存为说明字段）/ `CALL_UP` / `OTHER`——避免一个来源说 SO、另一个说 contract 时同号拆成两条。
- 去重键 `jurisdiction|procuringEntityKey|instrumentClass|normalizedNumber`；同号同类但机构键不同且非别名 → 新建并填 `possibleDuplicateOfId`，人工复核，不擅自合并。
- 标题只参与检索；同标题不同编号各自独立；同一来源记录内容哈希变化 → 新证据行（修订历史），采购工具 `lastChangedAt` 更新；哈希不变只刷新 `lastSeenAt` / `lastVerifiedAt`。
否决：按标题相似度合并——任务书明令同标题不同编号不合并。

### D6 优先级（确定性，可解释）
五个维度各给分与中文理由：业务匹配（关键词命中，0–30）、重复采购迹象（call-up / 前序 / 既有披露，0–20）、准备时间（到期前 4–6 个月 25 分、6–12 个月 10 分、招标截止临近 15 分，0–25）、资料缺口（无订单数据 / 无既有披露 15 分，0–15）、资料持有机关清楚（10 / 0）。只排序与解释，不输出中标概率；资格 / 原产地 / 认证等缺证据显示「未知」。

### D7 申请卡、模板与 READY 闸（确定性）
- 正文：任务书第七节联邦模板，按记录类别取舍条目，方括号由已核实数据替换；缺数据时保留方括号，READY 闸拦截。中文说明同源生成。省市申请不套联邦模板：正文由用户填写，规则未核实时不能 READY。
- 版本：任何正文 / 范围 / 机关 / 渠道 / 申请人变动写新 `RecordsRequestVersion`（只插入），重算 text hash（正文规范换行后 sha256）与 scope fingerprint（申请主体 + 辖区 + 机关 + 编号集 + 类别集 + 起止日，sha256，与渠道 / 标题 / 措辞无关）；当前状态 READY 时回到 DRAFT。已交接 / 已提交版本不再可编辑。
- READY 闸阻塞码（全部满足才 READY）：申请人缺失 / 未确认 / 必填缺失 / 快照过期；接收机关或持有依据缺失；规则缺失 / 未核实 / 费用未知 / 入口未核实 / 该辖区不支持自助；公开资料与既有披露未按序检查（新正式申请）；台账未核实；重叠未解决；正文含占位符；日期无效；类别或编号为空。
- 准备与发起交接时服务端在事务里先 `pg_advisory_xact_lock(hashtext(org|applicant|jurisdiction|institution))` 再重算重复检查与 READY，防两人并发交接同一范围。
否决：让模型判定 READY 或生成正文——违反硬纪律 7，且任务书要求 READY 由确定性代码负责。

### D8 重复检查
比较对象：本组织全部申请（含已归档 / 已关闭）的当前版本范围。命中条件：申请主体相同（申请人缺失的历史记录按「本组织可能同一主体」保守命中）+ 辖区相同 + 机关键相同（机关未规范化 → 人工复核）+ 编号交集非空 + 类别交集非空 + 日期区间相交。结果：`CLEAR` / `DRAFT_EXISTS`（未提交版本，优先续改）/ `BLOCKING`（已交接、用户报告提交、未知、已提交、受理、处理中、已披露）/ `NEEDS_REASON`（已关闭 / 撤回 / 取消 / 拒绝，须填新增范围或原因）/ `UNVERIFIED`（无台账确认、任一历史状态无法解析、读取失败）。日期按天计算覆盖与新增部分（含首尾日），例：旧至 10-31、新至 11-05 → 重叠 + 新增 11-01…11-05 共 5 天。

### D9 状态、证据与期限
三条独立状态 + 政府处理结果（任务书第九节词表）。状态转换查表：`DRAFT→READY→HANDOFF_PENDING→{USER_REPORTED_SUBMISSION | SUBMISSION_UNKNOWN}→SUBMITTED→ACKNOWLEDGED→PROCESSING→CLOSED`，另有回退 `READY→DRAFT`（新版本）、`HANDOFF_PENDING→READY`（取消交接）、`SUBMISSION_UNKNOWN→READY`（真实用户确认未提交并附依据）。CLOSED 只能由「最终回应」类事件触发且须附来信附件；内部提醒到期不改状态。未提交申请的本地归档另存 `archivedAt`，与向政府撤回分开。
证据等级：`user_reported`（口述）、`document_verified`（回执附件 + 确定性比对编号与机关名出现 + 真实用户确认）、`runtime_verified`（保留给未来自动适配器，V1 不产生）。仅付款凭证或截图不能单独证明提交。
期限：`officialDueAt` 只来自来信中明确写出的日期；`estimatedDueAt` 由规则（联邦 30 个日历日）推算并保存依据，UI 标「估算」；`internalFollowUpAt` 是内部提醒。不显示精确法律倒计时。
旧 Skill 单状态映射表：`RELEASE_NOTICE_RECEIVED → files NOTICE_RECEIVED`、`PARTIAL_RELEASE → outcome PARTIAL_DISCLOSURE + files PARTIAL_FILES_RECEIVED` 等；未知值返回错误，不静默吞掉。

### D10 附件与分析
- 上传：服务端校验类型 / 大小（PDF、CSV、XLSX、XLS、PNG、JPG、TXT，≤ 25 MB），sha256，同申请同哈希返回既有附件；文件进私有 Blob，下载走鉴权路由流式返回，不出公开链接，日志不打印文件名以外内容。
- 解析（`after()` + cron 兜底）：PDF 用 unpdf 分页；有效字符过少的页记 `OCR_REQUIRED`，全部页过少 → `NEEDS_OCR`；加密 → `ENCRYPTED`；解析异常 → `CORRUPT`；CSV / XLSX 按工作表成单元。
- 抽取：表格按表头同义词（中英法）映射列，金额口径由表头 / 工作表名判定（invoiced / paid / committed / ordered / ceiling / evaluated），判定不了记 `UNKNOWN`；PDF 抽含金额的行为候选，口径 `UNKNOWN`。全部明细默认 `NEEDS_REVIEW`，保存页码 / 工作表 + 行号与原文片段。附件文字只作为数据，永不改变申请字段、权限或触发动作。
- 分析：只用 `CONFIRMED` 明细（`NEEDS_REVIEW` 计入待复核数）；按（口径, 币种）分列合计；数量按（产品, 单位）分列；修订口径 `REVISED_TOTAL` 取最新不叠加，`UNKNOWN` 不计入并列缺口；同口径同单号去重；贷项 / 取消以负数保留关联；公开合同值不等于实际支出、框架值 0 不等于未采购、无记录不等于 0。结果标题固定为「已取得记录的合计」。

### D11 权限
- 组织级读（监控、运行、候选、台账、申请详情）：本组织 active 成员（`org_viewer` 及以上）；orgId 由 `resolveRequestOrgIdForUser` 校验，申请 / 附件按行上的 orgId 再查成员关系，浏览器传入的 orgId 只作选择、不作授权。
- 写配置、启用 / 停用、规则核实、申请人资料、台账确认：`org_admin` 及以上。
- 申请草拟、交接、回执、事件、附件、明细复核、分析：`org_member` 及以上。
- 平台 super_admin 视为组织管理员（与 `requireOrgRole` 一致）。cron 只以系统身份处理已启用的监控，不接受请求体里的组织参数。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | **触碰**：新增 16 张表（只 CREATE，不改既有表）。需要 Evan 拍板例外（D1 说明否决零 schema 方案的理由）；未拍板不合并。生产迁移不在本 change 执行。 |
| 2 | 出站先审批 | 遵守：零出站。不发邮件、不提交、不付款；跟进信只存草稿；「打开官方入口」是用户自己在浏览器打开链接。 |
| 3 | 禁止第三套队列 | 遵守：无新 cron / 队列 / 调度器 / worker 注册表；挂在既有 `tender-watch`，单轮认领用运行行唯一键（D2）。`AUTOMATION_REGISTRY` 只追加一条展示用登记，与 CAL-1 同型。 |
| 4 | 脱敏 | 不涉及 Muse 通道；另行约束：回执 / 来信 / 申请人资料不进通知摘要与日志（spec「敏感资料不外泄」）。 |
| 5 | 不爬登录页 | 遵守：只读开放数据与公开页；ATIP 门户只给链接，不抓取、不保存政府凭证。 |
| 6 | 邮箱分离 | 不涉及：V1 不读邮箱。 |
| 7 | 确定性优先 | 遵守：正文模板、优先级、去重、READY、状态、金额全部确定性；零 LLM 调用（UI 显示「AI 调用：0」）。 |
| 8 | 测试注册 | 遵守：新测试在同一 task 注册进 `scripts/test-all.sh`，纯测试同时进 `scripts/test-ci-unit.sh`。 |

## Risks / Trade-offs

- **[官方 CSV 列名变化]** → 前缀匹配 + 必需列缺失即 `PARSE_FAILED` 并在 UI 显示；不会把改版当成「零新标」。
- **[网络受限，适配器未在本会话真实运行]** → 测试只用标注的 fixture；报告里把真实只读验收列为待办，不用 fixture 冒充。
- **[ATI 摘要资源 ID 未核实]** → 不硬编码猜测值；未配置即 `SKIPPED` 并给出官方检索页人工链接。
- **[迁移闸使合并后生产构建被挡]** → 有意为之：按 Owner Gate 先 safe-migrate 再合并；暗合并闸保证 staging / preview 未迁移时不 500。
- **[每小时 cron 使开跑时间落在 08:25]** → UI 如实写明；任务书允许「08:00 附近」。
- **[表格表头千差万别]** → 映射不到的列保留原文、口径记 UNKNOWN 待复核；不猜。

## Migration Plan

1. Evan 拍板硬纪律 1 例外（或否决 → 改为零 schema 方案，代价见 D1）。
2. 隔离库预演：`DATABASE_ENVIRONMENT=isolated` 对 clone / 分支库执行 `npm run db:migrate:deploy`，核对 `prisma migrate status` 与迁移 sha256（`scripts/verify-migration-history.ts`）。
3. 生产：按 `docs/PHASE5_PRODUCTION_MIGRATION_RUNBOOK.md` 备份 → precheck → `scripts/safe-migrate-deploy.ts` → 验表 → 置 `PROCUREMENT_RECORDS_SCHEMA_READY=1` → 烟测（`GET /api/procurement/watch` 返回 `available:true`）。
4. 种子：`npx tsx scripts/procurement-records-seed.ts --org <orgId>`（dry-run 默认）→ `--write`。
5. 启用：org_admin 在「采购监控」页保存并启用；首轮结果出现「最近一次实际成功运行」后才算上线。
- 回滚：停用监控即停后续扫描（已有运行收尾为 CANCELLED），数据保留；关 `PROCUREMENT_RECORDS_SCHEMA_READY` 即全部入口回到未启用；迁移只新增表，回滚 = 保留空表或按 runbook 前向修复，不 drop。

## 验证方式

- `npx tsx src/lib/procurement-records/__tests__/procurement-pure.test.ts`：编号 / 机构规范化、去重键、多伦多 DST 排程、CSV / CKAN / ATI 解析与 PARSE_FAILED、优先级。
- `npx tsx src/lib/procurement-records/__tests__/records-request-pure.test.ts`：模板、READY 闸、重复检查（含 10-31 / 11-05）、状态转换、回执比对、期限、旧状态映射。
- `npx tsx src/lib/procurement-records/__tests__/disclosure-analysis-pure.test.ts`：表格抽取、PDF 行抽取、口径分列、修订 / 贷项 / 去重、SO 值 0、恶意文字不生效。
- `NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… npx tsx src/lib/procurement-records/__tests__/procurement-records-db.isolated.test.ts`：真实路由 + 注入 fetch 的端到端（任务书第十五节 1–18）。
- `npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npx tsx scripts/verify-migration-history.ts`、`npx -y @fission-ai/openspec@1.15.0 validate procurement-records-requests --strict`。

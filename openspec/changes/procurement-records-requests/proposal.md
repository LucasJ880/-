# Proposal — procurement-records-requests（PROC-1：Tender 采购情报与政府资料申请）

TASKFLOW：**PROC-1**（Phase R — 采购情报与资料申请；任务书副本 `docs/QINGYAN_PROC-1_RECORDS_TASKBRIEF.md`，交接 `docs/QINGYAN_PROC-1_HANDOFF.md`）。

## Why

Sunny 在下一次投标前要持续发现值得跟的政府采购，并查清前序合同的实际订单、单价和支出；现在只能人工翻 CanadaBuys，资料不足时手写 ATI 申请，回执、来信、披露文件和分析散落在邮箱与个人文件里，无法查重，也无法追溯金额来源。

## What Changes

- 新增组织级「采购监控」：可编辑关键词 / 排除词 / 机构 / 地区 / 时间范围 / 上限，新建默认未启用；授权用户「保存并启用」后，挂在既有 `tender-watch` 定时任务里按多伦多本地时间（缺省周一、周四 08:00，夏令时正确）扫描；也可「立即扫描」（后台执行，前端轮询进度）。
- 新增四个官方来源路径并逐项显示能力与每轮实际结果（SUCCESS / PARTIAL / UNAVAILABLE / PARSE_FAILED / SKIPPED）：CanadaBuys 招标公告开放数据（发现新候选）、Open Government 合同披露（关键词发现 + 已知合同 / call-up 刷新）、Completed ATI 摘要（既有披露检索）、CanadaBuys 合同历史公开页（变更检测）；省市门户只支持人工链接导入。
- 新增采购工具身份模型：按「组织 + 司法辖区 + 规范采购机构 + 采购工具类别 + 规范正式编号」去重；同标题不同编号不合并，不同来源同一合同合并证据，修订进历史而不新增；call-up 挂到父 SO；Tender 与多个历史合同 / SO 关联，「前序」关系不当作编号别名；三方机构（contracting / buying / records holder）分别保存；到期、剩余 options、确认重招日期未知即 null。
- 新增可解释优先级（业务匹配、重复采购迹象、准备时间、资料缺口、资料持有机关清晰度），不输出中标概率；每轮最多展示 5 个新候选、最多新生成 3 张申请卡，超出显示截断与待续。
- 新增申请卡：资料取得路径（公开资料 / 索取既有披露副本 / 新正式申请）按序检查；联邦 ATI 英文正文按模板由已核实数据填充、中文说明同步生成；正文版本化（版本号 + text hash），已提交正文不可覆盖；申请人资料独立维护、确认后才可用，模型或系统不补造姓名地址。
- 新增机关规则（RuleProfile）：法律、官方入口、渠道、费用（分）、币种、其他费用规则、时限、适用日期、来源、核实人与时间；种子为未核实状态，须真实用户核对后才用于 READY；未知费用为 null 不为 0。
- 新增确定性重复检查（申请主体 + 辖区 + 资料持有机关 + 相交编号 + 相交记录类别 + 相交日期），展示「已有覆盖」与「新增部分」；渠道 / 标题 / 英文改写不能绕过；台账未核实即 UNVERIFIED；首次使用须导入历史申请或由真实用户确认无历史。
- 新增 READY 闸与自助交接：复制正文、字段对应、打开核实入口都不改变提交状态；用户回填提交时间、渠道、实际费用、submission reference、所用正文版本与回执；区分 USER_REPORTED_SUBMISSION、SUBMITTED（回执经核对，document_verified）与 SUBMISSION_UNKNOWN（阻止同范围再次交接与跨渠道重复）。
- 新增案件时间线（只追加，更正留审计）、三条独立状态（申请 / 文件 / 分析）与政府处理结果；来信人工登记；正式期限、系统估算、内部提醒分开保存；站内待办按事件幂等生成。
- 新增披露文件上传（私有存储、哈希去重、页数 / 工作表范围、解析状态）；CSV / XLSX 按表头映射抽取、可读 PDF 按文本行抽取，均可复核并追溯页码或表格行；扫描件 / 加密 / 损坏显示阻塞并允许人工录入；分析按金额口径与币种分列，不跨口径相加，标明「已取得记录的合计」。
- 新增导出：申请卡（Markdown）与明细 / 分析（CSV）。
- 新增种子：三条联邦研究种子合同与联邦 ATI 规则（未核实）；可选导入 A-2026-00183 历史案件为「带来源说明的待核实历史记录」（无附件、无回执、证据等级 user_reported）。

## Capabilities

### New Capabilities
- `procurement/watch-scan`：采购监控配置与启停、定时 / 立即扫描、官方来源适配与覆盖、候选与采购工具去重、优先级、扫描通知。
- `procurement/records-request`：申请卡、申请人资料、机关规则、版本、重复检查、READY、自助交接、回执核对、案件事件、状态与期限、站内待办、组织隔离。
- `procurement/disclosure-analysis`：回执 / 来信 / 披露文件附件、解析与阻塞、明细抽取与复核、按口径分析、导出。

### Modified Capabilities
- 无（Tender 详情「情报」Tab 只追加一张只读卡片，现有卡片与行为不变）。

受影响的 Muse 意图：无（不触碰 `muse-bridge`）。

## Impact

- 新增：`src/lib/procurement-records/**`、`src/app/api/procurement/**`、`src/components/procurement-records/**`、`src/app/(main)/projects/intelligence/records/**`、`scripts/procurement-records-seed.ts`、`prisma/migrations/20261105120000_add_procurement_records_foundation/`。
- 修改：`prisma/schema.prisma`（只追加新 model）、`src/app/(main)/projects/intelligence/monitor/page.tsx`（占位页 → 采购监控）、`src/components/bid-workflow/intel-hub-shell.tsx`（加「资料申请」链接）、`src/lib/navigation/registry.ts`（matchPaths）、`src/app/api/cron/tender-watch/route.ts`（追加受跟踪步骤）、`src/lib/automation/registry.ts`（登记 `procurement-watch`）、Tender 详情情报 Tab 追加卡片、迁移三处登记、`scripts/test-all.sh` / `scripts/test-ci-unit.sh`。
- 新增 env：`PROCUREMENT_RECORDS_SCHEMA_READY`（默认关，关时新表零访问）、可选来源地址覆盖（见 design D4）。
- 硬纪律：触碰第 1 条（零 schema）与第 3 条（扫描运行行的认领租约）——两条均已获 PROC-1 限定例外（决定 C，Lucas 2026-11-05 批准，已写入 `openspec/config.yaml`）；其余六条遵守（见 design）。

## Out of scope

- 不做政府账号自动登录、浏览器自动填表、自动付款、无人值守代交、自动向政府发邮件；不保存政府密码、验证码、会话令牌或银行卡数据。
- 不做邮箱自动收信（V1 来信由用户上传 / 粘贴；UI 显示「尚未启用自动收信」）；不读取全邮箱。
- 不做全国省市门户适配与省市法规引擎；省市项目只支持人工导入、记录机关与人工核实结果，不显示「已支持自动申请」。
- 不做 OCR；不新增 LLM 调用（模型辅助抽取 / 草拟须另行拍板）。
- 不做自动供应商询价、自动投标、自动报价；询价准备摘要只作内部参考。
- 不做 Google Sheets / Drive 导出；青砚数据库是唯一正式申请台账。
- 不执行生产迁移、不在生产启用调度、不改 Personal Muse / MVP-002 / MVP-003 任何仓库、凭证或工具白名单。
- 不做自动上诉、自动重新申请、自动关闭已提交案件。

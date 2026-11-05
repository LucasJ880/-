# PROC-1 报告：Tender 采购情报与政府资料申请（V1）

| 项 | 值 |
|---|---|
| 日期 | 2026-11-05 |
| 任务书 | `docs/QINGYAN_PROC-1_RECORDS_TASKBRIEF.md`（v1.0） |
| OpenSpec change | `openspec/changes/procurement-records-requests/`（`validate --strict` 通过；tasks 1–7 完成，8 见本报告） |
| 分支 | `claude/tender-dijkstra-1i94ag`（未开 PR、未合并） |
| 硬纪律 | **触碰第 1 条零 schema（只新增 16 张表）——须 Evan 拍板例外，未拍板不得合并**；**第 3 条部分触碰**：扫描运行行带认领令牌 + 心跳，且 3 个新表名命中 R1 冻结模式，已手工加入 runtime-architecture baseline 待架构审查；其余六条遵守（design「与八条硬纪律的关系」） |

> 证据分级（本报告全文适用）：
> - **fixture**：构造的 CSV / CKAN 行、回执、来信、披露文件，只用于测试与演示；
> - **真实只读结果**：本会话**没有**——网络策略拒绝 `open.canada.ca`、`canadabuys.canada.ca`、`search.open.canada.ca`（代理 403）；
> - **用户真实提交证据**：**没有**——本次开发未提交任何政府申请。业务验收见 §8。

## 1. 已完成 / 未完成（对应任务书）

| 任务书条目 | 状态 | 说明 |
|---|---|---|
| 二、勘察与复用清单 | 完成 | 表格见 `docs/QINGYAN_PROC-1_HANDOFF.md` §5 |
| 三A 可配置监控（关键词 / 排除词 / 机构 / 地区 / 时间 / 上限）、立即扫描、保存并启用 | 完成 | `/projects/intelligence/monitor`；新建默认未启用；只 org_admin 可启停 |
| 三A 至少一个能发现新候选的真实官方来源适配器 | 代码完成，**未真实运行** | CanadaBuys 招标公告开放数据 CSV、Open Government 合同披露（CKAN）关键词发现；本会话网络被拒 |
| 三A 已知合同刷新与既有披露检索 | 代码完成，未真实运行 | CKAN 按 `procurement_id` / `standing_offer_number` 刷新 SO 与 call-up；合同历史页哈希变更检测；Completed ATI 摘要检索（资源 ID 未核实 → 未配置时 SKIPPED） |
| 三A 来源能力与实际结果逐项显示 | 完成 | SUCCESS / PARTIAL / UNAVAILABLE / PARSE_FAILED / SKIPPED；成功零结果与无法获取分开 |
| 三B 历史合同关联、证据归档、缺口判断、三种取得路径 | 完成 | 采购工具 + 证据 + 关系；`pathType`；路径按序检查进入 READY 闸 |
| 三B 英文正文 + 中文说明 + 机关 / 日期 / 费用 / 字段指引 | 完成 | 联邦模板逐字；缺数据保留方括号；省市不套联邦模板 |
| 三B 申请人资料、版本、重复检查、就绪检查 | 完成 | 见 §7 |
| 三C 复制正文 / 打开入口 / 字段映射 / 回填 / 回执 / 编号 / 时间线 / 待办 | 完成 | 门户字段名只显示实际观察到的；待办复用 `Task` |
| 三D 上传 PDF / CSV / XLSX、可复核解析、来源位置、扫描件阻塞与人工录入 | 完成 | 无 OCR：`NEEDS_OCR` + 人工录入 |
| 三D 历史需求 / 订单 / 金额口径 / 缺口 / 建议 | 完成 | 按口径分列；「已取得记录的合计」 |
| 四 多伦多排程（DST）、上限、截断待续、租约 / 重启 / 幂等、通知去重 | 完成 | 挂在既有 `tender-watch` cron；见 design D2 / D3 |
| 五 采购工具身份、三方机构、到期 / options / 重招未知为 null、可解释排序 | 完成 | 不输出中标概率 |
| 六 RuleProfile、未知费用 null、官方 / 估算 / 内部期限分开 | 完成 | 种子未核实；联邦 CAD 5 / 30 日历日来自任务书 S1 / S2，待用户核对官方页面 |
| 七 申请卡字段、正文模板、申请人不补造 | 完成 | |
| 八 自助交接闭环与 READY 条件、提交不确定 | 完成 | 不保存政府凭证；路由拒收凭证类字段 |
| 九 三条状态 + 政府结果 + 只追加事件 + 证据等级 + 旧状态映射 | 完成 | `runtime_verified` 保留给未来适配器，V1 不产生 |
| 十 数据 / 重复检查 / 权限 | 完成 | 事务 + advisory lock；UNVERIFIED 语义 |
| 十一 来信 / 附件 / 分析 | 完成 | 邮箱自动收信未启用（UI 明示） |
| 十二 UI 与内部能力接口 | 完成 | 见 §4 截图 |
| 十三 种子与历史样本 | 完成 | 三条种子幂等；A-2026-00183 只作「待核实历史记录」（user_reported、无附件 / 回执、不预填申请人） |
| 十五 验收场景 1–18 | 开发验证通过（fixture） | `procurement-records-db.isolated.test.ts` 142 项；纯测试 217 项 |
| 十五 上线业务验收 | **待业务验收** | 未发生真实生产扫描与真实提交；不能用 fixture 代替 |
| 模型辅助抽取 / 草拟 | 未做（有意） | 硬纪律 7；V1 全确定性，AI 调用 0；如需引入须单独拍板 |
| 邮箱读取、OCR、自动登录 / 付款 / 代交、省市门户适配 | 未做（Out of scope） | 任务书第三节列为非 V1 |

## 2. 改动文件与迁移

- **迁移**：`prisma/migrations/20261105120000_add_procurement_records_foundation/migration.sql`——只 `CREATE TABLE` / `CREATE INDEX` / 新表之间的外键，16 张表（`Procurement*` 7 张、`Records*` 8 张、`ProcurementLineItem` 1 张；清单与幂等锚点见 design D1）。sha256 `4e2df98d…f6857`，已登记 `expected-migrations.ts`、`verify-migration-history.ts`、`check-release-safety.test.ts`。
- **schema.prisma**：只在文件末尾追加新 model，既有 model 0 改动；对 Organization / Project / User / Task 只用逻辑引用（字符串 id）。
- **新增代码**：`src/lib/procurement-records/**`（28 个模块 + 5 个测试 / fixture 文件）、`src/app/api/procurement/**`（27 个路由文件）、`src/app/api/projects/[id]/procurement-records`、`src/components/procurement-records/**`、`src/app/(main)/projects/intelligence/records/**`、`scripts/procurement-records-{seed,demo}.ts`。
- **修改既有文件**（均为追加）：`tender-watch` cron（追加第二个受跟踪步骤，maxDuration 120→300）、`automation/registry.ts`、`cockpit/posts.ts` + `schedule.ts`（新 automation key 的穷举登记）、`navigation/registry.ts`（只加 matchPaths，侧栏快照不变）、`intel-hub-shell.tsx`（加「资料申请」链接）、`intel-tab.tsx`（加卡片）、`/projects/intelligence/monitor/page.tsx`（占位页 → 采购监控）、`scripts/test-all.sh` / `test-ci-unit.sh`。
- **复用**：`runTrackedAutomation`、`requireCronSecret`、`resolveRequestOrgIdForUser`、`requireProjectReadAccess`、`getOrgMembership` / `hasOrgRole`、`createNotification`（sourceKey 幂等）、`Task`（sourceId + templateKey 唯一）、`putPrivateBlob` / `readBlobStream`、`normalizeFilename`、unpdf / xlsx、`computeWatchDigest`、外部情报总闸、`logAudit`、`assertSafeTestDatabase`、T4 的 schema-ready 暗合并模式。

## 3. 测试结果（实际运行）

| 检查 | 结果 |
|---|---|
| `procurement-pure.test.ts`（身份 / DST 排程 / 来源解析 / 优先级） | 81 passed, 0 failed |
| `records-request-pure.test.ts`（模板 / 重复检查 / READY / 状态 / 期限 / 回执 / 旧状态映射） | 86 passed, 0 failed |
| `disclosure-analysis-pure.test.ts`（表格与 PDF 抽取 / 按口径分析 / CSV 导出） | 50 passed, 0 failed |
| `procurement-records-db.isolated.test.ts`（本地 PostgreSQL 16 + pgvector 隔离库，真实路由 + 注入假 fetch） | 142 passed, 0 failed（多次重复运行，自带清理） |
| 迁移预演：隔离库 `prisma migrate deploy`（既有 42 条 + 本迁移） | 成功；库 vs schema 对本 change 零残差 |
| `verify-migration-history.ts` / `check-release-safety.test.ts` / `release/drift.test.ts` | 93 / 27 / 27 passed |
| cockpit 测试（posts / schedule / posts-read-model / workload） | 225 / 196 / 139 / 94 passed |
| navigation 测试（position-nav / nav-active-matcher / navigation-ia / workspace / wechat-entry-nav） | 全部通过（position-nav 86/86） |
| `npm run typecheck` | 见 §3.1 |
| `npm run lint:baseline` | 见 §3.1 |
| `npm test` 全量 | 见 §3.1 |
| `openspec validate procurement-records-requests --strict` | valid |

### 3.1 全量（待填）

（运行中，完成后补）

**未运行 / 无法运行**：真实官方来源只读运行（网络策略拒绝）；生产 / staging 迁移（Owner Gate）；Vercel 预览构建（无凭证）。

## 4. 截图与可复现开发闭环

截图（隔离库 + 本地 `next dev`，**全部 fixture**）：`docs/acceptance/proc-1/`

| 文件 | 内容 |
|---|---|
| 01-monitor-status | 配置已启用 / 最近实际成功 / 最近运行 / 下一次运行（多伦多）、AI 调用 0 |
| 02-monitor-sources | 来源能力与最近结果（含截断说明、省市仅人工导入、自动收信未启用） |
| 03-candidates | 候选与已关注：三方机构、到期 / options / 重招「未知」、五维优先级理由、证据来源计数 |
| 04-ledger / 05-rules | 申请台账；机关规则（未核实 / 已核实、费用未知 ≠ 0、省级不支持自助） |
| 06–11 | 申请详情：中文说明、英文正文与版本、自助交接（期限三分）、时间线、明细复核、按口径分析 |
| 12-overlap-blocking | 改措辞 + 改渠道的同范围草稿 → BLOCKING，新增 2026-11-01 至 11-05（5 天） |
| 13-tender-intel-card | Tender 详情「情报」Tab 卡片 |
| 14-mobile-handoff | 手机宽度（iPhone 13） |

复现命令（仅隔离库）：

```bash
DATABASE_URL=postgresql://qy:qy@localhost:5544/qy_isolated DIRECT_URL=postgresql://qy:qy@localhost:5544/qy_isolated NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=<任意≥32字符> npx tsx scripts/procurement-records-demo.ts
```

输出演示组织 / 申请 id 与本地会话 cookie；随后用同样的 env 加 `PROCUREMENT_RECORDS_SCHEMA_READY=1 PRODUCT_CONTENT_LOCAL_STORE=1` 启动 `npx next dev` 浏览。闭环：fixture 扫描 → 候选 + 自动申请卡 → 申请人确认 / 规则核实（演示文字明示非真实核实）/ 台账确认 → READY → 交接（复制 / 打开入口不改变状态）→ 用户报告提交 → 回执核对（document_verified）→ 受理（案件编号单独保存，估算期限 2026-12-06）→「内附 105 页」回复信（NOTICE_RECEIVED）→ 披露 CSV → 复核 → 分析（ordered 9,750.00 CAD，2 条已确认 / 1 条待复核，缺口列明 0/105 页）。

## 5. 来源、覆盖、失败处理与上限

| 来源 | 端点（缺省，可 env 覆盖） | 能力 | 本会话 |
|---|---|---|---|
| CanadaBuys 招标公告 | `canadabuys.canada.ca/opendata/pub/{newTenderNotice-nouvelAvisAppelOffres,openTenderNotice-ouvertAvisAppelOffres}.csv`（`PROCUREMENT_CANADABUYS_NOTICE_URLS`） | 发现新候选 | 网络拒绝；列名按官方双语字典前缀匹配，**未在线复核** |
| Open Government 合同披露 | CKAN `datastore_search`，资源 `fac950c0-00d5-4ec1-a4d3-9cbebf98a305`（`EXTERNAL_INTEL_CONTRACTS_RESOURCE_ID`） | 关键词发现、已知合同 / call-up 刷新 | 网络拒绝；字段为仓库 2026-08-20 实证 + `procurement_id` / `standing_offer_number` / `instrument_type`（未在线复核） |
| Completed ATI 摘要 | CKAN，资源 `PROCUREMENT_ATI_SUMMARIES_RESOURCE_ID` | 既有披露检索 | 资源 ID 未核实，**未配置 → SKIPPED** 并给出 search.open.canada.ca/ati 人工链接 |
| CanadaBuys 合同历史页 | 种子 / 已关注合同的公开页 | 哈希变更检测（不解析字段） | 网络拒绝 |
| 省市门户 / MERX / Bonfire / Ariba | — | 仅人工链接导入 | — |

- **失败处理**：每来源独立超时（30 s）与状态；任一失败 → 整轮 PARTIAL（全部失败 FAILED），既有候选与字段不清空、不改 0；解析失败（列缺失 / 非 JSON / `success:false`）为 PARSE_FAILED；外部情报总闸未开 → 全部 UNAVAILABLE 且零外部请求。
- **上限（服务端夹紧）**：每轮新候选展示缺省 5（≤ 20）、自动申请卡缺省 3（≤ 10）、每来源页数缺省 5（≤ 20）、每页行数缺省 100（≤ 500）、墙钟缺省 150 s（≤ 240 s；cron 步骤预算 150 s）；CSV ≤ 60 MB；AI 调用 0。超过上限：记 `truncated` 与待续数，下轮继续；预算耗尽回到 QUEUED。
- **速率**：每轮每来源最多 `maxPagesPerSource` 次查询（CKAN 刷新另最多 2 倍）；定时缺省每周两次；手动扫描同一监控同一时间只有一个活动运行。

## 6. 配置、启停、首次台账导入、申请人确认

1. （Owner Gate 之后）`PROCUREMENT_RECORDS_SCHEMA_READY=1`；需要真实抓取再设 `TENDER_EXTERNAL_INTEL_ENABLED=1`（既有开关）；核实 ATI 摘要资源后设 `PROCUREMENT_ATI_SUMMARIES_RESOURCE_ID`。
2. 种子：`npx tsx scripts/procurement-records-seed.ts --org <orgId> --user <userId>`（dry-run）→ 加 `--write`；可选 `--with-history-case`。
3. 情报中枢 →「情报监控（采购）」→ 编辑配置 →「保存并启用监控」（org_admin）。启用只授权配置内的只读检索、分析与内部草稿，不授权发函或提交。停用：排队运行取消，运行中的在下一个来源前收尾，候选与案件保留。
4. 「资料申请」→ 机关申请规则：打开官方页面（S1 / S2 / S5）核对入口、费用、时限，填写入口与核实方法 →「保存并标为已核实」。
5. 「资料申请」→ 历史台账：导入历史申请（JSON，旧状态显式映射），或由真实用户确认「此范围没有历史申请」。未确认前重复检查为 UNVERIFIED、不能 READY。
6. 「资料申请」→ 申请人资料：填写当前资料（不要从旧回复信复制地址），核对后点「核对无误，确认」；任何修改回到未确认。

## 7. 回执 / 附件 / 金额模型与恢复

- **提交证据**：用户口述 → `USER_REPORTED_SUBMISSION`（user_reported，记录人与时间）；回执附件（RECEIPT / GOVERNMENT_LETTER）中确定性比对到提交编号与机关名 + 真实用户确认 → `SUBMITTED`（document_verified，记方法 / 人 / 时间 / 附件）；无文字层需勾选人工目视核对；付款凭证 / 截图 → 409。`submissionReference` 与 `caseNumber` 分开；提交正文三选一（与版本一致 / 实际正文新版本 / 「最终提交正文未核实」）。
- **不确定**：`SUBMISSION_UNKNOWN` 保存已知事实与待核查项，同范围任何渠道的新交接被重复检查拦截；只能以回执解除或真实用户写明依据确认未提交。
- **附件**：私有 Blob `procurement-records/<org>/<request>/<hash16>-<name>`；sha256 去重；下载走鉴权路由（attachment、no-store）；页 / 工作表单元另表保存。
- **金额**：Decimal 存储；计算全用整数分（BigInt）；按（口径, 币种）分列；修订后总额取最新；贷项为负；同口径同单号同额只计一次；币种未标注单列；单位不换算；只合计 CONFIRMED。
- **恢复**：解析失联（10 分钟）与排队附件由 cron 兜底重试（≤ 5 次）；扫描失联运行由下一轮接管并跳过已完成来源；分析每次新版本，可随时「重新分析」；事件只追加，更正另记；停用 / 关闸不删数据；迁移只新增表——回滚 = 关 `PROCUREMENT_RECORDS_SCHEMA_READY`（新表零访问）或前向修复，不 drop。

## 8. 部署 / 迁移 / 调度真实状态

| 项 | 状态 | 证据 |
|---|---|---|
| 代码 | 已推送分支 `claude/tender-dijkstra-1i94ag`；**未开 PR、未合并** | git log |
| 生产 / staging 迁移 | **未执行** | 只在本地隔离库预演 |
| `PROCUREMENT_RECORDS_SCHEMA_READY` | 各环境**未设置** | — |
| 定时扫描 | **未启用**（生产无表；新建监控默认未启用） | — |
| 真实官方来源只读运行 | **未发生**（网络策略拒绝） | 代理 403 记录 |
| 真实自助提交 | **未发生**（待业务验收） | — |

注意：迁移已登记进 `EXPECTED_ACTIVE_MIGRATIONS`。合并到 main 后，生产构建会被 `predeploy-migration-gate` 拦住，直到按 runbook 执行受控迁移——这是有意的（先 safe-migrate，再合并 / 部署）。

## 9. 需要你提供的资料或决定

1. **Evan**：是否批准硬纪律 1 的例外（新增 16 张表）。若否决，需改为零 schema 方案（代价见 design D1），本分支不能合并。
   同时审查 R1 baseline 新增的 `ProcurementScanRun`、`RecordsRequestEvent`、`RecordsLedgerAttestation`（第 3 条：扫描运行行的认领令牌 + 心跳是租约语义）。否决时的替代方案见 design「与八条硬纪律的关系」第 3 行。
2. 生产迁移的 Owner Gate 时间窗（备份 → precheck → `safe-migrate-deploy` → 验表 → 置位 → 烟测）。
3. 放行本会话或生产环境对 `open.canada.ca`、`canadabuys.canada.ca`、`search.open.canada.ca` 的出站访问，用于首次真实只读运行，并核对 CanadaBuys CSV 列名与 Completed ATI 摘要资源 ID（`PROCUREMENT_ATI_SUMMARIES_RESOURCE_ID`）。
4. 当前申请人资料（公司法定名称、代表人、地址、邮箱）：请在界面填写并确认；系统不会从历史回复信带出。
5. 首次台账：A-2026-00183 之外是否还有历史 ATI / 省市申请？有则按 JSON 导入，没有则由你在界面确认「该范围无历史申请」。
6. 三条种子合同的资料持有机关（PSPC 还是 CSC / CORCAN / DND）按所需记录核实后填写。
7. 是否需要我开 Draft PR（仓库惯例为一个 change 一个 PR）。

## 10. 业务验收（待做，不能用 fixture 代替）

- 生产迁移完成并置位后，授权用户「保存并启用监控」，至少一次生产定时扫描 SUCCESS / PARTIAL，来源结果可见；
- 用户在官方门户完成一次真实自助提交，上传真实回执，状态为 SUBMITTED（document_verified）。

# Qingyan Quote & Cost Engine — Phase 2 实施报告（Quote Operations / Real-World Workflow）

日期：2026-08-21 · 分支 `feature/quote-engine-phase2` · base = main `837558396b73589d26a8f213f7422a9503ea340e`（= PR #151 merge commit）· **Production DB changed = NO** · **Production flag changed = NO**

## 0. Phase 1 Merge Gate（live 核验）

| 项 | 状态 |
|---|---|
| PR #151 | **MERGED @ 83755839**（2026-08-21T22:13:28Z，SHA 锁 `3e92a0f5`） |
| main CI | GREEN @ 83755839；生产 `deployedCommit = 8375583`，health ok |
| Phase 1 migration | `20260821150000_add_quote_cost_engine_phase1` 已按 runbook 落生产（Lucas 执行）；`migrate status` = up to date；快照 `prod-pre-quote-engine-migration-20260821` 保留 |
| 生产迁移历史 vs repo | 一致（22 active） |
| `TENDER_QUOTE_ENGINE_ENABLED` | 生产 **OFF**（未设置） |
| Phase 1 P0/P1 blocker | 无 |
| Phase 2 分支 | 从 verified main@83755839 新建（独立 worktree），未在 Phase 1 分支上堆代码 |

## A. Repository Audit（先读后写；四路并行审计）

| 领域 | 现有实现 | 结论 |
|---|---|---|
| 文档存储 | `ProjectDocument` + `ProjectDocumentPage`（可引用单元 page/sheet/block）+ `putPrivateBlob`（`projects/{projectId}/…` 代理可读）+ `validateUploadedFileAsync`（magic bytes） | **复用**；导入文档 `source=quote_import`，单元解析复用 `parseDocumentPagesAndStore` |
| 解析器 | `xlsx`（sheet→csv 单元、`trade/importer` 双语表头映射先例）、`unpdf`（PDF 页文本）、无 OCR | **复用** `xlsx` / `extractPdfPagesFromBuffer`；扫描件 → 明示 OCR 不支持 |
| PDF | `renderHtmlToPdf`（puppeteer-core + @sparticuz/chromium + Noto Sans SC 内联）；`ProjectGeneratedDocument` 版本化持久化 + 镜像 `ProjectDocument`；`outputFileTracingIncludes` 按路由 key | **复用** Chromium 链；新路由登记 tracing（字体 + logo）；jsPDF 旧链不碰 |
| 人工审核 | Quote Engine 自有状态机（draft/review/approved…）；PendingAction 为 AI 动作审批 | **不建第二套审批**：导入用自己的 Review→Confirm→Apply 状态（QuoteCostImport.status），成本行仍受报价冻结纪律 |
| 财务 | `getBudgetVsActual`（按 `ProjectCost.refs.budgetLineId` 滚动）、`ProjectBudgetVersion`（DRAFT/ACTIVE/SUPERSEDED/AWARD_BASELINE）、`ProjectRevenueEntry`（CONTRACT_AWARD/CHANGE_ORDER/ADJUSTMENT）、`getTenderFinancialSummary`；**无**进度/完工百分比、**无** Change Order 表 | **复用**并组合成只读模型；Forecast 人工值存 ACTIVE 版本 `metadata`（零 schema）；投影法无进度信号 → 明确不可用 |
| Tender 我方报价 | `Project.ourBidPrice` 被 6+ 读模型消费，写入只在手填表单；**无** canonical/selected 报价标志；`BidIntelligenceRoom.pricingInputs.ourPriceCad` 被投标草稿读取但从未写入 | **新增最小机制** `Project.bidQuoteId`（逻辑引用），权威 = approved/awarded 引擎报价，写穿 `ourBidPrice` + room.pricingInputs |
| 客户/联系人 | 无 tender 域 Customer/Contact 模型（SalesCustomer 为窗饰 CRM，禁止复用）；买方 = `Project.clientOrganization` 自由文本；我方身份 = `settingsJson.tenderProfile`（无结构化地址/电话/税号） | **不建 CRM**：抬头/条款以快照 JSON 存报价；我方身份扩展 `tenderProfile.quoteHeader/quoteTerms`（零 schema） |
| 权限 / 审计 | `requireQuoteAccess`（read / internal_cost / edit / approve → project:cost:read/write/review）、`requireCostAccess`、`logAudit` snake_case | **复用**；新增 action 见 §I |

## B. Architecture（Reuse / Extend / New）

- **Reuse**：ProjectDocument/Page、putPrivateBlob、upload-guard、xlsx/unpdf、parseDocumentPagesAndStore、renderHtmlToPdf、ProjectGeneratedDocument、QuoteLineItem、ProjectQuote 状态机/冻结、awardQuoteToBudget、createBudgetVersion/activate/freeze、getBudgetVsActual、getProjectRevenueRollup、appendProjectEvent、AuditLog、RBAC、tenderProfile 存储、flag `TENDER_QUOTE_ENGINE_ENABLED`（**无新 flag**）。
- **Extend**：`ProjectQuote` + `customerJson/termsJson`；`QuoteLineItem` + `section/optional/allowance/taxable/sourceJson`；`Project` + `bidQuoteId`；`tenderProfileSchema` + `quoteHeader/quoteTerms`；`customer-view` 扩展（分组/Optional/Allowance/Taxable/抬头/条款/公司，泄露模式新增 confidence/import/evidence/vendor）；`service.ts` 在 transition/revise 后同步我方报价指针；tender-profile API 接受嵌套对象；`next.config.ts` tracing。
- **New**：表 `QuoteCostImport`；模块 `quote-engine/import/*`（contract / classify / classify-ai / parse-xlsx / parse-pdf / import-service）、`customer-quote.ts`、`quotation-identity.ts`、`quotation-html.ts`、`quotation-pdf.ts`、`tender-bid.ts`、`analyze-operations.ts`；`project-finance/performance.ts`、`forecast-service.ts`；6 条 quote-engine 路由 + 2 条 finance 路由；5 个 UI 组件；迁移 `20260821233000_add_quote_operations_phase2`。

## C. Part A — Cost Import

- 链路：Upload（multipart，magic bytes）→ ProjectDocument + QuoteCostImport(EXTRACTING) → 确定性抽取 → 可引用单元 → (可选) AI 低置信度分类 → **REVIEW_REQUIRED** → 人工 Review（类别 / 勾选 / 币种 / 描述 / 数量 / 单价）→ Confirm（行级校验：币种 / 类别 / 金额 / 数量；任一不合格整体拒绝）→ Apply（追加 QuoteCostLine，`source=import:{id}`，`metadata` 带 importId / sourceDocumentId / sheet / 行 / 单元 / 页码 / 原始描述 / 原始金额 / 置信度）。
- XLSX：不假设列位置——表头同义词（中英、优先级排序：Description 胜 Item）+ 币种（列 / 表头 `(CAD)` / 表级 / 报价默认）+ 数量×单价 互补核对 + 合计/税行跳过 + 无表头回退「描述 + 行内最后一个数字」+ 供应商/日期猜测；Excel 行号真实（blankrows 保留）。
- PDF：页文本 → 「描述 + 尾部金额」行；`qty × unit = amount` 核对；置信度封顶 0.7/0.55 → LOW_CONFIDENCE 提示；页码 + 原始金额文本 + 规范化金额保留；扫描件无文本 → notes 明示 OCR 不支持。
- 重复：同 quote + 同 sha256 且未取消/失败 → `SOURCE_ALREADY_IMPORTED`（409）；显式 `reimport=true` → 新记录标 `reimportOf`。
- 冻结：approved/superseded/awarded/cancelled 报价不可导入（`QUOTE_FROZEN`）。外币行 `fxRate` 留空 → 引擎 `FX_REQUIRED`（与 Phase 1 B1 一致，不默认 1:1）。
- 供应商来源沉淀：导入记录永久保留（supplierName / quoteDate / 文件 / 行），成本行 metadata 可查询「某 SKU 某供应商某月单价」。

## D. Part B — Customer Quote Builder + PDF

- 客户行 = `QuoteLineItem(isInternal=false)`，分组 / Optional（列示不计入）/ Allowance（计入并标注）/ Taxable（税基 = 非 optional 且 taxable 小计，B5 纪律保持）。
- 草稿生成（确定性）：可见分组（Supply / Installation / Engineering）按成本占比摊入间接成本与毛利，合计精确 = 售价；Commission / Profit / PM / Bond… **永不单列**；Delivery「Included」；Standing Offer → 分级单价行。草稿仅建议，必须人工「采用」后 PUT 保存。
- 抬头：客户 / 联系人 / 项目名 / 项目号 / 招标号（criticalFacts.tender_number → solicitationNumber）/ Prepared by / 日期 / 有效期；默认值来自项目 + 组织；条款自由文本 + 组织模板（`tenderProfile.quoteTerms`）。
- PDF：`CustomerQuoteView` → `assertCustomerViewSafe`（键名模式 + 结构白名单；命中 → `CUSTOMER_PDF_INTERNAL_LEAK` 500，拒绝生成）→ 英文 Sunny 品牌模板（logo 内联、Quote No. / Revision / Date / Valid until / Customer / Project / Scope & Pricing / Optional / Subtotal / Tax / Total / Terms / Exclusions / Prepared by）→ Chromium（失败 `PDF_RENDER_FAILED`，**不回落 HTML**）→ `ProjectGeneratedDocument(customer_quotation)` + 镜像 ProjectDocument；metaJson 绑定 quoteId / quoteVersion / total / generatedAt / generatedBy；同 quoteId 旧 PDF 标 stale，**修订版本各自保留**。
- 我方身份：`tenderProfile.quoteHeader`（公司名 / 地址 / 电话 / 邮箱 / 网站 / 税号 / 默认 Prepared by），运营 → 投标档案页维护。

## E. Part C — Approved Quote → Tender Our Bid

- `Project.bidQuoteId` 显式指针；只有 approved/awarded 可选（`NOT_APPROVED` 409）；首个 approved 且无指针 → 自动选中（审计 auto）。
- Sync：被选报价 superseded → 自动跟随同谱系最新 approved/awarded；没有 → `QUOTE_REVISION_PENDING`（绝不静默保留旧数）；cancelled → NONE。
- 写穿 `Project.ourBidPrice/currency`（既有复盘/基准/价差读模型一致）+ `BidIntelligenceRoom.pricingInputs.ourPriceCad`（投标草稿消费）；提交 tab 手填「我方报价」在存在权威报价时替换为只读显示。
- 不自动提交任何门户。

## F. Part D — Budget vs Actual / Forecast

- `getProjectFinancialPerformance`：Original（AWARD_BASELINE）/ Current（ACTIVE）Budget、Actual / Committed（ProjectCost）、Remaining、Used %、按类别（Budget / Actual / Remaining / Variance / Used% / OVER_BUDGET）、Contract Value（收入台账优先，含已批 CO；无则 awarded 报价并标注来源）、原始预期利润（awarded 报价）、Forecast（人工 > 投影（仅可信进度）> 无）、Forecast Profit / Margin / Change、溯源 `sourceReference=quote:{quoteId}`、确定性告警（OVER_BUDGET / CONTINGENCY_LOW / MARGIN_EROSION / COST_AHEAD_OF_PROGRESS / NO_ACTIVE_BUDGET / UNLINKED_ACTUALS）。除零一律 null。
- 人工预测：`setManualCostForecast` → ACTIVE 版本 `metadata.costForecast`（FOR UPDATE，历史 append），ledger producers 开启时同事务 `budget.forecast_updated:{versionId}:t{seq}`，审计 `financial_forecast_updated`。
- `analyzeQuoteOperations`：纯函数 advisory（差异摘要 / 最大超支 / 缺实际成本类别 / 毛利侵蚀 / 资金风险 / 供应商集中度 / 建议）。
- Award→Budget 可操作 UI：award 后预算版本 DRAFT → 激活 → 冻结中标基线（复用 `/finance/budget`）。

## G. Part E / F — Change Order 与供应商记忆（Foundation）

- **Quote Revision（Award 前）** = ProjectQuote 谱系（version / sourceQuoteId）；**Change Order（Award 后）** = 收入侧 `ProjectRevenueEntry.entryType=CHANGE_ORDER`（已存在，人工批准）+ 成本侧新预算版本（createBudgetVersion + activate）。本轮不建 `QuoteChangeOrder`；`CHANGE_ORDER_MODEL_GAP`（成本侧 CO 影响 / 审批链）仍为已登记债。
- 供应商报价记忆：导入记录 + 成本行 metadata 永久保留（供应商 / 品名 / 日期 / 币种 / 单价 / 来源文件），未来可按 supplierName + description 查询价格历史；本轮无独立 UI。

## H. Security

- 路由：6 条新 quote-engine 路由全部 `requireQuoteAccess`（imports 列表/详情 = internal_cost；上传/Review/Confirm/Apply/客户报价编辑/PDF 生成 = edit；select-bid = approve；tender-bid/PDF 列表 = read，内部数字仅 canViewInternal）；finance = `requireCostAccess`（performance = COST_READ；forecast = COST_WRITE）。
- 租户：import / quote / PDF / performance 全部 org+project scoped；E2E 跨组织枚举 quote / import / PDF / select-bid → not found，财务 → FINANCE_TENANT_MISMATCH。
- 客户数据：Customer View 永不含导入原始数据 / 供应商名 / 置信度 / 来源文件 / 内部映射（键名模式新增 confidence|import|evidence|provenance|rawAmount|vendor）。

## I. Audit actions（snake_case，沿用）

`quote_import_created / reviewed / confirmed / applied / cancelled / failed`、`customer_quote_updated / draft_generated / pdf_generated`、`quote_selected_as_tender_bid`、`tender_bid_pointer_synced`、`financial_forecast_updated`；ProjectEvent `budget.forecast_updated`。

## J. 测试证据

| 套件 | 结果 |
|---|---|
| `quote-import.test.ts`（XLSX/CSV/PDF 抽取 · 分类 · 确认校验 · 行→成本行映射） | **41/41** |
| `quote-ops-customer.test.ts`（草稿生成 = 售价 · Optional/Allowance/Taxable 税基 · 泄露门正反例 · PDF 模板 · XSS 转义） | **25/25** |
| `quote-ops-contract.test.ts`（6 路由权限门 · 导入状态机 · PDF fail-closed · Our Bid 规则 · 财务只读 · 迁移登记 · 无 flag 碎片） | **31/31** |
| `performance.test.ts`（Budget/Actual/Remaining · 超预算 · 零预算防除零 · 人工/投影/无预测 · 毛利侵蚀 · 收入台账优先 · advisory） | **20/20** |
| Phase 1 回归：`quote-calc` / `quote-engine-contract`（QE-07 路由表扩到 13 条；QE-10e 税基守卫改 `taxableSubtotal`） | **34/34 · 28/28** |
| 迁移守卫 `verify-migration-history` / `check-release-safety` | **63/63 · 27/27** |
| swc nullish 守卫 · tsc · ESLint baseline gate（相对基线 −12 error） | PASS · 0 错 · PASS |
| **Golden DB E2E** `scripts/quote-ops-golden-e2e.ts`（隔离 Neon 分支 `e2e-qops-phase2` + 本地磁盘 Blob + 真 Chromium PDF） | **44/44**：A 链 34（导入→Review→Apply→PDF 导入→定价→客户草稿→approve→PDF→自动 Our Bid→修订 REVISION_PENDING→跟随 V2→旧 PDF 保留→award→预算→激活/基线→合成实际→Freight +20%→溯源→人工预测→advisory→审计≥11）· B 链 6（Standing Offer 3,750,000 件分级→客户行→显式选 Our Bid→draft 拒绝）· C 安全 3（跨组织 quote/import/PDF/select-bid not found · 财务租户 mismatch · awarded 不可导入） |
| `npm run build` | PASS（Compiled successfully） |
| 全量 `scripts/test-all.sh`（隔离分支，NODE_ENV=test + `QINGYAN_ALLOW_GMAIL_DRAFT_NON_PROD`） | **302/303**；唯一失败 `Autopilot A2-P0 Isolated E2E`（4 条 A2-failure/A1-overlay 断言）= **既有**：该套件在此前全量跑中因缺 NODE_ENV=test 被跳过；在干净 `origin/main@83755839` 检出、同一隔离分支、同一 env 下**完全相同地失败**（92/96），与本分支及本地 Blob store 无关 |
| GitHub CI（validate-lint-typecheck-test-build）+ Vercel – qingyan-staging | **双绿 @ 91207de9** |

隔离分支 `e2e-qops-phase2` 已删除（残留 e2e-* = 0）；迁移前快照 `prod-pre-quote-engine-migration-20260821` 保留。

## K. 非目标与边界

不自动决定报价 / 不自动提交 / 不自动发送 / 无历史中标价推荐 / 无海关定价 / 无竞对定价 / 无自动议价 / 无 PO / AI 不改 Approved Quote / 生产不自动启用。

## Gate

```
QO_STATUS                 = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
QO_PHASE1_GATE            = PR151 MERGED @83755839 · main CI GREEN · migration applied in prod · flag OFF
QO_SCHEMA_CHANGE          = ADDITIVE（+QuoteCostImport；ProjectQuote +2 JSON；QuoteLineItem +5；Project +bidQuoteId+index）
QO_MIGRATION              = 20260821233000_add_quote_operations_phase2（三处登记；隔离分支 migrate deploy PASS；guards 63/63 + 27/27）
QO_PRODUCTION_DB_CHANGED  = NO
QO_PRODUCTION_FLAG_CHANGED= NO
QO_FLAG                   = TENDER_QUOTE_ENGINE_ENABLED（复用；无新 flag）；财务面沿用 TENDER_FINANCIAL_CONTROL_ENABLED
QO_TESTS                  = import 41/41 · customer 25/25 · contract 31/31 · performance 20/20 · Phase1 34/34+28/28 · guards 63/63+27/27 · golden DB E2E 44/44 · test-all 302/303（唯一失败为 main 既有）
QO_ISOLATED_BRANCHES      = 0
```

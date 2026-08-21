# Qingyan Quote & Cost Engine — Phase 1 实施报告

日期：2026-08-21 · 分支 `feature/quote-engine-phase1` · base = main `e21cae6a` · **Production DB changed = NO**

## A. Repository Audit（现有架构，先读后写）

| 领域 | 现有实现 | 结论 |
| --- | --- | --- |
| Tender | Tender = `Project`（workDomain=tender）；无独立 Tender 模型 | 报价挂 `projectId`（即 tender link） |
| Quote | `ProjectQuote`（templateType=export_standard / version 按项目计数 / status 小写 / internalCost / profitMargin / aiDraftJson）+ `QuoteLineItem`（卖价行，costPrice/isInternal）+ `src/lib/quote/*`（calculate/rules/templates）+ 投标 tab `ProjectQuoteSection` + 编辑器；另有 `SalesQuote`（窗饰零售）/ `TradeQuote`（外贸）——业务域不同，不复用 | **扩展 ProjectQuote 为报价聚合根**，QuoteLineItem 作客户侧卖价行；不建第二套 Quote |
| Cost / Budget | `ProjectBudget / ProjectBudgetVersion / ProjectBudgetLine`（T2-P1.5，版本化 + AWARD_BASELINE；`createBudgetVersion`；类别 `BUDGET_LINE_CATEGORIES`；百分比行须带 basis）；flag `TENDER_FINANCIAL_CONTROL_ENABLED`（生产 OFF） | Award → Budget **复用 createBudgetVersion**，成本类别 → 预算类别映射；不建第二套预算 |
| Ledger | `ProjectEvent`（eventKey 幂等、seq）/ `ProjectCost`（PLANNED/COMMITTED/ACTUAL）；producers flag 生产 dark | ProjectCost 不动（未来 Actual 对比口径保留）；QUOTE_* 事件 best-effort 写 ProjectEvent（flag 开时） |
| Approval | `ApprovalRequest` 仅用于 AgentTask 步骤审批（agent 专用） | 报价审批 = RBAC 权限 + 状态机 + AuditLog；**不建第二套审批** |
| Audit | `AuditLog` + `logAudit`（action/targetType/before/after） | QUOTE_* 动作全部写 AuditLog |
| Permission | `project:cost:read / write / review`（hasProjectPermission）；privileged = super_admin/org_admin/owner；`requireProjectReadAccess` | 直接复用（不经财务 flag 门）：read / internal_cost / edit / approve 四级 |
| FX / Money | `project-finance/money.ts`（CAD 基准、MONEY_SCALE 2 / FX_RATE_SCALE 8）、`fx.ts` | 成本行 sourceCurrency + 手填 fxRate（Decimal(18,8)）；本轮不接实时汇率 |
| Migration | `prisma/migrations` + `verify-migration-history`（hash 表）+ `check-release-safety`（名单）+ `src/lib/release/expected-migrations.ts` + 生产 predeploy gate | 新迁移三处登记；生产 gate 会在 merge 后**阻断生产构建直至受控迁移执行**（见 RISKS） |

## B. Proposed Architecture

- **Reuse**：Project(Tender)、ProjectQuote、QuoteLineItem、ProjectBudget*、AuditLog、ProjectEvent、RBAC、money/fx 约定、Chromium PDF 链（未来客户报价 PDF）。
- **Extend**：`ProjectQuote` +16 可空/带默认列（orgId/quoteType/quoteNumber/name/sourceQuoteId/revisionReason/pricingMethod/pricingRate/engineJson/summaryJson/calcVersion/submittedAt/approvedBy·At/supersededAt/awardedAt/cancelledAt）；`AUDIT` 动作词表（QUOTE_*）；`PROJECT_PDF_DOC_TYPES` 未动。
- **New**：`QuoteCostLine`（统一成本行）、`QuotePricingTier`（分级）；`src/lib/quote-engine/`（contract / calc / standing-offer / templates / service / access / customer-view / analyze / flags）；7 条 API；Pricing Control Center 页面；flag `TENDER_QUOTE_ENGINE_ENABLED`（默认 OFF）。
- **入口（§17 最小、不改五 Tab IA）**：投标 tab「招投标报价」区块置顶，legacy「外贸标准报价」折叠为次级（引擎未启用时回落为原样）；工作台新增「报价与成本」卡（当前报价 / 已批准·Awarded 报价 / 版本 / Bid / 估算成本 / 毛利率 / 状态 → 一键进 Pricing Control Center）。独立「报价」tab 留待 Lucas 拍板（IA 改动）。

## 计算引擎（纯函数，零 IO，禁 eval）

- 两遍求值：① 直接成本（FIXED / PER_UNIT / PER_HOUR / PER_DAY / PER_MONTH / PER_TRIP / PER_CONTAINER，FX 折算）→ 基数 DIRECT_COST / PROCUREMENT / LANDED / CAPITAL / CATEGORY:<X>；② PERCENT_OF_COST / PERCENT_OF_CAPITAL **只引用第 ① 遍基数**（无循环）；③ **卖价 = (C + markup×C) / (1 − Σrev% − margin)**；④ PERCENT_OF_REVENUE 行 = rate × 卖价。
- Pricing Method 显式：MARKUP_ON_COST（100→120）vs MARGIN_ON_REVENUE（100→125），UI 标明口径。
- TIER_BASED 由 Standing Offer 分级承载；CUSTOM_FORMULA 只有 schema 位（Phase 1 拒绝执行）。
- 校验：Margin<0/≥100、Σrev ≥ 100、数量 ≤ 0、单价 < 0、FX ≤ 0、容量 ≤ 0、分级重叠/缺口/重复/期望出界、除零、无效基数、循环——明确报错；`assertFiniteDeep` 禁 NaN/Infinity 入库。
- 快照策略 hybrid：运行时引擎为真相；保存写 `calculatedCost` / `summaryJson+calcVersion`；读取重算比对 → `drift` 标记。

## Template A / B

- A（PROJECT_SUPPLY_INSTALL）：30 行骨架覆盖 Procurement / Logistics（中国内陆、海运、清关、关税 % 采购、加拿大内陆、包装）/ Labour（拆除、安装、打胶、修补、测量、工长、加班）/ Equipment·Site / Engineering·Compliance / Project Overhead / Commercial（融资 % 资本、管理费 % 售价、佣金 % 售价、不可预见 % 直接成本）。
- B（STANDING_OFFER）：Unit Economics Panel（供应商单件成本、件/箱、箱/柜、MOQ、年估量、运费/清关/仓储/其它 /柜、关税 %、库存持有 %）→ 到岸成本/柜·箱·件；分级（min/max/期望量/口径/%）→ 单件/箱/柜售价、收入/成本/毛利率、**数学柜数 vs 采购柜数（CEILING）分开**。

## 安全

- 租户：所有路由 `requireQuoteAccess`（requireProjectReadAccess 租户+成员+存在性 → 细粒度权限）；引擎报价强制 orgId。
- 权限：read（客户视图）/ internal_cost（project:cost:read）/ edit（project:cost:write）/ approve（project:cost:review）；批准/作废/award 需 approve。
- 客户视图：白名单投影（Item/Description/Qty/Unit/Unit Price/Amount/Optional/Allowance/Subtotal/Tax/Total）；`customerViewLeaks` 服务端自检，命中拒发（500）；isInternal 行不出现；探针反例守卫。
- 审计：QUOTE_CREATED / UPDATED / VERSION_CREATED / SUBMITTED_FOR_REVIEW / APPROVED / SUPERSEDED / AWARDED / CANCELLED / PROJECT_BUDGET_CREATED（AuditLog，沿用小写 action 约定）。

## 测试证据

- `quote-calc` **25/25**：全部计算类型；**回归 1** 51,900 → 61,785.71（≠ 60,204）；**回归 2** 1,358,350 件/柜，2.7607 → 3；**回归 3** 250 × 14.67 = 3,667.50；Markup/Margin；收入基数叠加；校验矩阵；FX；情景；分解；分级；NaN 守卫。
- `quote-engine-contract` **19/19**：状态机 / 权限映射 / 客户视图零泄露（白名单 + 反例）/ 模板 A·B / Demo B = 回归 1·2 / analyzeQuote / Award→Budget 映射全覆盖 / 结构守卫（7 路由过门、approve 级、禁 eval、生产禁 demo）。
- **真实 DB E2E 13/13 + 4/4**（隔离 Neon 快照 + `prisma migrate deploy` 本迁移，分支已删）：Demo A/B 创建与计算、三个回归算例在库态快照一致、校验错误阻止提交、draft→review→approved→冻结（QUOTE_FROZEN）、approved 不可回 draft、修订谱系 v1→v2→v3/分叉 v4 不撞号、旧版 superseded、AuditLog 全链、Award → 预算映射（财务 flag dark 时只返回映射；flag 开时复用 `createBudgetVersion` 建 5 行版本）、客户视图零泄露。
- 迁移守卫：verify-migration-history 61/61、check-release-safety 27/27（新迁移三处登记）。
- tsc 零错；eslint 零告警；CI 单测子集 / next build：见 PR gate（本地同跑）。

## 非目标与边界（按任务书）

AI 仅 advisory（`analyzeQuote` 确定性实现，接口固定，情报钩子恒 null 不伪造）；不自动提交/发送/下单；无生产迁移/回填/启用；Draft PR 不 merge。

## Gate

```
QE_STATUS               = READY_FOR_REVIEW
QE_SCHEMA_CHANGE        = ADDITIVE（ProjectQuote +16 列；+QuoteCostLine；+QuotePricingTier）
QE_MIGRATION            = 20260821150000_add_quote_cost_engine_phase1（verify-history/check-release-safety/expected-migrations 三处登记；隔离分支 deploy PASS）
QE_PRODUCTION_DB_CHANGED= NO
QE_FLAG                 = TENDER_QUOTE_ENGINE_ENABLED（default OFF，生产 dark）
QE_TESTS                = calc 25/25 + contract 19/19 + DB E2E 17/17 + migration guards 88/88
QE_ISOLATED_BRANCHES    = 0
```

## Final Review Fix Gate（2026-08-21，Lucas 审阅 B1–B6）

前置核对：PR 实际 head = `a9894240`（与审阅一致）、base = main、Draft；main 漂移 3 提交（#149）→ `git merge origin/main`（merge commit，不改写历史）解测试注册并集。

| # | 阻断 | 修复 | 证据 |
| --- | --- | --- | --- |
| B1 P0 | Standing Offer 外币汇率缺失默认 1:1 | `validateStandingOffer(so, quoteCurrency)`：外币须 fxRate 有限且 >0（SO_FX_REQUIRED / FX_INVALID）；`computeUnitEconomics` 外币缺汇率**直接抛错**；service 传报价币种 | QC-14a–f（CNY/USD 缺→FAIL、≤0/非有限→FAIL、CAD→CAD 无 FX→PASS、CNY 有效→PASS 且按汇率折算）；DB E2E B1：CNY 缺汇率 → 无单位经济、不能提交审核 |
| B2 P0 | 预算创建失败/未启用仍 awarded | `awardQuoteToBudget({ mode })`：**with_budget** = `createBudgetVersion({tx})` 与 `quote.status: approved→awarded`（updateMany 条件 status=approved）同一事务，失败整体回滚并抛 BUDGET_CREATION_FAILED；财务未启用 → 抛 AWARD_BLOCKED；两者都写 `quote_award_blocked` 审计、quote 保持 approved、不产 QUOTE_AWARDED/PROJECT_BUDGET_CREATED；**without_budget** = 独立显式路径（审计注明）。`createBudget:true` 重载语义已移除；路由与 UI 双按钮对应两路径 | DB E2E B2-1（未启用→AWARD_BLOCKED/保持 approved/阻断审计）、B2-2（注入强制失败→回滚/无预算版本/无 PROJECT_BUDGET_CREATED/无 AWARDED）、B2-3（成功→同事务 awarded+版本+两审计）、B2-4（不可重复）、B2-5（without_budget） |
| B3 P1 | 修订版本号在事务外读取 | 事务内对谱系根 `SELECT … FOR UPDATE`，锁下重算谱系与 max version 再创建（DB 串行化，不依赖应用时序） | DB E2E B3-1（同时两路修订 → v2+v3）、B3-2（三路不同父并发 → v4/v5/v6 全唯一）；QE-10c 结构守卫 |
| B4 P1 | cancelled 未冻结 | `FROZEN_STATUSES` += cancelled | DB E2E B4（取消后头/成本行/分级更新全 QUOTE_FROZEN，内容零变化）；QE-01 |
| B5 P1 | 客户视图税复用引擎售价口径税额 | `buildCustomerView({ tax })` 按客户可见应税小计（非 optional 公开行）`computeTax` 重算；路由传 `engineOf(q).tax` | QE-09：售价 1000 / 公开行 900 / HST 13% → 117 / 1017（引擎税 130 不被复用）；QE-10e 反例守卫 |
| B6 P1 | 分级用 4 位显示值算百万件 | `UnitEconomics.exact{landedPerPiece…}` 全精度；`computeTiers` 用 exact；显示值只做输出舍入 | QC-15a–c：3,750,000 件下 4 位舍入漂移 >1 CAD（证明回归有意义）；分级成本 = 数量 × exact |

修复后验证：quote-calc **34/34** · quote-engine-contract **28/28** · 隔离 DB E2E **10/10**（新分支 `migrate deploy` 后，已删）· 迁移守卫 61/61 + 27/27 · swc-nullish 守卫 PASS · tsc 零错 · eslint 零告警；full test-all / lint / build / GitHub CI / qingyan-staging 结果见最终返回。

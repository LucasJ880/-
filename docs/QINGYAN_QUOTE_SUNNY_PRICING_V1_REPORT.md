# Quote Engine · Sunny 定价链 v1 + Pricing UX Round 1（PR #162）

任务书：Lucas 2026-08-24 口述 + AskUserQuestion 三项拍板（利润=按售价倒扣 / 融资基数=直接成本+关税 / 关税基数=标记材料行）。
黄金例（冻结）：成本 100、毛利率 30% → 售价 142.86、提成 12.86、净利 30.00。

## 1. 冻结口径 → 实现映射（calc/v2，零迁移）

| 步 | 口径 | 实现 |
|---|---|---|
| ① 直接成本 | 固定金额行，不用 % | 既有 FIXED/PER_* |
| ② 关税 | 材料行合计 × 税率% | `PERCENT_OF_COST` + 基数 `PROCUREMENT`（默认）或 **`SUBCAT:<组>`**（材料行 subcategory 作组标记；多品类多税率互不串，SP-06） |
| ③ 资金使用 | (直接+关税) × 年化8%/12 × ⌈月⌉ | 新类型 `PCT_ANNUALIZED_ON_COST`（duration=月；0.2→1 月、1.01→2 月，SP-04） |
| ④ 管理费 | 自含 3%（100 → 103.09） | 新类型 `PCT_SELF_INCLUSIVE_ON_COST`：A = P÷(1−r)−P，P 含资金使用（SP-03d：3.79 非 3.67） |
| ⑤ Cash allowance | (直接+关税) × 1% | 新类型 `PCT_ON_COST_SUBTOTAL`（基数刻意不含 ③④） |
| ⑥ 售价 | C ÷ (1−m)，m=15–30% | 既有 MARGIN_ON_REVENUE（供货类模板默认此口径） |
| ⑦ 提成 | 毛利 × 30%，从毛利扣 | 新类型 `PCT_OF_GROSS_PROFIT`：④b 段求值，**不进定价分母**（SP-02/07）；引擎利润 = 净利 |

链式 ②b 固定顺序求值（资金使用 → 管理费 → CA），无自由基数 → 结构上无循环。calcVersion → `quote-engine-calc/v2`（旧快照按既有 drift 机制提示重存）。

## 2. 「填了没金额」的根治（UX Round 1）

- **语义分层**：空值 = `LINE_UNPRICED` 警告，金额按 0 参与**实时试算**；填了但非法（负数、自含≥100%、外币已填金额缺汇率）= 硬错误（FX 绝不 1:1 混过，SP-05e）。
- **fail-closed 挪到该在的地方**：`draft→review/approved` 状态门拒绝任何未定价纳入行（`QUOTE_UNPRICED_LINES`，E2E H-03）；UI 提交按钮同步禁用并计数。
- **模板开箱即绿**：Supply+Install 尾段换 Sunny 链（默认 8/3/1/30）；未定率 % 行（Duty/Bond/Warranty/Contingency）默认不纳入。新增 **SUPPLY_ONLY 模板 + 「+ Supply Only」按钮**。
- **金额时时可见**：前端直接调用与服务端相同的 `computeQuote` 纯函数逐键重算；行内「待填」提示；保存后仍以服务端快照为准。
- 类型下拉中文化；FIXED 行不再显示 基数/% 列；基数改下拉（含 SUBCAT 组 + 组名小输入）。
- 客户报价抬头/条款**只填空**自动预填（clientCompany=项目客户组织、tenderNumber=关键事实、preparedBy=档案默认；人可见、保存才落库）。

## 3. AI 建议器（只建议、人点「采用」才生效）

- 关税：材料行说明 → Tavily 查加拿大现行税率（含对华附加税）→ LLM 输出 税率/HS 猜测/置信/理由 + **出处链接**；无 TAVILY key 或检索空 → `ADVISOR_UNAVAILABLE`（拒绝凭空猜税率）。
- 毛利率：基于成本结构给 15–30 内建议 + 理由（超界 clamp）。
- 路由 `POST …/advise`（edit 权限，flag OFF → 404 dark）；**零写库**（SPU-6 结构守卫）。

## 4. 证据（head `df26f4d5`，branch base main@825d3264）

| 项 | 结果 |
|---|---|
| `quote-calc`（含 SP-01..07 黄金链） | **60/60** |
| `quote-ops-contract`（含 SPU-1..8） | **75/75** |
| `quote-import` / `quote-ops-customer` / `quote-engine-contract` / `performance` | 74 · 25 · 28 · 20（全绿） |
| 黄金 E2E（A–H，隔离分支 `e2e-sunny-pricing-v1`，已删，0 残留） | **87/87**（H 段：种子含链 → 未定价被状态门拦 → 全瀑布 DB Decimal 往返 售价 169.85 / 提成 12.74 / 净利 29.72 → approve → Supply Only 种子无人工段） |
| swc 守卫 · tsc · ESLint 基线 · build | PASS · 0 错 · PASS（error 较基线 −12）· PASS |
| 全量 `test-all`（隔离分支） | **320/321**（唯一失败 = `Autopilot A2-P0 Isolated E2E`：单跑 92✓/4✗ 与干净 main 既档签名逐字一致；本分支 autopilot 改动 = 0 文件） |
| GitHub CI + Vercel – qingyan-staging | **双绿 @ df26f4d5** |
| Schema / 迁移 / 生产 DB / 生产 flag | 零改动（`prisma/` 无 diff） |

## 5. 明确不做（任务书边界）

Standing Offer 增强（另立项）；权限放宽（维持 RBAC：编辑 = org_admin / 项目 owner / cost-write 角色）；Phase 3。观察项：Scenario 表尚未把「提成=毛利30%」纳入各情景推演（当前情景毛利 = 提成前口径），若要对齐属后续小项。

## Gate

```
SUNNY_V1_STATUS            = READY_FOR_FINAL_REVIEW（Draft PR #162，不 merge）
SUNNY_V1_GOLDEN_EXAMPLE    = PASS（142.86 / 12.86 / 30.00 与 169.85 / 12.74 / 29.72 双例锁死）
SUNNY_V1_SCHEMA_CHANGED    = NO
SUNNY_V1_MIGRATION_CREATED = NO
SUNNY_V1_PROD_DB_CHANGED   = NO
SUNNY_V1_PROD_FLAG_CHANGED = NO（quote engine 生产 flag 维持既开状态，本 PR 未动任何 env）
SUNNY_V1_ISOLATED_BRANCHES = 0
```

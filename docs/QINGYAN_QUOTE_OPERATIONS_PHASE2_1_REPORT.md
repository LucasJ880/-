# Qingyan Quote & Cost Engine — Phase 2.1 真实模版适配报告

日期：2026-08-23 · 分支 `feature/quote-engine-phase2-1` · base = main `4f7294fd9ac84f43d02c911a1d2bffdc0b3b117b` · **SCHEMA_CHANGED = NO · MIGRATION_CREATED = NO · Production DB changed = NO · Production flag changed = NO**

## 0. 背景（Real Template UAT #1）

真实 Sunny Supply+Install 工作簿（单表 `项目|价格`，无表头备注列含裸数字与 % 格式单元，无公式，末尾纯数字校验行 359,404.12）在 Phase 2 导入器下：表头「价格」未识别 → 回退「最后一个数字」→ 4/17 行错钱（244,080.96 / 0.08 / 0.14 / 0.03），抽取合计 474,138.19 vs 工作簿 359,404.30。币种门、Apply、定价、客户视图、PDF 泄露门均正确；客户 PDF 第 2 页只有页脚。

## 1. 修复（仅解析层 + Review 提示 + 页脚 CSS）

| # | 规则 | 实现 |
|---|---|---|
| P0-A | 「价格/报价/价格（含税）/报价（含税）/Price」**上下文敏感**，显式 单价/总价/金额/Unit Price 永远压过 | `detectHeader` 新增 `price` 角色（priority 1）：无数量/单价/总价 → 价格=金额（`price_as_amount`）；有显式单价 → 价格=总价；有数量但无单价/总价 → `ambiguous_price`（整表行标 AMBIGUOUS_AMOUNT_COLUMN，金额留空，价格值入备注，Confirm 被挡）；有显式总价/金额 → 价格列忽略。新增同义词 总金额/金额（…）。 |
| P0-B | 无表头回退 **fail-closed**：不再「最后一个数字」 | `readSheetGrid`（带数字格式）→ 数据行 → 排除百分比单元 → 列一致性（覆盖率 ≥60%，仅在带数值的行上统计）：单列 → 金额列；三列且 数量×单价≈总价（≥80% 行）→ qty/unit/total；否则 → `AMBIGUOUS_AMOUNT_COLUMN`（候选值入备注，Confirm 被挡）。对真实布局：B 为金额列，C 只作参考数值。 |
| P0-C | 百分比单元语义 | `cell.z` 含 `%`（或显示文本以 % 结尾）→ 不是金额；保留 `suggestedRate`（8/14/3）；算法仍 FIXED，不自动 PERCENT_OF_*；只有百分比的行 → MISSING_AMOUNT + rate 提示（不再被当分组标题跳过）。 |
| P0-D | 对账守卫 | 参考总计 = 显式 小计/Subtotal（税前优先）> 合计/Total > 末尾纯数字校验行；不导入；`reconcileTotals`：容差 max(1.00, 0.1%)；MISMATCH → notes `RECONCILIATION_MISMATCH` + 导入 metadata.reconciliation + Review 横幅（参考总计 / 抽取合计 / 差异）。抽取合计统计**全部有金额的行**（含默认排除的利润行）。PDF 的 Subtotal/Total 同样接入。 |
| P1 | 利润不是成本 | 识别为 PROFIT 的行默认 `include=false` + `PROFIT_PRICING_RULE_RECOMMENDED`；provenance 完整；Review UI 文案「该行识别为利润。利润通常应通过 Pricing / Margin 设置…」；人工可重新勾选；不自动把 14% 转成定价规则；COMMISSION/ADMIN/FINANCING 不受影响。 |
| P2 | 客户 PDF 尾页只有页脚 | 初版用 `position:fixed` 页脚（Final Review G1 实测多页会压住正文，已作废）→ 终版：整份文档包在单个 `<table class="page">` 内，页脚放 `<tfoot>`（Chromium 每页重复并**按页预留高度**，不用 fixed），`@page{margin-bottom:7mm}` 让页脚落在原 14mm 页边距区内、每页正文容量与旧版持平；E2E G-10 仍断言 Real-UAT 规模报价 = 1 页。 |
| 识别 | `资金使用 / 资金占用` → FINANCING | classify 关键词补充（真实行「资金使用」此前无类别）。 |

## 2. 回归夹具（结构等价合成，不提交原始工作簿）

`quote-import.test.ts` 内 `realLayoutWorkbook()`：`项目|价格` 表头、17 行（含 C 列裸数字 244,080.96、"14.67/each" 等文字、0.08/0.14/0.03 百分比格式单元）、空行、B20 = 359,404.12（Σ B = 359,404.30）。REAL-01…12 + CASE-1…5（上下文表头）+ FB-01…04（回退 fail-closed）+ P0-C；`quote-ops-contract.test.ts` P21-S1…S11 结构守卫；golden E2E 新增 **G 段**（生产代码路径：Upload → 17 行零错钱 → 利润默认排除 → 币种 UNRESOLVED → 对账 OK → Review（CAD + 混合行类别）→ Apply 16 行 → Margin 14% → 309,087.60 / 359,404.19 / 14% / 16.28% → 客户视图 → 单页 PDF）。

## 3. 真实模版复跑（同一真实文件，只读诊断）

ROWS_EXTRACTED = 17 · WRONG_MONEY_ROWS = **0** · 窗户供货 58,755.68（244,080.96 入备注）· 资金使用 9,274.94 / 8% · 公司利润 50,316.70 / 14% / include=false · Admin Fee 11,000 / 3% · 币种 UNRESOLVED（17/17）· REFERENCE_TOTAL 359,404.12（第 20 行）· EXTRACTED 359,404.30 · 差 0.18（容差 359.40）→ OK。

## 3.5 Final Review 合并门（G1 多页页脚安全 / G2 并入 main）

**G1 — 多页客户 PDF 页脚安全（用 PDF 文本坐标证明，不靠肉眼）**

`scripts/quotation-pdf-layout-e2e.ts`（已登记 `test-all.sh`；无 Chromium 时 SKIP）：用 pdfjs `getTextContent` 的 transform 取每页正文 baseline 与页脚顶边，断言 单页=1 页、多页≥2 页、每页有页脚、任一页正文 baseline 不低于页脚顶边、末页仍有正文。

| 变体（48 行 + 长条款，A4，渲染器边距 14/14/12/12mm） | 页数 | 正文压页脚 | 仅页脚尾页 |
|---|---|---|---|
| 旧 `.foot{position:fixed;bottom:0}` + `@media print{body{padding:0}}` | 4 | **第 3 页 OVERLAP**（正文 baseline 51.4pt vs 页脚顶边 51.0pt） | 否 |
| `@page{margin-bottom:28mm}` + fixed 负偏移 | 4 | Chromium 把页脚挪到页顶（footerTop 764pt），不可用 | — |
| **`<tfoot>` 重复页脚（终版）** | 4 | **否**（第 3 页 baseline 51.4pt vs 页脚顶边 28.5pt，余量 23pt） | 否 |

- 负向对照：把模板回退到旧 fixed 版本跑同一脚本 → M-3 失败、exit 1（脚本是真门）。
- 0–60 行扫描（17 个尺寸）：无任何一页压页脚、无仅页脚尾页。
- G-10 回归与修正：`<tfoot>` 在每页（含末页）预留 ≈13pt，首次合成后 Real-UAT 规模报价变成 2 页（第 2 页是真实的两条 Assumptions）。终版把页脚压缩（3px/3px/9.5px）并 `@page{margin-bottom:7mm}`：页脚落在原 14mm 页边距区内（满页时 baseline ≈7.3mm 离纸边），每页正文容量与旧版持平（48 行夹具分页完全一致 157/196/193/60 个文本项），Real-UAT 报价回到 1 页（页余量 ≈8.3pt，与旧版 6–8pt 同量级；旧版的"1 页"其实是最后一条 Assumption 压进了页脚线）。左/上边距不变（minX 33.7pt=12mm，顶部文本 y 不变）。
- 观察（未改，超出本门范围）：长报价里 `h2` 可能孤立在页底（如"Terms & Conditions"标题在第 3 页底、内容在第 4 页），属 `break-after` 美观问题，不影响正确性。

**G2 — 并入当前 main**：`git merge --no-ff origin/main`（`29e4b2173f3bf7cc14052c1191a48cf3882d495e`，PR #153 A2-P2.2）→ 合并提交 `350307e7`，无冲突（唯一交叠文件 `scripts/test-all.sh` 自动合并）；`git diff origin/main..HEAD -- prisma/` = 空；`20260821233000/migration.sql` blob `c8ad4548` 两侧一致（sha256 `ea5a74fb…`）。

## 4. 证据（最终集成头 `85efa28c` = G1 + merge(main `29e4b217`) + G1 follow-up；全部在该头上复跑）

| 项 | 结果 |
|---|---|
| `quote-import.test.ts`（含 REAL-01…12 / CASE-1…5 / FB-01…04 / P0-C） | **74/74** |
| `quote-ops-contract.test.ts`（含 P21-S1…S11） | **64/64** |
| `quote-calc` / `quote-engine-contract` / `quote-ops-customer` / `performance` | 34/34 · 28/28 · 25/25 · 20/20 |
| 迁移守卫 | 63/63 · 27/27；`20260821233000` sha256 `ea5a74fb…` 不变（blob `c8ad4548` 与 main 一致）；`git diff origin/main..HEAD -- prisma/` = 空 |
| Golden DB E2E（A–G，隔离分支 `e2e-qops-phase2-1-final`，生产 project 子分支，已删） | **79/79**（G 段：17 行 / 0 错钱 / 利润默认排除 / 币种 UNRESOLVED / 对账 OK / Apply 16 / 309,087.60 → 359,404.19 @14% / 客户视图 / **PDF 1 页**） |
| 真实 `Quote.xlsx` 复跑（只读诊断，未提交） | 17 行 / 0 错钱 / 参考 359,404.12 vs 抽取 359,404.30（差 0.18，容差 359.40）OK |
| swc 守卫 · tsc · ESLint baseline · `npm run build` | PASS · 0 错 · PASS（error 较基线 −12）· PASS（Compiled successfully） |
| 客户 PDF 分页布局回归 `scripts/quotation-pdf-layout-e2e.ts`（真实 Chromium） | 单页 = **1 页** · 多页 = **4 页** · 页脚压正文 = **NO** · 仅页脚尾页 = **NO**（9/9；负向对照：旧模板 M-3 失败） |
| 全量 `test-all`（隔离分支） | **316/317**（唯一失败 = `Autopilot A2-P0 Isolated E2E`；**同环境在干净 main@29e4b217 复跑 = 同样 4 条断言失败 92✓/4✗，PR 头 92✓/4✗ 完全一致** → 既有失败，非本分支所致） |
| GitHub CI + Vercel – qingyan-staging | **双绿 @ 85efa28c**（docs-only 尾提交后再次核对，见 Gate） |

## Gate

```
QO21_STATUS               = READY_FOR_FINAL_REVIEW（Draft PR，不 merge；G1/G2 已关）
QO21_PRE_INTEGRATION_HEAD = de1ed47bbba1c17b3df7ed37837a45425ac76310
QO21_INTEGRATED_MAIN_SHA  = 29e4b2173f3bf7cc14052c1191a48cf3882d495e（合并提交 350307e7，无 rebase）
QO21_PARSER_CHANGE_AFTER_REVIEW = NO（review 后仅改 quotation-html.ts / P21-S10 守卫 / test-all 登记 / 新增布局脚本）
QO21_SCHEMA_CHANGED       = NO
QO21_MIGRATION_CREATED    = NO（20260821233000 sha256 ea5a74fb… 不变）
QO21_PRODUCTION_DB_CHANGED= NO
QO21_PRODUCTION_FLAG      = 未改（TENDER_QUOTE_ENGINE_ENABLED OFF；TENDER_FINANCIAL_CONTROL_ENABLED 未设）
QO21_ISOLATED_BRANCHES    = 0
```

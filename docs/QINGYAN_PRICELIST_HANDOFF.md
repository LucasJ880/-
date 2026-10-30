# Sunny 价格表 2026-10-28 + 报价统计 · 交接（HANDOFF）

> 新会话从这里进。先读本文件，再读任务书，不凭记忆重写；任何"现状"以任务书 §0 的文件行号为准，打开核对后再动手。本文件只记录**已核对过的事实**；未核对的写明"未核对"。

| 项 | 值 |
|---|---|
| 最后更新 | 2026-10-30（PRICE-1 #344 已合并并归档；下一个是 PRICE-2，propose 前先答 Q4） |
| 任务书（方案） | `docs/QINGYAN_PRICE-1_PRICELIST_TASKBRIEF.md`（§7 判断点 Q1–Q11 **待拍板**） |
| 主线 | `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` → Phase P（PRICE-1 / PRICE-2 / PRICE-3 / STAT-1，全部 `[ ]`） |
| 进行中的 change | `pricelist-2026-10-cordless-fullness`（四件套已写，`validate --strict` 通过；提交在归档 PR #353 合并之后再推，避免混进归档 PR） |
| 工作分支 | `claude/vigilant-goodall-4t0c17`（基于 origin/main `abad98d`；每个 PR 合并后从 origin/main 重建同名分支） |
| OpenSpec CLI | 未装进依赖：`OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 <cmd>` |
| 运行环境 | 仓库不带 `node_modules`，先 `npm ci`（约 2 分钟，会 `prisma generate`）；沙箱里 `tsc` 需 `NODE_OPTIONS=--max-old-space-size=8192` |
| 价表证据 | `config/pricelist/2026-10-28-lucas-quote.json`（增量 + 来源 SHA-256）、`config/pricelist/2026-10-28-golden-cases.json`（158 条黄金用例）；脚本 `scripts/pricelist/`（README 有四步命令） |

## 0. 交付流水线（每个 PR 合并后更新本表）

| change | 实施 | PR | archive PR | TASKFLOW |
|---|---|---|---|---|
| PRICE-1 `pricelist-2026-10-fauxwood-allusion` | 已实施（报告 `docs/QINGYAN_PRICE-1_REPORT.md`；Q1–Q11 全按推荐，Q4 暂按现状归 PRICE-2） | [#344](https://github.com/LucasJ880/-/pull/344) 已合并（2026-10-30，merge `33139de`） | 本 PR（`openspec/changes/archive/2026-10-30-pricelist-2026-10-fauxwood-allusion`） | `[x]` |
| PRICE-2 `pricelist-2026-10-cordless-fullness` | 已 propose（2026-10-30；Q4 = A：无绳改显式开关；设计 D5 不加企业默认褶皱率）；待审后 apply | — | — | `[ ]` |
| PRICE-3 `pricelist-2026-10-addons` | 未 propose（等 Q6 / Q7 / Q8） | — | — | `[ ]` |
| STAT-1 `sales-quote-stats-drilldown` | 已实施（会话 `claude/magical-shannon-keegzr`；Q9 / Q10 按推荐；报告 `docs/QINGYAN_STAT-1_REPORT.md`） | PR 待开 | — | `[G]` |

流程同 INSTALL-2：基于最新 main → 实施 → typecheck / lint:baseline / test:ci / registry / validate --strict + 本 change 的测试 → PR → CI 绿 → 用户确认合并 → `openspec archive <change> --yes`（在最新 main 上重跑）+ TASKFLOW `[x]` + 本表 → archive PR。

## 1. 下一步

1. **已拍板**（用户 2026-10-29："都按照推荐的来"）：Q1–Q11 全按推荐列；Q4 没有推荐值，PRICE-2 propose 前仍要问一句 Lift L/R 是否即无绳。
2. PRICE-1 已合并（#344）并归档（本 PR）；`openspec list --specs` 列出 `sales/price-list`。下一个 PRICE-2 `pricelist-2026-10-cordless-fullness`：**propose 前必须先答 Q4**（Order Form 里 Lift L/R 是否即无绳，`quote-sheet/page.tsx` 的 `cordless: l.lift === "L" || l.lift === "R"`）——它决定无绳 30% 折扣与 159 / 129 最低价套在哪些行上；黄金测试 `DEFERRED` 110 条（cordless-* / fullness-*）在 PRICE-2 转入 `MUST_MATCH` `src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts`（读 `config/pricelist/2026-10-28-golden-cases.json`，逐条调 `priceFor`，误差 ≤ 0.01，报错 ↔ 报错）并注册进 `scripts/test-all.sh`。
3. apply 前记基线：`npx tsx src/lib/blinds/__tests__/{sunny-motor,valance-options,cost-rates,quote-fees}.test.ts`、`npx tsx src/lib/sunny-process/__tests__/blinds-oracle.test.ts`、`npx tsx src/lib/fulfillment/__tests__/category.test.ts`、`npx tsx src/lib/sunny-process/__tests__/quote-mapping.test.ts`。
4. 价表下次再更新时，走 `scripts/pricelist/README.md` 四步，只把差异进新的 `config/pricelist/<日期>-*.json`。

## 2. 外部信息的可信度（防幻觉）

| 信息 | 状态 | 怎么补 |
|---|---|---|
| 上传包三个文件的 SHA-256 | **已记录**：zip `aa9d9416…3a1b3`、`index.html` `d068ab4b…203c`、`.xlsx` `d68a4cf8…cdfb6`（完整值在 `config/pricelist/2026-10-28-lucas-quote.json` `source`） | 下次上传先比哈希，相同就不用重做 V1 / V2 |
| 现有 9 个产品的 MSRP 矩阵 | **已核实三方一致**（V1，0 差异；`scripts/pricelist/crosscheck.py` 退出码 1 只因为 Fauxwood / Allusion 是增量） | — |
| Fauxwood / Allusion 矩阵 | **已核实** HTML = Excel（V1） | — |
| 无绳规则（30% off、159 / 129、无 75" 上限） | **已核实**：来自上传 `使用说明.txt` 原文 + `index.html` `price()` 源码 + `defaultPricing()` | Q3 / Q4 仍需 Lucas 确认业务上是否如此 |
| 褶皱率规则 | **已核实**：`使用说明.txt` 原文 + `price()` 的 `lookupW = w × fullness ÷ 2` | — |
| 黄金用例 158 条 | **已核实可复现**：`scripts/pricelist/gen-golden.mjs` 重跑与提交文件逐条相同 | — |
| 附加项目价 | **两套来源有冲突**（Hub 240 vs 300；电池电机 150 vs 190 Matter）；零售表 `retailAddons` 为结构化、带 enabled / display_order，Excel `ADD ON参考` 为参考行 | Q7 |
| Excel `计算过程` 页公式 | **未核对**：无缓存值，沙箱没有 LibreOffice 重算 | 有 LibreOffice 的机器重算 10 行与黄金用例比对（任务书 V6） |
| Order Form "Lift L/R = 无绳"（`page.tsx:884`） | 代码事实已核实；**业务含义未核对** | Q4 |
| "每个人报了多少钱"现有口径 | **已核实**：KPI-1 规格 `openspec/specs/sales/period-summary/spec.md` + `src/lib/sales/period/load.ts`（`byRep` 按 `createdById`） | — |
| 经销商参考价、面料画册附页、AI 在线后台（`ai-quote-server-eight.vercel.app`） | 上传包里有，**本次不进青砚**（Q11；画册与 AI 后台不在诉求内） | — |

规则：没核实的数字**不得**写进规格、`pricing-data.ts` 或测试；价表数值只从 `config/pricelist/*.json` 拷，不手敲。

## 3. 本会话做了什么（代码零改动）

| 产物 | 说明 |
|---|---|
| `docs/QINGYAN_PRICE-1_PRICELIST_TASKBRIEF.md` | 方案：现状 F1–F15（带行号）、V1 结果、增量 D1–D11、四个 change 的设计 / Out of scope / 验收、零 schema 落点、八条纪律对照、V1–V7 验证计划、Q1–Q11 |
| `config/pricelist/2026-10-28-lucas-quote.json` | 增量数据：Fauxwood / Allusion 矩阵与档位、无绳、褶皱率、费用、零售附加项目 CSV、Excel 附加项目 40 行、SKU 改名、经销商参考（标注不进）、来源哈希 |
| `config/pricelist/2026-10-28-golden-cases.json` | 158 条黄金用例（fauxwood 14 / allusion 14 / cordless 36 / fullness 74 / door-screen 3 / regression 11 / 其它），37 条是预期报错 |
| `scripts/pricelist/{README.md,extract-seed.py,dump-pricing.ts,crosscheck.py,gen-golden.mjs}` | V1 / V2 的可复跑脚本；本会话已用它们重跑一次并与提交文件比对一致 |
| `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` | 新增 Phase P（PRICE-1 / 2 / 3、STAT-1，`[ ]`） |

## 4. 不要做的事

- 不重录 9 个老产品的 MSRP（已三方一致）；不给 `QuoteDiscountSettings` 加列（纪律 1）；新折扣 / 无绳 / 褶皱率 / 附件价都落 `Organization.settingsJson.pricing`，改时只动 `pricing` 子键。
- 不改 KPI-1 的成单 / 报价口径；STAT-1 只补周预设、展开清单、按销售筛选、草稿提醒。
- 不把经销商参考价、面料画册、AI 在线后台带进青砚。
- 不删 `docs/` 任何文件；不动 `.claude/launch.json`；`openspec/specs/**` 只通过 archive 进。
- 黄金测试建立后，任何改 `pricing-data.ts` / `pricing-engine.ts` 的提交都先跑它。

## 5. 本地复跑

```bash
npm ci
# V1 + V2（需要上传包；见 scripts/pricelist/README.md）
# 既有定价相关测试（apply 前基线）
npx tsx src/lib/blinds/__tests__/sunny-motor.test.ts
npx tsx src/lib/blinds/__tests__/valance-options.test.ts
npx tsx src/lib/sunny-process/__tests__/blinds-oracle.test.ts
```

隔离库 / Playwright 走查步骤沿用 `docs/QINGYAN_INSTALL-2_HANDOFF.md` §4b。本会话（2026-10-29）在沙箱里实际用的是：

```bash
apt-get update && apt-get install -y postgresql-16-pgvector   # 第一次 apt-get install 没更新索引会报找不到包
pg_ctlcluster 16 main start                                    # 容器自带 16/main 集群，端口 5432
su postgres -s /bin/bash -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\" && createdb qy_test"
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/qy_test DIRECT_URL=$DATABASE_URL
npx prisma db push --skip-generate
NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/sales/__tests__/quote-settings-db.isolated.test.ts
# 走查：NODE_OPTIONS=--max-old-space-size=8192 npm run build；JWT_SECRET=<任意 32+ 字节> QINGYAN_ALLOWED_DB_ENDPOINT_PREFIXES=127 npx next start -p 3100
# 页面默认是"快速报价"（内嵌旧 HTML），要点"详细订单"才是 Order Form；保存前要在 Part B 填定金（≥ 30%）
```

## 附：会话分工与拍板（2026-10-30，会话 `claude/magical-shannon-keegzr` 记）

- 用户把 Phase P 交给 `claude/magical-shannon-keegzr` 会话后，发现 `claude/vigilant-goodall-4t0c17` 已在做 PRICE-2；用户拍板 **PRICE-2 由 vigilant-goodall 会话完成**，magical-shannon 会话做 STAT-1，PRICE-3 等 PRICE-2 合并后再动（两者都改折扣设置与报价单页面）。
- 用户 2026-10-30 对 magical-shannon 会话的两项拍板（PRICE-2 实施须对齐）：
  - **Q4**：Order Form 无绳改为单独勾选（与 PRICE-2 四件套的方案 A 一致）。
  - **计价褶皱率**：另设独立的"计价褶皱率"字段，缺省 2（= 现价），**现有 180% / 230% 工艺褶皱字段不动、不参与计价**。PRICE-2 四件套 D5"Order Form 把 180 / 230 转成 1.8 / 2.3 随 items 上传"与此相反（默认 180% 的窗帘会掉档变便宜），需按此改。


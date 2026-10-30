# QINGYAN STAT-1 报告 — 报价统计明细与按销售筛选（sales-quote-stats-drilldown）

| 项 | 值 |
|---|---|
| 日期 | 2026-10-30 |
| TASKFLOW | STAT-1（Phase P — Sunny 价格表 2026-10-28 + 按人报价 / 销售额统计） |
| OpenSpec change | `openspec/changes/sales-quote-stats-drilldown/` |
| 分支 | `claude/magical-shannon-keegzr` |
| 任务书 / 交接 | `docs/QINGYAN_PRICE-1_PRICELIST_TASKBRIEF.md` §3.4；`docs/QINGYAN_PRICELIST_HANDOFF.md` |
| 拍板 | Q9 / Q10 按推荐（用户 2026-10-29"都按照推荐的来"）：一周从周一开始、组织时区；销售能展开、只看自己。用户 2026-10-30 把 Phase P 交给本会话，PRICE-2 交回另一会话 |

## 1. 做了什么

| 部分 | 文件 | 说明 |
|---|---|---|
| 纯函数 | `src/lib/sales/period/summary-pure.ts` | `weekStartYmd`、`weekPresetRange`、`periodRepQuotes`（复用 KPI-1 的 `classify`，明细与按人表同一口径） |
| 明细取数 | `src/lib/sales/period/drilldown.ts` | 按创建人取期间报价行 → 分组 → 按 ID 补单号 / 客户 / 价表版本；每组 500 行上限，小计按全量 |
| 明细接口 | `src/app/api/sales/period-summary/quotes/route.ts` | 授权同期间汇总；本人范围只能看自己（403 `FORBIDDEN_REP`）；全企业范围必须带 `repId`（400 `INVALID_REP`）；`kind` 只能 won / quoted |
| 草稿提醒 | `src/lib/sales/period/load.ts` | 期间汇总响应加 `draftsUnsent.count`（期间内创建、仍是草稿、客户未归档，本人范围只算本人；不进 `totals`） |
| 报价列表 | `src/app/api/sales/quotes/list/route.ts`、`src/app/(main)/sales/quotes/page.tsx` | `createdById` 服务端筛选（在既有授权范围内）+ `reps` 名单；页面"按销售"下拉，`?rep=` 写进 URL |
| 面板 | `src/components/sales-command-center/sales-period-panel.tsx` | 本周 / 上周预设；"今天"按组织时区；按人行展开明细；全企业范围行链到按销售筛选的报价列表；草稿提醒链到草稿列表 |
| 测试 | `period-drilldown-pure.test.ts`（test-all + test-ci-unit）、`period-db.isolated.test.ts` 扩 [8] | 见 §2 |

无 schema、无 cron、无 LLM；KPI-1 口径、Muse `sales_overview`（只取 `period` / `totals`）与 KPI-2 解读输入都不变。

## 2. 怎么验

| 检查 | 结果 |
|---|---|
| apply 前基线 | period-pure 48、period-insights 38、period-narrative-pure 100、period-db.isolated 31、period-narrative-db.isolated 31、Muse sales-db.isolated 36 |
| `npx tsx src/lib/sales/__tests__/period-drilldown-pure.test.ts` | 24 通过 0 失败（周一 / 本周 / 上周、明细 = 按人表、跨销售修订、各人之和 = 全企业） |
| `period-db.isolated.test.ts`（隔离库 127.0.0.1:5433） | 55 通过 0 失败（原 31 + [8] 明细 / 草稿 / 列表筛选 19 + [9] 审查修订 5） |
| 变异检查（临时，已还原） | 改回"先按人过滤再分组"→ 纯测试 3 项变红；明细取数改回只取该销售 → 隔离库 2 项变红 |
| 回归 | period-pure 48、period-insights 38、period-narrative-pure 100、period-narrative-db 31、Muse sales-pure 84、sales-db 36，条数不变 |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | 退出 0 |
| `npm run lint:baseline` | PASS |
| `bash scripts/check-test-registry.sh` | 通过；已注册 500 |
| `npm run test:ci`（无 `DATABASE_URL`） | 退出 0，`CI unit subset PASS` |
| `openspec validate sales-quote-stats-drilldown --strict` | valid |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run build` | 退出 0（与全量测试同时跑时被系统杀掉一次，单独重跑通过）；`/api/sales/period-summary/quotes` 在产出表中 |

真实浏览器检查（`next start -p 3100` + Playwright；种子只写本机测试库，查完已删）：

| 检查 | 结果 |
|---|---|
| 老板点"本周"（组织当地 2026-10-29 周四） | URL `from=2026-10-26&to=2026-10-29` |
| 有一份本期草稿 | 显示"本期草稿未发送 1 份（草稿不计入报价金额）· 去发送或标记已发送" |
| 展开 Rep Alice | "成单 1 单 · $3,400.00"、报价 2 份，行含单号、状态、价表 2026-10-28；小计与按人行相同 |
| 点"在报价列表查看 Rep Alice 的全部报价" | 跳到 `/sales/quotes?rep=…`，下拉已选中 Alice，Bob 的 $900 报价不在列表 |
| 销售 Bob 打开首页（390px） | 只有本人一行、能展开本人报价、没有列表链接；无横向溢出；无页面错误 |
| 走查发现并修复 | 明细日期原按 UTC 截取，晚间签字显示成次日（10/30）；改为组织时区（10/29） |

## 3. 偏离与审查

1. **不在 `/sales/quotes` 里改状态筛选的 URL 行为**：状态按钮仍只在页面内生效（既有行为），`?status=` 只作为进入页面时的初值。

**独立审查后修订**（一个只读审查代理没有看我的结论；逐条核实后修复，纯测试 20 → 24，隔离库 50 → 55）：

2. **明细与按人表在跨销售修订时不一致（高）**：KPI-1 的"同商机未签只计最新一份"跨销售生效；原实现先按销售过滤再分组，A 发 v1、B 在同一商机发修订 v2 时 A 的明细会多算 v1，各人明细之和大于全企业报价数。改为对调用者范围内的全部行分组后再按人过滤，取数范围与期间汇总一致（全企业 / 本人）。变异检查：改回"先过滤"→ 纯测试 3 项、隔离库 2 项变红。
3. **跨企业露出用户姓名 / 邮箱（中）**：明细接口按任意 `repId` 查用户姓名；改为只对本企业成员或在本企业有报价的人给出姓名。
4. **两种截断混在一起（低）**：分成 `truncated`（某组超过 500 行，小计仍全量）与 `fetchTruncated`（取数命中 2 万行，小计也不完整），面板分别提示。
5. **前端竞态（低）**：展开明细加"正在取"防重；报价列表快速切换销售时只采用最后一次请求的结果。
6. **未修（外观）**：季度从周一开始的那一周，"本周"与"本季"区间相同时只高亮"本周"。

## 4. 已知限制

- **首屏预设可能差一天**：首屏用浏览器当天算预设，服务端响应回来后改用组织当天（之前所有预设都只用浏览器当天）。
- **明细按报价创建人**：与 KPI-1 按人表一致，不是商机负责人。
- **报价列表仍最多 200 份**：按销售筛选后是"该销售最近 200 份"。
- **草稿按创建时间计期**：期间内建的草稿才计；之前建、本期才改的草稿不计。

## 5. 上线步骤

1. 合并后无需配置。
2. 老板打开 `/sales/home` → 期间面板选"本周"，核对期间为本周一至今天。
3. 点开某位销售的行，核对成单 / 报价条数与金额等于该行数字；点"在报价列表查看"跳到 `/sales/quotes?rep=…`。
4. 有草稿时面板显示"本期草稿未发送 N 份"，点链接到草稿列表。
5. 销售账号登录，只能展开自己那一行。

## 6. 全量测试

| 检查 | 结果 |
|---|---|
| `npm test`（隔离库，分支 `dfab2493`） | 507/519 通过，12 失败 |
| `npm test`（同一隔离库，main `28e46ea2` worktree） | 506/518 通过，12 失败 |
| 失败清单对比 | 两边 12 项逐字相同，均为 main 既有；新增测试均通过 |

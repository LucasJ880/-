# QINGYAN KPI-1 报告 — 销售期间汇总（sales-period-summary）

| 项 | 值 |
|---|---|
| 日期 | 2026-10-28 |
| TASKFLOW | KPI-1（Phase K — Sunny 日程归因与期间看板） |
| OpenSpec change | `openspec/changes/sales-period-summary/` |
| 分支 | `claude/magical-shannon-keegzr`（基于 origin/main `ed3b55f`） |
| 设计稿 / 交接 | `docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md` §3；`docs/QINGYAN_SUNNY_SCHEDULE_KPI_HANDOFF.md` |

## 1. 做了什么

用户的问题："从 10 月 1 日到今天 28 日，一共成了多少单、报了多少钱出去"。现在首页面板与接口都能直接回答，任意期间、按人、带对比与确定性洞察。

- **一套口径**（`src/lib/sales/period/summary-pure.ts`，纯函数）：
  - 成单 = 状态 signed / accepted 且签字时间落在期间；每份已签报价各计一份（判断点 5，用户确认）。金额取报价 `grandTotal`（含税），另给税前。
  - 报价（报出去的）= 发送时间落在期间、非草稿；同一商机内已签的每份都计，未签的只计最新发出的一份。
  - 在手未签 = 上述报价中未签、状态 sent / viewed 的；另给发出超过 14 天的子集。
  - 定金 = 收款时间落在期间的定金之和；已签未登记定金的数量与金额。
  - 只汇总加元，非加元行数单列；排除已归档客户与草稿。
  - 期间按组织时区的当地日解释；缺省 = 当地本月 1 日至今天；对比期为"上一期"（紧邻同样天数）或"上月同期"（日号截到月末）。
- **九条确定性洞察**（`src/lib/sales/period/insights.ts`，规则表，零 LLM）：成单 / 报价金额环比 ±20%、超 14 天未签、转化率偏低、某销售本期零报价、成单集中、已签未登记定金、日程不明来源、网站预约占比。后两条要等 CAL-1 提供日程数据，本次恒不触发。销售本人范围不出团队与日程洞察。
- **接口** `GET /api/sales/period-summary?from&to&compare`：按 `sales.analytics.read` 授权；全企业范围给按人拆分，本人范围只算本人创建的报价；参数不合法返回 400 `INVALID_PERIOD`。取数一次查询覆盖本期与对比期，上限 20,000 行，超出时 `truncated: true`。
- **首页面板**：期间预设（本月至今 / 上月 / 本季 / 最近 30 天 / 自定义）、对比期切换、六个指标瓦片带变化率、洞察列表、按人表；期间写在网址里，刷新保留；无分析权限时整块不显示。
- **驾驶舱**："本月签约"标签改为"本月签约（商机估值）"，与首页已有写法一致，计算不变。
- **Muse**：`sales_overview` 可选 `period`（契约只追加）；带上时 `data.period` 给同一口径的汇总，期间汇总句放第一条理由。决定 B：销售范围剔除全部金额键，句子只有计数。绕过契约传入非法期间时显式返回 `VALIDATION_FAILED`。
- 零 schema：无任何 Prisma 改动。无新 cron、无出站、无 LLM 调用。

## 2. 怎么验

| 命令 / 检查 | 结果 |
|---|---|
| `npx tsx src/lib/sales/__tests__/period-pure.test.ts` | 48 passed |
| `npx tsx src/lib/sales/__tests__/period-insights.test.ts` | 38 passed |
| `period-db.isolated.test.ts`（本地 PG16 + pgvector 隔离库，41 个迁移） | 26 通过，0 失败；无库时跳过退出 0 |
| `muse-bridge-pure.test.ts` | 67 passed（开工前 61） |
| `muse-bridge sales-pure.test.ts` | 84 passed（开工前 73） |
| `muse-bridge sales-db.isolated.test.ts`（同一隔离库） | 36 passed（开工前 27） |
| `sales-record-access-db.isolated.test.ts`（相邻模块回归） | 15 通过（与开工前一致） |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | 退出 0 |
| `npm run lint:baseline` | PASS（无新增 error fingerprint；本次改动文件单独跑 ESLint 零告警） |
| `npm run test:ci` | CI unit subset PASS（含两个新纯测试） |
| `bash scripts/check-test-registry.sh` | 已注册 466 个（开工前 463），欠账基线 72 条不变 |
| `npm run build`（本地需 `NODE_OPTIONS=--max-old-space-size=8192`，见 §5） | 退出 0；`/sales/home`、`/sales/cockpit`、`/api/sales/period-summary` 正常产出 |
| `openspec validate sales-period-summary --strict` | valid |
| 真实服务 + Playwright（本地生产构建 + 隔离库 + 种子数据） | 见下表 |

真实浏览器检查（`next start` + Playwright，会话 cookie 由同一 JWT 密钥签发）：

| 检查 | 结果 |
|---|---|
| 老板 curl `from=2026-10-01&to=2026-10-28` | 返回 `totals.wonAmount`，对比期 9/3–9/30 |
| 老板打开 `/sales/home?from=2026-09-01&to=2026-09-30` 后刷新 | 仍显示 9/1–9/30；成单 2 单 6,800、报价 3 份 8,600、按人两行 |
| 销售打开同一地址 | 显示"仅本人报价"，看不到老板姓名 |
| 只持"客户读"自定义岗位的成员打开首页 | 首页正常；无期间面板、无任何错误提示 |
| 驾驶舱 | 显示"本月签约（商机估值）" |
| 手机宽度 390px | 页面无横向溢出；按人表在卡片内横向滚动 |

## 3. 实施中对规划的调整（均已同步回 spec / design）

1. **补 spec：已签未登记定金。** 洞察 I7 需要这个数，原响应结构没有，补进"在手未签与定金"要求与 `totals`。
2. **补 spec：取数上限不静默。** design 原写"截断时加一条警告洞察"，与 spec 的"九条规则"冲突；改为 `truncated` 字段 + 面板提示，单列一条要求。
3. **Muse 期间句放第一条理由。** 建议式回复契约限制理由 ≤ 3 条（`src/lib/muse-bridge/advisory.ts:23`），原计划"末尾追加"会被截掉。
4. **契约校验放在 `period` 子对象上**，联合成员保持普通对象。
5. **Muse 非法期间显式报错。** 隔离测试发现：绕过契约解析直接调路由器时，非法期间会被静默丢弃。正式入口先解析所以线上不受影响，仍改为返回 `VALIDATION_FAILED`。
6. **I8 / I9 也只给全企业范围**：日程来源是企业级数据，CAL-1 接入时再评估。
7. **只给 from 或只给 to → 400**（spec"不是合法日期"覆盖）。

## 4. 三处"签单金额"口径差异（请 Evan 决定是否统一）

| | 本 change（期间汇总） | 驾驶舱折扣统计 | 会计提成 |
|---|---|---|---|
| 位置 | `src/lib/sales/period/summary-pure.ts` | `src/app/api/sales/cockpit/discount-stats/route.ts` | `src/lib/accounting/service.ts` `loadSalesSummary` |
| 状态 | signed + accepted | 不看状态，只看 `signedAt` 落在期间（`discount-stats/route.ts:79`；注释写"或 status=signed"，代码未实现） | 只 signed |
| 范围 | 全部报价 | 只计 `finalDiscountPct` 非空的报价 | 全部报价 |
| 期间 | 任意当地日，组织时区 | 任意；`from` 按 UTC 零点、`to` 按服务器本地 23:59:59（`discount-stats/route.ts:57-60`） | 会计月 |
| 归档客户 | 排除 | 不排除 | 不排除 |
| 币种 | 只汇总 CAD | 不区分 | 不区分 |

首页英雄区与驾驶舱的"本月签约 / 本月已签"是第四个数：商机估值（`estimatedValue`）。本次只在驾驶舱加了"（商机估值）"标注，英雄区未改。

## 5. 已知限制

- **转化率可能大于 100%**：线下签字从未"发送"的报价计成单不计报价；上期发出、本期签字的也一样。面板此时显示"同期口径"说明。
- **`sentAt` 会被重发覆盖**：邮件发送会把 `sentAt` 改成当下，9 月发出、10 月重发邮件的报价计入 10 月。
- **外贸转入的销售报价**没有 `sentAt` / `signedAt`，不进入任何指标；非加元报价不汇总，只计数。
- **排除已归档客户**会让历史期间的数字随归档操作变小（与首页约定一致）。
- **单次取数上限 20,000 行**，超出时标 `truncated` 并在面板提示。
- **Muse 范围沿用 S1**：合价岗在 Muse 是本人范围、会计岗被拒，网页两者都是全企业；管理者带 `assigneeUserId` 时期间汇总仍是全企业。
- **本地构建内存**：`npm run build` 内部的 `tsc --noEmit` 不带堆参数，本容器 Node 22 默认堆不够，需 `NODE_OPTIONS=--max-old-space-size=8192`；CI（ubuntu-latest）历来不需要。
- 全量 `npm test` 结果见 §6。

## 6. 全量测试

见下方（实施收口时补）。

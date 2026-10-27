# QINGYAN S1 报告 — Muse 只读销售意图（muse-sales-read-intents）

| 项 | 值 |
|---|---|
| 日期 | 2026-10-27 |
| TASKFLOW | S1（Phase S — Sales Pilot） |
| OpenSpec change | `openspec/changes/muse-sales-read-intents/` |
| 分支 | `feature/muse-sales-read-intents`（基于 origin/main `3eac2a47`） |
| 上位文档 | `LucasJ880/Muse--Bridge-bot` 的 `docs/prd/sales-pilot-prd.md` 批次 Q1 |

## 1. 做了什么

- `muse-bridge/v1` 契约只追加：意图 `sales_overview`、`opportunity_status`（阶段 1，默认不开）；错误码 `PERMISSION_DENIED`、`OPPORTUNITY_NOT_FOUND`。
- `src/lib/muse-bridge/sales-pure.ts`（纯函数）：
  - 读范围：平台 admin / super_admin / boss / manager 或组织 org_owner / org_admin → 全组织；平台 sales / trade → 仅本人；其余拒绝。
  - 确定性排序（规则即理由）：客户来信后无我方外发 40、跟进日已过 20 + 天数（≤ 10）、逾期跟进行动 10、CRM 超过停滞阈值无互动 15、阶段权重 4–20、hot 10 / warm 4、金额分位 0–10。只排开放态（含 Sunny 历史阶段投影）。
  - 停滞理由固定写"CRM 中 N 天无互动记录（未核实是否有线下跟进）"；缺失字段进 `unverified`。
  - 决定 B：只有全组织读范围输出 `amount` 与金额理由。
  - `opportunity_status` 的 data 分开返回 CRM 事实（带 `updatedAt` 作记录版本）、最近 5 条互动（敏感摘要整段脱敏）、未结束行动（标逾期）、Revenue Spine 建议（标来源）、优先级理由、`unverified`、`employeeConfirmations: []`。
- `src/lib/muse-bridge/sales.ts`（取数）：所有查询带 `orgId`，销售角色加 `assignedToId`；跨范围与不存在同一口径 `OPPORTUNITY_NOT_FOUND`；停滞阈值读组织 Revenue Spine policy。
- `router.ts` 只加两个 case 与一个 `salesResponse`；沿用既有账本、意图门、建议式回复与整段脱敏。
- 纪律与文档：`openspec/config.yaml` 第 4 条补决定 B；TASKFLOW 新增 Phase S（S1–S4）与"已决定"第 6 条；`flags.ts` 注释。

## 2. 怎么验

| 命令 | 结果 |
|---|---|
| `npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts` | 61 passed（开工前 53；新增 8 条契约用例，意图数断言 12 → 14） |
| `npx tsx src/lib/muse-bridge/__tests__/advisory.test.ts` / `next-step.test.ts` / `prefs.test.ts` | 70 / 59 / 30 passed（未改动） |
| `npx tsx src/lib/muse-bridge/__tests__/sales-pure.test.ts` | 70 passed |
| `NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… DIRECT_URL=… npx tsx src/lib/muse-bridge/__tests__/sales-db.isolated.test.ts` | 26 passed, 0 failed（本地 Docker `pgvector/pgvector:pg16`，`npm run db:migrate:deploy` 建全量 41 个迁移） |
| 同上但不设 `DATABASE_URL` | 输出跳过，退出 0 |
| `tsc --noEmit`（6 GB 堆） | 退出 0 |
| `npx eslint src/lib/muse-bridge` | 无输出 |
| `npm run lint:baseline` | PASS（无新增 error fingerprint） |
| `npx -y @fission-ai/openspec@1.15.0 validate muse-sales-read-intents` | valid |

隔离库端到端覆盖：意图门、管理者全组织 + 金额、销售只看本人且无金额、销售指定别人被拒、管理者按负责人过滤、普通成员被拒、状态视图引用真实 ID 与 `updatedAt`、敏感互动摘要脱敏、外组织 / 别人负责 / 不存在三种情况同一错误与同一消息、requestId 重放逐字相同、账本留痕。

## 3. 判断点（请审）

1. **决定 B**：CEO 文件把"报价金额"列为必读事实、"按价值"列为第一排序依据，所以金额对管理角色开放；销售角色不出。改了 config.yaml 第 4 条的文字，招投标三样不变。
2. **读范围按平台角色 ∪ 组织角色**：管理权限以任一侧为准；销售身份只认平台 sales / trade。没有复用 `resolveRevenueAccess`（它依赖 cookie 会话，且对 sales 放行全组织）。
3. **金额仍参与销售本人的排序**，只是不输出数字——只影响他自己商机之间的相对顺序。
4. **两个新意图的 `availableInPhase` 填 1**：契约里阶段只能是 0–3，Phase S 与招投标 Phase 1 同期开放。

## 4. 已知限制

- `scripts/check-test-registry.sh` 在 origin/main 上本来就失败：`src/lib/trade/__tests__/channel-inbound-id-db.isolated.test.ts`、`src/lib/trade/__tests__/inbound-org.test.ts` 未注册也不在基线（与本 change 无关，未顺手修）。本 change 新增的两个测试均已注册。
- `.env.example` 未改：执行环境的权限设置禁止读取 `.env*` 文件；开关说明写在 `flags.ts` 注释里。
- 阶段过滤在数据库侧是精确匹配；如果有商机的 `stage` 存成大写或带空格，会被漏掉（现有写入都走小写词表）。
- 排序候选上限 500 条，超出时 `data.truncated = true`。
- 本批次没有写操作；`opportunity_status` 的下一步按钮留给 S2（`ask_colleague`）。

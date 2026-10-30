# Design

## Context

- `muse-bridge/v1` 的命令入口按"总开关 → ApiToken → 契约 → org 白名单 → 绑定 + 有效成员 → 路由"执行；路由先查 requestId 账本（AuditLog，24h），再过意图门（`MUSE_BRIDGE_INTENTS`），成功回复一律经 `advisoryResponse`（结论 → 理由 → 下一步，消息整段脱敏）。`MuseIdentity` 带 `userId`、`orgId`、平台角色 `role`、组织角色 `orgRole`。
- 销售数据在 `SalesOpportunity`：`stage` 是自由字符串，Mengxin 用 canonical 词表，Sunny 用历史词表，`opportunity-stage.ts` 的 `toCanonicalStage` 把两者投影到一套；时间戳 `lastInteractionAt / lastCustomerReplyAt / lastOutboundAt / nextFollowupAt` 由 Revenue Spine 维护；`nextActionType / nextActionReason` 是 `next-action.ts` 写入的系统建议。
- `CustomerInteraction` 是互动记录；`SalesAction` 是跟进行动（`status` open / in_progress 视为未结束）。
- Revenue Spine 的停滞阈值来自组织 policy（`followUp.staleAfterDays`，默认 21 天）。
- 现有访问控制（`revenue-spine/access.ts`）只按平台角色白名单、范围是整个组织，没有"销售只看自己"的规则。

## Goals / Non-Goals

**Goals:**

- 管理者在助理里拿到"哪些商机该先推进、为什么"，每条结论可追溯到商机 ID 与 `updatedAt`。
- 销售角色只能读自己的商机；金额只给管理角色。
- 生产默认零行为变化。

**Non-Goals:**

- `src/lib/muse-bridge/events.ts`、`events-pure.ts`、`hooks.ts`：不加销售事件（S2 / S3）。
- `src/lib/revenue-spine/scoring.ts`、`next-action.ts`、`policy.ts`：只读，不改。
- `src/app/(main)/**` 页面、`src/app/api/cockpit/**`：不改。
- `prisma/schema.prisma`：不改。
- 既有 12 个意图的 handler：不改。

## Decisions

### D1 读范围按角色映射，不复用 `resolveRevenueAccess`

- **选择**：在 `sales-pure.ts` 定义纯函数 `resolveSalesScope(identity)`：平台 admin / super_admin / boss / manager 或组织 org_owner / org_admin → 全组织；平台 sales / trade → 仅本人；其余 → 拒绝。
- **否决 A：直接调用 `resolveRevenueAccess`** —— 它依赖 `NextRequest` 与 cookie 会话，Muse 请求没有；而且它对 sales 角色放行全组织，不满足"销售只看自己"。
- **否决 B：只看组织角色** —— 现有组织里销售多为 org_member，与普通成员区分不开；平台角色才是销售身份的事实来源（Revenue Spine 也按平台角色判断）。

### D2 优先级用加权规则，规则即理由

- **选择**：每条规则给分并产出一句理由：客户来信后无我方外发 40；跟进日已过 20 + 逾期天数（最多 +10）；有逾期跟进行动 10；超过停滞阈值无互动 15；阶段权重（谈判 20、打样 16、已报价 / 跟进中 14、报价中 / RFQ 就绪 10、已合格 / 待补信息 6、新询盘 / 补全中 4）；热度 hot 10、warm 4；金额按本次候选集中的分位给 0–10。总分降序，平分时按跟进日早者、`updatedAt` 早者、ID 字典序。
- **否决 A：复用 `scoreOpportunity`** —— 那是对入站询盘的 RFQ 完整度评分（字段、产品匹配），不反映推进紧迫度。
- **否决 B：交给 LLM 排序** —— 违反纪律 7（确定性优先、不增加 LLM 调用），结果不可复现，也写不出可测试的理由。

### D3 只排开放态，统计窗口单独算

- **选择**：排序候选 = 本范围内 `toCanonicalStage` 属于开放态的商机（数据库先用"开放 canonical + 映射到开放的历史阶段"过滤，最多取 500 条，超出时 `data.truncated=true`）；窗口统计（新建、成交、丢单）按 `createdAt / wonAt / lostAt` 落在最近 `days` 天内计数。
- **否决：只返回窗口内有更新的商机** —— 长期没动的商机正是该优先推进的，按窗口过滤会把它们漏掉。

### D4 金额可见性 = 读范围是全组织（决定 B）

- **选择**：管理角色的 `data` 带 `amount`，理由里可以出现"金额 X 在本次列表中靠前"；销售角色不带 `amount` 键、理由不出金额，金额因子仍参与排序（只影响本人自己商机的相对顺序）。
- **否决 A：所有人都不出金额（沿用决定 A 的字面）** —— CEO 文件把"报价金额"列为必读事实、"按价值"列为第一排序依据，管理者看不到金额就无法判断。
- **否决 B：所有人都出** —— 扩大了财务数据在助理通道的暴露面，销售看自己负责的商机金额在青砚里本来就能看，不需要再从助理通道拿。

### D5 不存在与越权同一口径

- **选择**：`opportunity_status` 查询条件带 `orgId` 与（销售角色时）`assignedToId`，查不到统一 `OPPORTUNITY_NOT_FOUND`。
- **否决：越权返回 `PERMISSION_DENIED`** —— 会让调用者探测出别人商机的 ID 是否存在。

### D6 取数与格式分离，router 只加两个 case

- **选择**：`sales.ts` 取数并调用 `sales-pure.ts` 构造 `{ advisory, data }` 或错误；`router.ts` 只负责分发和走既有 `respond` / `errResponse` / 账本。
- **否决：把两个 handler 写进 `router.ts`** —— 该文件已 615 行，而且招投标逻辑集中在那里，销售放进去会让后续 S2 / S3 的改动与招投标改动冲突。

## 与八条硬纪律的关系

| #   | 纪律           | 本 change                                                                                                                 |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | 零 schema      | 遵守：只读既有表，不加 model / 字段 / migration                                                                           |
| 2   | 出站先审批     | 不涉及：两个意图只读，无出站                                                                                              |
| 3   | 禁止第三套队列 | 不涉及：不加 cron / 队列                                                                                                  |
| 4   | 脱敏           | 触碰：新增决定 B（金额只给管理角色），写进 config.yaml 第 4 条；消息仍整段过既有脱敏器；互动摘要命中敏感模式整段替换    |
| 5   | 不爬登录页     | 不涉及                                                                                                                    |
| 6   | 邮箱分离       | 不涉及                                                                                                                    |
| 7   | 确定性优先     | 遵守：排序与理由是规则函数，无 LLM 调用；下一步建议只读 Revenue Spine 已写入的字段                                        |
| 8   | 测试注册       | 遵守：两个新测试注册进 `scripts/test-all.sh`，纯逻辑测试同时进 `scripts/test-ci-unit.sh`                                  |

## Risks / Trade-offs

- **商机数据稀疏** → 排序理由会偏少；用 `unverified` 列出缺失字段，并在 S2 用"问负责人"补事实，而不是猜。
- **平台角色与组织角色不一致**（例如平台 user + 组织 org_admin）→ 按 D1 取并集，管理权限以任一侧为准；如有误判，只影响读，不影响写。
- **500 条上限** → Pilot 组织的开放商机远少于此；超出时如实标记 `truncated`。

## 验证方式

- `npx tsx src/lib/muse-bridge/__tests__/sales-pure.test.ts`：范围矩阵、各条排序规则、平分顺序、未核实字段、金额可见性、停滞措辞、建议式格式上限、意图门。
- `npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts`：契约解析与意图总数 14。
- 本地隔离库（Docker `pgvector/pgvector:pg16`，`npm run db:migrate:deploy` 建表）：`DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/muse-bridge/__tests__/sales-db.isolated.test.ts`。
- `npm run typecheck`；`bash scripts/check-test-registry.sh`；`npx eslint src/lib/muse-bridge`。

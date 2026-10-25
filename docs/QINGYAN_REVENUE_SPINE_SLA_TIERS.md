# Revenue Spine 首响 SLA 分级提醒 · 工作时间 · SLA 指标

适用：任何使用 Revenue Spine（询盘 → 商机 → FDE 草稿 → 审批）的组织。本文只写通用机制与示例配置，不含任何企业的真实数据。

## 1. 策略字段（`revenue_spine.policy` → `salesSla`）

全部新字段默认 `null`，即**今天的行为原样不变**：旧的 inquiry-sla 线程提醒（5 分钟提醒外贸成员、24 小时升级管理员）照常，SLA 到期时间按 V1 口径（UTC 周一至周五、全天计时）。

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `newInquiryResponseHours` | number | 4 | 新询盘人工处理时限（工作小时）——既有字段，默认值不变 |
| `customerReplyResponseHours` | number | 8 | 客户来信后回复时限（工作小时）——既有字段，默认值不变 |
| `unclaimedAlertMinutes` | number \| null | null | 第一档：新询盘 T+N 分钟仍未回复 → 提醒**负责人**（站内 + 微信） |
| `ownerEscalationMinutes` | number \| null | null | 第二档：T+N 分钟仍未回复 → 升级**管理层**（站内 + 微信） |
| `overdueDraftHours` | number \| null | null | 第三档：T+N 小时仍未回复 → 告诉**管理层**回复草稿是否在审批中心等待，或者为什么没有草稿 |
| `businessHours` | object \| null | null | 工作时间（见下）；设了之后分级提醒按工作时间计时，新算出的 SLA 到期时间也按工作时间 |

`businessHours` 结构：

| 字段 | 规则 |
|---|---|
| `timezone` | 必填，合法的 IANA 时区（如 `Asia/Shanghai`、`America/Toronto`）；非法 → 整个 `businessHours` 视为无效、保留原值 |
| `start` | `"HH:MM"`，缺省 `"09:00"` |
| `end` | `"HH:MM"` 或 `"24:00"`，须晚于 `start`，缺省 `"18:00"`；不支持跨午夜班次 |
| `workdays` | ISO 星期 1..7（1 = 周一），去重排序，缺省 `[1,2,3,4,5]`；不能为空 |

校验规则（`mergeRevenueSpinePolicy`）：

- 三档任一非 `null` = 本组织**启用分级提醒**（只配一档也算启用；建议三档都配）。
- 分钟数取正整数、上限 7 天（10080 分钟）；`overdueDraftHours` 取正数（保留两位小数）、上限 168。
- 显式写 `null` = 关闭该项；负数、字符串、超上限等非法值 = **忽略，保留原值**。
- `PUT /api/revenue/policy` 存的是合并后的完整策略，再次合并不会丢这些字段（有单测保证）。

## 2. 示例配置

```json
{
  "salesSla": {
    "newInquiryResponseHours": 4,
    "customerReplyResponseHours": 8,
    "unclaimedAlertMinutes": 15,
    "ownerEscalationMinutes": 120,
    "overdueDraftHours": 24,
    "businessHours": {
      "timezone": "Asia/Shanghai",
      "start": "09:00",
      "end": "18:00",
      "workdays": [1, 2, 3, 4, 5]
    }
  }
}
```

发布方式（需企业负责人或管理员，人工执行）：

```http
PUT /api/revenue/policy
Content-Type: application/json

{ "policy": { "salesSla": { "unclaimedAlertMinutes": 15, "ownerEscalationMinutes": 120, "overdueDraftHours": 24,
  "businessHours": { "timezone": "Asia/Shanghai" } } } }
```

关闭：把三档都写成 `null`（`businessHours` 同理）。

## 3. 分级提醒（`src/lib/revenue-spine/sla-tiers.ts`）

**对象**：开放的新询盘 FDE 行动（`SalesAction.actionType = inbound_inquiry`，status `open` / `in_progress`），商机在开放阶段、客户未归档，且询盘之后还没有任何回复。
「回复」= 已执行的询盘回复草稿 / 外发互动（含外贸收件箱回复的镜像）/ 关联外贸线索的外发消息，任一即算。

| 档位 | 时刻 | 收件人 | 内容 |
|---|---|---|---|
| unclaimed | T + `unclaimedAlertMinutes` | 商机负责人（不在组织了则组织所有者） | 未回复提醒 + 商机链接；行动已被人认领（`status = in_progress`）则跳过这一档 |
| escalation | T + `ownerEscalationMinutes` | 管理层（组织所有者 / 管理员，或平台角色老板 / 经理 / 管理员） | 升级 + 负责人姓名 |
| overdue_draft | T + `overdueDraftHours` | 管理层 | 仍未回复；草稿在审批中心等了多久，或没有草稿的原因（AI 起草失败 / 未完成、不做的类目、护栏拦截、买家没留邮箱、草稿被拒或过期） |

- **绝不自动给买家发邮件**。PRD 里「T+24h 自动发送确认信」本轮不做：第三档只通知管理层；自动确认信需老板先发布模板，默认关闭，留待后续。
- 计时：设了 `businessHours` 按组织当地工作时段计（夏令时切换日按真实时刻），否则按自然时间。
- 微信：经 `pushNotification`（cron / serverless 中唯一能真正发出的通道）。没绑微信、在静默时段（推送服务按绑定的静默时段跳过）或通道失败时，站内通知照常、微信不补发。正文只有评分、国家、来源、公司名，不含买家邮箱 / 电话；审批一律回青砚看完草稿再批。
- 幂等：每档每条行动一个通知 `sourceKey`：`inquiry-sla:v2:<tier>:<orgId>:<actionId>`（第一位收件人用它占位，其余收件人再加 `:<userId>`）。先占位再推送；每档只发一次，负责人中途换人也不重发；与旧键 `inquiry-sla:5m:` / `inquiry-sla:24h:` 不相交。
- 不补发积压：档位到期后超过 24 小时还没发（cron 停摆、刚启用分级时的老询盘），不再补发。
- 不进分级：展会速记卡（`source = trade_show`，一晚录入几十张，由展会小结统一告知）、入驻测试询盘（`utm_source = qingyan_onboarding_test` / 测试买家标记 / 测试关闭原因）。

**与旧提醒的分工**（同一条询盘只有一个提醒来源）：

- 启用分级的组织：被分级跟踪的询盘，inquiry-sla 旧线程提醒跳过它关联的外贸线索；其它线程（没进 Revenue Spine 的渠道消息、回复后客户再来信等）旧提醒照常。分级跑失败的组织当次不跳过，旧提醒兜底。
- `cron/revenue-spine` 本来就不为 `reply_inquiry` 发提醒；`reply_customer` 需要已有外发，而有外发的询盘不在分级对象里，二者天然不重叠。
- 未启用分级的组织：逐位旧行为。

**频率**：`/api/cron/inquiry-sla` 改为每 5 分钟（`vercel.json` 与自动化登记表同步），15 分钟一档约在 15–20 分钟内发出。

## 4. 工作时间对 SLA 到期时间的影响

- `addBusinessHours` / `addBusinessDays` 新增可选 `calendar` 参数；不传或 `null` 与 V1 逐位一致（原有测试不改）。
- 新询盘的 `SalesAction.dueAt`（含收据补建行动）与商机下一步 `reply_inquiry` / `reply_customer` 的到期时间按组织工作时间计。
- 已落库的 `SalesAction.dueAt` 不重算。商机的下一步（`nextFollowupAt`）本来就由 `cron/revenue-spine` 每 15 分钟按当前策略重算（与调整 `newInquiryResponseHours` 时一样），所以设置工作时间后，开放商机的回复类到期时间会在下一次 cron 按新口径刷新。
- 跟进类（3 个工作日无回复等）仍按 V1 工作日口径。
- V1 起不含节假日表。

## 5. SLA 指标（M1 退出条件「SLA 指标可看」）

- 代码：`src/lib/revenue-spine/sla-metrics.ts`（纯函数 `computeSlaMetrics` + 查询 `loadSlaMetrics`）
- 接口：`GET /api/revenue/sla-metrics?days=30`（组织由服务端解析，`days` 1–180）
- 页面：「今日询盘」（`/revenue/today`）顶部「首响 SLA · 近 30 天」卡片

| 指标 | 口径 |
|---|---|
| 询盘数 | 窗口内进来的新询盘（每个新商机一条），不含展会速记卡与入驻测试询盘 |
| 首响中位 / P90 | 只算已回复的；设了工作时间按工作时间，否则自然时间；P90 用最近秩法 |
| 24 小时内回复率 | 自然时间 24 小时（买家视角）；分母只算已满 24 小时、且不是「关闭未回复」的询盘 |
| 未回复 | 至今没回复、行动仍开放 |
| 关闭未回复 | 没回复但行动已关闭（不合格 / 人工关闭），单列，不进 24 小时分母 |
| 护栏拦截 | 草稿因护栏（价格 / MOQ / 交期 / 认证 / 付款等承诺）没进审批中心：首封 + 无回复跟进 |
| 展会速记卡 | 同口径单独一组 |

护栏拦截的持久标记（无迁移，写在既有 JSON 字段）：

- 首封（Inbound FDE）：`SalesAction.inputContext.draftStatus`（`created` / `reused` / `guardrail_blocked` / `out_of_range` / `disqualified` / `no_email` / `cancelled` / `approval_failed`），拦截时另写 `guardrailBlockedAt` / `guardrailViolations`，之后重跑成功也保留。标记之前的旧数据退回读该次 FDE 的 `AgentRunEvent`（`decision = draft` 且 `guardrailViolations` 非空）。
- 无回复跟进：`AuditLog`（`action = revenue_spine.followup_draft.guardrail_blocked`，`afterData` 含该次跟进的 idempotencyKey），同一次跟进只记一次。

## 6. 秘书跟进阶梯去重

`src/lib/secretary/followup-engine.ts` 的四类扫描（到期跟进 / 无回复阶梯 / 回复未处理 / 谈判停滞）不再包含已链接 Revenue Spine 商机（`TradeProspect.convertedToSalesOpportunityId` 指向 canonical 阶段商机）的线索——它们的跟进由 Revenue Spine 负责。手动「转入销售 CRM」生成的旧阶段商机（如 `new_lead`）不在 Revenue Spine 跟进范围内，仍由秘书跟进。

## 7. 上线检查（人工）

1. 合并部署后确认 Vercel Cron 中 `/api/cron/inquiry-sla` 为 `*/5 * * * *`。
2. 需要分级的组织按第 2 节发布策略；不发布 = 旧行为。
3. 管理层与业务员确认已绑定微信、静默时段合理（静默时段内只有站内通知）。
4. 打开「今日询盘」确认顶部 SLA 卡片有数；入驻测试询盘不应计入。

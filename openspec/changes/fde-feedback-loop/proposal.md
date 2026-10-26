# Proposal: fde-feedback-loop

**TASKFLOW：** B-1（审批动作自动产反馈事件 + 草稿结构化 diff）。状态列在 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase B 表。本分支叠在 A-4（PR #247）之上。
**受影响的 Muse 意图：** `approve` / `reject`。它们走同一个审批端口终态入口，自动获得反馈事件；响应文本不变。

## Why

FDE 询盘回复草稿的批准、驳回、过期今天都不留任何学习信号：任务书审计 F1，`createHumanFeedbackEvent` 只有手工入口。所以 `practice-miner` 与 `preference-learner` 对 FDE 一直空转（F5）。B-1 把这些终态自动转成团队范围的反馈事件，并为将来的"改过再发"准备好结构化 diff。

## What Changes

- 新增询盘回复草稿的结构化 diff：
  - 把正文按段落分成问候 / 事实段 / 追问段 / 签名四类；
  - 比较两版正文，得出是否改过、改了哪几类段落、改动字数占比，并从新增的事实句里捕获数值与单位；
  - 结果只含结构信息与数字，不含正文。
- 询盘回复审批（首封回复与跟进草稿）创建成功时，写一条草稿快照审计日志，内容包括：
  - 主题、正文（截断 10k，与执行器一致）、护栏结果、引用的工厂事实、待内部确认项；
  - 正文与主题里买家的联系人名、公司名、电话号码，以及收件人以外的邮箱地址，替换为占位符。
- 询盘回复审批到达以下终态时，自动调用 `createHumanFeedbackEvent` 产生一条团队范围的反馈事件，按终态映射：
  - 批准并执行，或批准后执行失败 → `approved_as_is`；正文与快照不同时为 `approved_edited`；
  - 人工驳回 → `rejected`，驳回备注原样带入（同样做买家信息替换），没有备注则为空；
  - 过期 → `expired`。
- 反馈事件规则：
  - 只存引用（审批 id、商机 id、终态）与结构化 diff，不存正文；
  - 同一审批同一终态只产一条；
  - 写入失败不影响审批本身。
- 接入点：
  - 审批端口的批准 / 驳回：覆盖审批中心、Muse、微信确认、助手收件箱；
  - 过期扫描的赢家；
  - 既有 `approval-timeout` 定时任务里的补漏扫描：终态超过 10 分钟仍无事件的询盘回复审批。
- `createHumanFeedbackEvent` 增加两个可选参数：系统记录（驳回无原因时不报错）、外部给定的 diff 摘要。手工入口 `/api/agent-feedback` 的行为不变。
- 新增测试，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

**与任务书的偏差（GATE 审核时请逐条确认）：**
1. **【GATE 决策项】"改过再批"当前不会发生**：
   - 现状：询盘回复审批的载荷创建后不可改（`payloadVersion` 恒为 1，审批中心校验 `payloadHash`），批准接口只收"批准 / 驳回 + 备注"，执行器发送的就是载荷里的正文。所以 `approved_edited` 在现有代码里永远不会出现。
   - 任务书 F2 假设人在审批时改稿，实际的人工改稿发生在两处：驳回后自己写，或在 Trade 收件箱 / 邮箱里人工回复，这会以 `SUPERSEDED_BY_MANUAL_REPLY` 作废草稿。后者被任务书 B-1 的 Out of scope 排除。
   - 本 change 按任务书实现，diff 已就绪并测试，有了改稿来源即可产出 `approved_edited`。
   - **B-2（人工修改 → 商务事实）以 `approved_edited` 为触发，依赖这里的决定**，可选：
     - (a) 审批时允许改稿（改审批接口与执行器，任务书 B-1 写了不改）；
     - (b) 对"人工回复作废草稿"做草稿 vs 人工回复的 diff（任务书 B-1 写了不做）；
     - (c) 维持现状，B-2 暂缓。
2. **终态映射到既有字段**：
   - `HumanFeedbackEvent.humanDecision` 只有 accepted / edited / rejected / deferred / not_applicable。映射为：approved_as_is → accepted，approved_edited → edited，rejected → rejected，expired → deferred。
   - 任务书的四种 feedbackType 原样写在 `aiOutputRef.feedbackType`。
   - 任务书的 `employeeKey = inbound_sales_fde` 写入 `skillSlug`（有 `(orgId, skillSlug, createdAt)` 索引）。`scope = team` 对应 `feedbackScope = "team_candidate"`，这也是 `practice-miner` 读取的范围。
3. **过期事件的 userId**：
   - 表上 `userId` 必填，过期没有决策人，取审批指定的审批人，没有则取创建人（FDE 的负责人）。
   - 人工取消（"已取消"）与系统作废（新来信 / 人工已回复 / 入驻测试）不在任务书的四种终态里，不产事件。
4. **驳回原因**：审批中心的驳回备注就是 `PendingAction.failureReason`，原样带入 `reasonText`，只把买家信息换成占位符；`reasonCode` 不猜，留空。
5. **补漏扫描放在既有 `approval-timeout` 定时任务里**（每 2 小时），不新增 cron。三类写入时间上互不重叠，配合"先查后写"做到同一终态只产一条：
   - 批准 / 驳回：端口内的 CAS 赢家立即记；
   - 过期：定时任务的过期赢家记；
   - 补漏：只看终态超过 10 分钟的。

## Capabilities

### New Capabilities
- `revenue-spine/fde-draft-feedback`：询盘回复草稿的结构化 diff、创建时的草稿快照审计、终态反馈事件（映射、内容、幂等、接入点、补漏扫描）以及不含买家个人信息的约束。

### Modified Capabilities
（无。`createHumanFeedbackEvent` 只新增可选参数，手工入口行为不变，由测试锁定。）

## Impact

- 新文件：
  - `src/lib/revenue-spine/fde/draft-diff.ts`：纯函数，含段落分类、diff、数值捕获、买家信息替换；
  - `src/lib/revenue-spine/fde/draft-feedback.ts`：草稿快照、终态映射、记录器、补漏扫描，依赖可注入；
  - 2 个测试；
  - `docs/QINGYAN_ORG_COCKPIT_B-1_REPORT.md`。
- 改动：
  - `src/lib/employee-ai/feedback-service.ts`：新增两个可选参数；
  - `src/lib/revenue-spine/fde/inbound-sales.ts`、`no-reply-followup.ts`：审批创建成功后写快照，尽力而为，不影响原流程；
  - `src/lib/approval/port.ts`：批准 / 驳回的非重复分支与过期赢家调用记录器，尽力而为；
  - `src/app/api/cron/approval-timeout/route.ts`：追加补漏扫描；
  - 测试脚本各追加 2 条。
- 写入：只写既有表 `AuditLog` 与 `HumanFeedbackEvent`。不改 Prisma schema、不改 `vercel.json`、不加 LLM 调用、不改任何出站行为。

## Out of scope

- 不改审批 UI、不改审批接口参数、不改执行器的发送逻辑（偏差 1）。
- 不对 Trade 收件箱 / 邮箱里的人工回复做 diff（偏差 1 的 b 选项另行决定）。
- 不为人工取消与系统作废产反馈事件；不猜驳回原因代码。
- 不改 `preference-learner` / `practice-miner` 的学习规则；不做 B-2 的事实抽取。
- `/api/agent-feedback` 手工入口行为不变。

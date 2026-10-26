# Design

## Context

动机与偏差见 proposal.md，对外行为见 `specs/revenue-spine/fde-draft-feedback/spec.md`。

**询盘回复审批的创建点**（`INQUIRY_REPLY_ACTION_TYPE = "sales.send_inquiry_reply"`），两处都是 `requestApproval` 成功后拿到 `actionIds[0]`：
- `src/lib/revenue-spine/fde/inbound-sales.ts`：首封回复。复用未决草稿时不新建，`draftStatus = "reused"`。
- `src/lib/revenue-spine/fde/no-reply-followup.ts`：跟进第 N 次。

此时可用的数据：草稿 `subject` / `body` / `factsUsed` / `pendingInternalConfirmation` / `guardrailViolations`，客户 `name` / `contactName` / `email`。

**终态写入方：**
- 审批端口 `src/lib/approval/port.ts`：
  - `approveApprovalItem` → `executePendingAction`：claim 后为 approved，再变为 executed，或变为 failed（带决策人与执行错误）；pending 已过期时就地写"已过期"；
  - `rejectApprovalItem` → `rejectPendingAction`：rejected，决策人 + `failureReason` = 驳回备注。
  - 两者都有"已终态 → 幂等收敛"的重复分支，以及 B2 竞态重复分支。
- 调用审批端口的入口：
  - 审批中心（`capabilities/approvals/decision.ts`）；
  - Muse（`muse-bridge/router.ts`）；
  - 微信确认（`ai-grader/actions/wechat-confirm.ts`）；
  - 助手收件箱（`api/ai/pending-actions/[id]`）。
- 过期：`expireOverdueApprovals`（每 2 小时的 `approval-timeout` 定时任务），逐行 CAS，得到赢家列表。
- 系统作废：`pending-actions/supersede.ts`。
- 人工取消：`decision.ts` 的 cancel 分支。

**反馈服务**：`src/lib/employee-ai/feedback-service.ts` 的 `createHumanFeedbackEvent`：
- 校验：驳回必须有原因；
- 快照截断 4000；
- 只在 edited 时用 `buildStructuredDiff` 算 diff；
- 写 `HumanFeedbackEvent` 与审计；
- 有 `agentRunId` 时触发 autopilot 观察。驳回且有 `pendingActionId` 的不观察；`reconcile-human.ts` 同样跳过。

**下游读者：**
- `practice-miner` 读 `feedbackScope = "team_candidate"` 的 `humanDecision` / `diffSummary` / `taskType`；
- `preference-learner` 读当前用户的事件。

**执行正文**：`exec-sales-inquiry-reply.ts` 发送的是 `payload.body.trim().slice(0, 10_000)`。载荷创建后不可改，见 proposal 偏差 1。

## Goals / Non-Goals

**Goals:**
- 段落分类、diff、数值捕获、买家信息替换、终态映射、幂等键全部是纯函数，表驱动测试覆盖。
- 记录器依赖可注入，测试可覆盖装配与幂等，无需数据库。
- 记录永远是尽力而为：任何异常只记日志，不改变审批结果、接口响应与 FDE 流程。

**Non-Goals:**
- 不改以下模块：
  - `src/lib/pending-actions/executor.ts`、`exec-sales-inquiry-reply.ts`（发送逻辑）；
  - `src/lib/capabilities/approvals/decision.ts`、`src/lib/muse-bridge/router.ts`、`src/lib/ai-grader/actions/wechat-confirm.ts`、`src/app/api/ai/pending-actions/[id]/route.ts`（各入口经端口覆盖）；
  - `src/app/api/agent-feedback/route.ts`；
  - `src/lib/employee-ai/{preference-learner,practice-miner,diff}.ts`。
- 不改 `prisma/schema.prisma`、`vercel.json`、审批 UI。

## Decisions

### D1 diff 放在 FDE 侧的新模块，复用 `buildStructuredDiff` 的基础字段
- **选择**：`revenue-spine/fde/draft-diff.ts`。
  - 两版正文先按执行器规则归一（`trim` + 截断 10k）。
  - 基础字段（changed / lengthDelta / shortenedPct / notes）用 `employee-ai/diff.ts` 的 `buildStructuredDiff` 算。
  - 在其上扩展三项：`sections`（改动段落类型）、`changedRatio`、`capturedNumbers`。
  - 输出类型为 `StructuredDiff & {...}`，既有读者按 `StructuredDiff` 读不受影响。
- **否决：改 `employee-ai/diff.ts` 的通用 diff**：通用 diff 还服务手工反馈入口；段落分类是询盘回复模板专属，放进通用模块会改变手工入口的 diff 结果。

### D2 段落分类按模板结构查规则，不用 LLM
- **选择**：先按空行切段，再依次判定：
  1. **签名**：命中结束语（Best regards / Kind regards / Regards / Sincerely / Thanks / 此致 / 祝好 / 谢谢 等）的段及其后所有段；
  2. **问候**：首段且短（≤ 2 行），以称呼开头（Hi / Hello / Dear / 您好 / 你好 / 尊敬的，或以"，您好："结尾）；
  3. **追问段**：任一行以问号结尾，或为编号 / 圆点列表且所在段或前一段含提问引导语（could you / please confirm / 请问 / 请确认 / 请告知）；
  4. **事实段**：其余。

  改动判定在行级做：两版各自归一化（去首尾空白、合并空白）。
  - 只出现在一边的行算"改动行"，按所在段落类型归类。
  - `changedRatio` = 改动行字数 / 两版总字数。
  - 数值捕获只看新正文里事实段的新增行，规则为"数字（可带千分位、小数）+ 可选单位"，单位来自固定词表（pcs / pieces / units / sets / days / weeks / months / kg / g / gsm / cm / mm / m / % / 天 / 周 / 个月 / 件 / 套 / 个 / 米 / 克），并识别 "per color / 每色" 这类修饰。
- **否决：逐字符 Levenshtein**：成本高，输出也不比行级更有用；任务书要的是段落类型与占比。

### D3 买家信息替换（快照与驳回原因共用）
- **选择**：纯函数 `maskBuyerPii(text, { names, recipientEmail })`，规则如下：
  - **姓名**：买家联系人名与公司名（来自商机客户），按长度降序、忽略大小写、按词边界匹配，替换为 `{{buyer_contact}}` / `{{buyer_company}}`；
  - **电话**：7 位以上数字（含空格、括号、横线、加号的电话串）替换为 `{{phone}}`；
  - **邮箱**：收件人以外的邮箱替换为 `{{email}}`，收件人邮箱保留，这是任务书允许的唯一一项。
- **否决：直接用 `autopilot/sanitize.ts` 的 `toContentRef` 只存哈希**：任务书要求快照保留正文供将来 diff 与审计。我们沿用 sanitize.ts 的口径（不无脑存业务正文），所以替换买家标识、不存哈希以外的买家信息。

### D4 终态映射是纯函数，记录器先查后写
- **选择**：
  - `feedbackForTerminal(row)` 按状态与失败原因判定：
    - executed / approved → approved_as_is；
    - failed 且有决策人，失败原因不是"已取消"、不是批量准备失败、也不是作废码 → approved_as_is（执行失败不影响对草稿的判断）；
    - rejected 且不以"关联任务已取消"开头 → rejected；
    - failed 且为"已过期" → expired；
    - 其余 → 不记。
  - `approved_as_is` 再与快照比对，正文不同即为 `approved_edited`。快照取不到时按 approved_as_is 记，并在 diff 里标"无快照"。
  - 记录器 `recordInquiryReplyFeedback(actionId, deps)` 的流程：
    1. 取审批行；
    2. 只处理询盘回复类型；
    3. 映射终态；
    4. 查同键事件是否已存在（`pendingActionId` + `aiOutputRef.feedbackType`）；
    5. 取快照；
    6. 算 diff；
    7. 调 `createHumanFeedbackEvent`。
- **否决：数据库唯一约束做幂等**：零 schema。改为三类写入时间互不重叠，加上先查后写（D6）。

### D5 `createHumanFeedbackEvent` 加两个可选参数
- **选择**：`systemRecorded?: boolean` 与 `diffSummary?: object`。
  - `systemRecorded` 为真时跳过"驳回必须有原因"。理由：原因来自审批备注原样带入，任务书要求没有就为空，不猜。
  - 给了 `diffSummary` 就直接写入，不再按 edited 计算。
  - 两者缺省时行为与现在逐字相同，测试锁定手工入口仍需原因。
  - 不传 `aiOutputSnapshot` 与 `humanEditedOutput`，所以服务不存正文；也就不会因 edited 去调 autopilot 编辑观察（现阶段不会出现 edited）。
- **否决：在 FDE 侧直接写 `db.humanFeedbackEvent.create`**：会绕过反馈服务的审计与下游观察钩子，任务书也要求"自动调用 createHumanFeedbackEvent"。

### D6 三个接入点 + 既有定时任务里的补漏
- **选择**：
  - **端口批准 / 驳回**：在非重复分支、`executePendingAction` / `rejectPendingAction` 返回之后调用 `recordInquiryReplyFeedbackSafe(id)`。它是尽力而为的包装，所有异常吞掉并打日志。只在操作确实改变了状态时调用：返回 B2 重复码时不调用，已终态的幂等分支不调用。
  - **过期赢家**：`expireOverdueApprovals` 对 `expiredWinners` 逐个调用。
  - **补漏**：`approval-timeout` 路由在过期之后调用 `sweepInquiryReplyFeedback(now)`。范围是近 7 天、终态已超过 10 分钟的询盘回复审批，最多 200 条；已有事件的跳过（批量查已有事件）。lazy 过期（批准时发现已过期）由补漏记。
  - 三者在时间上不重叠：端口在操作当时；过期在定时任务内且只处理本轮赢家；补漏只看 10 分钟前完成的终态。再加上先查后写，同一终态只产一条。
- **否决：只靠补漏**：反馈要等最多 2 小时才出现，审批中心与 Muse 的即时性差。
- **否决：在每个入口文件里各自调用**：入口有四个以上，都经端口，挂在端口一处即可覆盖。

### D7 快照写在两处创建点，内容先替换再截断
- **选择**：
  - 在 `inbound-sales.ts` 与 `no-reply-followup.ts` 的 `approval.ok` 且非复用分支里调用 `recordInquiryDraftSnapshotSafe`（尽力而为），内容见 spec。
  - 审计 `targetType = "pending_action"`、`targetId` 为审批 id，记录器据此取快照。
  - 正文与主题先做买家信息替换，再归一（`trim` + 截断 10k）。
  - 比对时执行正文也做同样的替换和归一，所以替换本身不会造成"改过"的误判。
- **否决：放进 `approval/request.ts` 统一钩**：通用请求层不知道哪些是买家信息，也拿不到护栏结果与引用事实。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守：只写既有 `AuditLog`、`HumanFeedbackEvent`；幂等不靠新约束 |
| 2 | 出站先审批 | 遵守：不改任何出站路径；只在审批结局之后写学习数据 |
| 3 | 禁止第三套队列 | 遵守：补漏扫描挂在既有 `approval-timeout` 定时任务内，不新增 cron / 队列 / worker |
| 4 | 脱敏 | **触碰**：快照与驳回原因都做买家信息替换，只保留收件人邮箱；反馈事件只含引用与结构化 diff，不含正文、主题与任何买家信息；测试断言 |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及（不读不改发件设置） |
| 7 | 确定性优先 | 遵守：段落分类、diff、数值捕获、终态映射全部规则化，零 LLM；偏好记忆里不存金额（diff 只捕获数量 / 周期类数值，单位表不含货币） |
| 8 | 测试注册 | **触碰**：`src/lib/revenue-spine/fde/__tests__/{draft-diff,draft-feedback}.test.ts` 在各自 task 内注册进 test-all 与 test-ci-unit |

## Risks / Trade-offs

- [`approved_edited` 现阶段永远不出现] → proposal 偏差 1 列为 GATE 决策项。diff 已就绪，接入改稿来源后自动生效。
- [段落分类是启发式，英文 / 中文模板之外的手写邮件可能分错] → 规则只服务 FDE 模板生成的正文。分不准时落到"事实段"，不影响是否改过与占比。
- [端口钩子在请求链路上多一次查询与写入] → 只对询盘回复类型生效。尽力而为、异常吞掉。端口返回值在钩子之前就已确定。
- [先查后写有极小竞态] → 三类写入时间互不重叠。补漏只看 10 分钟前完成的终态。
- [过期事件的 userId 取审批人] → 表上 `userId` 必填。审批人正是"没处理"的人，作为个人偏好样本也合理；`preference-learner` 只看 diff 信号，过期没有 diff。

## 验证方式

- `npx tsx src/lib/revenue-spine/fde/__tests__/draft-diff.test.ts`：
  - 段落分类（中英模板、跟进模板）；
  - 全文照发、改签名、加 MOQ 并捕获数值、改追问、缩短正文；
  - 不含正文；
  - 买家信息替换（姓名大小写 / 词边界、电话、非收件人邮箱，保留收件人）。
- `npx tsx src/lib/revenue-spine/fde/__tests__/draft-feedback.test.ts`：
  - 终态映射表；
  - 记录器（照发、过期 userId、无备注驳回、有备注替换、幂等、无快照）；
  - 系统作废与取消不记；
  - 事件不含个人信息；
  - 手工入口仍需原因（直接调反馈服务，校验先于数据库）；
  - 补漏扫描的查询条件；
  - 源码静态断言：端口三处接入在非重复分支且包在异常保护里，两处创建点非复用分支写快照，`approval-timeout` 调补漏，`vercel.json` 无改动。
- 全量门禁：
  - `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`；
  - `npm test` 与基线比对；
  - `git diff --stat origin/main -- prisma/ vercel.json` 为空；
  - `openspec validate fde-feedback-loop --strict`。

## Migration Plan

无数据迁移。上线后新产生的终态开始产事件；补漏扫描只看近 7 天，不回填更早的历史。回滚 = revert 该 PR；已写入的事件是普通学习样本，可保留。

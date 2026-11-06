# Spec Delta

## Purpose

在青砚项目页发起招标询价轮次：发起前的前置判断、生成并送审、原地审批、发出后的状态展示，以及旧的单封直发入口下线。询价内容的生成、审批、发送、回信入表与催单沿用既有询价引擎，本能力只规定 Web 入口的对外行为。

## ADDED Requirements

### Requirement: 发起前的入口状态
`GET /api/projects/{id}/tender-rfq/entry` SHALL 在不创建任何询价轮次、询价项或审批卡的前提下返回 `state: { enabled, reason, message, action?, warnings }`，并按以下优先级给出第一个命中的不可发原因：`pending_approval`（已有待批的询价发送卡）、`recently_sent`（轮次锁期内已发出）、`no_confirmed_requirements`、`sensitive_leak`、`sender_not_connected`（授权邮箱未连接 Gmail）、`sender_no_compose_scope`。

#### Scenario: 不可发原因按优先级判定
- **WHEN** 项目同时存在待批发送卡且授权邮箱未连接
- **THEN** `state.enabled` 为 false、`reason` 为 `pending_approval`；`npx tsx src/lib/tender-rfq/__tests__/web-entry-pure.test.ts` 覆盖六种原因的优先级与可发态

#### Scenario: 查询不产生副作用
- **WHEN** 连续调用两次 entry
- **THEN** 项目的询价轮次数与审批卡数不变（实现只做读与内存中的 RFQ 预构建）

### Requirement: 入口说明文字与出路
每个不可发原因 SHALL 带一句中文说明与一个可点击的出路（`action: { label, href }`，待批发送卡指向该审批卡），说明文字 SHALL NOT 含错误码或英文枢纽词。可发时 `message` SHALL 写明发件地址、已确认要求条数与回复截止日。授权邮箱缺读信权限 SHALL 作为不阻断的提醒放进 `warnings`，说明「回信不会自动进表」。

#### Scenario: 可发态说明
- **WHEN** 发件地址 project@sunnyshutter.ca、已确认要求 12 条、回复截止 2026-11-13
- **THEN** `message` 为「将从 project@sunnyshutter.ca 发出 · 已确认要求 12 条 · 回复截止 11-13」；同一测试覆盖

#### Scenario: 只缺读信权限仍可发
- **WHEN** 授权邮箱有发信权限、没有读信权限，其余条件满足
- **THEN** `state.enabled` 为 true，`warnings` 含「回信不会自动进表」；同一测试覆盖

### Requirement: 可选供应商与默认条款
entry SHALL 返回本组织 active 供应商与操作者常用供应商的并集，每家标明 `ready`（有有效邮箱且 active）与不可选原因（`no_email` / `inactive`），操作者常用供应商 SHALL 标 `isDefault: true` 并排在前面；SHALL 返回默认贸易条款及其是否来自个人偏好。

#### Scenario: 常用供应商默认勾选、没邮箱的不可选
- **WHEN** 操作者常用供应商里有一家没有联系邮箱
- **THEN** 该供应商 `isDefault: true`、`ready: false`、`blockedReason: "no_email"`，前端灰显并给出「补邮箱」链接到该供应商页

### Requirement: 生成并送审
`POST /api/projects/{id}/tender-rfq/rounds` SHALL 要求项目写权限，用 zod 校验请求体（`supplierIds` 1–8 个、`extraQuestions` ≤ 5 条、`incoterm` 限 EXW/FOB/CIF/DDP/DAP），校验失败返回 400 与中文说明。通过后 SHALL 以 `source: "web"` 调用与 Muse `rfq` 意图相同的询价生成流程（轮次锁、供应商就绪、只发已确认要求、敏感内容整单拦截），成功时创建且只创建一张 `tender.send_rfq` 审批卡，响应 SHALL 含轮次号、每家收件人、回复截止与 `approval: { approvalId, canApprove, payloadHash }`（`canApprove` 与审批中心对同一张卡的判定一致）。批准前系统 SHALL NOT 发出任何邮件。失败时响应 SHALL 含 `userMessage: { message, action? }`。

#### Scenario: 成功送审、零出站
- **WHEN** 选 3 家有邮箱的供应商提交
- **THEN** 返回 200 与 3 个收件人、一张待批 `tender.send_rfq`；询价项状态全部为 `pending`，没有发出邮件

#### Scenario: 错误码转成人话
- **WHEN** `prepareRfqRound` 返回 `ROUND_LOCKED` / `NO_CONFIRMED_REQUIREMENTS` / `SENSITIVE_LEAK` / `SUPPLIERS_NOT_READY` / `NO_SUPPLIERS` / `PROJECT_NOT_FOUND` / `DRAFT_FAILED`
- **THEN** `userMessage.message` 为对应中文说明（不含错误码），能给出路的附 `action`；`web-entry-pure.test.ts` 逐码覆盖

### Requirement: 原地审批与待批轮次保护
对 `canApprove` 为 true 的用户，送审结果页与待批轮次卡片 SHALL 提供「批准并发送」与「驳回」，并调用既有 `POST /api/capabilities/approvals/{approvalId}/approve|reject`（带 `idempotencyKey` 与 `expectedPayloadHash`），不跳转页面；批准响应里的发送结果 SHALL 原样展示。`canApprove` 为 false 时 SHALL 显示「需要有审批权限的同事批准」与审批中心链接，SHALL NOT 声称已通知任何人。一个轮次有待批发送卡时，该轮 SHALL NOT 显示「标记发送」与「开始询价」。

#### Scenario: 创建人原地批准
- **WHEN** 创建人（审批中心对该卡 `canApprove` 为 true）点「批准并发送」
- **THEN** 前端调用既有 approve 接口，展示「已发出 N/N：…」，刷新后该轮状态为进行中、各家为已发送

#### Scenario: 待批轮次不能手工标记发送
- **WHEN** 某轮有待批 `tender.send_rfq`
- **THEN** 该轮询价明细里没有「标记发送」「开始询价」按钮，只显示审批面板

### Requirement: 发出后的轮次状态
由询价引擎发出的轮次（任一询价项记有邮件线程）SHALL 在卡片上显示状态行：已发出家数、已报价 / 已回复 / 未响应家数、等回复家数与回复截止日；SHALL 显示「回信每 10 分钟自动检查并进表；{N} 天没回会自动起草催单给你批」，其中 N 与催单引擎使用的天数一致；授权邮箱缺读信权限时 SHALL 改为说明回信不会自动进表并给出重新授权链接。有对应已执行发送卡的轮次 SHALL 显示「从发起到发出：x 分 x 秒」（取审批卡创建与执行时间）。

#### Scenario: 状态行与耗时
- **WHEN** 一轮 3 家已发出、1 家已报价、回复截止 2026-11-13，审批卡创建到执行 252 秒，催单天数 3
- **THEN** 显示「已发出 3 家 · 已报价 1 · 等回复 2（截止 11-13）」「从发起到发出：4 分 12 秒」与「3 天没回会自动起草催单给你批」；`web-entry-pure.test.ts` 覆盖文案与耗时边界（< 1 分钟、≥ 1 小时）

### Requirement: 预览不含敏感商务数字
entry 与 rounds 的响应、抽屉与结果页 SHALL NOT 包含毛利率、项目估值（`estimatedValue`）、我方报价（`ourBidPrice` / `winningBidPrice`）；预览只含发件抬头与地址、回复截止、要求条数、供应商名称与收件邮箱、询价正文（正文已由询价生成器做敏感内容整单拦截）。

#### Scenario: 预览字段白名单
- **WHEN** 读取 entry 响应
- **THEN** 响应对象中不存在 `estimatedValue`、`ourBidPrice`、`winningBidPrice`、`margin` 字段（实现按白名单组装）

### Requirement: 单封直发下线
`POST /api/projects/{id}/inquiries/{inquiryId}/items/{itemId}/email/send` 与 `…/email/generate` SHALL 返回 410 与「单封直发已下线，请用项目页『问供应商要价』」，SHALL NOT 发送邮件、SHALL NOT 调用 LLM、SHALL NOT 写 `ProjectEmail`。询价明细 SHALL NOT 再显示「生成邮件」按钮；首页 AI 建议「批量催促供应商」SHALL 跳转到该项目的「标书与报价」tab。

#### Scenario: 旧接口返回 410
- **WHEN** 对 `email/send` 或 `email/generate` 发 POST
- **THEN** 返回 410 与上述中文说明；无邮件、无 LLM 调用、无数据写入

### Requirement: Muse 旁路行为不变
Muse `rfq` 意图 SHALL 继续可用且响应结构不变；它与 Web 入口共用同一询价生成流程，审批卡 `source.toolName` SHALL 区分来源（Web 为 `tender_send_rfq_web`，Muse 为 `tender_send_rfq`）。

#### Scenario: Muse 纯逻辑测试不回归
- **WHEN** 运行 `npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts`
- **THEN** 全部通过

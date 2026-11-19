## MODIFIED Requirements

### Requirement: 发起前的入口状态
`GET /api/projects/{id}/tender-rfq/entry` SHALL 在不创建任何询价轮次、询价项或审批卡的前提下返回 `state: { enabled, reason, message, action?, warnings }`，并按以下优先级给出第一个命中的不可发原因：`pending_approval`（已有待批的询价发送卡）、`recently_sent`（轮次锁期内已发出）、`no_confirmed_requirements`、`sensitive_leak`、`identity_leak`（询价内容含招标身份信息，见 `tender/supplier-identity-guard`）、`sender_not_connected`（授权邮箱未连接 Gmail）、`sender_no_compose_scope`、`no_ready_suppliers`（没有一家在用且有联系邮箱的供应商）。

#### Scenario: 不可发原因按优先级判定
- **WHEN** 项目同时存在待批发送卡且授权邮箱未连接
- **THEN** `state.enabled` 为 false、`reason` 为 `pending_approval`；`npx tsx src/lib/tender-rfq/__tests__/web-entry-pure.test.ts` 覆盖八种原因的优先级与可发态

#### Scenario: 身份信息排在内部敏感词之后
- **WHEN** 询价内容同时含内部敏感词与采购方名称，且授权邮箱未连接
- **THEN** `reason` 为 `sensitive_leak`；去掉内部敏感词后 `reason` 为 `identity_leak`（同一测试）

#### Scenario: 查询不产生副作用
- **WHEN** 连续调用两次 entry
- **THEN** 项目的询价轮次数与审批卡数不变（实现只做读与内存中的 RFQ 预构建）

### Requirement: 生成并送审
`POST /api/projects/{id}/tender-rfq/rounds` SHALL 要求项目写权限，用 zod 校验请求体（`supplierIds` 1–8 个、`extraQuestions` ≤ 5 条、`incoterm` 限 EXW/FOB/CIF/DDP/DAP），校验失败返回 400 与中文说明。通过后 SHALL 以 `source: "web"` 调用与 Muse `rfq` 意图相同的询价生成流程（轮次锁、供应商就绪、只发已确认要求、敏感内容整单拦截、招标身份信息整单拦截），成功时创建且只创建一张 `tender.send_rfq` 审批卡，响应 SHALL 含轮次号、每家收件人、回复截止与 `approval: { approvalId, canApprove, payloadHash }`（`canApprove` 与审批中心对同一张卡的判定一致）。批准前系统 SHALL NOT 发出任何邮件。失败时响应 SHALL 含 `userMessage: { message, action? }`。

#### Scenario: 成功送审、零出站
- **WHEN** 选 3 家有邮箱的供应商提交
- **THEN** 返回 200 与 3 个收件人、一张待批 `tender.send_rfq`；询价项状态全部为 `pending`，没有发出邮件

#### Scenario: 审批卡没建成不留孤儿轮次
- **WHEN** 询价轮次已建、创建审批卡失败（`DRAFT_FAILED`）
- **THEN** 该轮次被标为已取消，用户重试时不会看到一轮无法发送的草稿

#### Scenario: 错误码转成人话
- **WHEN** `prepareRfqRound` 返回 `ROUND_LOCKED` / `NO_CONFIRMED_REQUIREMENTS` / `SENSITIVE_LEAK` / `IDENTITY_LEAK` / `SUPPLIERS_NOT_READY` / `NO_SUPPLIERS` / `PROJECT_NOT_FOUND` / `DRAFT_FAILED`
- **THEN** `userMessage.message` 为对应中文说明（不含错误码），能给出路的附 `action`；`web-entry-pure.test.ts` 逐码覆盖

#### Scenario: 招标身份信息整单拦截
- **WHEN** 一条已确认要求含采购方名称，选 3 家有邮箱的供应商提交
- **THEN** 返回 422、`errorCode` 为 `IDENTITY_LEAK`；不建轮次、不建审批卡、没有发出邮件（`npx tsx src/lib/tender-rfq/__tests__/supplier-identity-guard-db.isolated.test.ts`）

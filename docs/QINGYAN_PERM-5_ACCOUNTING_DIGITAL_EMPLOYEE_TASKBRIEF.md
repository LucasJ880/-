# PERM-5 任务书：会计视图 + 数字员工岗位绑定与工具授权

| 项 | 值 |
|---|---|
| 编号 | PERM-5a（会计视图）、PERM-5b（数字员工按岗位授权） |
| 设计稿 | `docs/QINGYAN_PERMISSION_REDESIGN_DESIGN.md` §3（`accounting` 行）、§4 第 8、10 条、§5 冲突 C8、C9 |
| 依赖 | 5a 依赖 PERM-4a（报价金额口径稳定）与 PERM-4c（`project.finance.*` 键）；5b 依赖 PERM-1（绑定表与模板已在）可独立先做 |
| 执行者 | Claude Code（两个 change：`perm-5a-accounting-view`、`perm-5b-digital-employee-positions`） |
| 审核 | Claude（chat）；Lucas 拍板 |
| 纪律 | 零 schema；数字员工对外动作一律 `requestApproval`；脱敏（会计视图不含客户联系方式以外的个人资料）；确定性优先；新测试注册 |

---

## 0. 先读

**会计（5a）**
- `src/app/api/sales/commission-summary/route.ts` —— 现有"本人本月提成"口径：真实毛利 = Σ(price − costPrice)，提成 = 毛利 × `commissionRate`（折扣设置里，默认 30%），只统计 `createdById = 本人`、`status = signed`、按 `signedAt` 落月；无成本快照的行计入 uncosted 如实展示
- `src/app/(main)/sales/performance/page.tsx` —— 业绩页（本人）
- `src/lib/blinds/discount-settings.ts` `loadDiscountsDto`（commissionRate）
- `prisma/schema.prisma` `SalesQuote`（grandTotal / status / signedAt / createdById / promotionApprovalStatus）、`SalesQuoteItem`（price / costPrice / product）
- `src/lib/project-finance/access.ts` `requireCostAccess`（owner / super_admin / org_admin 特权，其余按项目角色）；`src/app/api/projects/[id]/finance/{summary,revenue,expenses,budget,payables}`
- `src/lib/authorization/role-defaults.ts` `accounting` 岗位现有绑定：`accounting.read`、`sales.quote.read`（ORG）、INSTALL-1 的 assign / read / photo.read；`permissions.ts` `accounting.read`（HIGH）
- `openspec/specs/sales/discount-tiering/spec.md`、`sales/quote-settings-approval/spec.md` —— 审批留痕字段（会计要能看）

**数字员工（5b）**
- `src/lib/authorization/resolve-principal.ts` —— `DIGITAL_EMPLOYEE` 返回 `NOT_IMPLEMENTED`（fail-closed）；`resolve-effective-permissions.ts` 第 62 行 `principal.type !== "HUMAN"` 直接空
- `prisma/schema.prisma` `PrincipalRoleBinding.principalType`（已支持非 HUMAN 值，无需改列）；`Agent`（数字员工复用 Agent，`type` / `status`）
- `src/lib/agent-core/skills/digital-employee-roles.ts` `DIGITAL_EMPLOYEE_ROLES`（sales / marketing-growth / tender / analytics 四类）
- `src/lib/digital-employees/activation.ts`（env 开关与 allowlist）
- `src/lib/tenancy/tool-auth.ts` `canInvokeTool`（按 orgRole / workspaceRole / `tool.allowRoles` / 风险等级决定 allowed / requiresApproval）；调用点 `src/lib/agent-runtime-v2/executor.ts`、`src/lib/workforce-runtime/resume-freshness.ts`、`src/lib/assistant/followup-task.ts`、`src/lib/runtime-architecture/risk.ts`
- `src/lib/approval/port.ts` `requestApproval`；`src/lib/audit/logger.ts` `AuditLogParams.correlation`（AI 执行关联）
- `scripts/bind-positions.ts` / `src/lib/authorization/position-binding.ts`（PERM-1 绑定脚本，可扩 principalType）

---

## PERM-5a：会计视图

### Why
设计稿 §4-8：会计看成交金额、提成、报价全过程；招投标中会计只是参与方、知道价格即可；项目单独结算、与销售分开。现在提成与业绩只有"本人本月"口径，Miki 作为会计看不到全员，项目财务又按 org_admin 特权。

### What
1. **全员成交 / 提成接口** `GET /api/accounting/sales-summary?month=YYYY-MM`：`authorize(accounting.read)`（ORG）→ 按销售人员分组：签约单数、成交金额（grandTotal 合计）、真实毛利、提成（毛利 × commissionRate）、成本覆盖率（uncosted 如实）；口径与 `commission-summary` 共用一个纯函数 `summarizeCommission(quotes, rate)`（把现有内联计算抽出来，两处共用，避免两套口径）。不含客户联系方式、不含 costPrice 明细。
2. **报价过程只读** `GET /api/accounting/quotes?month&salesId&status`：`accounting.read` + `sales.quote.read`（ORG）→ 列表含折扣档位、超限审批状态与审批人 / 时间（来自 AuditLog `quote_promotion_approved` 与 PendingAction），点进报价详情走现有 `sales.quote.read`。
3. **项目结算只读**：`project.finance.read`（PERM-4c 新键）绑给 `accounting`（ORG）与 `bids`（只对本人参与项目）；`requireCostAccess` 的只读分支接受该权限；汇总接口 `GET /api/accounting/projects?quarter` 列项目收入 / 费用 / 应付 / 结余（复用 finance/summary 的计算）。**不与销售成交混算**（两个页签，两个接口）。
4. **页面** `/accounting`（管理层与 `accounting` 可进）：三个页签 —— 成交与提成（按人 / 按月，可导出 CSV）、报价过程、项目结算；入口 `requiredPermissions: ["accounting.read"]`；工作区 `accounting`（`workspace-policy` 新增，默认落地仅当不持销售 / 运营 / 招投标）。
5. 审计：导出 CSV 写 AuditLog `accounting.export`。

### 受影响意图
- Miki 能看全员成交与提成、每张报价的折扣与审批轨迹、每个项目的结算；不能改任何一项。
- Alex / Lynn 的业绩页不变（仍只看本人）。
- 招投标参与者看项目金额，看不到销售成交。

### Out of scope
- 提成规则本身（按人差异化、阶梯）不改；不做工资 / 发放；不做会计凭证。

### 验收
- `summarizeCommission` 纯函数测试（与现有 commission-summary 行为逐项等价 + 分组 + uncosted）。
- 路由契约：`sales_rep` 调 `/api/accounting/*` 403；`accounting` 200 且响应不含 `costPrice`、客户电话以外个人资料；`bids` 只拿到参与项目。
- `openspec validate perm-5a-accounting-view --strict`；specs 增量覆盖：会计可见范围、项目结算与销售分离、导出审计。

---

## PERM-5b：数字员工岗位绑定与工具授权

### Why
设计稿 §4-10：助手模式权限 = 操作者；数字员工是独立主体，绑定岗位（销售数字员工→`sales_rep`、营销→`ops_staff`、投标→`bids`、数据分析→`accounting` 只读），永不审批、不改设置、不给折扣，对外动作必须由该岗位的人审批，审计标"数字员工 X 代 岗位 Y"。现状 C8：非 HUMAN 主体 fail-closed，数字员工拿不到任何 `authorize` 权限；C9：工具授权按企业角色 / 工作区角色，与岗位无关。

### What
1. **主体解析**：`resolvePrincipalRef({ type: "DIGITAL_EMPLOYEE", id: agentId, orgId, sponsorUserId })` → ok；`resolveEffectiveBindings` 对 DIGITAL_EMPLOYEE 读 `PrincipalRoleBinding(principalType = "DIGITAL_EMPLOYEE", principalId = agentId)`，**无兼容回退**（无绑定 = 无权限）。
2. **硬禁区（纯函数 `DIGITAL_EMPLOYEE_DENY`）**：在 `decideFromBindings` 前对非 HUMAN 主体强制 DENY：`*.approve`、`sales.settings.manage`、`sales.quote.discount.*`、`identity.*`、`install.task.assign`、`orders.cancel`、`inventory.manage`、`operations.manage`；`permissions.ts` 已有 `allowedPrincipalTypes` 的键（如 `identity.position.manage` 仅 HUMAN）照旧。禁区列表进 registry 元数据而不是散落判断。
3. **岗位映射**：`DIGITAL_EMPLOYEE_ROLES[].positionKey`：sales → `sales_rep`（PRINCIPAL 范围落在 sponsorUserId 名下的客户 / 报价 —— `resource.ownerId = sponsorUserId` 判定，见判断点 1）、marketing-growth → `ops_staff`、tender → `bids`、analytics → `accounting`；`scripts/bind-positions.ts` 增加 `--principal-type DIGITAL_EMPLOYEE`，配置 `config/positions/sunny-digital-employees.json`（agentId → positionKey）。
4. **对外动作必审**：任何 `outbound`（邮件 / 微信 / 发布 / 报价分享）由数字员工发起 → `requestApproval`，审批人 = 持该岗位对应人类权限者（`listUsersWithPermission`），数字员工自己永不是审批人；`AuditLog.afterData._runtimeCorrelation` 加 `{ actorKind: "digital_employee", agentId, positionKey, sponsorUserId }`，审计中心展示"数字员工 X 代 岗位 Y"。
5. **工具授权 C9**：`canInvokeTool` 新增输入 `principal`（HUMAN / DIGITAL_EMPLOYEE + permissionKeys）；`ToolDefinition` 新增可选 `requiredPermission`；有则以 `authorize` 结果为准，`allowRoles` 只作无 `requiredPermission` 的工具的过渡回退；风险等级 ≥ medium 对数字员工一律 `requiresApproval`。
6. **助手模式不变**：主助手 / 项目问青砚以操作者为主体（HUMAN），加一条契约测试锁住"助手权限 = 操作者"。

### 受影响意图
- 数字员工只能在绑定岗位范围内读写；没绑定的数字员工一切 403。
- 数字员工代发邮件 / 微信 / 发布全部进审批中心，由对应岗位的人批；审计可区分人与数字员工。
- 人类用户路径不变。

### Out of scope
- 数字员工的技能包 / 调度 / 预算（workforce-runtime）；新建员工表；外贸模块工具。

### 验收
- `authorize.test.ts`：DIGITAL_EMPLOYEE 有绑定 → 按岗位；无绑定 → 拒绝；禁区键即使绑定也 DENY；HUMAN 不受禁区影响。
- tool-auth 测试：`requiredPermission` 命中 / 未命中；数字员工 medium 风险必审；`allowRoles` 回退仅在无 `requiredPermission` 时生效。
- 执行器：数字员工发起的 outbound 类型，审批人集合不含任何 agentId。
- `grep -rn "principal.type !== \"HUMAN\"" src/lib/authorization` 只剩禁区实现处。
- `openspec validate perm-5b-digital-employee-positions --strict`；specs 增量覆盖：数字员工主体解析、禁区、岗位映射、对外必审、工具授权。

---

## 判断点（Lucas 先定）

1. **销售数字员工的 PRINCIPAL 范围落在谁名下**：建议落在 sponsor（操作它的销售）名下 —— 它只能看 Alex 的客户若 Alex 是 sponsor；若要"所有销售共用一个数字员工"，则需 ORG 只读 + 写动作全部审批。
2. **会计是否能看 costPrice 明细**：设计稿说"看成交金额、提成"，我按只给毛利合计、不给逐行成本；若要逐行成本请明说。
3. **项目结算的"参与方知道价格"**：`bids` 岗看项目收入 / 费用汇总即可，还是也看逐笔费用与收据。
4. **数字员工绑定由谁维护**：仅平台管理员跑脚本（与人类一致），还是允许 owner 在界面上绑（需要 UI，建议留 PERM-6）。

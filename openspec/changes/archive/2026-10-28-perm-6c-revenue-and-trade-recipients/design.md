# Design

## Context

- **营收中心**（`src/lib/revenue-spine/access.ts`）：
  - `resolveRevenueAccess(request, opts)` = `requireRole(["trade","sales","boss","manager","admin"])` + `resolveTradeOrgId`；
  - 13 个路由文件、14 个处理器：GET 8 个；POST 5 个（`run-fde`、`transition`、`interactions`、`customer-replied`、`inquiries`）；策略 GET / PUT；
  - 策略 PUT 另判 `isAdmin(role) || role === "boss"`；
  - 纯函数 `roleCanAccessRevenueSpine` 只被 `scoring-draft.test.ts:367` 使用；
  - 数据全企业（`cockpit.ts:43-54`、队列、商机列表都只按 `orgId`）。
- **收件人**：
  - `trade/booth-summary.ts:146-157`：`isManagementMember` / `managementOf` = 企业 `org_owner / org_admin` 或平台 `boss / manager / admin / super_admin`；
  - `managementOf` 被展会小结（`booth-summary.ts:188`）、老板早报（`owner-brief.ts:144`）、SLA 分级（`sla-tiers.ts:381`）共用；
  - 旧提醒（`inquiry-sla.ts:211-219`）：首次提醒发平台 `trade / boss / manager / admin / super_admin`，24 小时升级用 `isManagementMember`；
  - 询盘到达通知 `notifyInquiryMembers`（`website-inquiry.ts:994`；网站询盘 `:785` 与通道入站 `channel-service.ts:547` 调用）：平台 `trade / boss / manager / admin / super_admin`。
- **默认负责人**：`resolveInquiryOwner`（`inquiry-intake.ts:144-155`）= 最早加入的平台 `trade / sales` 在职成员（成员与用户都 active）→ 企业 owner。
- **已有工具**：
  - `loadPermissionKeys(userId, orgId)` / `loadPositionMode(orgId)`（`rbac/permission-keys.ts`，含兼容回退与 super_admin 全权）；
  - `isManagementWorkspaceUser`（`rbac/workspace-policy.ts:98`）：旧模式口径与 `isManagementMember` 完全相同，岗位模式 = `organization.dashboard.read` 或 super_admin；
  - `deriveEffectivePlatformRole`（4c4 / 6a）。
- **剩余外贸平台角色读点**（压扁 `trade` 前提）：
  - 侧栏 `usesTradeLayout(user.role)`（`sidebar.tsx:298,405`）；
  - 入职清单 `onboarding.ts:607`（岗位模式：`m.user.role === "trade" || hasSalesWorkKey`）。
  - 其余已用派生角色或只在旧模式生效：管理总览读 `effectiveRole`、AI 晨报 / agent-runtime / Muse 经 `resolveEffectivePlatformRole`、`nav-role-policy` 只在旧模式。
- **压扁脚本**：`COLLAPSIBLE_PLATFORM_ROLES = ["boss","manager","operations","sales"]`（`platform-role-collapse.ts:9`）；只对岗位模式企业生效。
- **梦馨生产**：2 名成员，平台 `admin` + `org_owner`（老板），平台 `trade` + `org_member`（业务员）。

## Goals / Non-Goals

**Goals**：
- 营收中心与外贸收件人按岗位键；
- 梦馨（旧模式）生产两人的结果与今天一致；
- 岗位模式压扁前后一致；
- 平台 `trade` 纳入压扁，为 6b 铺路；
- 堵住销售员经营收中心看全企业商机的口子。

**Non-Goals**：
- 按负责人收窄营收 / 外贸数据（6b）；
- 通知文案、频率、渠道；
- AI 工具策略的平台 `admin` 档（跨域，另议）；
- 新权限键。

## Decisions

### D1 营收中心复用外贸三键
- `resolveRevenueAccess(request, keys, opts?)`：内部先 `requireTradePermission(request, keys)`（6a），再 `resolveTradeOrgId(request, user, { bodyOrgId })` 做 body orgId 交叉校验。返回形状不变，路由只多传一个键组参数。
- 键组复用 `TRADE_READ_KEYS` / `TRADE_MANAGE_KEYS` / `TRADE_SETTINGS_KEYS`（以 `REVENUE_*_KEYS` 再导出）：GET → 读，POST → 写，策略 PUT → 设置。策略 PUT 删掉 `isAdmin || boss` 判断。
- 策略 GET 例外 → 三键任一（`REVENUE_POLICY_READ_KEYS`）：只管设置的 `org_admin` 要先看到当前策略才能发布；策略里没有客户数据。
- 删除 `REVENUE_SPINE_ROLES` / `roleCanAccessRevenueSpine`；`scoring-draft.test.ts` 改为断言新守卫源码。
- 导航：`biz-revenue` / `biz-revenue-today` 的 `requiredPlatformRoles` 去掉 `sales`，只影响旧模式；岗位模式仍按外贸入口规则（`tradeEntry`）。
- 否决：
  - 新增 `revenue.*` 键：营收中心是梦馨询盘流水线，与外贸同一批人，多一组键只多一层绑定。
  - 认销售商机读键：要判 `ORG` 范围才不越过 4a 的本人范围，等于再造一套范围判定。

### D2 收件人集中到 `src/lib/trade/recipients.ts`
- **加载**：`loadTradeMemberSignals(orgId)` 一次取：
  - 在职成员的 `userId`、企业角色、平台角色、用户状态、加入时间；
  - 各自的有效权限键（`loadPermissionKeys`）；
  - 企业的岗位模式。
  - 企业成员个位数到几十人，提醒 / 早报都在"确有要发的内容"之后才加载。
- **纯选择函数**（测试对象）：
  - `isTradeWorker(m)` = 持 `trade.read` 或 `trade.manage`；
  - `isTradeManager(m, positionMode)` = `isManagementWorkspaceUser({ role, orgRole, positionMode, permissionKeys })` 且 `isTradeWorker(m)`；
  - `pickDefaultInquiryOwner(members, positionMode)` = 成员与用户都 active、派生角色 ∈ {`trade`, `sales`}，按加入时间取最早。
- **入口**：`tradeWorkRecipients(orgId)`、`tradeManagementRecipients(orgId)`、`resolveDefaultInquiryOwner(orgId)`（无人 → 企业 owner）。
- **接入**：
  - `booth-summary.managementOf` 改为转调 `tradeManagementRecipients`，导出名不变，展会小结 / 早报 / SLA 分级不用改调用点。`recipients.ts` 不引用 `booth-summary`，避免 owner-brief 注释里提到的环。
  - `inquiry-sla` 的首次提醒 / 24 小时升级改用两个入口；
  - `notifyInquiryMembers` 改用 `tradeWorkRecipients`；
  - `resolveInquiryOwner` 的成员查询改用 `resolveDefaultInquiryOwner`（`preferredUserId` 优先不变）。
  - 删除 `isManagementMember`、`MANAGEMENT_ROLES`、`MANAGEMENT_ORG_ROLES`。
- **成员筛选沿用各处今天的口径**：通知类只要求成员 active；默认负责人另要求用户 active。

### D3 管理层收件人要求持外贸键（待拍板 2，按推荐写）
- 管理层定义不另造，复用 `isManagementWorkspaceUser`：旧模式 = 今天的 `isManagementMember`，岗位模式 = 老板岗位。
- 再要求持外贸读写键，使收件人都能打开提醒里的线索：
  - 旧模式中，只持设置键的 `org_admin` 被排除；
  - 不是企业负责人的平台 boss / manager / admin 被排除（6a 后已打不开外贸）。
- SLA 分级"无人则回退企业 owner"保留。早报只在企业启用外贸模块时生成（`owner-brief.ts:110`），所以 Sunny 老板虽有外贸键，未开外贸前不会收到。

### D4 默认负责人用派生角色
- 派生角色在旧模式就是平台角色，与今天逐字等价；岗位模式下 `trade_rep` → `trade`、`sales_rep` → `sales`、`owner` → `boss`（不入选），压扁前后选到同一人。
- 否决"持 `trade.manage` 的最早成员"：梦馨老板（`org_owner` 含外贸键）最早加入，会抢走默认负责人。

### D5 压扁纳入 `trade`，补两处读点
- `COLLAPSIBLE_PLATFORM_ROLES` 加 `trade`；前置校验与写库闸门不变。
  - 只对岗位模式企业生效：Sunny 无外贸成员；梦馨到 6b 才是岗位模式。
- 侧栏：`usesTradeLayout(user.effectiveRole ?? user.role)`（`/api/auth/me` 已返回 `effectiveRole`，4c5）。
- 入职清单：岗位模式"业务员" = `hasSalesWorkKey` 或持 `trade.manage`（去掉对平台 `trade` 的依赖；旧模式分支不变）。
- 残留清单新增"F 组 外贸"（F1 营收中心、F2 收件人、F3 默认负责人、F4 侧栏布局、F5 入职清单），逐条标状态；D2–D4 标"PERM-6c 已收口"。

## 等价性（梦馨生产两人，旧模式）

| 场景 | 今天 | 6c 后 |
|---|---|---|
| 营收中心读 / 写 | 老板（平台 admin）、业务员（平台 trade） | 老板（`org_owner` 外贸键）、业务员（兼容 `trade_rep`） |
| 策略发布 | 老板 | 老板（`trade.settings.manage`） |
| 询盘通知 / 首次提醒 | 老板、业务员 | 老板、业务员 |
| 早报 / 展会小结 / 升级 | 老板 | 老板 |
| 默认负责人 | 业务员 | 业务员 |

## 与八条硬纪律的关系

1. **零 schema**：不涉及。
2. **出站先审批**：触碰。只改谁收站内 / 微信提醒；FDE 与回复草稿仍走审批，不新增出站。
3. **第三套队列**：触碰。不新增调度，沿用既有 cron 与即时通知。
4. **脱敏**：触碰。提醒正文不变（已不含买家邮箱 / 电话）。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：触碰。选人全是查表与权限键，无 LLM。
8. **测试注册**：触碰。纯测试注册 `test-all` 与 `test-ci-unit`，隔离库测试注册 `test-all`。

## Risks / Trade-offs

- **BREAKING**：
  - 平台 `sales`（如 Sunny 销售员压扁前）调营收中心 403；
  - 不是企业负责人的平台 boss / manager / admin 不再收外贸提醒；
  - `org_admin` 不再收外贸管理层提醒。
  - 上线前确认需要收提醒的人绑了外贸岗位或是 `org_owner`。
- 每次发提醒多做 N 次权限解析（N = 企业成员数）。只在确有提醒时发生，可接受。
- 压扁 `trade` 后，旧模式残留的 `role === "trade"` 判断（`nav-role-policy`、AI 工具策略）在岗位模式下不再命中。它们只在旧模式生效，或已经过派生角色；纯测试用源码断言兜底。

## 验证方式

- `npx tsx src/lib/trade/__tests__/trade-recipients.test.ts`（新，纯）：
  - 工作 / 管理层 / 默认负责人三个选择函数的矩阵：
    - 旧模式：梦馨两人、平台 boss 非负责人、`org_admin`、super_admin；
    - 岗位模式：`owner`、`trade_rep`、`sales_rep`、压扁前后；
  - 营收路由表源码断言：13 个文件无 `requireRole`，每个处理器的键组与方法一致，策略 PUT 用设置键；
  - 压扁范围含 `trade`；
  - 侧栏与入职清单源码断言；
  - 旧的 `isManagementMember` / 角色字面量已移除。
- `trade-recipients-db.isolated.test.ts`（新，隔离库，真实路由与函数）：
  - 营收中心：`trade_rep` 200、`owner` 200、`sales_rep` 403、平台 admin 非负责人 403、业务员发布策略 403、老板发布策略 200；
  - 收件人：旧模式与岗位模式企业的 `tradeWorkRecipients` / `tradeManagementRecipients` / 默认负责人；
  - 压扁：岗位模式企业的平台 `trade` 成员有绑定则被压扁、无绑定则阻断。
- 回归：
  - 既有 `booth-summary`、`inquiry-sla`、`sla-tiers`、`owner-brief`、`scoring-draft`、`website-inquiry*`、`channels-to-spine`；
  - `platform-role-collapse`（纯 + 隔离库），`residual-reads`、`trade-access`。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate perm-6c-revenue-and-trade-recipients --strict`。

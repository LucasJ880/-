# Proposal: perm-2-discount-by-position

**TASKFLOW：** PERM-2（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）；承载任务书 `docs/QINGYAN_PERM-1-2_POSITIONS_DISCOUNT_TASKBRIEF.md` 的 PERM-2 部分。
**受影响的 Muse 意图：** 无。本 change 不触碰 `src/lib/muse-bridge/**`。

## Why

折扣设置只认唯一 org_owner、平台 admin 可绕过超限审批、报价分享链接不检查超限是否已批、企业管理员可以换成员角色——这四条与设计稿 §4 第 1、2、4、5、6 条决定相悖。PERM-1 已把岗位和平台管理员的有效权限立起来，现在把折扣 / 审批 / 发送 / 成员管理四条判定换到岗位上。

## What Changes

- **折扣三档**（报价创建与修改）：折扣 ≤ 销售上限 `promoMaxPct` 直接生效；销售上限 < 折扣 ≤ 合价上限（默认 35%，可按企业在 `Organization.settingsJson.pricing.leadMaxPct` 覆盖）时，持有 `sales.quote.discount.over_limit.submit` 的人直接生效并审计 `via: pricing_lead`；折扣 > 合价上限一律 `required`，走现有超限审批。**BREAKING**：删除平台 `admin` 的直批分支；只有平台 super_admin 可直批，审计记 `selfApproved: true`。
- **超限审批人按岗位**：提交审批时收件人 = 企业内持有 `sales.quote.discount.over_limit.approve` 的人（无人时回退 org ownerId + org_admin）；执行批准时校验批准人持有该权限且不是提交人；super_admin 可自批并审计。
- **折扣表 / 费用 / 解锁码修改走审批**：PUT 不再直接落库，改为建 PendingAction `sales.update_quote_settings`（payload 只含 diff 与解锁码哈希，不含明文），由另一位持 `sales.settings.manage` 的人批准后执行；super_admin 直接落库并审计 `selfApproved`。响应 `202 { pending: true, approvalId }`。驾驶舱折扣卡片与快速报价桥接按 202 显示"已提交审批"。
- **发送出口前置检查**：分享链接 GET / 签名 / 分享 PDF 在超限折扣未批时返回 409 `PROMOTION_APPROVAL_REQUIRED`（与 mark-sent / send-email 现有行为一致）；mark-sent / send-email 的"只能本人或 super_admin"改为 `authorize(sales.quote.send)`，合价人可发全企业报价。
- **成员管理仅平台管理员**：企业成员的新增、角色 / 状态修改、移除三个接口改为 `requirePlatformAdmin`；唯一 org_owner 保护保留。系统模板 `org_owner` 移除 `identity.member.manage`、`identity.role.manage`、`authorization.policy.manage`（与 PERM-1 报告 §4-1 对齐）。
- **报价读写判定不再因平台 admin 跳过**：报价详情 GET / PATCH 与提交审批接口的 `isAdmin` 短路删除，统一走 `authorize`（super_admin 由 PERM-1 的全权解析覆盖）。
- 写 `docs/QINGYAN_PERM-2_REPORT.md`；TASKFLOW PERM-2 状态列改 `[G]`。

## Capabilities

### New Capabilities
- `sales/discount-tiering`：报价折扣分档——销售上限 / 合价上限 / 审批三档的判定与审计，以及谁能提交、谁能批准。
- `sales/quote-settings-approval`：销售设置（折扣表、费用、税率、解锁码）的修改必须经另一人审批后生效。
- `sales/quote-delivery-gate`：报价发出去之前的前置条件——超限折扣未批不得发送、分享、签名；发送权限按岗位。
- `identity/member-management`：企业成员的增删与角色变更只属于平台管理员。

### Modified Capabilities
- `authorization/position-catalog`：系统模板 `org_owner` 不再含成员 / 岗位 / 策略管理权（PERM-1 的 delta 尚未归档，本 change 以 ADDED Requirement 叠加约束，不改 PERM-1 的文本）。

## Impact

- `src/lib/sales/discount-tier.ts`（新，纯函数）、`src/lib/sales/pricing-policy.ts`（新：读 settingsJson 合价上限）、`src/lib/sales/approvers.ts`（新：按权限找审批人）。
- `src/app/api/sales/quotes/route.ts`、`[quoteId]/route.ts`、`[quoteId]/request-promotion-approval/route.ts`、`[quoteId]/mark-sent`、`[quoteId]/send-email`、`share/[token]/route.ts`、`share/[token]/sign`、`share/[token]/pdf`。
- `src/lib/pending-actions/types.ts`（新类型 `sales.update_quote_settings`）、`executor.ts`（新执行器 + 超限审批批准人校验）。
- `src/app/api/sales/quote-settings/discounts/route.ts`、`src/lib/blinds/discount-settings.ts`（接受预哈希解锁码）、`src/lib/blinds/discount-permissions.ts`（删除）、`src/app/(main)/sales/cockpit/discount-settings-card.tsx`、`src/app/(main)/sales/quote-sheet/rough-quote-panel.tsx`（202 处理）。
- `src/app/api/organizations/[orgId]/members/route.ts`、`[memberId]/route.ts`。
- `src/lib/authorization/role-defaults.ts`（`org_owner` 模板减 3 键）。
- 测试：新增 `src/lib/sales/__tests__/discount-tier.test.ts`、`pricing-policy.test.ts`；改 `discount-permissions.test.ts` → 删除；`authorize.test.ts` 补 org_owner 断言；全部注册。
- 数据库：零 schema。PendingAction / AuditLog / Organization.settingsJson 均为既有表与 JSON 位。
- 对外行为变化：平台 admin 不再免审批；折扣表修改延迟到审批后生效；org_admin 不能再管成员；分享链接对未批超限报价返回 409。

## Out of scope

- 不做审批 UI 的改版；审批仍在现有"审批中心"（PendingAction）完成。
- 不改 `promoMaxPct` 的语义与默认值；不改安装 / 运费 / 税率计算。
- 不做出单按品类、导航 / 工作区按岗位、会计视图、数字员工（PERM-3 ~ 5）。
- 不改 `org_admin` 系统模板（梦馨可能仍用）；只改 `org_owner`。
- 不改 PendingAction 的通用批准接口 `ai/pending-actions/[id]` 的角色判定（仍按 `canDecideTeamApproval`）；岗位校验放在执行器里，批准接口拒绝时返回执行器的错误。

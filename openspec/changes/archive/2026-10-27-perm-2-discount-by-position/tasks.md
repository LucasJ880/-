# Tasks

## 1. 折扣分档

- [x] 1.1 新建 `src/lib/sales/pricing-policy.ts`：`DEFAULT_LEAD_MAX_PCT = 0.35`、`readLeadMaxPct(settingsJson)`（纯函数，非法回落）、`loadPricingPolicy(orgId, promoMaxPct)`（读 Organization.settingsJson，返回 `{ leadMaxPct: max(read, promoMaxPct) }`）。新建 `src/lib/sales/__tests__/pricing-policy.test.ts`（默认 / 覆盖 / "abc" / 1.5 / -0.1 / 低于 promoMaxPct）并在 `scripts/test-all.sh` 注册。verify：测试全通过；`bash scripts/check-test-registry.sh` 退出 0。
- [x] 1.2 新建 `src/lib/sales/discount-tier.ts`：`decideDiscountTier({ ratio, promoMaxPct, leadMaxPct, actor })` 返回 `within_limit | lead_direct | platform_self_approved | approval_required` 与 `approvalData`（写入 salesQuote 的 promotionApproval* 字段）及 `auditVia`。新建 `src/lib/sales/__tests__/discount-tier.test.ts` 覆盖 spec 7 个场景并注册。verify：测试全通过。
- [x] 1.3 `quotes/route.ts` POST 与 `[quoteId]/route.ts` PATCH：删除 `isAdmin` 直批分支，改为 `authorize(over_limit.submit)` 得能力位 + `loadPricingPolicy` + `decideDiscountTier`；`lead_direct` / `platform_self_approved` 写 `approved` 并审计（`via`、`selfApproved`）；删除 GET / PATCH / request-promotion-approval 里 `if (!isAdmin(user.role))` 的 authorize 短路，统一调用 authorize。verify：`npm run typecheck` 通过；`grep -c "isAdmin" src/app/api/sales/quotes/route.ts "src/app/api/sales/quotes/[quoteId]/route.ts" "src/app/api/sales/quotes/[quoteId]/request-promotion-approval/route.ts"` 均为 0。

## 2. 审批人与批准校验

- [x] 2.1 新建 `src/lib/sales/approvers.ts`：`listUsersWithPermission(orgId, permissionKey)`（绑定链查询）与纯函数 `pickApprovalRecipients({ holders, fallback, requesterId })`（排除提交人、空集回退）。`request-promotion-approval/route.ts` 收件人改为 `over_limit.approve` 持有者；`approverUserId` 取第一人。纯函数用例并入 `quote-settings-approval.test.ts`（见 2.2）。verify：typecheck 通过；纯函数用例通过。
- [x] 2.2 执行器批准人校验：新建纯函数 `checkApproverEligibility({ approverId, requesterId, isPlatformSuperAdmin, hasPermission, enforcement })` 返回 `{ ok, selfApproved, reason }`（`enforcement=false` 时仅拒绝自批）；`execSalesApproveQuotePromotion` 开头调用（`enforcement` = 企业存在至少一条 `over_limit.approve` 绑定），审计加 `selfApproved`。新建 `src/lib/sales/__tests__/quote-settings-approval.test.ts`（自批拒绝 / 无权拒绝 / super_admin 自批标记 / 过渡态只拒自批 / 收件人排除提交人与回退）并注册。verify：测试通过；typecheck 通过。

## 3. 设置审批

- [x] 3.1 `pending-actions/types.ts` 加 `sales.update_quote_settings` 与 `SalesUpdateQuoteSettingsPayload`（numericPatch、costRates?、depositOverrideCodeHash?: string|null、lineDiscountUnlockCodeHash?: string|null、requestedById、metadata）；`discount-settings.ts` 的 `DiscountSavePatch` 增加预哈希字段 `depositOverrideCodeHashed` / `lineDiscountUnlockCodeHashed`（与明文字段互斥，明文优先哈希后写入）；新增纯函数 `buildQuoteSettingsApprovalPayload(...)` 与 `quoteSettingsIdempotencyKey(orgId, payload)`（基于 `computePayloadHash`）。用例并入 `quote-settings-approval.test.ts`（payload 不含明文、同内容同 key）。verify：测试通过。
- [x] 3.2 `quote-settings/discounts/route.ts` PUT：校验 → 解锁码哈希 → super_admin 直接 `saveDiscountsForOrg` + 审计 `selfApproved: true, actorKind: platform_admin` → 否则 `authorize(sales.settings.manage)` 不允许 403 → PendingAction upsert（type `sales.update_quote_settings`，approverUserId = `sales.settings.manage` 持有者中非提交人第一人，requiredRole `org_owner`）→ 通知持有者 → 202 `{ pending: true, approvalId }`。executor 新增 `execSalesUpdateQuoteSettings`（批准人校验 → `saveDiscountsForOrg({ userId: requestedById, patch })` → 审计 `quote_settings_updated` 含 approvedById）。删除 `src/lib/blinds/discount-permissions.ts` 与其测试，并从 `scripts/test-all.sh` 移除该行。verify：typecheck 通过；`grep -rn discount-permissions src scripts` 为空；`bash scripts/check-test-registry.sh` 退出 0。
- [x] 3.3 `discount-settings-card.tsx` 与 `rough-quote-panel.tsx`：PUT 返回 202 时显示"已提交审批，等待另一位老板批准"，卡片保持当前生效值不覆盖；panel 向 iframe 回传 `{ success: true, pending: true }`，`sunny-quote.html` 桥接接收端提示文案同步。verify：`npm run typecheck`；`npx eslint` 两文件无 error；`public/sunny-quote.html` 内联脚本 `node --check` 通过。

## 4. 发送闸与成员管理

- [x] 4.1 `share/[token]/route.ts` GET 与 `share/[token]/pdf/route.ts` 加超限未批 409 `PROMOTION_APPROVAL_REQUIRED`（复用 `evaluatePromotionApproval`，响应体 `error: "报价待内部审核，暂不可查看"`）；`mark-sent` / `send-email` 的所有权判定改为 `authorize({ permission: "sales.quote.send", resource: { ownerId: createdById } })`。verify：typecheck；`grep -c "PROMOTION_APPROVAL_REQUIRED"` 在 share GET / pdf 各为 1；`grep -c isSuperAdmin` 在 mark-sent / send-email 为 0。
- [x] 4.2 `members/route.ts` POST、`[memberId]/route.ts` PATCH / DELETE 改 `requirePlatformAdmin`（GET 不动）；`role-defaults.ts` 的 `org_owner` 模板移除 `identity.member.manage` / `identity.role.manage` / `authorization.policy.manage`；`authorize.test.ts` 加 org_owner 三键断言并修正现有相关断言。verify：`grep -c requireOrgRole` 在两文件为 0（GET 用 requireAuth 或保持原有读守卫）；authorize.test.ts 通过。
- [x] 4.3 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；写 `docs/QINGYAN_PERM-2_REPORT.md`（做了什么 / 怎么验 / 判断点 / 已知限制：admin 账号受影响检查、过渡态、手工走查步骤）；TASKFLOW PERM-2 改 `[G]`；更新 HANDOFF。verify：四条命令退出 0；报告存在；`grep -c "PERM-2 .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1；`openspec validate perm-2-discount-by-position --strict` 通过。

## Workflow follow-up

- PR 合并到 main 后 `/opsx:archive perm-2-discount-by-position --yes`（独立小 PR）；确认 `openspec list --specs` 列出 `sales/discount-tiering`、`sales/quote-settings-approval`、`sales/quote-delivery-gate`、`identity/member-management`；TASKFLOW PERM-2 改 `[x]`。
- 交叉测试：对 preview 环境按岗位（销售 / 合价 / 老板 / 平台管理员）走查折扣三档、设置审批、分享链接 409、成员管理 403，结果写 `docs/QINGYAN_PERM-1-2_REPORT.md`。

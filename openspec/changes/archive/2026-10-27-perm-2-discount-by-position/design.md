# Design: perm-2-discount-by-position

## Context

见 proposal.md「Why」。现状（已读代码）：
- 报价创建 `quotes/route.ts` 225-242 与修改 `[quoteId]/route.ts` 205-215：`finalDiscountPct > promoMaxPct` 时 `isAdmin(user.role)` → 直接 `approved`，否则 `required`。
- 提交审批 `request-promotion-approval/route.ts`：收件人 = org ownerId + org_admin；`approverUserId` 取第一人；PendingAction `sales.approve_quote_promotion`，`requiredRole: "org_admin"`。
- 批准路径：`ai/pending-actions/[id]` → `canDecideTeamApproval`（super_admin / approverUserId / org owner / org_admin）→ `approveApprovalItem` → executor `execSalesApproveQuotePromotion`（无自批与岗位校验）。
- 设置 `quote-settings/discounts` PUT：`canManageQuoteDiscountSettings(orgRole)` 只认 org_owner，直接落库。
- 发送：`mark-sent` / `send-email` 已用 `evaluatePromotionApproval` 返回 409；`share/[token]` GET 与 `share/[token]/pdf` 不检查；`share/[token]/sign` 已检查。`mark-sent` / `send-email` 的所有权判定是 `createdById === user.id || isSuperAdmin`。
- 成员：`members/route.ts` POST、`[memberId]` PATCH / DELETE 用 `requireOrgRole(..., "org_admin")`。
- PERM-1 已提供：`authorize()`（super_admin 全权）、权限键、岗位模板。

## Goals / Non-Goals

**Goals:**
- 四条判定（折扣档位、审批人、设置修改、发送 / 成员）全部以岗位权限为准；平台 admin 失去特权；super_admin 保留直批但留痕。
- 折扣档位是纯函数，决策表可单测。
- 设置修改复用 PendingAction，不新造审批。

**Non-Goals:**
- 不改 `evaluatePromotionApproval` 的快照一致性语义。
- 不改 `ai/pending-actions/[id]` 的 `canDecideTeamApproval`（它决定"谁能点"，岗位校验在执行器决定"能否生效"）。
- 不改 `calculateQuoteTotal`、安装 / 运费 / 税率。
- 不改 `org_admin` 系统模板；不改梦馨任何岗位。
- 不改前端报价单页面的折扣输入控件；只改保存结果的提示。

## 八条硬纪律对照

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守。合价上限放 `Organization.settingsJson.pricing.leadMaxPct`；审批走 PendingAction 既有表；无 migration |
| 2 | 出站先审批 | 遵守并加强。设置修改、超限折扣都先建 PendingAction；发送出口在未批时 409 零出站 |
| 3 | 禁止第三套队列 | 不涉及。复用 PendingAction 执行器，不加 scheduler / queue |
| 4 | 脱敏 | 不涉及 Muse。PendingAction payload 不含解锁码明文，只含哈希 |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及。send-email 的发件逻辑不改 |
| 7 | 确定性优先 | 遵守。档位判定、审批人选择都是查表 / 查权限，无 LLM |
| 8 | 测试注册 | 遵守。新增 `discount-tier.test.ts`、`pricing-policy.test.ts`、`quote-settings-approval.test.ts`（纯函数部分）注册；删除的 `discount-permissions.test.ts` 同时从 `test-all.sh` 移除 |

## Decisions

### D1 档位判定是纯函数，输入是"能力位"而不是角色
`decideDiscountTier({ ratio, promoMaxPct, leadMaxPct, actor: { isPlatformSuperAdmin, canSubmitOverLimit } })` → `within_limit | lead_direct | platform_self_approved | approval_required`。路由先用 `authorize(sales.quote.discount.over_limit.submit)` 得到能力位再调用。
- 否决：在路由里直接 `if (hasPosition("pricing_lead"))`。理由：岗位 key 不是契约，权限键才是；老板也持 over_limit.submit，按能力位自然覆盖。
- 否决：把 super_admin 判定也放进 `authorize`（例如新权限 `sales.quote.discount.self_approve`）。理由：自批是平台身份的特例，设计稿 §4-3 明确；放权限键会让它可被绑给岗位。

### D2 合价上限读 settingsJson，纯函数 + 默认 0.35
`readLeadMaxPct(settingsJson)`：取 `pricing.leadMaxPct`，非 0~1 有限数回落 0.35；`loadPricingPolicy(orgId)` 读 Organization 一次。低于 `promoMaxPct` 时以 `promoMaxPct` 为准（`Math.max`）。
- 否决：加列 `QuoteDiscountSettings.leadMaxPct`。理由：零 schema；#260 已是一次例外。

### D3 审批人按权限查，不按成员角色
`listUsersWithPermission(orgId, key)`：PrincipalRoleBinding(active, HUMAN) → RoleProfile(active) → RolePermissionBinding(permissionKey=key, effect=ALLOW)，去重返回 userId。空集回退 ownerId + org_admin（兼容未绑岗位的企业）。排除提交人。`approverUserId` 取第一人（现有 PendingAction 只支持单 approver 字段；其余人靠 `canDecideTeamApproval` 的 org owner / admin 放行会漏掉"老板岗位"——因此执行器再校验）。
- 否决：只改 `canDecideTeamApproval`。理由：它是 marketing 团队审批的通用判定，改它影响面大；执行器校验是最小落点且 fail-closed。

### D4 执行器校验批准人
`execSalesApproveQuotePromotion` 开头：`ctx.userId === payload.requestedById` 且非 super_admin → 拒绝；非 super_admin 且 `authorize(over_limit.approve)` 不允许 → 拒绝；super_admin 自批 → 审计 `selfApproved: true`。新执行器 `execSalesUpdateQuoteSettings` 同样校验（权限键换 `sales.settings.manage`）。
- 否决：在批准接口层校验。理由：接口层对所有 PendingAction 通用，岗位语义属于动作类型本身。

### D5 设置修改：PUT 变"提交"，super_admin 例外
PUT 流程：校验（现有 `validateDiscountsInput` / `validateCostRatesInput` / 解锁码）→ 解锁码立即哈希 → super_admin：`saveDiscountsForOrg`（接受预哈希字段）+ 审计 selfApproved → 否则 `authorize(sales.settings.manage)` → PendingAction upsert（idempotencyKey = `quote-settings:<orgId>:<payloadHash>`）→ 202。执行器把 payload 交给 `saveDiscountsForOrg`，`userId` 记提交人，审计 `approvedById`。
- 否决：保留直接落库、只加审计。理由：设计稿 §4-2 明确老板敏感操作要另一老板批。
- 否决：payload 存解锁码明文。理由：PendingAction 可被审批中心展示；哈希后执行器直接写列。

### D6 发送权限换 `authorize(sales.quote.send)`
`mark-sent` / `send-email`：`authorize({ permission: "sales.quote.send", resource: { ownerId: quote.createdById } })`；`sales_rep` 为 PRINCIPAL（本人），`pricing_lead` 为 ORG，super_admin 全权。分享三接口（公开、无登录）只加超限未批 409，不加岗位判定。
- 否决：分享接口也要求登录。理由：分享链接是给客户的，设计稿未改这一点。

### D7 成员接口 `requirePlatformAdmin`，模板 `org_owner` 减三键
三个写接口换守卫；GET 不动。`role-defaults.ts` 的 `org_owner` 去掉 `identity.member.manage` / `identity.role.manage` / `authorization.policy.manage`。`discount-permissions.ts` 删除（唯一引用在 discounts 路由，已改）。
- 否决：保留 org_admin 可管成员、只在 Sunny 关掉。理由：接口守卫不按企业分叉；梦馨成员管理也由 Lucas 做（用户决定"只有 Lucas"）。

## Risks / Trade-offs

- [平台 admin 失去直批，现网若有 `admin` 角色的业务账号会突然需要审批] → REPORT 列出受影响账号的检查 SQL（`User.role = 'admin'`）；Lucas 是 super_admin 不受影响。
- [折扣表修改延迟生效，老板习惯"保存即生效"] → 卡片与快速报价明确提示"已提交审批"；super_admin 仍即时。
- [企业无人持 `over_limit.approve`（PERM-1 绑定未跑）时审批人回退到 ownerId + org_admin] → 与现状一致，不劣化；执行器对回退收件人仍要求权限 → **冲突**：未绑岗位的企业将无人能批。处理：执行器校验在"企业存在至少一条 over_limit.approve 绑定"时才启用，否则沿用现状（REPORT 记录为过渡态，PERM-1 绑定跑完即自动收紧）。
- [分享链接 409 会让客户看到报错] → 响应体给中文说明"报价待内部审核"，前端分享页按 code 显示友好文案（前端改动最小：share 页已处理 409 的 sign 场景，复用文案）。
- [PendingAction 幂等键用 payloadHash，老板改两次不同内容会产生两条待批] → 预期行为；执行器按先后各自应用，后者覆盖。

## Migration Plan

1. 合并即生效，无数据迁移。
2. 生产前置：PERM-1 的 Sunny 岗位绑定已跑（否则审批人回退、执行器校验处于过渡态）。
3. 回滚：revert 本 PR；PendingAction 里未执行的 `sales.update_quote_settings` 会因类型未知被 executor 标 unsupported，不会误执行。

## 验证方式

- `npx tsx src/lib/sales/__tests__/discount-tier.test.ts`：决策表每行一例（§折扣三档判定 7 个场景）。
- `npx tsx src/lib/sales/__tests__/pricing-policy.test.ts`：默认 / 覆盖 / 非法回落 / 不低于 promoMaxPct。
- `npx tsx src/lib/sales/__tests__/quote-settings-approval.test.ts`：payload 构造不含明文、幂等键稳定、批准人校验纯函数（自批 / 无权 / super_admin 自批标记）。
- `npx tsx src/lib/authorization/__tests__/authorize.test.ts`：org_owner 模板不含三键。
- `npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npm run test:ci`。
- 路由级行为（409 / 403 / 202）在沙箱无 DB 不可实跑：REPORT 写明手工走查步骤，交叉测试阶段用 Playwright 对 preview 环境走查。

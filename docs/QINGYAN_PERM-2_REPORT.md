# PERM-2 完成报告：折扣 / 审批 / 解锁码 / 发送 / 成员管理按岗位判定

| 项 | 值 |
|---|---|
| 日期 | 2026-10-27 |
| change | `perm-2-discount-by-position`（`openspec/changes/perm-2-discount-by-position/`） |
| 任务书 | `docs/QINGYAN_PERM-1-2_POSITIONS_DISCOUNT_TASKBRIEF.md` PERM-2 部分 |
| 依赖 | PERM-1（#264 已合并） |
| 状态 | 代码完成，待 GATE 审 → PR → 合并 → archive |

## 1. 做了什么

- **折扣三档**（`src/lib/sales/discount-tier.ts` 纯函数 + `pricing-policy.ts`）：
  - 折扣 ≤ 销售上限 `promoMaxPct` → 直接生效；
  - 销售上限 < 折扣 ≤ 合价上限（默认 35%，`Organization.settingsJson.pricing.leadMaxPct` 可覆盖，不低于销售上限）且持 `sales.quote.discount.over_limit.submit` → 直接 `approved`，审计 `via: pricing_lead`；
  - 平台 super_admin 且超销售上限 → `approved`，审计 `via: platform_admin_self_approval, selfApproved: true`；
  - 其余超销售上限 → `required`，走超限审批。
  - **平台 `admin` 的直批分支已删除**（`quotes/route.ts`、`[quoteId]/route.ts`）；报价详情 GET / PATCH / 提交审批不再因 `isAdmin` 跳过 `authorize`。
- **审批人按岗位**（`src/lib/sales/approvers.ts`）：提交超限审批的收件人 = 持 `sales.quote.discount.over_limit.approve` 的人（老板岗）排除提交人，无人时回退 ownerId + org_admin；执行器批准前校验"不是提交人 + 持权"（super_admin 例外并审计自批）；企业尚无人持权时为过渡态，只拒自批。
- **销售设置修改走审批**（`quote-settings/discounts` PUT）：持 `sales.settings.manage` 者提交 → `requestApproval`（canonical 入口）建 PendingAction `sales.update_quote_settings`，payload 只含数值 diff / 成本率 / 解锁码**哈希**，响应 `202 { pending, approvalId }`，通知另一位持权者；执行器 `execSalesUpdateQuoteSettings` 校验批准人与设置版本后落库并审计 `quote_settings_updated`（含提交人、批准人）。super_admin 直接落库，审计 `selfApproved: true, actorKind: platform_admin`。`discount-permissions.ts` 删除。微信确认策略把该类型归为 `web_only_review`。
- **发送闸**：分享链接 GET、分享 PDF 新增超限未批 409 `PROMOTION_APPROVAL_REQUIRED`（签名接口原已有）；mark-sent / send-email 的"创建人或 super_admin"改为 `authorize(sales.quote.send)`（销售本人 / 合价全企业 / 平台管理员），且超限未批对所有人 409。
- **成员管理仅平台管理员**：`members` POST、`[memberId]` PATCH / DELETE 改 `requirePlatformAdmin`；系统模板 `org_owner` 移除 `identity.member.manage` / `identity.role.manage` / `authorization.policy.manage`。
- **UI**：驾驶舱折扣卡片与快速报价桥接收到 202 显示"已提交审批，等待另一位老板批准后生效"，当前生效值不覆盖。

## 2. 怎么验的

| 检查 | 结果 |
|---|---|
| `pricing-policy.test.ts` / `discount-tier.test.ts` / `quote-settings-approval.test.ts`（新增、已注册） | 10 / 14 / 18 passed |
| `authorize.test.ts`（含 org_owner 三键断言） | 52 passed |
| `wechat-confirm-policy.test.ts`（类型数 14 → 15） | 11 passed |
| `runtime-architecture repo-conformance`（NEW_APPROVAL_BYPASS 守卫） | 9 通过 |
| promotion-approval / phase5-contract / security1-sales-authz / quote-ops-contract | 全通过 |
| `npm run typecheck` / `npm run lint:baseline` / `npm run test:ci` / `check-test-registry` | 全通过 |
| grep 守卫：三个报价路由无 `isAdmin`；mark-sent / send-email 无 `isSuperAdmin`；share GET / pdf 各 1 处 409 码 | 符合 |
| `openspec validate perm-2-discount-by-position --strict` | valid |

## 3. 判断点

- **能力位而不是岗位名**：路由只问 `authorize(over_limit.submit)`，老板因同时持该键也能在合价上限内直批；岗位 key 不是契约。
- **批准人校验放执行器**：批准接口的通用判定（`canDecideTeamApproval`）不动；岗位语义在动作类型自己的执行器里 fail-closed。
- **过渡态**：企业没有任何 `over_limit.approve` / `settings.manage` 绑定时，不启用持权校验（否则无人能批），但仍拒自批。PERM-1 的绑定跑完即自动收紧。
- **设置审批用 canonical 入口**：首版直接写 PendingAction 被 `NEW_APPROVAL_BYPASS_FORBIDDEN` 守卫拦下，改为 `requestApproval`，顺带拿到 canonical 风险与来源审计。

## 4. 已知限制与后续

1. **平台 `admin` 账号受影响**：现网若有 `User.role = 'admin'` 的业务账号，其超限折扣改为需审批、读他人报价需岗位。上线前查：`select email from "User" where role = 'admin'`；Lucas 是 super_admin 不受影响。
2. **老板审批入口**：`canDecideTeamApproval` 只放行 approverUserId / org ownerId / org_admin / super_admin。持 `owner` 岗位但既不是 org ownerId 也不是 org_admin 的老板，只有被指定为 approverUserId（收件人第一人）时才能在审批中心点"批准"。PERM-4 收口时把该判定也改为按岗位；过渡期：提交人若希望由特定老板批，由平台管理员或 ownerId 代批。
3. **路由级 409 / 403 / 202 未在沙箱实跑**（无 Postgres）：逻辑由纯函数测试覆盖；手工走查步骤：
   - 销售 Alex 建 30% 折扣报价 → 状态 `required`，分享链接 409；
   - Miki 改成 30% → `approved`，审计 `via: pricing_lead`；改成 40% → `required`，提交审批 → Bob 收到通知，Miki 自己批 → 拒绝，Bob 批 → 通过；
   - Bob 在驾驶舱改 Zebra 折扣 → 202 提示；Bill 在审批中心批 → 折扣表版本 +1；
   - org_admin 改成员角色 → 403；Lucas → 200。
4. **折扣表修改延迟生效**：老板习惯"保存即生效"需要沟通；super_admin 仍即时。
5. 不改 `org_admin` 系统模板（梦馨可能仍用），但成员写接口已对 org_admin 关闭。

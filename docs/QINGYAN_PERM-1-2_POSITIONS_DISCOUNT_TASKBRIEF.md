# PERM-1 / PERM-2 任务书：Sunny 岗位绑定 + 折扣与审批按岗位判定

| 项 | 值 |
|---|---|
| 编号 | PERM-1（岗位模板与绑定）、PERM-2（折扣 / 审批 / 解锁码 / 发送按岗位） |
| 设计稿 | `docs/QINGYAN_PERMISSION_REDESIGN_DESIGN.md`（§3 岗位矩阵、§4 已决定、§5 冲突 C1–C3、C7） |
| 依赖 | #260（romanShade 列）已合并 |
| 执行者 | Claude Code（`/opsx:propose perm-1-positions` → `/opsx:propose perm-2-discount-by-position`，两个 change） |
| 审核 | Claude（chat）；Lucas 拍板 |
| 纪律 | 零 schema；敏感操作先建 PendingAction；确定性优先；新测试注册到 `scripts/test-all.sh` |

---

## 0. 先读

- `src/lib/authorization/role-defaults.ts` — 系统岗位模板 `SYSTEM_ROLE_PROFILES` 与 `SYSTEM_POSITION_TEMPLATES`；PERM-1 在这里加 Sunny 岗位
- `src/lib/authorization/seed-org-profiles.ts` `seedOrgAuthorizationProfiles` — 模板落库方式（upsert RoleProfile + RolePermissionBinding）；绑定脚本复用
- `src/lib/authorization/resolve-effective-permissions.ts` — 有绑定走绑定，无绑定按 `OrganizationMember.role` 兼容回退；PERM-1 启用后 Sunny 全员应走绑定
- `src/lib/authorization/authorize.ts` `authorize` / `decideFromBindings`；`src/app/api/sales/quotes/[quoteId]/route.ts` 51、156 行是现有唯一接入样例
- `src/lib/blinds/discount-permissions.ts` — 折扣设置页守卫，现在只认 `org_owner`
- `src/app/api/sales/quotes/route.ts` 225-242、288-300；`src/app/api/sales/quotes/[quoteId]/route.ts` 205-215、430-440 — 超限折扣 `promotionApprovalStatus` 与 `isAdmin` 直批
- `src/lib/sales/promotion-approval.ts`、`src/app/api/sales/quotes/[quoteId]/request-promotion-approval/route.ts` — 现有超限审批流程（PendingAction）
- `src/app/api/sales/quotes/[quoteId]/{mark-sent,send-email}/route.ts`、`src/app/api/sales/quotes/share/[token]/route.ts` — 报价发送三个出口
- `src/app/api/sales/quote-settings/{discounts,verify-deposit-code,verify-line-discount-code}/route.ts` — 折扣表与解锁码
- `src/app/api/organizations/[orgId]/members/[memberId]/route.ts` — 成员角色变更，现在 `requireOrgRole(..., "org_admin")`

---

## PERM-1：Sunny 岗位模板与人员绑定（不改业务判定）

### Why
Security-1 的岗位表和绑定表已存在但未启用，Sunny 没有任何 PrincipalRoleBinding，所有人都走兼容回退（org_member + 平台角色 sales 才算销售）。先把岗位和人绑上，后续判定才有依据。

### What
1. `role-defaults.ts` 新增 Sunny 岗位模板（key 见设计稿 §3）：`owner`、`sales_rep`（已有，调整绑定）、`pricing_lead`、`ops_lead`、`ops_staff`（已有）、`accounting`、`bids`、`fulfillment_vinyl`、`fulfillment_drapery`、`fulfillment_shades`。每个岗位的 permissionKey / dataScope 按设计稿 §3 列；出单岗位本阶段只绑读权限，CATEGORY 范围留 PERM-3。
2. Permission Registry 新增 key：`sales.quote.pricing_close`（合价）、`sales.quote.discount.over_limit.submit`、`sales.quote.discount.over_limit.approve`、`sales.settings.manage`（折扣表 / 费用 / 解锁码）、`orders.fulfillment.update`、`inventory.manage`、`accounting.read`、`identity.position.manage`（仅平台管理员）。
3. 新脚本 `scripts/bind-positions.ts`：输入 orgId + `email → 岗位 key[]` 的 JSON 文件，upsert PrincipalRoleBinding（principalType=HUMAN）。只允许 `ALLOW_POSITION_BINDING=true` 且执行者为平台管理员时运行；打印脱敏结果。Sunny 的绑定文件 `config/positions/sunny.json` 按设计稿 §3（Miki = owner + pricing_lead + accounting 等）。
4. `resolve-effective-permissions.ts`：平台 `super_admin` 直接返回全部 registry 权限（ORG scope），来源标 `platform_admin`（设计稿 §4-3）；DIGITAL_EMPLOYEE 分支本阶段不动。
5. `seedOrgAuthorizationProfiles` 幂等地把新模板落到 Sunny；梦馨不受影响（模板按 orgId 上，可选参数指定模板集）。

### 受影响意图
- 销售（Alex、Lynn）在报价详情与销售上下文里的数据范围从"兼容回退"变为"绑定"，结果不变（仍本人）。
- 其他接口判定本阶段不变。

### Out of scope
- 任何 UI；成员管理界面；折扣判定（PERM-2）；品类范围（PERM-3）。

### 验收
- 单测：每个新岗位模板至少一例 `bindingsFromSystemProfile` 快照；`compatProfileKeyForMembership` 行为不变。
- 脚本对本地库跑一遍：Sunny 11 人绑定数与设计稿一致，重复执行幂等。
- `npm test` 全绿；新测试已注册；`openspec validate perm-1-positions` 通过。

---

## PERM-2：折扣、审批、解锁码、报价发送按岗位判定

### Why
设计稿 §4 第 2、4、5、6 条与冲突 C2、C3、C7。现在折扣设置只认唯一 org_owner，平台 admin 可绕过审批，报价发送不检查超限折扣是否已批。

### What
1. **折扣表 / 费用 / 解锁码设置**（`quote-settings/discounts` PUT）：守卫改为 `authorize(permission: "sales.settings.manage")`，老板岗通过。保存不再直接落库：生成 PendingAction（类型 `quote_settings.update`，payload 为 diff），由另一位 `owner` 批准后执行器写库；提交人不能批自己。平台管理员可直批，审批记录 `selfApproved=true`。`discount-permissions.ts` 删除或改为薄封装。
2. **折扣分档**（`quotes` POST、`[quoteId]` PATCH）：
   - 折扣 ≤ `promoMaxPct`：任何有 `sales.quote.create/update` 的人直接生效。
   - `promoMaxPct` < 折扣 ≤ 35%（新常量 `PRICING_LEAD_MAX_PCT`，可在 `Organization.settingsJson.pricing.leadMaxPct` 覆盖）：仅 `pricing_lead` 直接生效，`promotionApprovalStatus='approved'`，审计 `via: 'pricing_lead'`。
   - 折扣 > 35%：`promotionApprovalStatus='required'`，走现有 `request-promotion-approval`；审批人必须是不同于提交人的 `owner`（或平台管理员直批记自批）。
   - 删除所有 `isAdmin(user.role)` 直批分支。
3. **报价发送**：`mark-sent`、`send-email`、`share/[token]` 签发三处统一前置检查：`promotionApprovalStatus === 'required'` 则 409 `{error:"超限折扣未审批，不能发送"}`；发送权限 = `sales.quote.send`，绑给 `sales_rep`（PRINCIPAL）与 `pricing_lead`（ORG）。
4. **定金解锁码**：`verify-deposit-code` / `verify-line-discount-code` 保持销售可调用；设置码走第 1 条的审批。
5. **成员角色变更**：`[memberId]` PATCH / DELETE 改为仅平台管理员（`requirePlatformAdmin`），移除 `org_admin` 放行；唯一 owner 保护保留。
6. 审计：以上每条写 AuditLog，`actorKind` 区分 `human` / `platform_admin`。

### 受影响意图
- 老板改折扣表要等另一位老板批准（Lucas 可直批）。
- Miki 35% 以内不再触发审批；Alex/Lynn 超 `promoMaxPct` 仍触发。
- 报价超限未批时发送按钮 / 分享链接报错。
- org_admin 不能再改成员角色。

### Out of scope
- 出单品类范围；导航与平台角色收口；数字员工；会计视图。

### 验收
- 单测（纯函数）：折扣分档决策表每行一例（≤上限 / 合价区间 / 超 35% × 岗位 sales_rep / pricing_lead / owner / platform_admin）；审批人 ≠ 提交人；平台管理员自批标记。
- 路由测试：三处发送出口在 `required` 时 409；`approved` 后放行。
- `discount-permissions` 旧测试改为岗位判定。
- `npm test` 全绿；`openspec validate perm-2-discount-by-position` 通过；specs 增量覆盖：折扣分档、设置审批、发送前置、成员管理权限四项对外行为。

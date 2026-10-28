# Proposal

TASKFLOW：PERM-4a（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）；任务书 `docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md` PERM-4a 段（判断点 2026-10-28 已拍板）

## Why

销售区还有 8 个路由与 `org-context.ts` 4 处按平台角色字符串（`isAdmin` / `isSuperAdmin` / `canManageUsers` / `user.role === "admin"`）短路，平台 `admin`（非 super_admin）在这些点仍是全权、在报价读写上却已被 PERM-2 收回，口径不一致；其中测量记录列表与定金登记连企业边界都没有。已签约报价的金额被改只要有 ORG 改权即直接生效，没有第二人把关。

## What Changes

- 删除 `src/lib/sales/org-context.ts` 的 4 处 `isAdmin` 短路（`resolveSalesScope`、`resolveSalesAuthorizedWhere`、`assertSalesOpportunityInOrgForMutation`、`assertSalesCustomerInOrgForMutation`），一律走 `authorize`；平台 super_admin 的全权只来自平台管理员绑定。**BREAKING**：平台 `admin` 在销售区失去隐含权限。
- 商机详情 GET / PATCH、客户详情 GET / PATCH 删除 `isAdmin` 分支，统一按 `sales.opportunity.read / update`、`sales.customer.read / update` 资源级判定。
- 客户删除（软归档）改为要求 `sales.customer.archive`（资源级），不再是"平台 admin / super_admin"。
- 测量记录列表按当前企业过滤（经客户所属企业），范围按 `sales.customer.read`：ORG → 企业全部，本人范围 → 本人测量的记录。
- 标记签约、上传报价 PDF、登记定金：把"创建人或平台 admin"改为 `sales.quote.update` 资源级判定；登记定金补企业边界（跨企业 404）。超限折扣未批的拦截只对平台 super_admin 放行（与 PERM-2 自批口径一致），平台 `admin` 不再放行。
- 代设他人销售目标：要求 `sales.analytics.read` 全企业范围，目标人必须是本企业活跃成员；删除 `canManageUsers`。
- 销售知识库向量索引初始化：只允许平台 super_admin（原来只认 `admin`，super_admin 反被拒）。
- 新增权限键 `sales.quote.signed_amount.approve`（ORG，HIGH），只绑 `owner`。
- 已签约（`signed` / `accepted`）报价的修改若改变总价：不落库，生成审批 `sales.update_signed_quote`，返回 202；另一位持 `sales.quote.signed_amount.approve` 的人批准后由执行器按提交内容落库（报价版本未变才执行），平台 super_admin 直批并记自批；总价不变的修改照旧直接生效。
- `owner` 模板以 ORG 范围追加 `sales.customer.update`、`sales.customer.archive`、`sales.opportunity.update`、`sales.quote.update`、`sales.quote.signed_amount.approve`（"全看全改"落到权限键）。

## Capabilities

### New Capabilities
- `sales/record-access`: 销售客户、商机、测量记录、报价出口（签约 / PDF / 定金）与销售目标的授权判定——统一按岗位权限键与资源归属，不因平台角色短路
- `sales/signed-quote-amount-approval`: 已签约报价改总价的审批提交、批准执行、版本校验与自批规则

### Modified Capabilities
- `authorization/position-catalog`: 老板岗位追加销售改权、客户归档权与签约改价审批权；权限目录登记新键 `sales.quote.signed_amount.approve`

## Out of scope

- 报价行级出单编辑（任务书第 5 条）：报价行没有工艺字段，签字后由 sunny-process 生成工艺单，出单人在工艺单上按品类改（PERM-3 已覆盖）；另开报价行入口会与已生成的工艺单不同步。2026-10-28 拍板移出。
- `src/app/api/trade/**` 的 `requireRole`（PERM-6）；运营 / 组织 / 项目财务路由（PERM-4b）；导航、默认工作区、客户端 `permissions-client.ts` 与平台角色压扁（PERM-4c）。
- `User.role` 列与 `PLATFORM_ROLES` 枚举不删；`isAdmin` / `isSuperAdmin` 函数本身不删（销售区以外仍有调用）。
- 签约报价非金额字段的修改流程不变；超限折扣三档（PERM-2）不变。

## Impact

- `src/lib/sales/org-context.ts`；`src/app/api/sales/opportunities/[id]/route.ts`、`customers/[id]/route.ts`、`measurements/route.ts`、`home/route.ts`、`knowledge/init/route.ts`
- `src/app/api/sales/quotes/[quoteId]/route.ts`（PUT 拆出共用落库函数）、`mark-signed/route.ts`、`pdf/route.ts`、`record-deposit/route.ts`；新建 `src/lib/sales/quote-update.ts`
- `src/lib/authorization/permissions.ts`、`role-defaults.ts`、`__tests__/authorize.test.ts`
- `src/lib/pending-actions/types.ts`、`executor.ts`；`src/lib/ai-grader/actions/wechat-confirm-policy.ts`（新类型 `sales.update_signed_quote`）
- 零 schema；审批载荷落既有 `PendingAction.payload`；不新增队列 / 执行器注册表
- 上线：合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`（owner 模板变了）；上线前按 PERM-2 报告 §4-1 清查平台 `admin` 账号

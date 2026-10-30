# Design

## Context

- 授权内核已就绪：`authorize()` / `buildAuthorizedWhere()` 按岗位绑定（无绑定时按组织角色兼容回退）判定；平台 super_admin 经 `platformAdminBindings()` 拿到全部键的 ORG 范围（PERM-1）。所以删掉 `isAdmin` 短路后，super_admin 行为不变，变的只有平台 `admin`。
- `isSuperAdmin()` 与 `isAdmin()` 同义（都是 `admin || super_admin`），名字误导；真正只认 super_admin 的是 `isPlatformSuperAdmin()`。
- 现存短路点（2026-10-28 盘点）：`org-context.ts` 4 处；`opportunities/[id]` GET / PATCH；`customers/[id]` GET / PATCH / DELETE；`measurements` GET（且无企业过滤）；`home` PUT（`canManageUsers`）；`knowledge/init`（只认 `admin`）；`quotes/[quoteId]/mark-signed`、`pdf`、`record-deposit`（"创建人或 admin"，定金还无企业边界）。
- 报价修改只有一个入口：`PUT /api/sales/quotes/[quoteId]`（全量替换行与附加项，约 470 行，含 PERM-2 折扣三档与超限审批快照处理）。已签约报价被修改时既有规则是作废签名、回到 `draft`。
- 审批先例：PERM-2 `sales.update_quote_settings`（持有者优先 + 兜底收件人 + `requestApproval` + 执行器校验批准人与版本）、PERM-3 `orders.cancel_blinds_order`（执行器 `checkQuoteApprover` + 幂等）。新审批一律走 `requestApproval`（runtime-architecture 守卫禁止直接写 PendingAction）。

## Goals / Non-Goals

**Goals:**
- 销售区服务端判定只剩两类：权限键 + 资源归属；平台 super_admin（经平台管理员绑定或少数显式的平台运维 / 自批分支）。
- 签约单改总价两人把关，执行器复用与 PUT 相同的落库逻辑，不出现第二份报价保存实现。

**Non-Goals:**
- `src/app/api/sales/quotes/route.ts`、`quotes/[quoteId]/route.ts`、`quote-settings/discounts/route.ts` 里传给折扣三档的 `isPlatformSuperAdmin(user.role)` 不动（PERM-2 的自批口径）。
- `src/app/api/sales/cockpit/**` 的局部变量 `isAdmin = !ownOnly` 只是命名，不是角色判定，不改。
- `src/lib/rbac/roles.ts` 的 `isAdmin` / `isSuperAdmin` / `canManageUsers` 不删、不改语义（运营 / 外贸 / 组织路由仍在用，属 PERM-4b / PERM-6）。
- `src/lib/permissions-client.ts` 与客户端组件的角色门禁（PERM-4c）。
- `quotes/[quoteId]/send-email`、`mark-sent`、分享链接（PERM-2 已按 `sales.quote.send` 与交付闸处理）。
- `SalesQuoteItem` 结构与报价行级编辑（已移出，见 proposal Out of scope）。

## 八条硬纪律对照

1. 零 schema：触碰。只加权限键（代码常量）与岗位模板绑定；审批载荷落既有 `PendingAction.payload`，版本用既有 `SalesQuote.updatedAt`。无 migration。
2. 出站先审批：触碰（方向一致）。签约单改价是敏感内部变更，新增审批；不新增任何对外发送。
3. 禁止第三套队列：触碰。审批走既有 `requestApproval` + `pending-actions/executor` 的 switch，不新增队列 / 调度 / 注册表。
4. 脱敏：触碰。审批预览与通知只含报价号、客户名、改前改后总价；不含行级成本快照 `costPrice`、成本率、毛利（spec 有 SHALL NOT）。不涉及 Muse 通道。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：触碰。"是否改了总价"是用定价引擎重算后与当前 `grandTotal` 比较（阈值 0.005），不调用 LLM。
8. 测试注册：触碰。新测试文件在 `scripts/test-all.sh` 注册；CI 子集按需加入 `scripts/test-ci-unit.sh`。

## Decisions

### D1 删除短路而不是换成 `isPlatformSuperAdmin`
`org-context.ts` 与各路由的 `isAdmin` 分支直接删除，判定全部交给 `authorize`；super_admin 的全权由 `platformAdminBindings()` 提供。
- 否决：把 `isAdmin(user.role)` 换成 `isPlatformSuperAdmin(user.role)` 保留短路。理由：两套来源（短路 + 绑定）会再次分叉；且 `buildAuthorizedWhere` 对 super_admin 已经返回 `{ orgId }`，短路没有收益。

### D2 `isPlatformSuperAdmin` 只保留在三类显式分支
允许出现的位置：PERM-2 折扣自批（已有）、超限未批拦截的放行（mark-signed / pdf）、平台运维动作（knowledge/init）、本次签约改价的 super_admin 直接生效。验收 grep 用 `isAdmin\(|isSuperAdmin\(|canManageUsers\(|user\.role\s*[!=]==`，不把 `isPlatformSuperAdmin(` 算违规。
- 否决：任务书原验收 `grep "user\.role"` 为空。理由：会连带改掉 PERM-2 刚落地的自批判定；为过 grep 包一层同义函数是纯形式，不改变行为。

### D3 测量记录按 `sales.customer.read` 定范围
`MeasurementRecord` 无 `orgId`，用 `customer.orgId = 当前企业` 过滤；ORG → 全部，本人范围 → `measuredById = 本人`（保留现有"销售看自己测的"语义）。
- 否决：新增 `sales.measurement.read` 键。理由：测量是客户档案的一部分，独立键只会让每个岗位多绑一个键，没有不同的授予对象。

### D4 代设他人目标用 `sales.analytics.read`（ORG）
- 否决：`sales.settings.manage`。理由：该键走设置审批流程（PERM-2），设目标不需要审批；看全员业绩的人（老板 / 合价 / 会计 / 销售经理）就是会给人定目标的人。会计也持该键——目标不是金钱出账，接受。

### D5 签约改价：PUT 内判定 + 共用落库函数
把 PUT 的"计算 + 事务落库"抽成 `src/lib/sales/quote-update.ts` 的 `prepareQuoteUpdate`（只算，不写）+ `commitQuoteUpdate`（事务落库）两步（输入：企业、报价、提交内容、操作者身份用于折扣三档），PUT 与执行器共用；拆两步是因为 PUT 要先拿到新总价再决定走审批还是落库。超限折扣审批收口的 PendingAction 写入放 `src/lib/pending-actions/quote-promotion-settle.ts`（runtime-architecture 守卫要求审批存储归口 `pending-actions/`）。PUT 先算出新总价：已签约且总价变化且操作者不是 super_admin → 查重（已有待批 → 409）→ 选收件人（持 `sales.quote.signed_amount.approve` 者优先，排除提交人；空则企业 owner / org_admin 兜底；仍空 → 409 `NO_APPROVER`）→ `requestApproval(sales.update_signed_quote)` → 202。载荷：提交内容原样、`baseUpdatedAt`、改前 / 改后总价、提交人。
- 执行器：`checkQuoteApprover(..., "sales.quote.signed_amount.approve")`（批准人 ≠ 提交人，super_admin 可自批）→ 报价仍在本企业、`updatedAt === baseUpdatedAt`，否则失败"报价已变化，请重新提交" → `applyQuoteUpdate`（折扣三档按**提交人**身份判定）→ 审计 `sales.signed_quote.amount_changed` → 通知提交人。
- 否决 A：执行器内部再调一次 PUT 路由。理由：执行器没有 request 上下文，且架构守卫禁止旁路 HTTP。
- 否决 B：只存"金额差"在批准后打补丁。理由：总价由行与附加项算出，只改总价会与行不一致。
- 否决 C：所有签约单修改都走审批。理由：拍板只要求改金额把关，备注 / 订单号这类修改不应排队。

### D6 新键 `sales.quote.signed_amount.approve` 而非复用折扣审批键
- 否决：复用 `sales.quote.discount.over_limit.approve`。理由：两者今天都只给老板，但语义不同（折扣比例 vs 已成交合同金额）；以后若让销售经理批超限折扣，不应顺带获得改合同金额的批准权。

### D7 owner 追加销售改权
删掉短路后，老板若平台角色是 `admin` 会失去改客户 / 商机 / 报价的能力；`owner` 模板描述本来就是"全看全改"。追加 `sales.customer.update / archive`、`sales.opportunity.update`、`sales.quote.update`、`sales.quote.signed_amount.approve`（均 ORG）。签约单改总价对老板同样要另一位审批人。
- 否决：继续依赖平台角色 `admin` 给老板改权。理由：与 PERM-4c 压扁平台角色的方向相反。

## Risks / Trade-offs

- [平台 `admin` 账号失去销售区隐含权限，是 BREAKING] → 上线前按 PERM-2 报告 §4-1 查 `User.role='admin'` 账号并补岗位绑定；合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`。
- [Sunny 只有一位老板时签约单改总价无人可批] → 返回 409 `NO_APPROVER` 明确告知；平台 super_admin（Lucas）可直接改或批准。兜底收件人（org_owner / org_admin）若不持审批键，在企业已有持有者时不能批准（与 PERM-2 一致），审批会等到 super_admin 处理。
- [抽出 `applyQuoteUpdate` 是对 470 行路由的重构，可能改坏 PERM-2 折扣三档与审批快照] → 抽函数时逐段搬运、不改逻辑；保留 `discount-tier.test`、`promotion-approval.test`、`quote-settings-approval.test` 全绿；新增签约改价测试覆盖"总价不变 200 / 变化 202 / 重复 409 / 无人可批 409"。
- [载荷含完整 `formDataJson`，体积较大] → 只在签约改价时产生，频率低；不含成本字段以外的敏感信息（`formDataJson` 是报价单本身，审批人本来就能看报价）。
- [测量记录列表从"admin 看全平台"收窄为"当前企业"] → 平台 super_admin 切换企业即可；这是修正跨企业泄露。

## Migration Plan

1. 合并前：Lucas 按 PERM-2 报告 §4-1 清查平台 `admin` 账号，需要的人补岗位绑定。
2. 合并后：对 Sunny 跑 `seedOrgAuthorizationProfiles`（owner 模板追加 5 个键，幂等）。
3. 回滚：revert PR；owner 模板回退需再跑一次 seed；已生成的 `sales.update_signed_quote` 待批审批在回滚后无执行器，需在审批中心拒绝。

## 验证方式

- `npx tsx src/lib/authorization/__tests__/authorize.test.ts`：owner 新增 5 键快照、pricing_lead 不含新审批键与归档键、新键 HUMAN only。
- `npx tsx src/lib/sales/__tests__/security1-sales-authz.test.ts`：追加"平台 admin 无绑定 → 客户 / 商机 / 测量拒绝"与 super_admin 允许。
- 新增 `src/lib/sales/__tests__/signed-quote-amount.test.ts`（纯函数：是否需审批、收件人选择、载荷不含成本字段、版本校验）并注册。
- `npx tsx src/lib/ai-grader/actions/__tests__/wechat-confirm-policy.test.ts`：类型数 +1，`sales.update_signed_quote` 为仅网页。
- `discount-tier.test`、`promotion-approval.test`、`quote-settings-approval.test`、`phase5-contract.test`、`quote-ops-contract.test` 回归通过。
- 隔离库（本地 Postgres 16 + pgvector，见 HANDOFF 环境注意）跑一条签约改价端到端：202 → 另一老板批准 → 报价更新且回 `draft`；自批被拒；提交后改备注再批准 → 失败。
- `grep -rnE "isAdmin\(|isSuperAdmin\(|canManageUsers\(|user\.role\s*[!=]==" src/app/api/sales src/lib/sales --include=*.ts | grep -v __tests__` 为空。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`；`openspec validate perm-4a-sales-authorize --strict`。

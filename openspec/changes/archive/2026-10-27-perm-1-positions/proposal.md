# Proposal: perm-1-positions

**TASKFLOW：** PERM-1（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）；承载任务书 `docs/QINGYAN_PERM-1-2_POSITIONS_DISCOUNT_TASKBRIEF.md` 的 PERM-1 部分。
**受影响的 Muse 意图：** 无。本 change 不触碰 `src/lib/muse-bridge/**`。

## Why

Security-1 的岗位表（RoleProfile / PrincipalRoleBinding）已建好，但 Sunny 没有一条岗位绑定，所有人都走"OrganizationMember.role + 平台角色"的兼容回退，四个老板里只有一个能是 org_owner。没有岗位数据，后续折扣 / 审批 / 出单按岗位判定（PERM-2 起）无从落地。

## What Changes

- 新增窗饰企业岗位模板集（industryPackId = `window_covering_services_v1` 的企业）：`owner`（老板）、`pricing_lead`（销售合价）、`ops_lead`（运营主管）、`accounting`（会计）、`bids`（招投标）、`fulfillment_vinyl` / `fulfillment_drapery` / `fulfillment_shades`（出单，三条品类线）；复用已有 `sales_rep`、`ops_staff`。非窗饰企业（梦馨）不落这套模板。
- 新增 Permission Registry 权限键：`sales.quote.pricing_close`、`sales.quote.discount.over_limit.submit`、`sales.quote.discount.over_limit.approve`、`sales.settings.manage`、`sales.order.create`、`orders.fulfillment.update`、`inventory.manage`、`accounting.read`、`identity.position.manage`。本 change 只登记与绑定，不改任何路由判定。
- 新增绑定脚本 `scripts/bind-positions.ts`：按 `--org <企业 code> --file <绑定文件> --actor <平台管理员邮箱>` 把"邮箱 → 岗位 key 列表"写成 PrincipalRoleBinding；必须 `ALLOW_POSITION_BINDING=true`；执行者必须是平台 super_admin；幂等；每条新增 / 停用写 AuditLog；退出码 0 / 1（拒绝）/ 2（输入错误）。
- 新增 Sunny 绑定文件 `config/positions/sunny.json`：按设计稿 §3 列出 11 人的岗位；邮箱未知者写 `TODO:<姓名>` 占位，脚本遇占位整文件拒绝（退出 2），防止半截绑定。
- 修改有效权限解析：平台 `super_admin` 直接获得 Registry 全部权限、ORG 范围，来源标记 `platform_admin`；不再依赖企业内岗位绑定。设计稿 §4 第 3 条。
- 写 `docs/QINGYAN_PERM-1_REPORT.md`；`docs/QINGYAN_PERMISSION_TASKFLOW.md` PERM-1 状态列改 `[G]`。

## Capabilities

### New Capabilities
- `authorization/position-catalog`：企业岗位目录——按行业包落地的岗位模板集与权限键登记；岗位是 permission + dataScope 的集合，一人可绑多岗取并集。
- `authorization/position-binding`：岗位绑定脚本——平台管理员把人与岗位的对应关系写入系统的受控入口（入口、保护条件、幂等、审计、退出码）。
- `authorization/platform-admin-authority`：平台管理员权限——super_admin 在任何企业内的有效权限来源与标记。

### Modified Capabilities
（无。`openspec/specs/` 目前只有 `qa/test-registry`，与本 change 无关。）

## Impact

- `src/lib/authorization/role-defaults.ts`：新增窗饰模板集与按行业包选择模板的导出；现有 8 个系统模板不改。
- `src/lib/authorization/permissions.ts`：Registry 追加 9 个 key；现有 key 不改。
- `src/lib/authorization/seed-org-profiles.ts`：按 `Organization.industryPackId` 追加落地窗饰模板集；现有 org_owner / org_admin / 平台 sales 自动绑定逻辑不改。
- `src/lib/authorization/resolve-effective-permissions.ts`：加 super_admin 分支；兼容回退不改。
- 新文件：`scripts/bind-positions.ts`、`src/lib/authorization/position-binding.ts`（纯函数：解析、校验、计算绑定差异）、`config/positions/sunny.json`、`src/lib/authorization/__tests__/position-binding.test.ts`。
- `scripts/test-all.sh`：注册新测试；`src/lib/authorization/__tests__/authorize.test.ts` 追加模板快照断言。
- 数据库：零 schema。只写既有表 RoleProfile / RolePermissionBinding / PositionTemplate / PrincipalRoleBinding / AuditLog。
- 运行时行为：销售（Alex、Lynn）在已接入 `authorize` 的两处（报价详情、销售上下文）从"兼容回退"变为"绑定"，结果仍为本人范围；super_admin 在这两处从"按 isAdmin 跳过"变为"authorize 允许"，结果不变。其余接口判定不变。

## Out of scope

- 不改任何路由的权限判定（折扣、发送、成员管理留 PERM-2）。
- 不做岗位管理 UI / API；绑定只走脚本。
- 不给梦馨建岗位；不改梦馨现有绑定。
- 不实现 CATEGORY 数据范围（出单按品类留 PERM-3）；出单岗位本次只绑读权限。
- 不改 `OrganizationMember.role` 语义与唯一 org_owner 保护。
- 不改数字员工（DIGITAL_EMPLOYEE）分支。

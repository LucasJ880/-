# Proposal

TASKFLOW：PERM-4c3（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）；任务书 `docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md` PERM-4c 段 What-4 / What-5（拍板：先 Sunny、梦馨不动、Sunny 无人用 `manager`、`trade` 不动；"拍板结果 · PERM-4c"第 1–3 条）

## Why

设计稿 §2.1 的终态是平台角色只剩 `super_admin / user`，业务权限全部来自岗位。4c1 / 4c2 已让窗饰企业（Sunny）的项目财务、导航、默认落地、底栏按岗位键判定。还剩两件：
- 把 Sunny 成员的平台角色 `boss / manager / operations / sales` 压成 `user`（数据，不改列）；
- 窗饰企业关闭"按成员角色回退到系统模板"的兼容路径，有绑定才有权限，防止压扁后漏放。

**propose 前的盘点发现，压扁不能在本 change 合并后立即执行。** 导航之外仍有约 25 处运行时逻辑按平台角色判定，Sunny 压扁后会立刻失效：
- 销售的 AI 销售 / 秘书 / 项目工具、晨报、Muse 销售查询；
- 老板的 Muse 金额（决定 B）、团队任务、运营项目列表、交接、审批执行、管理层通知；
- 等等。

清单见 design D6，并落成文档 `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md`。所以本 change 交付"可安全合并、但写库被代码闸门挡住"的压扁工具。闸门由后续残留收口 change 打开。

## What Changes

- **压扁脚本** `scripts/collapse-platform-roles.ts`，纯函数规划在 `src/lib/authorization/platform-role-collapse.ts`。
  - 双闸：`ALLOW_ROLE_COLLAPSE=true`，且执行者是平台 super_admin。`--dry-run` 打印每人前后角色。
  - 只改该企业 active 成员中 `User.role ∈ {boss, manager, operations, sales}` 的人 → `user`。`super_admin / admin / trade / user` 不动。
  - 前置拒绝（退出 2，列出名单）：
    - 企业不是岗位模式；
    - 待改的人没有任何 active 人类岗位绑定；
    - 待改的人还是某个旧模式企业（无岗位模板，如梦馨）的 active 成员——`User.role` 跨企业共用，压扁会改变他在梦馨的菜单与权限。
  - 每人写一条 AuditLog（`authorization.platform_role.collapse`，含前后角色）。
  - `--restore` 按 AuditLog 把本企业被压扁且当前仍是 `user` 的人还原，写 `authorization.platform_role.restore`。
- **写库闸门**：常量 `PLATFORM_ROLE_COLLAPSE_READY = false`。为 false 时脚本只允许 `--dry-run` 与 `--restore`，真正写入退出 1 并指向残留清单文档。后续残留收口 change 全部合并后再改为 true。
- **兼容回退收口**：`resolveEffectiveBindings` 对岗位模式企业（行业包有岗位模板）的人类主体，无 active 岗位绑定时返回空，不再按 `OrganizationMember.role` / 平台角色 `sales` 回退到系统模板。旧模式企业（梦馨）照旧。平台 super_admin 全权不变。
  - 此项**合并即生效**，不等脚本。
- **残留清单**：`docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md`。按"AI / 接口 / 仅界面 / 通知收件人 / 数据"分组，逐条写明 file:line、门槛、压扁前后差异、建议改法与归属 change。

## Capabilities

### New Capabilities
- `authorization/platform-role-collapse`：压扁脚本的入口与双闸、前置校验、写入与幂等、审计与还原、写库闸门

### Modified Capabilities
- `authorization/position-binding`：新增"岗位模式企业不做成员角色兼容回退"
- `authorization/platform-admin-authority`："非平台管理员不受影响"改为兼容回退只在旧模式企业发生

## Out of scope

- 残留平台角色读点的改造（D6 清单，拆为后续 change，见 design D6 建议）；本 change 不改任何 AI 工具、Muse、任务、审批、通知逻辑。
- 外贸 `src/app/api/trade/**` 的 `requireRole` 与 `trade` 角色（PERM-6）；`revenue-spine` 走外贸通道的部分同属 PERM-6，清单里标注。
- 梦馨压扁与梦馨落岗位。
- `User.role` 列、`PLATFORM_ROLES` 枚举、`roles.ts` / `nav-role-policy.ts` 的旧值（梦馨与外贸仍在用）。
- 生产上实际执行脚本（Lucas 在闸门打开后做）。

## Impact

- 新增：`src/lib/authorization/platform-role-collapse.ts`、`scripts/collapse-platform-roles.ts`、`docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md`、测试 `src/lib/authorization/__tests__/platform-role-collapse.test.ts`（纯）与 `platform-role-collapse-db.isolated.test.ts`（隔离库）
- 修改：`src/lib/authorization/resolve-effective-permissions.ts`（岗位模式关闭兼容回退）；`scripts/test-all.sh`、`scripts/test-ci-unit.sh` 注册
- **BREAKING（Sunny，合并即生效）**：没有任何 active 岗位绑定的 Sunny 成员失去兼容回退来的系统模板权限（`org_owner` / `org_admin` / `org_viewer` / 平台 `sales` → 系统模板）。上线前用 `bind-positions --dry-run` 确认全员已绑定。`seedOrgAuthorizationProfiles` 已自动把 `org_owner` / `org_admin` / 平台 `sales` 成员绑到系统模板，那是真实绑定，不受影响。
- 零 schema：前后角色存 AuditLog（既有表）；还原读 AuditLog。

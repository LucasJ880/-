# Proposal

TASKFLOW：PERM-4c1（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）；任务书 `docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md` PERM-4c 段 What-1 与 What-4 的 `canManageUsers` 删除（拍板见末尾"拍板结果 · PERM-4c"，2026-10-28 已定）

## Why

项目财务与报价引擎的"特权直通"按企业成员角色 `org_admin` 判（设计稿 §5 冲突 C4），与岗位无关：老板岗位不是 `org_admin` 就批不了费用，会计岗位（`project.finance.read`，PERM-5a）不是项目成员就进不了单项目财务页。本次把特权换成岗位权限键，同时删掉最后一处 `canManageUsers`。

## What Changes

- 新增权限键 `project.finance.manage`（"管理项目财务"，HIGH，ORG，只允许人类）：只绑定 `owner` 岗位（系统模板 `org_owner` / `org_admin` 不绑——seed 会把企业管理员成员自动绑到这两个模板，绑上就等于保留 `org_admin` 特权）。
- 项目财务接口（`/api/projects/{id}/finance/**`）的特权判定从"平台 super_admin 或 `org_admin` 或项目负责人"改为"平台 super_admin 或在该企业持 `project.finance.manage`（ORG）或项目负责人"：可编辑预算、审核费用、登记付款、替他人提交 / 上传票据、看全部费用与应付。**BREAKING**：只靠 `org_admin` / `org_owner` 成员角色、不持 `owner` 岗位的人失去财务与报价引擎特权（所有企业；项目财务与报价引擎在生产默认关闭，当前无线上影响）。
- 持 `project.finance.read`（ORG）的人（会计、老板）在该企业已派发项目上可只读访问项目财务接口，**即使不是项目成员**：能看预算、全部费用、全部应付、收入、汇总、表现；不能编辑预算、审核费用、登记付款、替他人操作。
- 报价引擎（`/api/projects/{id}/quote-engine/**`）的特权同样改为平台 super_admin / `project.finance.manage`（ORG）/ 项目负责人；项目成员按项目角色的规则不变。
- 招投标交接（`src/lib/projects/handoff/access.ts`）的管理者判定去掉 `canManageUsers`（平台 admin / boss）；删除 `src/lib/rbac/roles.ts` 与 `src/lib/permissions-client.ts` 的 `canManageUsers` / `canDeleteUsers`。**BREAKING**：平台 `admin`（非 super_admin）不再是交接管理者。

## Capabilities

### New Capabilities
- `projects/finance-access`: 项目财务与报价引擎的特权、只读访问与非成员只读的判定
- `projects/handoff-access`: 招投标交接管理者判定不含平台角色 admin

### Modified Capabilities
- `authorization/position-catalog`: 登记 `project.finance.manage`；`owner` 与系统模板 `org_owner` / `org_admin` 绑定

## Out of scope

- 导航、默认工作区、底栏（PERM-4c2）；平台角色压扁与关闭兼容回退（PERM-4c3）。
- 项目成员按项目角色（`hasProjectPermission`）的财务权限矩阵不改；`requireProjectReadAccess` 对其他项目接口的口径不改（只在财务接口内追加"持结算只读键可进"）。
- `bids` 岗位不绑定 `project.finance.manage`（招投标参与方按拍板 3 只看自己参与项目的结算汇总；在自己项目里的财务权限仍按项目角色）。
- 财务功能开关（`TENDER_FINANCIAL_CONTROL_ENABLED` 等）与报价引擎开关不改。
- 外贸 `requireRole`（PERM-6）。

## Impact

- `src/lib/authorization/permissions.ts`、`role-defaults.ts`、`__tests__/authorize.test.ts`
- `src/lib/project-finance/access.ts`（集中判定：特权 / 只读全量 / 非成员只读）；`src/lib/projects/access.ts`（导出项目查找）
- `src/app/api/projects/[id]/finance/**` 中 5 个文件的内联特权判定（expenses、expenses/[expenseId]、receipt、budget、payables）
- `src/lib/quote-engine/access.ts`（`resolveQuoteCapabilities` 改为接收岗位特权输入）
- `src/lib/projects/handoff/access.ts`、`src/lib/rbac/roles.ts`、`src/lib/permissions-client.ts`
- 测试：`quote-engine-contract.test`（QE-02 改语义）、`security1-owner-manager.test`（删 `canManageUsers` 用例）、新增纯测试与隔离库 e2e
- 零 schema；上线需对 Sunny 重跑 `seedOrgAuthorizationProfiles`（owner 加了 `project.finance.manage`）；梦馨的 `org_admin` 同样失去财务特权，但财务 / 报价引擎开关在生产关闭，启用前需给梦馨落 `owner` 岗位

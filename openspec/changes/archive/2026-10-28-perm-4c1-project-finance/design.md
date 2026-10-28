# Design

## Context

- `requireCostAccess(request, projectId, perm)`（`src/lib/project-finance/access.ts`）：先过财务开关 → `requireProjectReadAccess`（负责人 / `org_admin` / 项目成员，否则 403；平台 super_admin 直通）→ 特权（super_admin / `org_admin` / 负责人）直通 → 否则按项目角色 `hasProjectPermission`。5 个路由文件另有内联的同款特权判定（`canReview` / `canManage` / `canRecordPayment` / 替他人提交 / 上传票据）。
- `resolveQuoteCapabilities(access)`（`src/lib/quote-engine/access.ts`）是同步纯函数，特权同样含 `org_admin`；`quote-engine-contract.test` QE-02 锁住了"org_admin 直通"。
- PERM-5a 已有 `project.finance.read`（`accounting` / `owner` ORG，`bids` ASSIGNED）。
- `handoff/access.ts` `isManager`：管理层工作区 / super_admin / `canManageUsers`（平台 admin 或 boss）/ `org_admin`。`canManageUsers` 只剩这一个调用点（4b 后）。

## Goals / Non-Goals

**Goals**：财务与报价引擎的特权按岗位键；会计（结算只读 ORG）不是项目成员也能只读进单项目财务；删掉 `canManageUsers`。

**Non-Goals**：
- 不改 `src/lib/rbac/permissions.ts` 的项目角色矩阵与 `hasProjectPermission`。
- 不改 `requireProjectReadAccess` 的对外口径（只导出项目查找函数）。
- 不改 `src/lib/project-finance/**` 的服务层（`approveExpense`、`recordPayment` 等的业务校验、自审批闸）。
- 不改 `src/lib/navigation/**`、`src/lib/rbac/workspace-policy.ts`（4c2）。

## Decisions

### D1 新键 `project.finance.manage`，只给 `owner`
HUMAN only，ORG。`bids` 不绑（拍板 3）。系统模板 `org_owner` / `org_admin` 不绑。
- 否决：挂在系统模板 `org_owner` / `org_admin` 上保持梦馨现状——`seedOrgAuthorizationProfiles` 会把每个 `org_owner` / `org_admin` 成员**自动绑定**到同名系统模板（真实绑定，不只是兼容回退），挂上去等于在 Sunny 也保留 `org_admin` 特权（实施时隔离库 e2e 发现）。项目财务与报价引擎在生产默认关闭（`TENDER_FINANCIAL_CONTROL_ENABLED` / `TENDER_QUOTE_ENGINE_ENABLED`），梦馨当前无线上影响；启用前给梦馨落 `owner` 岗位。
- 否决：给 `bids` 绑 ORG 的 manage——招投标会看到所有项目的逐笔费用与收据，违反 PERM-5a 拍板 3；招投标在自己项目里的权限仍按项目角色。
- 否决：财务判定里保留 `org_admin` 分支只对非窗饰企业生效——两套口径散在路由里。

### D2 集中判定 `resolveFinancePrivilege`，路由只读结果
`requireCostAccess` 在通过访问校验后算出 `finance = { privileged, canReadAll }` 并挂到返回的上下文：
- `privileged` = super_admin ∨ authorize(`project.finance.manage`, ORG) ∨ 项目负责人；
- `canReadAll` = `privileged` ∨ authorize(`project.finance.read`, ORG)。
请求的 `perm` 判定：`privileged` → 全过；`canReadAll` 且 `perm = PROJECT_COST_READ` → 过；否则按项目角色。5 个路由的内联判定改为 `access.finance.privileged`（审核 / 编辑 / 付款 / 替他人）与 `access.finance.canReadAll`（看全部列表），项目角色分支原样保留。
- 否决：每个路由各自调 `authorize`——5 处重复、容易漏；`p15-authz-contract` 已按"每路由服务端闸"断言，集中后仍在服务端。

### D3 非成员只读进入：仅在财务访问函数内
`requireCostAccess` 先调 `requireProjectReadAccess`；若被拒（非成员 403），再查：项目存在、`intakeStatus = dispatched`、调用者是项目所属企业 active 成员、持 `project.finance.read` 或 `project.finance.manage` 的 ORG 范围 → 构造上下文（`projectRole = null`）继续。`src/lib/projects/access.ts` 只导出 `findProjectForAccess`。
- 否决：改 `requireProjectReadAccess` 本身——会让会计能读项目的所有非财务接口，超出本次范围（4c2 / 后续评估）。
- 否决：会计只走 PERM-5a 的汇总接口——任务书 What-3 与 5a 报告 §4 都把"会计进单项目财务页"留给 4c。

### D4 报价引擎：`resolveQuoteCapabilities(access, { financeManage })`
纯函数多一个输入（调用方 `requireQuoteAccess` 先 authorize 得出），特权 = super_admin ∨ `financeManage` ∨ 负责人；QE-02 用例改为"org_admin 不再直通、持 manage 直通"。
- 否决：报价引擎也开放给 `project.finance.read` 非成员——内部成本 / 毛利不在本次需求内。

### D5 删除 `canManageUsers` / `canDeleteUsers`
`handoff/access.ts` 去掉该行（boss 已由管理层工作区判定覆盖，平台 admin 失去）；`roles.ts`、`permissions-client.ts` 删函数；`security1-owner-manager.test` 删对应用例；`onboarding-rules.ts` 注释同步。
- 否决：保留函数只标 deprecated——4b 已标，任务书要求 4c 删除。

## 与八条硬纪律的关系

1. 零 schema：触碰。新键是代码常量；无字段、无迁移。
2. 出站先审批：不涉及（财务审批 / 付款的业务闸不改）。
3. 第三套队列：不涉及。
4. 脱敏：触碰（数据面）。会计只读不开放报价引擎内部成本；Muse 通道不涉及。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：触碰。全部是查表判定；不新增 LLM 调用。
8. 测试注册：触碰。新测试注册 `scripts/test-all.sh`，纯测试同时进 `scripts/test-ci-unit.sh`。

## Risks / Trade-offs

- **BREAKING**：只靠 `org_admin` / `org_owner` 成员角色、无 `owner` 岗位的人失去财务与报价引擎特权（所有企业）。两个功能在生产默认关闭，当前无线上影响；启用前核对谁需要 `owner`。Sunny 上线前按 4a / 4b 同口径核对：需要的人绑 `owner`。
- 平台 admin 失去交接管理者身份（与 4a / 4b 一致）。
- `requireCostAccess` 每次多 1–2 次 authorize 查询；财务接口低频，可接受。

## 验证方式

- `npx tsx src/lib/authorization/__tests__/authorize.test.ts`（新键登记与模板）
- `npx tsx src/lib/project-finance/__tests__/finance-access.test.ts`（新，纯：特权 / 只读全量 / perm 判定决策表、源码断言 5 个路由不再出现 `org_admin`、QE 特权）
- `src/lib/project-finance/__tests__/finance-access-db.isolated.test.ts`（新，隔离库，财务开关打开：老板非成员审核费用 200、会计非成员看全部费用 200 / 审核 403、org_admin（有 / 无岗位）均无特权、销售非成员 403、跨企业不可见、负责人编辑预算）
- 回归：`p15-authz-contract`、`p16-authz-contract`、`quote-engine-contract`、`quote-ops-contract`、`security1-owner-manager`、`ops-access`、handoff 相关测试
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate perm-4c1-project-finance --strict`
- 验收 grep：`grep -rn 'orgRole === "org_admin"' src/app/api/projects src/lib/project-finance src/lib/quote-engine`（非测试）为空；`grep -rn "canManageUsers\|canDeleteUsers" src`（非测试）为空

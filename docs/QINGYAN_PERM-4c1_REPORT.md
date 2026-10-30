# PERM-4c1 报告 — 项目财务 / 报价引擎按岗位

change：`openspec/changes/perm-4c1-project-finance/`（proposal / specs ×3 / design / tasks 6/6）
任务书：`docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md` PERM-4c 段（拍板见"拍板结果 · PERM-4c"）
零 schema：新键是代码常量。

## 1. 做了什么

### 1.1 权限键
| 键 | 范围 | 给谁 |
|---|---|---|
| `project.finance.manage`（新，HIGH，"管理项目财务"，只允许人类） | ORG | 只给 `owner` |

`bids`、`accounting`、系统模板 `org_owner` / `org_admin` 都不绑。`authorize.test` 133 → 146。

### 1.2 项目财务（`/api/projects/{id}/finance/**`）
集中在 `src/lib/project-finance/access.ts`：
- **财务特权** = 平台 super_admin ∨ 本企业持 `project.finance.manage`（ORG）∨ 项目负责人：可编辑预算、审核费用、登记付款、替他人提交 / 上传票据、看全部。**不再认 `org_admin`。**
- **结算只读全量** = 特权 ∨ 持 `project.finance.read`（ORG，会计 / 老板）：看全部费用 / 应付 / 预算 / 收入 / 汇总；不能审核、付款、编辑、替他人操作。
- **非项目成员只读进入**：`requireProjectReadAccess` 返回 403 时，若是本企业 active 成员、项目已派发、持结算只读或管理键 → 放行进入财务接口。404（不存在 / 未派发）照旧。其他项目接口口径不变。
- 5 个路由的内联判定改读 `access.finance`（expenses、expenses/[expenseId]、receipt、budget、payables）；项目角色（`hasProjectPermission`）矩阵不变。

### 1.3 报价引擎
`resolveQuoteCapabilities(access, { financeManage })`：特权 = super_admin ∨ `project.finance.manage` ∨ 负责人。

### 1.4 `canManageUsers` 删除
招投标交接管理者判定去掉 `canManageUsers`（平台 admin 不再是交接管理者）；删除 `roles.ts` 的 `canManageUsers` / `canDeleteUsers` 与 `permissions-client.ts` 的 `canManageUsers`。

## 2. 怎么验

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint:baseline` | PASS（改动文件 eslint 0 问题） |
| `npm run test:ci` | PASS（含新 `finance-access.test`；`accounting.test` 中"单项目财务授权未改（5a D4）"一条改为"结算只读键只放行读"——4c1 接手 5a D4） |
| `bash scripts/check-test-registry.sh` | OK（450） |
| `openspec validate perm-4c1-project-finance --strict` | valid |
| `finance-access.test`（新，纯） | **27 / 27**：财务能力决策表 5 种；细粒度放行表（会计只读、老板全过、无键非成员拒、项目角色不变）；报价引擎特权（org_admin / 平台 admin 不直通、manage / super_admin 直通）；源码断言（财务路由无 `org_admin` / 平台角色字符串、5 个路由读 `access.finance`、非成员只在 403 时尝试、需已派发 + active 成员、报价引擎按 manage、`canManageUsers` 已删） |
| `finance-access-db.isolated.test`（新，本地 Postgres 16，财务开关打开） | **18 / 18**：老板非成员审核 / 编辑预算放行、费用列表全部且可审；会计非成员读放行、列表全部不可审、审核 / 编辑 / 付款 / 提交 403；`org_admin` + `sales_rep` 成员只见本人、审核 403；无岗位 `org_admin` 审核 403；销售非成员 403；招投标成员只见本人；跨企业不可见；未派发 404；负责人编辑预算放行；开关关闭 404 |
| 回归 | p15-authz-contract 10、p16-authz-contract 12、p15-pure 7、quote-engine-contract 29、quote-ops-contract 75、security1-owner-manager 13、ops-access 21、tender-profile 5、handoff-domain 33、handoff-failure-recovery 11 |
| 验收 grep | `grep -rn 'orgRole === "org_admin"' src/app/api/projects src/lib/project-finance src/lib/quote-engine`（非测试）空；`grep -rn "canManageUsers\|canDeleteUsers" src`（非测试）空 |

两条既有源码契约断言随语义更新（不是跳过）：`p15-authz-contract`（项目角色判定移入 `allowCostPermission`）、`p16-authz-contract`（应付列表按 `seeAll = canReview || 结算只读` 过滤）；`quote-engine-contract` QE-02 改为"org_admin 不再直通、持 manage 直通"；`security1-owner-manager` 的 `canManageUsers` 用例改为 `isPlatformSuperAdmin` + "函数已删除"。

## 3. 判断与实施中的变更

- **`bids` 不给 `project.finance.manage`**（审核时确认）：招投标在自己项目里按项目角色，看不到所有项目的逐笔费用（PERM-5a 拍板 3）。
- **实施中改了一处设计**（design D1）：原方案把 `project.finance.manage` 也挂在系统模板 `org_owner` / `org_admin` 上以保持梦馨现状；隔离库 e2e 发现 `seedOrgAuthorizationProfiles` 会把每个 `org_owner` / `org_admin` 成员**自动绑定**到这两个系统模板，挂上去等于在 Sunny 也保留 `org_admin` 特权。改为只给 `owner`。代价：梦馨的 `org_admin` 同样失去财务 / 报价引擎特权——两个功能在生产默认关闭，当前无线上影响，启用前给梦馨落 `owner` 岗位。

## 4. 已知限制与上线

- **BREAKING**：只靠 `org_admin` / `org_owner` 成员角色、无 `owner` 岗位的人失去项目财务与报价引擎特权；平台 admin 失去交接管理者身份。
- 项目财务（`TENDER_FINANCIAL_CONTROL_ENABLED`）与报价引擎（`TENDER_QUOTE_ENGINE_ENABLED`）生产默认关闭——本次改动在开关打开前没有线上可见效果。
- 会计非成员进入只限财务接口；项目详情等其他项目页面对会计仍按原规则（不是成员看不到）。
- **上线**：合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`（owner 加 `project.finance.manage`）。

## 5. 合并后

`/opsx:archive perm-4c1-project-finance --yes` 独立小 PR；`openspec list --specs` 应出现 `projects/finance-access`、`projects/handoff-access`；TASKFLOW PERM-4c1 → `[x]`。下一个 `perm-4c2-nav-by-position`。

# Proposal

TASKFLOW：PERM-5a（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）；任务书 `docs/QINGYAN_PERM-5_ACCOUNTING_DIGITAL_EMPLOYEE_TASKBRIEF.md` PERM-5a 段（判断点见末尾"拍板结果 · PERM-5"，2026-10-28 已定）

## Why

设计稿 §4-8 定的是"会计看成交金额、提成、报价全过程；项目单独结算、与销售分开；招投标参与方知道价格即可"，而现在提成与业绩只有"本人本月"口径，会计岗位（Miki）持 `accounting.read` 却没有任何页面或接口能看全员成交、报价审批轨迹与项目结算。本次给会计一个只读视图，口径与销售本人业绩页共用同一套计算，不新造第二套。

## What Changes

- 抽出提成计算纯函数（签约单数、成交金额、真实毛利、提成、成本覆盖），本人提成接口 `GET /api/sales/commission-summary` 改用它，响应不变。
- 新增 `GET /api/accounting/sales-summary?month=YYYY-MM`：要求 `accounting.read`（ORG），按销售人员分组给出签约单数、成交金额、真实毛利、提成、成本覆盖；`format=csv` 时返回 CSV 并写审计 `accounting.export`。响应不含 `costPrice` 与逐行明细（拍板 2）。
- 新增 `GET /api/accounting/quotes?month=YYYY-MM&salesId&status`：要求 `accounting.read` 与 `sales.quote.read`（ORG），列出报价的金额、折扣、超限审批状态与审批人 / 时间、签约时间；不含客户联系方式、地址、备注、成本与签名 / PDF 路径。
- 新增权限键 `project.finance.read`（"查看项目结算"，HIGH，`ASSIGNED` / `ORG`）：`accounting`、`owner` 以 `ORG` 绑定，`bids` 以 `ASSIGNED` 绑定（只看自己参与的项目，拍板 3）。
- 新增 `GET /api/accounting/projects?quarter=YYYY-Qn`：要求 `project.finance.read`，`ORG` 看企业全部项目、`ASSIGNED` 只看本人是成员或负责人的项目；每个项目只给收入 / 费用 / 应付 / 结余汇总，不给逐笔费用与收据；财务控制未启用时返回 `available: false` 与空列表。
- 新增页面 `/accounting`（三个页签：成交与提成、报价过程、项目结算；页签按接口权限显示），导航入口与工作区"会计"：持 `accounting.read` 或 `project.finance.read` 可见；只持会计岗（不持运营 / 招投标写 / 销售专职）的人默认落地 `/accounting`。
- 把 `/api/accounting/` 加入前端按当前企业带 `orgId` 的接口前缀。

## Capabilities

### New Capabilities
- `accounting/sales-commission-view`: 会计看全员成交与提成（口径、分组、导出与审计、不输出的字段）
- `accounting/quote-process-view`: 会计看报价全过程（字段、筛选、不输出的个人资料与成本）
- `accounting/project-settlement-view`: 项目结算汇总（权限范围、与销售成交分离、财务未启用时的行为、不输出逐笔明细）
- `accounting/workspace`: 会计页面、导航入口与默认落地

### Modified Capabilities
- `authorization/position-catalog`: 登记 `project.finance.read`；`accounting` / `owner` / `bids` 模板追加绑定

## Out of scope

- 提成规则本身（按人差异化、阶梯）、工资 / 发放、会计凭证。
- 项目财务既有接口 `src/app/api/projects/[id]/finance/**` 的授权（`requireCostAccess` / `requireProjectReadAccess`）不改——会计不是项目成员时仍进不了单项目财务页；这属于 PERM-4c 的 `project.finance.*` 收口。
- PERM-4c 的其余 `project.finance.*` 键、导航 `requiredPlatformRoles` 删除、平台角色压扁。
- 销售本人业绩页（`/sales/performance`）不改。

## Impact

- `src/lib/authorization/permissions.ts`、`role-defaults.ts`、`__tests__/authorize.test.ts`
- 新建 `src/lib/accounting/`（提成纯函数、月份 / 季度解析、CSV、查询服务、访问判定）
- `src/app/api/sales/commission-summary/route.ts`（改用纯函数，响应不变）
- 新建 `src/app/api/accounting/{sales-summary,quotes,projects}/route.ts`、`src/app/(main)/accounting/page.tsx`
- `src/lib/rbac/workspace-policy.ts`、`src/lib/navigation/{registry,types,filter}.ts`、`src/lib/api-fetch.ts`
- 新测试：`src/lib/accounting/__tests__/accounting.test.ts`（纯）、`src/lib/accounting/__tests__/accounting-db.isolated.test.ts`（隔离库）
- 零 schema；上线需对 Sunny 重跑 `seedOrgAuthorizationProfiles`（accounting / owner / bids 模板加了 `project.finance.read`）

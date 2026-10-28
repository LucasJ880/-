# PERM-5a 报告 — 会计视图

change：`openspec/changes/perm-5a-accounting-view/`（proposal / specs ×5 / design / tasks 7/7）
任务书：`docs/QINGYAN_PERM-5_ACCOUNTING_DIGITAL_EMPLOYEE_TASKBRIEF.md` PERM-5a 段（拍板见末尾"拍板结果 · PERM-5"）
零 schema：只读既有列；新键 `project.finance.read` 是代码常量；导出审计落 AuditLog。

## 1. 做了什么

### 1.1 权限键与岗位
| 键 | 范围 | 给谁 |
|---|---|---|
| `project.finance.read`（新，HIGH，"查看项目结算"） | `ASSIGNED` / `ORG` | `accounting`、`owner`（ORG）；`bids`（ASSIGNED = 本人是成员 / 负责人的项目） |

`authorize.test` 120（含 5b）→ 133。PERM-4c 其余 `project.finance.*` 键不在本次。

### 1.2 提成口径唯一
`src/lib/accounting/commission.ts` `summarizeCommission` / `groupCommissionBySales`（逐行照搬原内联逻辑）。`/api/sales/commission-summary` 改用它，**响应字段不变**（销售本人业绩页不受影响）。

### 1.3 接口（全只读，`/api/accounting/`；前端已加入按企业带 `orgId` 的前缀）
| 接口 | 权限 | 内容 | 不输出 |
|---|---|---|---|
| `GET /sales-summary?month=YYYY-MM[&format=csv]` | `accounting.read`（ORG） | 按销售：签约单数、成交金额、真实毛利、提成、成本覆盖；企业合计；CSV 导出写审计 `accounting.export` | 逐行成本 / 单价、客户资料（拍板 2） |
| `GET /quotes?month&salesId&status` | `accounting.read` + `sales.quote.read`（ORG） | 金额、折扣、特别让利、超限审批状态 / 比例 / 上限 / 批准人与时间 / 驳回人与时间、签约时间；最多 500 | 客户电话 / 邮箱 / 地址、备注、表单原文、分享令牌、签名、PDF、成本 |
| `GET /projects?quarter=YYYY-Qn` | `project.finance.read` | ORG = 全企业已派发项目；ASSIGNED = 参与的项目；每项只给成本 / 收入 / 未结应付 / 未结报销 / 结算状态 / 预测与最终利润；财务控制未启用 → `available:false`；最多 100 | 逐笔费用、收据、付款、供应商明细（拍板 3） |

### 1.4 页面与入口
- `/accounting`（`src/app/(main)/accounting/page.tsx` + `src/components/accounting/accounting-view.tsx`）：三页签"成交与提成 / 报价过程 / 项目结算"，接口 403 的页签不显示（招投标只见项目结算）；月份选择；CSV 下载。
- 工作区 `accounting`：`canAccessAccountingWorkspace` = `accounting.read` 或 `project.finance.read`；导航"会计视图"（`biz-accounting`）。
- 默认落地：持 `accounting.read`、非销售 / 运营专职、不持 `operations.*` / `project.create|update` → `/accounting`（判在招投标之前——会计岗有 `project.read`，原来会被导去 `/bids`）。

## 2. 怎么验

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint:baseline` | PASS（改动文件 eslint 0 问题） |
| `npm run test:ci` | PASS（CI unit subset，含新 `accounting.test`） |
| `bash scripts/check-test-registry.sh` | OK |
| `openspec validate perm-5a-accounting-view --strict` | valid |
| `accounting.test`（新，纯） | **38 / 38**：提成口径与原本人接口内联实现逐项等价（空 / 混合成本 / 小数舍入 / 负毛利）；成交金额；分组排序；本人接口改用纯函数且响应字段不变；月份 / 季度解析（跨年、非法、缺省）；CSV 转义；工作区（纯会计落地 /accounting、招投标可进不落地、销售不可进、持运营键不落地）；导航可见性；源码断言（报价 select 不含敏感列、客户只取名称、项目只取汇总、财务关闭 available:false、ASSIGNED = 成员或负责人、导出审计、既有单项目财务授权未改） |
| `accounting-db.isolated.test`（新，本地 Postgres 16） | **27 / 27**：销售 / 招投标请求成交汇总 403；会计按人分组（Alex 2 单毛利 500 提成 150、Lynn draft 不计）、无 costPrice / 联系方式；Alex 本人提成接口与会计汇总同口径；月份非法 400；CSV + 审计；老板 200；报价过程（销售 403、审批轨迹带批准人姓名与时间、只给客户名、无令牌 / 签名 / 备注 / 联系方式、按销售 / 状态过滤）；项目结算（财务关闭 available:false、会计 ORG 3 个、招投标 ASSIGNED 只 1 个、销售 403、季度非法 400、季度过滤） |
| 回归 | workspace-policy 26、default-workspace 8、home-redirect 9、navigation-workspace 34、navigation-ia 63、nav-active-matcher 21 |

## 3. 判断点（拍板，2026-10-28）

2. 会计不看逐行成本：只给毛利合计、提成、成本覆盖。
3. 招投标参与方只看自己参与项目的结算汇总，不看逐笔费用与收据。

（1、4 属 5b。）实施中的设计选择：
- **不改既有单项目财务路由授权（design D4，偏离任务书 What-3）**：`requireCostAccess` 先过 `requireProjectReadAccess`（负责人 / org_admin / 项目成员），会计不是项目成员时在那一步就 403；改它属于 PERM-4c。若只在 `requireCostAccess` 加分支，对会计无效、对已是成员的招投标反而放开逐笔费用（违反拍板 3）。会计的项目结算走新接口。
- 报价过程按**创建时间**落月（看过程）；成交与提成按**签约时间**落月（与本人口径一致）。
- 项目季度按投标提交时间，无则创建时间。

## 4. 已知限制与上线顺序

- **项目财务在生产默认关闭**（`TENDER_FINANCIAL_CONTROL_ENABLED`）：项目结算页签今天显示"项目财务控制未启用"，如实。收入 / 结算还另受 `TENDER_PROFITABILITY_SCHEMA_READY` 控制，关闭时对应字段为 null。
- 会计点不进单项目财务页（不是项目成员）——PERM-4c 收口 `project.finance.*` 时一并处理。
- 报价过程最多 500 条 / 月、项目结算最多 100 个项目（Sunny 远低于此）。
- **上线**：合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`（accounting / owner / bids 加了 `project.finance.read`）；确认 Miki 绑了 `accounting`。

## 5. 合并后

`/opsx:archive perm-5a-accounting-view --yes` 独立小 PR；`openspec list --specs` 应出现 `accounting/sales-commission-view`、`accounting/quote-process-view`、`accounting/project-settlement-view`、`accounting/workspace`；TASKFLOW PERM-5a → `[x]`。

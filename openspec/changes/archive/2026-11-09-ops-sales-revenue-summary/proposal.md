# Proposal：运营看全公司销售额汇总（VIS-2）

TASKFLOW：VIS-2。Lucas 2026-11-09 拍板。

## Why

Lucas 定的岗位可见规则：销售只看销售额（本人），运营看运营数据和销售额，招投标对销售 / 运营不可见，老板看全部。

对照现状（按代码里的岗位模板与导航规则逐岗位算出）：
- 销售人员：只有本人范围的销售权限，导航只有销售首页 / 客户 / 报价 / 我的业绩——**已符合**。
- 招投标：招投标中心、项目列表、历史中标等只对招投标岗与老板可见——**已符合**。
- 老板：全部可见——**已符合**。
- 运营主管 / 运营人员：能看运营数据，但**没有任何销售数字权限**——这是唯一的缺口。

拍板细节（2026-11-09）：
1. 运营只看汇总数字：全公司本周 / 本月成单金额、成单数、报价金额；看不到客户名单、单个报价和每个销售员的明细。
2. 运营主管和运营人员都看。
3. 销售人员保持只看本人。

## What Changes

- 权限目录新增 `sales.revenue.summary.read`（只支持 `ORG` 范围）：只读全公司销售额汇总，不含客户、报价与按人明细。
- 窗饰岗位模板：`ops_lead`、`ops_staff` 以 `ORG` 范围绑定该键；其他岗位不变（不给运营任何其他 `sales.*` 权限）。
- 新接口 `GET /api/ops/sales-summary`：全企业范围的 `sales.revenue.summary.read` 或 `sales.analytics.read` 放行（运营岗 / 老板 / 合价 / 会计）；只有本人范围或没有 → 403 `SALES_SUMMARY_FORBIDDEN`。只返回本周（本周一至今天）与本月至今的成单金额、成单数、报价金额、报价数，口径与销售期间汇总（KPI-1）同一份计算。
- 运营中心（`/ops`）顶部新增只读卡「全公司销售额」：两栏（本周 / 本月至今）× 三个数字；无权时不渲染；不链到任何销售页。

## Capabilities

### New Capabilities
- `operations/sales-revenue-summary`：运营中心的全公司销售额只读汇总。

### Modified Capabilities
- `authorization/position-catalog`：运营岗位权限加 `sales.revenue.summary.read`；新增权限键登记。

受影响的 Muse 意图：无。

## Impact

- 修改：`src/lib/authorization/permissions.ts`、`src/lib/authorization/role-defaults.ts`、`src/components/ops/ops-workspace-shell.tsx`、测试注册脚本。
- 新增：`scripts/seed-org-authorization.ts`、`src/lib/sales/period/revenue-summary-pure.ts`、`src/lib/sales/period/revenue-summary.ts`、`src/app/api/ops/sales-summary/route.ts`、`src/components/ops/ops-sales-summary-card.tsx`、两份测试、报告与截图。
- 硬纪律：零 schema、零出站、零 LLM、无新队列；运营只多一个只读汇总键，不放宽任何既有销售读写。
- 生效：岗位绑定存在库里，代码上线后需要对 Sunny 重跑岗位模板落地，运营岗才拿到新键。新增只动一个企业的脚本 `scripts/seed-org-authorization.ts --org <code>`（只 upsert、不删；或下一次有人经企业邀请码加入 Sunny 时自动落地）。走 Owner Gate。

## Out of scope

- 管理总览（`/`）的岗位卡与指标（按设计不显示金额，不动）。
- 运营看客户、报价、销售员明细（拍板为只看汇总）。
- 非窗饰企业的运营模板（系统模板 `ops_manager` / `ops_staff` 不变）。
- 导航入口：不新增菜单项（卡片在运营中心内）。

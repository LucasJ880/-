# Design：比价落地价与报价引擎内部数字统一只给有财务查看权的人（CHAIN-2e）

## Context

「财务查看权」已经在三处用同一个判定：成本核算 `bid-workspace/cost-sheet`（403「无权查看成本核算」）、CHAIN-2 寻源建议卡的我方落地价（`sourcing-suggestions.ts` 的 `loadLanded`）、CHAIN-2b 报价表助手的我方成本（未合并）。判定是 `src/lib/project-finance/access.ts` 的 `resolveFinancePrivilege(user, orgId, ownerId).canReadAll`：平台超级管理员、持组织范围 `project.finance.manage` 或 `project.finance.read`、项目负责人。`bids` 岗位的 `project.finance.read` 只在 `ASSIGNED` 范围，不算；组织管理员本身也不算。

还没统一的四处（本 change 的范围）：

| 页面 / 接口 | 今天谁能看 | 看到什么 |
|---|---|---|
| `GET …/inquiries/[inquiryId]/compare/matrix`（界面没用，接口对外） | 项目读者（`requireProjectReadAccess`） | 每家 `landedCad.unit/total`、`assumptions`（运费 / 保险 / 关税 / 清关逐项金额与汇率）、`summaryZh`（「推荐 X：落地价 N」「最低价 Y（N）……贵 p%」） |
| `POST …/compare/analysis` → `quote-analysis-panel.tsx`（询价详情页） | 项目读者 | 同一矩阵 + `analysis.summary`（= `summaryZh`）+ 模型解读（模型输入里有每家落地价） |
| `GET /api/org/tender-rfq/tracker`（询价追踪页） | 项目读者（`projectReadWhere`，含组织管理员） | 「落地价 CAD N」 |
| 报价引擎 13 条路由 →「报价与成本」卡、投标页报价区、「我方报价」卡、Pricing Control Center | 内部数字：特权或项目角色带 `project:cost:read` | 估算成本、毛利率、成本行、供应商、加价、情景表 |

报价引擎这一行的实际范围比 GATE ④ 写的大：项目角色 `viewer`、`tester`、`operator`、`project_admin`、`accounting` 都带 `project:cost:read`（`src/lib/rbac/permissions.ts`），即每个项目成员今天都能看内部数字。现有测试 QE-02 用的项目角色名 `project_viewer` 不存在，于是测成了「看不到」，与真实的 `viewer` 不符。

## Goals / Non-Goals

**Goals：** 上表四处的落地价与报价引擎内部数字只给有财务查看权的人；判定与成本核算同一个；没有权限的人看到一句谁能看、找谁；有权限的人与改动前逐字段相同。

**Non-Goals：**

- `src/lib/muse-bridge/**`（`router.ts` 的 compare / price_scenario 照旧调用 `loadCompareMatrix` 拿完整矩阵；决定 A）。
- `src/app/api/projects/[id]/inquiries/[inquiryId]/route.ts`（`getInquiry`）与 `…/compare/route.ts`（`compareQuotes`）返回的供应商报价原价。
- `src/lib/tender-pricing/**`（CHAIN-2b 的范围；`compare-cost-source-load.ts` 不改）、`src/lib/tender-intel/sourcing-suggestions*.ts`（已按财务查看权）。
- `src/lib/tender-rfq/landed-cost.ts`、`compare.ts` 的 `buildCompareMatrix` 与排序 / 推荐规则、`compare-service.ts` 的 `loadCompareMatrix`。
- `src/lib/quote-engine/customer-view.ts`、`quotation-pdf.ts`、`calc.ts`、`service.ts`（客户视图与计算不变）。
- `src/app/api/projects/[id]/bid-workspace/cost-sheet/route.ts`、项目财务接口、`allowCostPermission`。
- Prisma schema、`vercel.json`、环境变量。

## Decisions

### D1. 判定：一个带兜底的入口放在 `project-finance/access.ts`

新增 `resolveFinanceViewSafe(user, orgId, ownerId, resolve = resolveFinancePrivilege)`（第四个参数只给测试注入会抛错的判定）：调 `resolve`；抛错时记 `console.warn("[finance-view] …", message)`（只含原因），返回 `decideFinancePrivilege({ isPlatformSuperAdmin, isProjectOwner, holdsManage: false, holdsRead: false })`。报价引擎、比价两条接口、追踪页都用它。追踪页一次请求只查一次组织键（`ownerId = null`），再按每个项目的负责人并上。

- 否决：直接 import CHAIN-2b 的 `tender-pricing/finance-view.ts`——那个 PR 没合并，两个 change 不能互相依赖；合并后另开整理把两边收成一份（Out of scope）。
- 否决：继续用项目角色的 `project:cost:read`——`viewer` 也带，等于对所有项目成员开放，正是要改的。
- 否决：出错时返回 500——比价与追踪页今天不会因授权查询失败而整页报错，改成 500 是回归；兜底只收组织键，与 CHAIN-2 / CHAIN-2b 相同。

### D2. 报价引擎：看内部数字只认财务查看权；编辑 / 批准要求先能看

`resolveQuoteCapabilities(access, { finance })`（`finance` 为 D1 的结果）：`privileged = finance.privileged`（与今天的 super_admin | 组织范围 manage | 负责人逐条相同）；`canViewInternal = finance.canReadAll`；`canEdit = canViewInternal && (privileged || 项目角色有 project:cost:write)`；`canApprove = canViewInternal && (privileged || 项目角色有 project:cost:review)`。`requireQuoteAccess` 改调 D1（今天只查 manage 一个键）。13 条路由与 `internal_cost / edit / approve / read` 四个级别不改。

- 否决：编辑 / 批准仍只看项目角色——`PUT …/[quoteId]` 返回 `serializeInternal`（全部成本行），`select-bid` 返回 `internal: true` 的「我方报价」，Pricing Control Center 本来就是成本编辑器；能改不能看自相矛盾，会从编辑接口漏出内部数字。
- 否决：编辑接口对无权的人裁掉成本——编辑的对象就是成本行，裁掉后无法编辑。
- 代价：项目角色是 `operator` / `project_admin`、但不是负责人、没有组织范围财务键的人（典型是 `bids` 岗位的同事）不能再新建 / 编辑 / 批准报价；与 CHAIN-2b GATE ①「不用改」一致，列为 GATE 问题 1。

### D3. 比价里「成本」指系统算出的落地价及由它推出的东西

裁掉：每行 `landedCad`（unit / total 置 null）、`assumptions`（逐项金额与汇率，置空数组）、`summaryZh`（换成不含金额与百分比的版本），顶层加 `costHidden: true`。保留：供应商报价原价 `quoted`（询价明细与旧比价接口对同一批人已经返回）、排序、`cheapest` / `fully_compliant` / `not_normalized` 等标记、`recommendedItemId`、`cheapestItemId`、`checks`、`deliveryLateDays` / `validityShortDays`、`missingFields`、`warnings`（汇率过期天数，不含金额）、`blockers`（缺什么参数，不含金额）。纯函数 `compareMatrixFinanceView(matrix, canView)` 放在 `src/lib/tender-rfq/compare.ts`；无金额结论由 `summarizeMatrixZh` 加 `{ hideAmounts: true }` 生成，有权限时调用方式不变。

- 否决：连原价一起藏——询价同事要据原价追问供应商，且原价已经经两个既有接口对项目读者返回，只藏这里没有意义。
- 否决：连排序与推荐一起藏——推荐是比价的结论，藏了面板就没有用；排序只透露谁更便宜，不透露差多少。

### D4. AI 报价分析：无权时同一次调用，输入不含落地价

`buildInterpretationPayload` / `buildMatrixInterpretationPrompt` 接受 D3 裁剪后的矩阵：`landedCadTotal / landedCadUnit` 为 null、`summary` 为无金额结论，并加 `costHidden: true`；系统提示词在 `costHidden` 时多一条硬规则「本次不提供落地价（看的人没有财务查看权）；landedCadTotal 为空不代表换算不出，换算不出看 not_normalized；不得估算或给出任何金额」。数字校验 `collectAllowedNumbers` 用同一份裁剪后的输入。仍是一次 `createCompletion`（workflow 不变）；有权限时输入与改动前逐字相同。

- 否决：无权时 403——交期、有效期、风险、要追问的点对询价同事同样有用，403 把这些一起拿走。
- 否决：无权时不调模型、只回确定性结论——同样拿走交期与风险解读；裁剪输入已经从源头保证模型看不到落地价。

### D5. 追踪页按行所在项目判定

`loadTracker` 取一次 D1（`ownerId = null`）的组织级结果，每个项目再并上「负责人是本人」。`quoteCellView` 加一个 `canViewCost` 参数：为 false 且矩阵换算出了落地价时 `landedText = 「落地价只给有财务查看权的人看」`、`needsCompareLink = false`；换算不出时照旧写原因；`cheapest` 照旧。`matrixRowByItem` 在组装行之前按项目裁掉，响应里不出现那几家的落地价。`summaryOnly`（/bids 汇总卡）不取矩阵，不受影响。

- 否决：对所有人去掉追踪页的落地价——有财务查看权的人今天靠它跨项目看价，去掉是倒退。
- 否决：不管追踪页——比价面板藏了、追踪页还在，统一就是空的。

### D6. 界面提示与 CHAIN-2b 同一句式，不共享常量

报价引擎三处：「估算成本和毛利率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」比价面板：「落地价只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」常量放在 `src/lib/quote-engine/access.ts` 与 `src/lib/tender-rfq/compare.ts`（客户端组件能 import 的纯模块）。

- 否决：import CHAIN-2b 的 `COST_ACCESS_HINT_ZH`——同 D1，未合并。

### D7. 单个报价页（Pricing Control Center）接住客户视图

`GET …/quote-engine/[quoteId]` 对没有内部权限的人返回 `{ customerView, capabilities }`，但 `pricing-control-center.tsx` 的 `load` 直接读 `res.quote.costLines`，抛错后 `data = null`，页面一直停在「加载报价引擎…（未启用或无权限时不可见）」。今天几乎碰不到（项目成员都带成本读权限），改后只读成员从卡片点进来就会碰到。改为：响应带 `customerView` 时整页显示 D6 那句提示 + 现有「Customer Quote Preview」表格（抽成同文件内的小组件复用），不显示 KPI、成本行、情景表与任何编辑 / 批准按钮。

- 否决：卡片对无权的人不让点——卖价与客户视图对项目读者本来就开放（`customer-view` 是 read 级别），没必要拿走。
- 否决：无权时跳回工作台——用户不知道发生了什么。

## 与八条硬纪律的关系

1. 零 schema：不涉及。不改 Prisma，不加字段；`costHidden` 只是接口响应里的键。
2. 出站先审批：不涉及。不发邮件、不建审批卡。
3. 禁止第三套队列：不涉及。
4. 脱敏：触碰。本 change 就是把落地价与报价内部数字收到有财务查看权的人；警告日志只含原因，不含金额。Muse 通道不改（决定 A：所选供应商落地价允许出 Muse）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：触碰。裁剪与无金额结论都是代码；AI 报价分析仍是原来那一次模型调用，只是无权时输入更少，不新增调用。
8. 测试注册：触碰。新增隔离库测试 `src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`，同一 task 里注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；其余改的是已注册测试。

## Risks / Trade-offs

- 不是负责人的投标同事不能再用报价引擎建 / 改 / 批报价，也看不到比价落地价（D2 代价）→ GATE 问题 1。
- 追踪页对组织管理员：别人负责的项目不再显示落地价 → 写在报告里。
- CHAIN-2b 与本 change 各有一份同口径兜底 → 两边合并后另开整理。

## Verification

- `npx tsx src/lib/quote-engine/__tests__/quote-engine-contract.test.ts`（QE-02 改用真实项目角色名 `viewer` / `operator` / `accounting`，加财务查看权的组合）
- `npx tsx src/lib/project-finance/__tests__/finance-access.test.ts`（`resolveQuoteCapabilities` 新签名、兜底）
- `npx tsx src/lib/tender-rfq/__tests__/compare.test.ts`（裁剪、无金额结论、模型输入）
- `npx tsx src/lib/tender-rfq/__tests__/tracker-pure.test.tsx`；`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/tracker-db.isolated.test.ts`
- `NODE_ENV=test npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`（七种身份 × 比价矩阵 / AI 分析的模型输入 / 报价列表 / 单个报价 / 「我方报价」/ 新建 / 编辑；少见数字搜索）
- `npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate finance-view-compare-quote-gate --strict`、`git diff origin/main -- prisma/ vercel.json` 为空

## Open Questions（GATE）

1. 不是负责人的投标同事（`bids` 岗位、项目角色 `operator`）今天能建 / 改 / 批报价，改后不能——接受，还是给报价引擎另定口径？
2. 「报价与成本」卡以外，Pricing Control Center 整页（成本行、情景表、Landed / piece）也随之只给有财务查看权的人；没有的人只看客户视图。确认按此。
3. 比价矩阵对无权的人保留排序与「最便宜」标记（透露谁便宜，不透露差多少）。确认按此。

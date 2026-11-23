# Design：比价落地价与报价引擎内部数字统一只给有财务查看权的人（CHAIN-2e）

## Context

「财务查看权」已经在三处用同一个判定：成本核算 `bid-workspace/cost-sheet`（403「无权查看成本核算」）、CHAIN-2 寻源建议卡的我方落地价（`sourcing-suggestions.ts` 的 `loadLanded`）、CHAIN-2b 报价表助手的我方成本（#532，2026-11-23 合并，`src/lib/tender-pricing/finance-view.ts`）。判定是 `src/lib/project-finance/access.ts` 的 `resolveFinancePrivilege(user, orgId, ownerId).canReadAll`：平台超级管理员、持组织范围 `project.finance.manage` 或 `project.finance.read`、项目负责人。`bids` 岗位的 `project.finance.read` 只在 `ASSIGNED` 范围，不算；组织管理员本身也不算。

还没统一的四处（本 change 的范围）：

| 页面 / 接口 | 今天谁能看 | 看到什么 |
|---|---|---|
| `GET …/inquiries/[inquiryId]/compare/matrix`（界面没用，接口对外） | 项目读者（`requireProjectReadAccess`） | 每家 `landedCad.unit/total`、`assumptions`（运费 / 保险 / 关税 / 清关逐项金额与汇率）、`summaryZh`（「推荐 X：落地价 N」「最低价 Y（N）……贵 p%」） |
| `POST …/compare/analysis` → `quote-analysis-panel.tsx`（询价详情页） | 项目读者 | 同一矩阵 + `analysis.summary`（= `summaryZh`）+ 模型解读（模型输入里有每家落地价） |
| `GET /api/org/tender-rfq/tracker`（询价追踪页 `/bids/rfq`） | 项目读者（`projectReadWhere`，含组织管理员） | 「落地价 CAD N」 |
| 报价引擎 14 个路由文件 →「报价与成本」卡、投标页报价区、「我方报价」卡、单个报价页（Pricing Control Center） | 内部数字：特权或项目角色带 `project:cost:read` | 估算成本、毛利率、成本行、供应商、加价、情景表 |

报价引擎这一行的实际范围比 GATE ④ 写的大：项目角色 `viewer`、`tester`、`operator`、`project_admin`、`accounting` 都带 `project:cost:read`（`src/lib/rbac/permissions.ts`），即每个项目成员今天都能看内部数字。现有测试 QE-02 与 PERM-4c1 用的项目角色名 `project_viewer` 不存在，于是测成了「看不到」，与真实的 `viewer` 不符。逐条核实见文末「开工前核实（2026-11-23）」。

报价引擎生产上仍关着（`TENDER_QUOTE_ENGINE_ENABLED` 未设，见 `docs/QINGYAN_QUOTE_OPERATIONS_PHASE2_REPORT.md`）：报价引擎这部分合并后要等开关打开才有人看得到；比价与追踪页两部分没有开关，合并即生效。

## Goals / Non-Goals

**Goals：** 上表四处的落地价与报价引擎内部数字只给有财务查看权的人；判定与成本核算同一个；没有权限的人看到一句为什么、找谁（GATE ①），不停在加载中；能看内部数字的人看到的数字与按钮与改动前相同。

**Non-Goals：**

- `src/lib/muse-bridge/**`（`router.ts` 的 compare / price_scenario 照旧调用 `loadCompareMatrix` 拿完整矩阵；决定 A）。
- `src/app/api/projects/[id]/inquiries/[inquiryId]/route.ts`（`getInquiry`）与 `…/compare/route.ts`（`compareQuotes`）返回的供应商报价原价。
- `src/lib/tender-pricing/**`（CHAIN-2b 的范围）：只 import `finance-view.ts` 的 `COST_ACCESS_HINT_ZH` 拼提示句，不改；`compare-cost-source-load.ts` 不改；`src/lib/tender-intel/sourcing-suggestions*.ts`（已按财务查看权）。
- `src/lib/tender-rfq/landed-cost.ts`、`compare.ts` 的 `buildCompareMatrix` 与排序 / 推荐规则、`compare-service.ts` 的 `loadCompareMatrix`。
- `src/lib/quote-engine/customer-view.ts`、`quotation-pdf.ts`、`calc.ts`、`service.ts`、`advisors.ts`、`templates.ts`（客户视图与计算不变；`advisors.ts` / `templates.ts` 归 BIDPAGE 轨道）。报价引擎组件只做权限收口与无权说明，其它文案不改。
- `src/app/api/projects/[id]/bid-workspace/cost-sheet/route.ts`、项目财务接口、`allowCostPermission`、`resolveFinancePrivilege`。
- 谁能当、谁能换项目负责人（`src/app/api/projects/[id]/members/**`、派发；CHAIN-2c #539 的范围）。
- Prisma schema、`vercel.json`、环境变量。

## Decisions

### D1. 判定：一个带兜底的入口放在 `project-finance/access.ts`

新增 `resolveFinanceViewSafe(user, orgId, ownerId, resolve = resolveFinancePrivilege)`（第四个参数只给测试注入会抛错的判定）：项目没有组织时、或 `resolve` 抛错时，返回 `decideFinancePrivilege({ isPlatformSuperAdmin, isProjectOwner, holdsManage: false, holdsRead: false })`；抛错时记 `console.warn("[finance-view] …", message)`（只含原因）。报价引擎、比价两条接口、追踪页都用它。追踪页一次请求只查一次组织键（`ownerId = null`），再按每个项目的负责人并上。

- 否决：直接用 CHAIN-2b 的 `resolvePricingCostVisibility`——它只回「能不能看」一个布尔，报价引擎还要「特权」位（编辑 / 批准直通）；把两份收成一份要改 CHAIN-2b 的路由，另开整理（Out of scope，编号待定）。
- 否决：继续用项目角色的 `project:cost:read`——`viewer` 也带，等于对所有项目成员开放，正是要改的。
- 否决：出错时返回 500——比价与追踪页今天不会因授权查询失败而整页报错，改成 500 是回归；兜底只收组织键，与 CHAIN-2 / CHAIN-2b 相同。

### D2. 报价引擎：看内部数字只认财务查看权；编辑 / 批准要求先能看

`resolveQuoteCapabilities(access, { finance })`（`finance` 为 D1 的结果）：`privileged = finance.privileged`（与今天的 super_admin | 组织范围 manage | 负责人逐条相同）；`canViewInternal = finance.canReadAll`；`canEdit = canViewInternal && (privileged || 项目角色有 project:cost:write)`；`canApprove = canViewInternal && (privileged || 项目角色有 project:cost:review)`。`requireQuoteAccess` 改调 D1（今天只查 manage 一个键）。14 个路由文件与 `internal_cost / edit / approve / read` 四个级别不改。

- 否决：编辑 / 批准仍只看项目角色——`PUT …/[quoteId]` 返回 `serializeInternal`（全部成本行），`select-bid` 返回 `internal: true` 的「我方报价」，Pricing Control Center 本来就是成本编辑器；能改不能看自相矛盾，会从编辑接口漏出内部数字。
- 否决：编辑接口对无权的人裁掉成本——编辑的对象就是成本行，裁掉后无法编辑。
- 代价：项目角色是 `operator` / `project_admin`、但不是负责人、没有组织范围财务键的人（典型是 `bids` 岗位的同事）不能再新建 / 编辑 / 批准报价——GATE ①（Evan 2026-11-22）已接受，前提是谁做报价谁就是该项目负责人（代码里成立，见「开工前核实」第 5 条）。

### D3. 比价里「成本」指系统算出的落地价及由它推出的东西

裁掉：每行 `landedCad`（unit / total 置 null）、`assumptions`（逐项金额与汇率，置空数组）、`summaryZh`（换成不含金额与百分比的版本），矩阵上加 `costHidden: true`，两条接口的响应顶层也加 `costHidden: true`。保留：供应商报价原价 `quoted`（询价明细与旧比价接口对同一批人已经返回）、排序、`cheapest` / `fully_compliant` / `not_normalized` 等标记、`recommendedItemId`、`cheapestItemId`、`checks`、`deliveryLateDays` / `validityShortDays`、`missingFields`、`warnings`（汇率过期天数，不含金额）、`blockers`（缺什么参数，不含金额）。纯函数 `compareMatrixFinanceView(matrix, { canView, firstTierQty })` 放在 `src/lib/tender-rfq/compare.ts`；无金额结论由 `summarizeMatrixZh` 加 `{ hideAmounts: true }` 用裁剪前的行生成（「换算不出」要看原来的落地价），有权限时调用方式与结果不变。

- 否决：连原价一起藏——询价同事要据原价追问供应商，且原价已经经两个既有接口对项目读者返回，只藏这里没有意义。
- 否决：连排序与推荐一起藏——推荐是比价的结论，藏了面板就没有用；排序只透露谁更便宜，不透露差多少（GATE ③ 已同意）。

### D4. AI 报价分析：无权时同一次调用，输入不含落地价

`buildInterpretationPayload` / `buildMatrixInterpretationPrompt` 接受 D3 裁剪后的矩阵：`landedCadTotal / landedCadUnit` 为 null、`summary` 为无金额结论，并加 `costHidden: true`；系统提示词在 `costHidden` 时多一条硬规则「本次不提供落地价（看的人没有财务查看权）；landedCadTotal 为空不代表换算不出，换算不出看 not_normalized；不得估算或给出任何金额」。数字校验 `collectAllowedNumbers` 用同一份裁剪后的输入。仍是一次 `createCompletion`（workflow 不变）；有权限时输入与改动前逐字相同。解读格式异常的 502 返回也只带裁剪后的矩阵。

- 否决：无权时 403——交期、有效期、风险、要追问的点对询价同事同样有用，403 把这些一起拿走。
- 否决：无权时不调模型、只回确定性结论——同样拿走交期与风险解读；裁剪输入已经从源头保证模型看不到落地价。

### D5. 追踪页按行所在项目判定

`loadTracker` 取一次 D1（`ownerId = null`）的组织级结果，每个项目再并上「负责人是本人」。`matrixRowByItem` 在组装行之前按项目裁掉（没有权限的项目，那几家的 `landedCad` 置空），响应里不出现那几家的落地价。`quoteCellView` 的选项加 `canViewCost`：为 false 时，矩阵标了「换算不出」照旧写原因并给去比价链接；其余（换算出了，或这一轮超过上限没取矩阵）写「落地价只给有财务查看权的人看」、`needsCompareLink = false`；`cheapest` 照旧取矩阵标记。`summaryOnly`（/bids 汇总卡）不取矩阵，不查财务键，不受影响。

- 否决：对所有人去掉追踪页的落地价——有财务查看权的人今天靠它跨项目看价，去掉是倒退。
- 否决：不管追踪页——比价面板藏了、追踪页还在，统一就是空的。
- 否决：没有权限时超过上限的那一格仍写「落地价请到比价面板查看」——比价面板对他同样不显示落地价，这句话把人往空处指。

### D6. 界面提示与 CHAIN-2b 同一句式，由同一常量拼成

报价引擎三处与单个报价页：「估算成本和毛利率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」比价面板：「落地价只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」两句都是「对象」+ CHAIN-2b 的 `COST_ACCESS_HINT_ZH`（`src/lib/tender-pricing/finance-view.ts`）。报价引擎的常量放新的纯模块 `src/lib/quote-engine/finance-hint.ts`，比价那句放 `src/lib/tender-rfq/compare.ts`（客户端组件能 import 的纯模块）。追踪页那一格是短句「落地价只给有财务查看权的人看」（`tracker-pure.ts`）。

- 否决：常量放 `src/lib/quote-engine/access.ts`（原设计）——它 import `next/server` 与读库的 `@/lib/projects/access`，客户端组件不能 import。
- 否决：各处自己写一遍整句——CHAIN-2b 已合并，拼同一常量才保证句式不漂。

### D7. 单个报价页（Pricing Control Center）接住客户视图与读取失败

`GET …/quote-engine/[quoteId]` 对没有内部权限的人返回 `{ customerView, capabilities }`，但 `pricing-control-center.tsx` 的 `load` 直接读 `res.quote.costLines`，抛错后 `data = null`，页面一直停在「加载报价引擎…（未启用或无权限时不可见）」；接口返回 403 / 404 时走同一条路径。改为：响应带 `customerView` 时整页显示 D6 那句提示 + 现有「Customer Quote Preview」表格（抽成同文件内的小组件复用），不显示 KPI、成本行、情景表与任何编辑 / 批准按钮；读取失败时显示「打不开这个报价：」加接口给的原因（如「报价引擎未启用」「报价不存在」「无权查看该项目」）；只有还在读取时才显示「加载报价引擎…」。

- 否决：卡片对无权的人不让点——卖价与客户视图对项目读者本来就开放（`customer-view` 是 read 级别），没必要拿走。
- 否决：无权时跳回工作台——用户不知道发生了什么。

### D8. 不能新建 / 修改 / 批准报价时说清楚（GATE ①）

投标页报价区（`quote-engine-section.tsx`）今天在 `canEdit = false` 时直接不显示新建按钮，没有任何说明。改后在同一位置显示：「你不是本项目负责人，不能新建、修改或批准报价；需要的话请找项目负责人。」（`canEdit = false` 的人一定不是负责人：负责人是特权，`canEdit` 恒为真。）没有财务查看权时同一区块另显示 D6 的那一句。常量同放 `src/lib/quote-engine/finance-hint.ts`。

- 否决：写成「只给项目负责人和有全企业「管理项目财务」权限的人」——还有「组织范围查看项目结算 + 项目角色带成本写权限」这条路能编辑，「只给」不准确；按看的人自己的情况说（不是负责人）才准确。
- 否决：不加——GATE ① 明确要求打开报价入口能看到为什么、找谁。

## 与八条硬纪律的关系

1. 零 schema：不涉及。不改 Prisma，不加字段；`costHidden` 只是接口响应里的键。
2. 出站先审批：不涉及。不发邮件、不建审批卡。
3. 禁止第三套队列：不涉及。
4. 脱敏：触碰。本 change 就是把落地价与报价内部数字收到有财务查看权的人；警告日志只含原因，不含金额。Muse 通道不改（决定 A：所选供应商落地价允许出 Muse）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：触碰。裁剪与无金额结论都是代码；AI 报价分析仍是原来那一次模型调用，只是无权时输入更少，不新增调用。测试里的模型是本机假服务。
8. 测试注册：触碰。新增隔离库测试 `src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`，同一 task 里注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；其余改的是已注册测试。

## Risks / Trade-offs

- 不是负责人的投标同事不能再用报价引擎建 / 改 / 批报价，也看不到比价落地价（D2 代价）→ GATE ① 已接受（前提：谁做报价谁就是该项目负责人）。
- 派发时没指定负责人的项目（派发对话框「项目负责人（可选）」选了「不指定（保持系统默认）」），负责人是导入时的系统账号：改后只有平台超级管理员与持组织范围「管理项目财务」的人能做报价，要先在项目成员页把做报价的人设为主负责人 → 写进报告「合并后要人做的事」。
- 追踪页对组织管理员：别人负责的项目不再显示落地价 → 写在报告里。
- CHAIN-2b 与本 change 各有一份同口径兜底 → 另开整理（编号待定）。
- 每次报价引擎请求多一次 `authorize`（`project.finance.read`），与成本核算接口同代价。

## Verification

- `npx tsx src/lib/quote-engine/__tests__/quote-engine-contract.test.ts`（QE-02 改用真实项目角色名 `viewer` / `operator` / `accounting`，加财务查看权的组合；源码断言：四处提示、单个报价页认 `customerView` 与读取失败）
- `npx tsx src/lib/project-finance/__tests__/finance-access.test.ts`（`resolveQuoteCapabilities` 新签名、`resolveFinanceViewSafe` 兜底）
- `npx tsx src/lib/tender-rfq/__tests__/compare.test.ts`（裁剪、无金额结论、模型输入）
- `npx tsx src/lib/tender-rfq/__tests__/tracker-pure.test.tsx`；`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/tracker-db.isolated.test.ts`
- `NODE_ENV=test npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`（七种身份 × 比价矩阵 / AI 分析的模型输入（本机假模型服务记下请求）/ 报价列表 / 单个报价 / 「我方报价」/ 新建 / 编辑；少见数字搜索）
- `npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate finance-view-compare-quote-gate --strict`、`git diff origin/main -- prisma/ vercel.json` 为空

## GATE（Evan 2026-11-22 已答）

1. 不是项目负责人的投标同事不能新建、编辑、批准报价——**接受**，前提是谁做报价谁就是该项目负责人；没权限的人打开报价入口要看到一句白话说明（为什么看不了、找谁），不能停在加载中 → D2、D6、D7、D8。
2. 单个报价页的完整成本视图只给有财务查看权的人，其他人只看客户视图——**同意** → D7。
3. 没权限的人仍能看到排序和「最便宜」标记，看不到金额与差额——**可以** → D3、D5。

## 开工前核实（2026-11-23）

核对基线：main `451bb0d3`（含 CHAIN-2b #532 `d9de8490`）。复现用的是隔离库 `qy_iso_f` 上的一次性脚本（虚构组织 / 用户 / 项目 / 报价 / 询价，跑完即删，脚本不进仓库），直接调真实路由。

### 1. 只读成员（viewer）带成本读权限——属实

- 权限表：`src/lib/rbac/permissions.ts:187-196` 的 `VIEWER_PERMISSIONS` 含 `PERMISSIONS.PROJECT_COST_READ`（第 193 行）；其余四个项目角色同样带：`project_admin` 第 133 行、`operator` 第 153 行、`accounting` 第 167 行、`tester` 第 182 行。项目角色只有这五个（`src/lib/rbac/roles.ts:48-56`）。
- 判定：`src/lib/quote-engine/access.ts:29-31`，`canViewInternal = privileged || hasProjectPermission(projectRole, "project:cost:read")`；`requireQuoteAccess`（第 41-42 行）只查 `project.finance.manage`。
- 复现：项目角色 `viewer`、企业成员角色 `org_member`、没有岗位的成员 → `resolveQuoteCapabilities` 返回 `{"privileged":false,"canViewInternal":true,"canEdit":false,"canApprove":false}`；隔离库里调 `GET /api/projects/{项目}/quote-engine` → 200，`capabilities.canViewInternal: true`，列表那一行带 `estimatedCost: 91234.56`；调 `GET …/quote-engine/{报价}` → 200，顶层键 `quote,computed,capabilities`，`quote.costLines` 14 行。
- 结论：属实。每个项目成员（含只读）今天都能看报价引擎内部数字。
- 对设计的影响：无，正是 D2 要改的。

### 2. 测试里用了不存在的角色 `project_viewer`——属实

- `src/lib/quote-engine/__tests__/quote-engine-contract.test.ts:35`（QE-02）与 `src/lib/project-finance/__tests__/finance-access.test.ts:78`（「PERM-4c1 报价引擎特权」）都写 `projectRole: "project_viewer"`；`PROJECT_ROLES` 里没有它，`hasProjectPermission("project_viewer", …)` 恒为 false。
- 复现：同一脚本，`resolveQuoteCapabilities(projectRole = "project_viewer")` → `canViewInternal: false`，与真实 `viewer` 的 `true` 相反。
- 结论：属实。QE-02「普通成员默认看不到内部成本」与 PERM-4c1「org_admin 本身不再直通」的 `!canViewInternal` 断言是因为角色名不存在才通过的，没测到真实行为。
- 对设计的影响：无范围变化；task 1.1 两个测试都改用真实角色名。

### 3. 没有内部权限的人一直停在「加载报价引擎…」——属实

- 接口：`src/app/api/projects/[id]/quote-engine/[quoteId]/route.ts:28-29`，没有内部权限时返回 `{ customerView, capabilities }`，没有 `quote` 键。
- 组件：`src/components/quote-engine/pricing-control-center.tsx:48-60` 的 `load()` 在 `try` 里执行 `setLines(res.quote.costLines)` → TypeError → `catch` 里 `setData(null)`；第 143 行 `if (!data)` 渲染「加载报价引擎…（未启用或无权限时不可见）」，没有重试、没有说明。接口返回 404（报价引擎未启用 / 报价不存在）或 403（不是项目读者）时 `apiJson` 抛错，走同一个 `catch`，同样停住。页面入口 `src/app/(main)/projects/[id]/quote-engine/[quoteId]/page.tsx`，从「报价与成本」卡、投标页报价区、「我方报价」卡点进来。
- 复现：隔离库里组织管理员（`org_admin`、不是项目成员、没有岗位；`requireProjectReadAccess` 放行组织管理员）调 `GET …/quote-engine/{报价}` → 200，顶层键 `customerView,capabilities`；照 `load()` 的写法取 `res.quote.costLines` → `TypeError: Cannot read properties of undefined (reading 'costLines')` → `data = null` → 停在「加载报价引擎…」。
- 结论：属实。今天只有「能读项目但不是项目成员」的组织管理员会碰到；改完后只读成员、`bids` 岗位的 operator 都会碰到。
- 对设计的影响：D7 加一条——读取失败（403 / 404 / 网络错误）也不停在加载中，写出接口给的原因（GATE ①「不能停在加载中」）。

### 4. 询价追踪页是第三处显示落地价的地方——属实

- 页面 `/bids/rfq`：`src/app/(main)/bids/rfq/page.tsx:21` → `src/components/bids/rfq-tracker.tsx:204-205`（`landedText` 与「最便宜」）。
- 接口 `GET /api/org/tender-rfq/tracker`：`src/app/api/org/tender-rfq/tracker/route.ts:18` → `src/lib/tender-rfq/tracker.ts:147`（`projectReadWhere`，第 84-93 行：负责人 / 该组织 `org_admin` / 项目 active 成员）→ 第 225-239 行对每轮已报价的询价调 `loadCompareMatrix`、按 itemId 记下 `landedCad` → 第 252 行 `quoteCellView` → `src/lib/tender-rfq/tracker-pure.ts:244-246` 写「落地价 CAD N」。
- 另外两处：`…/compare/matrix`（`route.ts:19-26`，界面不调用，接口对外）；`…/compare/analysis`（`route.ts:48-81`）→ `src/components/inquiry/quote-analysis-panel.tsx:152`（`analysis.summary` = `summaryZh`，含金额）。已按财务查看权的：报价表助手（CHAIN-2b）、寻源建议卡（CHAIN-2）。Muse（`src/lib/muse-bridge/router.ts:480-506`）按决定 A 不改。
- 复现：隔离库里只读成员读追踪接口 → 那一行 `landedText = "落地价 CAD 27,532"`；读比价矩阵 → `landedCad {"unit":137.66,"total":27531.8}`，`summaryZh` 里有「（27,532）」。
- 结论：属实，已在范围内（D5）。
- 对设计的影响：D5 补一条——没有权限的人那一格在「超过上限没取矩阵」时也写「落地价只给有财务查看权的人看」，不再写「请到比价面板查看」。

### 5. GATE ① 的前提「谁做报价谁就是该项目负责人」——代码里成立

- 负责人是 `Project.ownerId`（单人）；报价引擎把负责人当特权（`src/lib/quote-engine/access.ts:29`，D2 不改这一条）。
- 负责人怎么来：自己新建项目（`src/app/api/projects/route.ts:187`）与「跟这个标」（`src/lib/procurement-records/tender-follow.ts:81`）都是建的人当负责人并成为 `project_admin`；派发（`src/lib/project-intake/service.ts:42-44`）由平台管理员指定；项目成员页「设为主负责人」（`src/app/api/projects/[id]/members/[memberId]/route.ts:129-138`、`members/route.ts:171-175`，`requireProjectManageAccess`）可以换给做报价的人。CHAIN-2c（#539，未合并）合并后只有现负责人、组织管理员以上、持组织范围「管理项目财务」的人能换，且不能换成自己——做报价的人仍可以由现负责人或组织管理员设为负责人。
- 报价不会改负责人（`createEngineQuote` 不写 `ownerId`）：前提靠流程，代码让「把做报价的人设为负责人」走得通。
- 边角：派发对话框的「项目负责人（可选）」可以选「不指定（保持系统默认）」（`src/app/(main)/admin/project-intake/dispatch-dialog.tsx:175-193`），负责人仍是导入时的系统账号（`src/app/api/v1/projects/route.ts:158`）。这类项目没有人是负责人，改后要先在成员页把做报价的人设为主负责人（Risks、报告）。
- 结论：前提成立，不推翻 GATE ①，不改范围。

### 6. 其它与代码不符、已随之修订四件套的地方

- CHAIN-2b 已合并（#532，`d9de8490`）：D1 / D6 原来「那个 PR 没合并，不能 import」的否决理由作废。D6 改为两句提示都由 `COST_ACCESS_HINT_ZH`（`src/lib/tender-pricing/finance-view.ts:25`）拼成；D1 仍新增 `resolveFinanceViewSafe`，否决理由改为「CHAIN-2b 的判定只回一个布尔，报价引擎还要特权位」。
- 提示常量原定放 `src/lib/quote-engine/access.ts`：它 import `next/server` 与读库的 `@/lib/projects/access`，客户端组件不能 import → 改放新的纯模块 `src/lib/quote-engine/finance-hint.ts`（D6）。
- 报价引擎路由是 14 个文件（`route.ts`、`tender-bid/route.ts`、`[quoteId]` 下 12 个；QE-07a 列的 13 个不含后加的 `advise`），原写「13 条」。
- GATE ① 要求打开报价入口能看到为什么、找谁：投标页报价区在不能新建时，新建按钮原本直接消失、没有说明 → 新增 D8 与 spec 一条场景。
- `requireQuoteAccess` 今天只查 `project.finance.manage`，改后多查一次 `project.finance.read`（Risks 已写）。

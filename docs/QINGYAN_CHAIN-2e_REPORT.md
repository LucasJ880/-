# CHAIN-2e 报告 — 比价落地价与报价引擎内部数字统一只给有财务查看权的人（`finance-view-compare-quote-gate`）

合并后，项目只读成员、不是负责人的投标同事、没有财务权限的组织管理员，在询价详情页的「AI 报价分析」和询价追踪页（`/bids/rfq`）上**看不到各家的落地价和差多少**，只看到排序、「最便宜」、推荐谁和换算不出的原因，并多一句「落地价只给……；需要的话请找项目负责人」（项目负责人还是导入用的系统账号时改为请组织管理员先指定负责人）。报价引擎（生产上还没开）打开以后，这些人也看不到估算成本和毛利率，不能新建、修改、批准报价，点进单个报价只看到客户视图——每个入口都写一句为什么、下一步找谁，不再停在「加载报价引擎…」，也不再把不能新建的人引去「去创建报价」。项目负责人、老板（`owner` 岗位）、会计（`accounting` 岗位）、平台超级管理员看到的与以前一样。

| 项 | 值 |
|---|---|
| TASKFLOW | CHAIN-2e（Phase F（续）— 情报串联；CHAIN-2b 报告 §6 第 4 条） |
| 拍板 | Lucas 2026-11-20「532 统一」；GATE 三问 Evan 2026-11-22 已答（§6） |
| OpenSpec change | `openspec/changes/finance-view-compare-quote-gate/`（`projects/finance-access` 改 1 条、加 5 条；`tender/rfq-compare` 改 1 条、加 3 条；`tender/rfq-tracker` 改 1 条、加 1 条；归档演练 + 9 ~ 3，`--specs --strict` 149 / 149） |
| 基线 | origin/main `451bb0d3`（含 CHAIN-2b #532）；之后合入 `22a87fb7`（#552 CHAIN-2b 归档、#544 / #553 RFQ-PDF-1），与本 change 只在测试注册脚本上相邻，无冲突；再合入 `f332dd91`（#535 CHAIN-3b 与其归档），同样不重叠 |
| 开关 | **没有开关，合并即在生产生效**：比价矩阵、AI 报价分析、询价追踪页。报价引擎部分随既有开关 `TENDER_QUOTE_ENGINE_ENABLED`（生产未设，见 `docs/QINGYAN_QUOTE_OPERATIONS_PHASE2_REPORT.md`），开关打开才有人看得到；**打开之前必须先修 legacy 报价接口**（§5「上线前提」） |

## 1. 做了什么

「财务查看权」与成本核算接口、报价表助手（CHAIN-2b）、寻源建议卡（CHAIN-2）同一个判定：平台超级管理员、持**组织范围** `project.finance.manage`（岗位设置里叫「管理项目财务」，`owner` 岗位有）或 `project.finance.read`（「查看项目结算」，`accounting` 岗位有）、项目负责人。`bids` 岗位的 `project.finance.read` 只在本人参与范围，不算；组织管理员本身不算。授权查询出错时只剩平台超级管理员与项目负责人，记一条带固定标签、只含原因的错误日志（`console.error`），这时提示写「暂时无法确认你的查看权限，请稍后刷新。」，不说成没有权限。项目负责人是导入建项目用的系统账号（`system@qingyan.internal`，派发时不指定负责人就是它）或负责人账号不存在时，所有「需要的话请找项目负责人」换成「这个项目还没有指定负责人，请找组织管理员在项目成员里把做报价的同事设为主负责人。」；接口用 `hintReason`（`no_owner` / `unconfirmed`，追踪页另有 `mixed`）告诉界面，默认那句时不带；能编辑的人不带（返回形状与改动前相同），能看内部数字但不能编辑的人（如会计岗位 + 只读项目角色）在负责人是系统账号时 capabilities 会多带 `hintReason: "no_owner"`（给「不能新建」那句用）。

| 地方 | 以前 | 现在（没有财务查看权的人） | 有财务查看权的人 |
|---|---|---|---|
| `GET …/inquiries/{轮次}/compare/matrix`（接口，界面没用） | 项目读者都拿到每家落地单价 / 总价、换算说明（运费、保险、关税、清关逐项金额与汇率）、带金额与百分比的一句话结论 | 落地价为 `null`；换算说明里带金额 / 汇率的几条去掉（运费、保险、关税、清关、汇率），检查说明（如「未设交付截止，按截标日 +30 天……判断交期」）照常；结论换成不含金额与百分比的版本（「共 N 家报价（落地价金额不显示）。推荐 X：……最低价 Y 未推荐：……另有 Z 未能换算落地价（……）」），矩阵与响应顶层带 `costHidden: true`；排序、「最便宜」、推荐、交期 / 有效期 / 强制项 / 起订量检查、缺字段、换算不出的原因、供应商报价原价照常（供应商报 DDP 且币种是 CAD 时，原价就是落地价） | 逐字段与以前相同 |
| `POST …/compare/analysis` → 询价详情页「AI 报价分析」 | 同上 + 模型拿到每家落地价 | 同上；**仍是同一次模型调用**，模型输入是裁剪后的矩阵（没有落地价，带 `costHidden`），系统提示词多一条「本次不提供落地价……不得估算或给出任何金额」，数字校验用同一份输入；解读格式异常的 502 也只带裁剪后的矩阵；面板写「落地价只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」 | 模型输入与提示词逐字与以前相同 |
| 询价追踪页 `/bids/rfq`（`GET /api/org/tender-rfq/tracker`） | 能读项目的人（含组织管理员看全组织）都看到「落地价 CAD N」 | 按**每行所在项目**判定：那一格写「落地价只给有财务查看权的人看」、没有去比价链接，响应里搜不到那几家的落地价；换算不出的原因（带去比价链接）与「最便宜」照常；超过 50 轮上限没取矩阵的那几行也写同一句（不再指向同样看不到落地价的比价面板）；返回的行里有格子因权限被隐藏时（「落地价未换算」与被行数上限截掉的不算）页面顶部写一次比价面板那一句（被隐藏的项目都没有、部分没有真人负责人时换句）；授权查询出错时那一格写「暂时无法确认查看权限，请稍后刷新」 | 照旧；组织管理员看**自己负责**的项目照旧 |
| 报价引擎看内部数字（14 个路由文件：列表的估算成本 / 毛利率、单个报价的成本行与情景、「我方报价」的估算成本 / 毛利 / 毛利率 / 加价 / 定价比例、导入、分析、客户报价编辑视图） | 特权，或项目角色带 `project:cost:read`——**五个项目角色都带，包括只读 `viewer`**，等于每个项目成员都能看 | 只认财务查看权 | 照旧 |
| 报价引擎新建 / 编辑 / 批准 | 特权，或项目角色带成本写 / 审权限（`operator`、`project_admin` 等） | 先要财务查看权，再看项目角色的成本写 / 审权限（特权直通不变）→ 不是负责人的投标同事（`bids` 岗位、`operator`）不能再新建 / 编辑 / 批准（GATE ① 已接受）；会计岗位 + 只读项目角色只能看不能改 | 照旧 |
| 「报价与成本」卡、投标页报价区、「我方报价」卡 | 没有内部权限时估算成本 / 毛利率直接不显示 | 有报价（「我方报价」卡：有我方报价）时不显示，另写「估算成本和毛利率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」；不能新建时（新建按钮不出现）投标页报价区写「你不是本项目负责人，不能新建、修改或批准报价。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。」，空列表时不再写「新建后进入…」；「报价与成本」卡对不能新建的人不显示「去创建报价」与「在「投标」tab 新建…」，还没有报价时改写同一句 | 照旧 |
| 单个报价页（Pricing Control Center） | 没有内部权限时接口只给客户视图，页面读 `quote.costLines` 抛错，**一直停在「加载报价引擎…（未启用或无权限时不可见）」**；接口 403 / 404 时也一样 | 只拿到客户视图时显示报价名称 / 状态 / 版本、成本与不能修改两句提示和客户视图表格（只含公开字段），没有 KPI、成本行、情景表和任何编辑 / 批准按钮；读取失败写「打不开这个报价：」加接口给的原因；只有还在读取时才显示「加载报价引擎…」；保存遇到 403 时不再重新读取（以前会整页切成客户视图、丢掉没保存的成本行），写「没有保存：……填的内容还留在页面上……」 | 照旧 |

不改：Muse 通道——`compare` / `price_scenario` 照旧带所选供应商落地价（决定 A），**而且不看项目读权限与财务查看权，整份回复写进审计日志 `afterData`，组织管理员能读到**（审查发现，另开任务）；询价明细与旧比价接口返回的供应商报价原价；落地价算法与排序 / 推荐规则；报价引擎的客户视图与计算；`advisors.ts` / `templates.ts`（BIDPAGE 轨道）；成本核算（已按财务查看权）；项目财务接口（**仍认项目角色的成本读权限**，开关生产关着，另开任务）；legacy 报价接口与问青砚报价工具（另开任务，§5「上线前提」）；谁能当 / 换项目负责人。零 schema，不新增模型调用、队列、定时任务、出站。

## 2. 开工前核实（design「开工前核实（2026-11-23）」全文）

四件套里 fork 写的四条意外发现都在隔离库 `qy_iso_f` 上用一次性脚本（虚构数据、跑完即删、不进仓库）调真实路由复现，**全部属实**：

1. 只读成员带成本读权限：`src/lib/rbac/permissions.ts:193`（`VIEWER_PERMISSIONS` 含 `PROJECT_COST_READ`；其余四个项目角色在第 133 / 153 / 167 / 182 行）；`src/lib/quote-engine/access.ts:29-31` 按它判 `canViewInternal`。项目 `viewer` 读报价列表拿到 `estimatedCost: 91234.56`，读单个报价拿到 14 行成本行。
2. 测试用了不存在的角色：`quote-engine-contract.test.ts:35`（QE-02）、`finance-access.test.ts:78`（PERM-4c1）写 `project_viewer`，`PROJECT_ROLES` 里没有它，所以测成了「看不到」；换成真实的 `viewer` 就是 `canViewInternal: true`。改测试后，「org_admin 本身不再直通」那一条在改动前的代码上就不过。
3. 停在「加载报价引擎…」：`[quoteId]/route.ts:28-29` 只回 `{ customerView, capabilities }`；`pricing-control-center.tsx:48-60` 读 `res.quote.costLines` 抛 `TypeError` → `catch` 里 `setData(null)` → 第 143 行一直显示加载中。今天能复现的是「能读项目但不是项目成员」的组织管理员。
4. 追踪页是第三处显示落地价：`/bids/rfq` → `tracker.ts:225-252` 每轮调 `loadCompareMatrix` → `tracker-pure.ts:244-246` 写「落地价 CAD N」；只读成员读到「落地价 CAD 27,532」。

GATE ① 的前提「谁做报价谁就是该项目负责人」在代码里**成立**：负责人是 `Project.ownerId`，自己建项目和「跟这个标」都是建的人当负责人，派发由平台管理员指定，项目成员页可以「设为主负责人」（CHAIN-2c #539 合并后由现负责人 / 组织管理员以上 / 老板来换）；报价引擎本来就把负责人当特权。边角：派发时「项目负责人（可选）」选了「不指定」的项目，负责人仍是导入时的系统账号（§5 第 1 条）。不推翻 GATE，不改范围。

与四件套原稿不符、已改四件套的地方（单独提交 `0aed0e98`，`openspec validate --strict` 通过）：CHAIN-2b 已合并，提示句改由它的 `COST_ACCESS_HINT_ZH` 拼成；提示常量原定放 `quote-engine/access.ts`（会 import `next/server` 与读库模块，客户端组件不能用），改放新的纯模块 `quote-engine/finance-hint.ts`；单个报价页读取失败也写原因（D7）；投标页报价区不能新建时加说明（D8，GATE ①）；追踪页超过上限没取矩阵时无权的人也写同一句；报价引擎路由是 14 个文件（原写 13）。都不改变范围与 GATE 决定的对外行为。

## 3. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/project-finance/access.ts` | 新增 `resolveFinanceViewSafe`（带兜底的财务查看权；出错时标 `unconfirmed`、`console.error` 带固定标签；第四个参数只给测试注入）、`projectOwnerAssigned`、`resolveFinanceHintReason` |
| `src/lib/project-finance/view-hint.ts`（新） | 四种说法（默认 / 没有真人负责人 / 混合 / 暂时无法确认）与原因判定（纯模块，客户端也用） |
| `src/lib/projects/system-owner.ts`（新） | 导入用的系统账号（纯函数）；`src/app/api/v1/projects/route.ts` 改用同一常量 |
| `src/lib/quote-engine/access.ts` | `resolveQuoteCapabilities(access, { finance })`：看内部数字 = 财务查看权，编辑 / 批准要求先能看；`requireQuoteAccess` 改调 `resolveFinanceViewSafe`，不能编辑时带 `hintReason` |
| `src/app/api/projects/[id]/quote-engine/route.ts`、`[quoteId]/route.ts`、`tender-bid/route.ts` | capabilities 带 `hintReason`（默认不带） |
| `src/lib/quote-engine/finance-hint.ts`（新） | 报价引擎几句白话与 `quoteHintLinesZh`（哪个位置出哪几句、同一句只出一次；纯模块） |
| `src/components/quote-engine/quote-budget-card.tsx`、`quote-engine-section.tsx`、`tender-our-bid.tsx` | 没权限时的提示；不能新建时的说明 |
| `src/components/quote-engine/pricing-control-center.tsx` | 接住客户视图与读取失败；保存 403 不重新读取；客户视图表格抽成同文件内的 `CustomerPreviewTable` 复用 |
| `src/lib/tender-rfq/compare.ts` | `compareMatrixFinanceView`、`isLandedCostAssumption`、`summarizeMatrixZh` 的 `hideAmounts`、模型输入 / 提示词的 `costHidden` 分支、`landedHiddenHintZh` |
| `src/app/api/projects/[id]/inquiries/[inquiryId]/compare/matrix/route.ts`、`…/analysis/route.ts` | 按财务查看权裁剪（含 502） |
| `src/components/inquiry/quote-analysis-panel.tsx` | `costHidden` 时的提示 |
| `src/lib/tender-rfq/tracker.ts`、`tracker-pure.ts`、`src/components/bids/rfq-tracker.tsx` | 按项目判定、组装前裁掉；`quoteCellView` 加 `canViewCost`、`LANDED_HIDDEN_CELL_ZH`；整页 `landedHidden` + `hintReason`，页面顶部写一次 |
| `docs/acceptance/chain-2e/prod-check.sql`（新） | 合并前提：生产只读查负责人是系统账号的招投标项目（§5） |
| 测试 | 新隔离库 `src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`（注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）；改 `finance-access.test.ts`、`quote-engine-contract.test.ts`、`compare.test.ts`（审查后进 CI 子集）、`tracker-pure.test.tsx`、`tracker-db.isolated.test.ts` |

## 4. 怎么验证的

| 测试 | 改动前（main `451bb0d3`） | 改动后（审查修订后） |
|---|---|---|
| `npx tsx src/lib/project-finance/__tests__/finance-access.test.ts` | 27 通过 | 59 通过（提示原因接 unconfirmed 3 条（第二轮）；报价引擎特权改用真实项目角色名、五个项目角色 × 没有财务键、会计 / 老板 / 负责人 / 超管组合；`resolveFinanceViewSafe` 兜底含「暂时无法确认」标记、固定标签的 `console.error`、判定返回没有权限时不标；四种说法与系统账号判定） |
| `npx tsx src/lib/quote-engine/__tests__/quote-engine-contract.test.ts` | 29 通过 | 43 通过（QE-02 改真实角色名并加会计组合；QE-07a 列上 `advise`（14 个路由文件）；QE-07b 不再认 cost:read；QE-13 提示逐字、各位置出哪几句、单个报价页分支本体、读取失败写原因、保存 403 不重新读取、不能编辑时才查负责人） |
| `npx tsx src/lib/quote-engine/__tests__/quote-ops-contract.test.ts` | 75 | 75（不改期望） |
| `npx tsx src/lib/tender-rfq/__tests__/compare.test.ts`（审查后进 CI 子集） | 47 | 80（第二轮加两条接口里 `r.matrix` 只在裁剪处；有权逐字段相同；无权落地价 / 带金额的换算说明 / 汇率搜不到、检查说明照常；无金额结论；模型输入；四种提示；两条比价接口、追踪页、分析面板的接线源码断言） |
| `npx tsx src/lib/tender-rfq/__tests__/interpretation-guard.test.ts` | 29 | 29 |
| `npx tsx src/lib/tender-rfq/__tests__/tracker-pure.test.tsx` | 89 | 108（无权四种格子；暂时无法确认的格子；哪些格子算被隐藏；整页原因；页面顶部提示；`canViewCostOf` / `hiddenProjects` / `costUnconfirmed` 接线；提示模块链没有 node: / 读库模块） |
| 隔离库 `tracker-db.isolated.test.ts` | 46 | 61（第二轮加「被行数上限截掉」「只有落地价未换算」两条）；第一轮修订后的 59 条里**新加的 13 条在改动前的源文件上 6 条不过** |
| 隔离库 `finance-access-db.isolated.test.ts` | 18 | 18 |
| 隔离库 `finance-view-compare-quote-db.isolated.test.ts`（新） | —（**在改动前的源文件上 102 过 53 不过**） | 155 通过：八种身份（只读成员、`bids` 岗位 operator、没有财务键的组织管理员、项目负责人、`accounting` 岗位、`owner` 岗位、平台超级管理员、组织管理员 + `accounting` 岗位且不是项目成员）× 比价矩阵 / AI 报价分析（本机假模型服务记下每次请求，核对模型输入与调用次数）/ 追踪页 / 报价列表 / 单个报价 / 内部分析、成本导入、客户报价编辑视图 / 「我方报价」/ 新建 / 编辑；502 路径；模型写出落地价时数字校验标出；负责人是系统账号的项目（`hintReason`）；少见数字搜索（去掉时间戳后搜） |
| 相邻测试 | — | CHAIN-2b `pricing-helper-finance-db` 34、`finance-view` 47、`route-gate` 145、`finance-access-db` 18；合入 main 后 FIX-21 `project-routes-guard` 98、BIDPAGE-1 `next-step` 124 / 隔离库 55，全部通过 |

「改动前」的隔离库数字：把 10 个改过的源文件（`project-finance/access.ts`、`quote-engine/access.ts`、`compare.ts`、`tracker.ts`、`tracker-pure.ts`、比价两条路由、报价引擎列表 / 单个报价 / 我方报价三条路由）换回 `origin/main` 版本，只留新测试跑出来，跑完已还原（`git status` 核对）。

关键变异（交叉验证后第二轮另 8 处：直接返回 `r.matrix`、`canViewCostOf` 的 `||` 改 `&&`、`hiddenProjects` 去掉 `!`、`costUnconfirmed` 写死、整页原因的 unconfirmed 写死、两处 unconfirmed 分支删掉、格子短句不换——全部被抓住。第一轮，逐个改坏再跑对应测试）：分析面板 `{false && result.costHidden && (`、单个报价页客户视图分支走不到、读取失败丢掉接口原因、保存 403 判断失效、比价矩阵 `canView: true`、追踪页 `canViewCost: true`、兜底不标 `unconfirmed`、换算说明不过滤、卡片照旧显示「去创建报价」——9 处全部被抓住。

门禁（交叉验证后第二轮，合入 main `f9c73ba2`，含 FIX-21 目录守卫与 BIDPAGE-1）：

| 项 | 命令 | 结果 |
|---|---|---|
| 全量（删掉重建 `qy_full_chain2e`，`npx prisma migrate deploy`） | `npm test > /home/user/full-finance-view-compare-quote-gate.log 2>&1` | `718/728 通过, 10 失败`；10 项与 main 基线逐条相同：来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标 Postgres 矩阵、客户报价 PDF 分页、招标询价自动起草 DB；本 change 的测试 59 / 43 / 80 / 108 / 18 / 61 / 155 都过（上一轮 `713/723` 同样 10 项） |
| CI 子集 | `env -u DATABASE_ENVIRONMENT DATABASE_URL=…/ci DIRECT_URL=…/ci JWT_SECRET=ci-only-… NODE_ENV=test npm run test:ci` | PASS（`compare` 80、`tracker-pure` 108、`finance-access` 59、FIX-21 `project-routes-guard` 98；新隔离库测试按设计跳过） |
| FIX-21 目录守卫 | `npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts` | 98 通过（本 change 改过的 `src/app/api/projects/[id]/**` 接口都先过项目级守卫） |
| 类型 | `npm run typecheck` | 通过（合入 main 后 BIDPAGE-1 汇总接口按旧签名调用导致不过，`49bffa7c` 修好） |
| lint | `npm run lint:baseline` | PASS（无新增指纹）；改过的 28 个源文件直接跑 `eslint` 0 error（4 条 warning 是 `tracker-db` 既有的未用变量） |
| 测试注册 | `bash scripts/check-test-registry.sh` | 已注册 694 个，历史欠账 66 条 |
| 运行时架构 | `bash scripts/test-runtime-architecture.sh` | 9 通过 0 失败，guards PASS |
| OpenSpec | `openspec validate finance-view-compare-quote-gate --strict`；临时副本 `openspec archive … --yes` 后 `openspec validate --specs --strict` | valid；归档 + 9 ~ 3，151 / 151（演练前也是 151 / 151；合入 main 后主规格多了 2 个），每条要求 ≤ 500 字（最长 363） |
| 合并前提 SQL | `psql … -f docs/acceptance/chain-2e/prod-check.sql`（隔离库）+ 带回滚的 fixture | 三段都跑通；fixture 结果与预期相同 |
| 受保护文件 | `git diff origin/main -- prisma/ vercel.json package.json package-lock.json .claude/launch.json openspec/specs openspec/config.yaml` | 空 |

### 没验证到的

- 没有在浏览器里打开页面看（没有截图）：四处提示、单个报价页的客户视图整页、分析面板的提示只经源码断言与 `typecheck` 核对，接口侧经隔离库测试核对。
- 报价引擎在生产上关着，生产上这部分要开关打开后才能看到；没有在打开开关的环境里走一遍。
- 没有生产数据：不知道生产里有多少项目的负责人是系统账号（合并前由协调会话跑 `docs/acceptance/chain-2e/prod-check.sql`）、多少报价是不是负责人的同事做的。
- 授权查询出错（`unconfirmed`）只在单元测试里注入；隔离库里没有办法让真实的授权查询抛错。

## 5. 上线前提与合并后要人做的事

**上线前提：打开 `TENDER_QUOTE_ENGINE_ENABLED` 之前必须修 legacy 报价接口**（审查安全 1，TASKFLOW「编号待定」）。`src/app/api/projects/[id]/quotes/**`、`…/quotes/[quoteId]/ai/review` 与 `src/lib/agent/skills/quote.ts` 仍按项目读权限把引擎报价的成本与毛利给项目读者，只读成员还能用 PATCH 把报价改成 approved——绕过 GATE ①。本 change 只收住报价引擎自己的 14 个路由文件。

**合并前提（协调会话执行）**：有生产只读权限的人跑 `docs/acceptance/chain-2e/prod-check.sql`（`BEGIN READ ONLY … ROLLBACK`，不含金额）。第 1 段是负责人是系统账号的已派发招投标项目数，第 2 段是其中有已报价询价的项目名单，第 3 段是每个有招投标项目的组织里企业负责人有没有绑组织范围的财务查看权（只出组织名与人数）。第 1 段不为 0 时，先由组织管理员在这些项目的「项目成员」里把做报价的同事设为主负责人，再合并；第 3 段见下面第 4 条。SQL 已在隔离库上验证过语法与逻辑（带回滚的 fixture：2 个系统账号项目、1 个有已报价询价、1 个有真人负责人的项目不计；3 个企业负责人里 1 个已绑、1 个没绑、1 个被 DENY，另一组织全绑，没有招投标项目的组织不列）。

合并后：

1. **默认派发留下系统负责人**：派发对话框「项目负责人（可选）」默认「不指定（保持系统默认）」，负责人就一直是导入用的系统账号。**比价与追踪页合并当天就受影响**：这类项目只有平台超级管理员和持组织范围财务岗位（老板、会计）的人看得到落地价。报价引擎开关打开后，这类项目能做报价的是平台超级管理员、老板岗位（组织范围「管理项目财务」），以及会计岗位（组织范围「查看项目结算」）且项目角色能写成本（`operator` / `project_admin` / `accounting`）的成员。提示已改为「请找组织管理员在项目成员里把做报价的同事设为主负责人」。派发时负责人必填（或默认取第一个所选成员）要 Evan 定，已登记 TASKFLOW「编号待定」。
2. **告诉投标同事**：比价落地价（AI 报价分析、询价追踪页）合并即对他们不显示。首选办法是**把做报价的人设为该项目主负责人**（GATE ① 的前提）。另一条路是请平台管理员绑组织范围「查看项目结算」，但岗位只有模板：给投标同事绑 `accounting` 岗位会一并带上成交金额、提成、报价全过程只读、项目结算只读、安排安装与确认尾款等权限；CHAIN-2b GATE ① 也已答不给 `bids` 岗位开组织范围财务权。
3. 组织管理员（没有财务岗位）在追踪页上看别人负责的项目不再有落地价——知会一下。
4. **企业负责人同样受影响**：成员角色是 `org_owner` 的人，系统岗位 `org_owner` 本身不带 `project.finance.*`（`src/lib/authorization/role-defaults.ts` 的 `SYSTEM_ROLE_PROFILES`），组织范围的财务查看权要另绑「老板」（`owner`）或「会计」（`accounting`）岗位；没绑的企业负责人合并当天在别人负责的项目上也看不到比价 / 追踪页的落地价。`prod-check.sql` 第 3 段按组织列出企业负责人人数与其中已绑组织范围财务键的人数（`all_bound` 为 false 的组织需要知会，或由平台管理员先绑「老板」岗位）。
5. 打开 `TENDER_QUOTE_ENGINE_ENABLED` 之前，先做完上面的「上线前提」，再按 §1 的报价引擎几行走一遍（需要 Vercel 权限，本 change 不动开关）。

## 6. GATE（Evan 2026-11-22 已答）

1. 不是项目负责人的投标同事不能新建、编辑、批准报价——**接受**，前提是谁做报价谁就是该项目负责人（代码里成立，§2）；没权限的人打开报价入口要看到一句白话说明，不能停在加载中 → 四处提示 + 单个报价页的客户视图 / 读取失败（D6、D7、D8）。
2. 单个报价页的完整成本视图只给有财务查看权的人，其他人只看客户视图——**同意**（D7）。
3. 没权限的人仍能看到排序和「最便宜」标记，看不到金额与差额——**可以**（D3、D5）。另外照常返回的是供应商报价原价（询价明细与旧比价接口本来就给项目读者）：供应商报 DDP 且币种是 CAD 时，原价就是落地价，这一家「看得到金额」；规格的「搜不到」场景已限定为不是 DDP + CAD 的报价。

## 7. 回退办法

Revert 本 PR 的合并提交即可：零 schema、没有数据迁移、没有新开关，回退后比价 / 追踪页 / 报价引擎回到「项目读者 / 项目角色成本读权限」的口径。CHAIN-2b 的报价表助手不受影响（本 change 只 import 它的一句常量）。

## 8. 已知限制与后续

- 每次报价引擎请求多一次 `authorize`（`project.finance.read`），比价两条接口各多两次，追踪页整页多两次——与成本核算接口同代价；看的人缺权限时再多一次查负责人账号（选提示用哪一句）。
- CHAIN-2b 的 `resolvePricingCostVisibility` 与本 change 的 `resolveFinanceViewSafe` 判定相同、各有一份兜底（前者只回布尔、出错时记 warn 且不区分暂时无法确认），成本核算接口出错时 500、403 那句没有「找谁」，寻源卡另有一套 → TASKFLOW「编号待定」一行，另开整理收成一份。
- 比价矩阵对没有权限的人仍返回供应商报价原价（询价明细与旧比价接口本来就返回给项目读者）；供应商报 DDP 且币种是 CAD 时，原价就等于落地价——属于有意保留（design D3）。
- 组织管理员能在组织设置里看到询价的落地价参数（汇率、运费、保险、清关、项目关税率），加上照常返回的原价，可以自己算出落地价——本 change 不收组织设置（审查安全 6）。
- 审查发现、另开任务（TASKFLOW「编号待定」各一行）：legacy 报价接口（上线前提）；项目财务接口仍认项目角色成本读权限；Muse compare / price_scenario 不看项目读权限与财务查看权、整份回复进审计；问青砚 `project_get_project_quotes` 返回毛利率、不查项目读权限与财务查看权；派发时负责人必填；三处兜底口径不一（并入两份兜底收成一份那一行）。
- 解读格式异常的 502 照旧带模型原文 `raw`：模型输入里没有落地价，原文里不会有真实落地价。
- `compare.test.ts` 进 CI 子集靠 `scripts/test-ci-unit.sh` 里那一行，没有校验在守它（`check-test-registry.sh` 只查 `test-all.sh`）；有人删掉那一行，CI 里这些接线断言就不跑了（交叉验证 F6，不改）。
- main 新合入的 BIDPAGE-1 汇总接口（`bid-page-summary`）按旧签名调 `resolveQuoteCapabilities`，合入时改为新签名（`49bffa7c`）；它的金额门仍用不带兜底的 `resolveFinancePrivilege`，授权查询出错时整个接口报错——并入「财务查看权兜底收成一份」那一行。 **行为也随之变了一点**（交叉验证复核发现）：新签名下 `canViewInternal` 就是 `finance.canReadAll`，汇总接口的金额门 `canViewBidAmounts` 从「（特权 或 项目角色有成本读）且 `canReadAll`」变成「只看 `canReadAll`」——只在「组织管理员或企业负责人、持组织范围「查看项目结算」、又不是项目成员」这一类人身上不同：他们在汇总接口里 `canViewAmounts` 从 false 变成 true、能看到我方报价金额（12 种身份对照只有这一类不同）。BIDPAGE 开关在生产关着、我方报价金额另外还要报价引擎开关，合并当天没有生产影响；方向与 CHAIN-2e 一致（同一类人在报价引擎里同样能看到内部数字）。BIDPAGE 规格里「有财务查看权但不能看内部成本 → 看不到金额」那个场景因此不会再出现，已告知 BIDPAGE 轨道。

## 审查后的修订（协调会话清单，2026-11-23）

五维度审查（正确性、安全与硬纪律、权限口径与使用流畅、规格一致性、测试质量 / 49 个变异）在 `e0a4883d` 上做，没有阻断项；协调会话核实后定的清单逐条处理如下（代码 `c0d227af`，规格 / 设计 / SQL `70c39f19`，报告 / TASKFLOW 本次提交）。

| 条 | 内容 | 去向 |
|---|---|---|
| A1 | 负责人是系统账号时换提示（纯函数判定，比价面板 / 追踪页 / 报价引擎同一规则） | 改了 `c0d227af`：`projects/system-owner.ts` 按导入接口找账号用的邮箱判定，`view-hint.ts` 四种说法；隔离库与追踪 DB 测试覆盖 |
| A2 | 「你不是本项目负责人…」补下一步 | 改了 `c0d227af`，QE-13a 逐字钉住 |
| A3 | 不能新建的人不再被引导去新建 | 改了 `c0d227af`（卡片隐藏「去创建报价」与新建说明；报价区空列表只写那一句） |
| A4 | 追踪页有行被隐藏时顶部写一次 | 改了 `c0d227af`（`landedHidden` + `hintReason`，含 `mixed`） |
| A5 | 无权版结论改「（落地价金额不显示）」 | 改了 `c0d227af` |
| A6 | 单个报价页客户视图同时写两句 | 改了 `c0d227af` |
| A7 | 兜底区分「暂时无法确认」；保存 403 不丢编辑（先写测试） | 改了 `c0d227af`：`unconfirmed` 标记、`console.error` 固定标签；保存 403 不重新读取。兜底的测试先写（实现前 56 条里 3 条不过）；保存 403 的源码断言用变异核过（把判断改掉即不过） |
| A8 | 换算说明只去掉金额部分 | 改了 `c0d227af`（`isLandedCostAssumption`，逐条核对落地价换算写的每一条）；规格 `70c39f19` |
| 9 | rfq-compare 补 MODIFIED | 改了 `70c39f19`（「落地价写明含什么、不含什么」限定为有财务查看权的人，原两个场景保留，加无权的结论场景） |
| 10 / 22 | 分析面板提示源码断言 | 改了 `c0d227af`（核对 `result.costHidden &&`、`data-testid="landed-hidden-hint"` 与提示函数；文案按原因换句后，断言的是 `landedHiddenHintZh(result.hintReason)`，`COMPARE_LANDED_HIDDEN_HINT_ZH` 是它的默认值。`{false && result.costHidden && (` 变异被抓住） |
| 11 / 21 | 两条比价接口与追踪页的兜底与接线断言，compare.test 进 CI | 改了 `c0d227af`（进 `scripts/test-ci-unit.sh`）；规格场景 `70c39f19` |
| 12 | 规格写明原价照常、DDP + CAD | 改了 `70c39f19`；报告 §6、§8 |
| 13 | 规格补追踪页无链接与 SHALL NOT、我方报价卡「有我方报价时」、无推荐前 3 家、模型输入 costHidden、项目没有组织、QE-07a 列上 advise、组织管理员 + 会计岗 | 改了 `70c39f19`（QE-07a 与组织管理员 + 会计岗的测试在 `c0d227af`） |
| 14 | 文档改正（TASKFLOW 数字、§5.1 / §5.2、Muse、design Non-Goals、组织管理员能自己算） | 改了（本次提交与 `70c39f19`） |
| 23–26 | 单个报价页断言收紧、兜底「返回没有权限」一条、提示逐字、数字校验以裁剪后输入为准 | 改了 `c0d227af` |
| 15–19 | legacy 报价接口、项目财务接口、Muse、问青砚工具、派发负责人必填 | 登记 TASKFLOW「编号待定」各一行；第 15 条写进 §5「上线前提」 |
| 20 | 三处兜底口径不一 | 并入「财务查看权兜底收成一份」那一行 |
| C | 生产只读 SQL | `docs/acceptance/chain-2e/prod-check.sql`（`70c39f19`），隔离库验证过；由协调会话执行 |

### 交叉验证后的修订（第二轮，2026-11-23）

交叉验证结论：可以合并、没有阻断项（有权的人 456 个读接口条目 + 50 次模型调用与 origin/main 逐字相同；31 个变异 27 个抓住；归档演练 149 → 149；prod-check.sql 跑通）。合入 main `f9c73ba2`（含 FIX-21 目录守卫、BIDPAGE-1）后处理：

| 条 | 内容 | 去向 |
|---|---|---|
| F1 | 企业负责人（`org_owner`）同样看不到；SQL 加一段 | 改了：§5 第 4 条；`prod-check.sql` 第 3 段，隔离库带回滚 fixture 验证（本次报告提交） |
| F2 | 「有权限的人返回形状不变」对会计类身份不成立 | 改了：design D9、§1 与两处代码注释改措辞 |
| F3 | CI 补源码断言：矩阵接口 `r.matrix` 只在裁剪处；`canViewCostOf` 定义、`hiddenProjects` 按 `!canViewCostOf` | 改了 `df273bcb`（`compare.test` 与 `tracker-pure`，都在 CI 子集；M31 / M13 / M14 对应变异都被抓住） |
| F4 | `unconfirmed` 接到提示原因的两处补测试 | 改了 `df273bcb`（`resolveFinanceHintReason` 可注入负责人查询；`trackerLandedHiddenReason` 纯函数；两处删掉分支的变异都被抓住） |
| F5 | 追踪页只按真正因权限被隐藏的格子提示；`unconfirmed` 时格子写短版 | 改了 `df273bcb`；规格 rfq-tracker 两个场景（本次规格提交）；隔离库 tracker-db 加「被截掉」「只有未换算」两条 |
| F6 | `compare.test` 进 CI 那一行没人守 | 不改，写进 §8 已知限制 |
| F7 | 门禁与全量重跑 | 见 §4：全量 718/728，失败的 10 项与基线逐条相同 |
| 另 | 合入 main 后 BIDPAGE-1 汇总接口按旧签名调用，typecheck 不过 | 改了 `49bffa7c`（改传 `{ finance }`，`next-step.test.ts` 的源码断言跟着改；BIDPAGE-1 单测 124、隔离库 55 通过） |

## 9. 多维审查

（由协调会话补）

# CHAIN-2e 报告 — 比价落地价与报价引擎内部数字统一只给有财务查看权的人（`finance-view-compare-quote-gate`）

合并后，项目只读成员、不是负责人的投标同事、没有财务权限的组织管理员，在询价详情页的「AI 报价分析」和询价追踪页（`/bids/rfq`）上**看不到各家的落地价和差多少**，只看到排序、「最便宜」、推荐谁和换算不出的原因，并多一句「落地价只给……；需要的话请找项目负责人」。报价引擎（生产上还没开）打开以后，这些人也看不到估算成本和毛利率，不能新建、修改、批准报价，点进单个报价只看到客户视图——每个入口都写一句为什么、找谁，不再停在「加载报价引擎…」。项目负责人、老板（`owner` 岗位）、会计（`accounting` 岗位）、平台超级管理员看到的与以前一样。

| 项 | 值 |
|---|---|
| TASKFLOW | CHAIN-2e（Phase F（续）— 情报串联；CHAIN-2b 报告 §6 第 4 条） |
| 拍板 | Lucas 2026-11-20「532 统一」；GATE 三问 Evan 2026-11-22 已答（§6） |
| OpenSpec change | `openspec/changes/finance-view-compare-quote-gate/`（`projects/finance-access` 改 1 条、加 2 条；`tender/rfq-compare` 加 3 条；`tender/rfq-tracker` 改 1 条） |
| 基线 | origin/main `451bb0d3`（含 CHAIN-2b #532）；之后合入 `22a87fb7`（#552 CHAIN-2b 归档、#544 / #553 RFQ-PDF-1），与本 change 只在测试注册脚本上相邻，无冲突 |
| 开关 | **没有开关，合并即在生产生效**：比价矩阵、AI 报价分析、询价追踪页。报价引擎部分随既有开关 `TENDER_QUOTE_ENGINE_ENABLED`（生产未设，见 `docs/QINGYAN_QUOTE_OPERATIONS_PHASE2_REPORT.md`），开关打开才有人看得到 |

## 1. 做了什么

「财务查看权」与成本核算接口、报价表助手（CHAIN-2b）、寻源建议卡（CHAIN-2）同一个判定：平台超级管理员、持**组织范围** `project.finance.manage`（岗位设置里叫「管理项目财务」，`owner` 岗位有）或 `project.finance.read`（「查看项目结算」，`accounting` 岗位有）、项目负责人。`bids` 岗位的 `project.finance.read` 只在本人参与范围，不算；组织管理员本身不算。授权查询出错时只剩平台超级管理员与项目负责人，并记一条只含原因的警告日志。

| 地方 | 以前 | 现在（没有财务查看权的人） | 有财务查看权的人 |
|---|---|---|---|
| `GET …/inquiries/{轮次}/compare/matrix`（接口，界面没用） | 项目读者都拿到每家落地单价 / 总价、换算说明（运费、保险、关税、清关逐项金额与汇率）、带金额与百分比的一句话结论 | 落地价为 `null`、换算说明为空、结论换成不含金额与百分比的版本（「共 N 家报价（按落地价从低到高排序，金额不显示）。推荐 X：……最低价 Y 未推荐：……另有 Z 未能换算落地价（……）」），矩阵与响应顶层带 `costHidden: true`；排序、「最便宜」、推荐、交期 / 有效期 / 强制项 / 起订量检查、缺字段、换算不出的原因、供应商报价原价照常 | 逐字段与以前相同 |
| `POST …/compare/analysis` → 询价详情页「AI 报价分析」 | 同上 + 模型拿到每家落地价 | 同上；**仍是同一次模型调用**，模型输入是裁剪后的矩阵（没有落地价，带 `costHidden`），系统提示词多一条「本次不提供落地价……不得估算或给出任何金额」，数字校验用同一份输入；解读格式异常的 502 也只带裁剪后的矩阵；面板写「落地价只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」 | 模型输入与提示词逐字与以前相同 |
| 询价追踪页 `/bids/rfq`（`GET /api/org/tender-rfq/tracker`） | 能读项目的人（含组织管理员看全组织）都看到「落地价 CAD N」 | 按**每行所在项目**判定：那一格写「落地价只给有财务查看权的人看」，响应里搜不到那几家的落地价；换算不出的原因、去比价链接、「最便宜」照常；超过 50 轮上限没取矩阵的那几行也写同一句（不再指向同样看不到落地价的比价面板） | 照旧；组织管理员看**自己负责**的项目照旧 |
| 报价引擎看内部数字（14 个路由文件：列表的估算成本 / 毛利率、单个报价的成本行与情景、「我方报价」的估算成本 / 毛利 / 毛利率 / 加价 / 定价比例、导入、分析、客户报价编辑视图） | 特权，或项目角色带 `project:cost:read`——**五个项目角色都带，包括只读 `viewer`**，等于每个项目成员都能看 | 只认财务查看权 | 照旧 |
| 报价引擎新建 / 编辑 / 批准 | 特权，或项目角色带成本写 / 审权限（`operator`、`project_admin` 等） | 先要财务查看权，再看项目角色的成本写 / 审权限（特权直通不变）→ 不是负责人的投标同事（`bids` 岗位、`operator`）不能再新建 / 编辑 / 批准（GATE ① 已接受）；会计岗位 + 只读项目角色只能看不能改 | 照旧 |
| 「报价与成本」卡、投标页报价区、「我方报价」卡 | 没有内部权限时估算成本 / 毛利率直接不显示 | 不显示，另写「估算成本和毛利率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」；投标页报价区不能新建时（新建按钮不出现）写「你不是本项目负责人，不能新建、修改或批准报价；需要的话请找项目负责人。」 | 照旧 |
| 单个报价页（Pricing Control Center） | 没有内部权限时接口只给客户视图，页面读 `quote.costLines` 抛错，**一直停在「加载报价引擎…（未启用或无权限时不可见）」**；接口 403 / 404 时也一样 | 只拿到客户视图时显示报价名称 / 状态 / 版本、那一句提示和客户视图表格（只含公开字段），没有 KPI、成本行、情景表和任何编辑 / 批准按钮；读取失败写「打不开这个报价：」加接口给的原因；只有还在读取时才显示「加载报价引擎…」 | 照旧 |

不改：Muse 通道（`compare` / `price_scenario` 照旧带所选供应商落地价，决定 A）、询价明细与旧比价接口返回的供应商报价原价、落地价算法与排序 / 推荐规则、报价引擎的客户视图与计算、`advisors.ts` / `templates.ts`（BIDPAGE 轨道）、成本核算与项目财务接口、谁能当 / 换项目负责人。零 schema，不新增模型调用、队列、定时任务、出站。

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
| `src/lib/project-finance/access.ts` | 新增 `resolveFinanceViewSafe`（带兜底的财务查看权；第四个参数只给测试注入） |
| `src/lib/quote-engine/access.ts` | `resolveQuoteCapabilities(access, { finance })`：看内部数字 = 财务查看权，编辑 / 批准要求先能看；`requireQuoteAccess` 改调 `resolveFinanceViewSafe` |
| `src/lib/quote-engine/finance-hint.ts`（新） | 报价引擎三句白话（纯模块） |
| `src/components/quote-engine/quote-budget-card.tsx`、`quote-engine-section.tsx`、`tender-our-bid.tsx` | 没权限时的提示；不能新建时的说明 |
| `src/components/quote-engine/pricing-control-center.tsx` | 接住客户视图与读取失败；客户视图表格抽成同文件内的 `CustomerPreviewTable` 复用 |
| `src/lib/tender-rfq/compare.ts` | `compareMatrixFinanceView`、`summarizeMatrixZh` 的 `hideAmounts`、模型输入 / 提示词的 `costHidden` 分支、`COMPARE_LANDED_HIDDEN_HINT_ZH` |
| `src/app/api/projects/[id]/inquiries/[inquiryId]/compare/matrix/route.ts`、`…/analysis/route.ts` | 按财务查看权裁剪（含 502） |
| `src/components/inquiry/quote-analysis-panel.tsx` | `costHidden` 时的提示 |
| `src/lib/tender-rfq/tracker.ts`、`tracker-pure.ts` | 按项目判定、组装前裁掉；`quoteCellView` 加 `canViewCost`、`LANDED_HIDDEN_CELL_ZH` |
| 测试 | 新隔离库 `src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`（注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）；改 `finance-access.test.ts`、`quote-engine-contract.test.ts`、`compare.test.ts`、`tracker-pure.test.tsx`、`tracker-db.isolated.test.ts` |

## 4. 怎么验证的

| 测试 | 改动前（main `451bb0d3`） | 改动后 |
|---|---|---|
| `npx tsx src/lib/project-finance/__tests__/finance-access.test.ts` | 27 通过 | 44 通过（报价引擎特权改用真实项目角色名、五个项目角色 × 没有财务键、会计 / 老板 / 负责人 / 超管组合；`resolveFinanceViewSafe` 兜底 7 条，含「只含原因」的警告） |
| `npx tsx src/lib/quote-engine/__tests__/quote-engine-contract.test.ts` | 29 通过 | 36 通过（QE-02 改真实角色名并加会计组合；QE-07b 改为不再认 cost:read；QE-13 源码断言：四处提示、单个报价页认客户视图且在读成本行之前返回、读取失败写原因、提示常量是纯模块） |
| `npx tsx src/lib/quote-engine/__tests__/quote-ops-contract.test.ts` | 75 | 75（不改期望） |
| `npx tsx src/lib/tender-rfq/__tests__/compare.test.ts` | 47 | 67（有权逐字段相同；无权落地价 / 逐项金额 / 汇率搜不到；无金额结论没有金额与「%」；模型输入搜不到落地价、提示词有「不提供落地价」、有权时提示词与原文逐字相同；数字校验能标出解读里冒出的落地价） |
| `npx tsx src/lib/tender-rfq/__tests__/interpretation-guard.test.ts` | 29 | 29 |
| `npx tsx src/lib/tender-rfq/__tests__/tracker-pure.test.tsx` | 89 | 96（无权四种格子：换算出了、换算不出、超过上限没取、没有矩阵行；传进完整矩阵行也不写金额） |
| 隔离库 `tracker-db.isolated.test.ts` | 46 | 54；**新加的 8 条在改动前的源文件上 3 条不过**（组织管理员看别人负责的项目那一格、响应里搜得到落地价 `21,153`、只读成员看到落地价） |
| 隔离库 `finance-access-db.isolated.test.ts` | 18 | 18 |
| 隔离库 `finance-view-compare-quote-db.isolated.test.ts`（新） | —（**在改动前的源文件上 80 过 39 不过**） | 119 通过：七种身份（只读成员、`bids` 岗位 operator、没有财务键的组织管理员、项目负责人、`accounting` 岗位、`owner` 岗位、平台超级管理员）× 比价矩阵 / AI 报价分析（本机假模型服务记下每次请求，核对模型输入与调用次数）/ 追踪页 / 报价列表 / 单个报价 / 内部分析、成本导入、客户报价编辑视图 / 「我方报价」/ 新建 / 编辑，外加 502 路径；少见数字搜索（落地价、换算说明里的逐项金额与汇率、成本行 73,519.37、估算成本 91,234.56、供应商名、内部备注） |
| 相邻测试 | — | CHAIN-2b `pricing-helper-finance-db` 34、`finance-view` 47、`compare-cost-source` 83 / 隔离库 42、`quote-ops-customer` 25、`b3-ledger-producer` 隔离库 11、`route-gate` 145；合入 main 后 RFQ-PDF-1 的 `sheet-download` 67 / 隔离库 38，全部通过 |

「改动前」的隔离库数字是把 7 个改过的源文件（`project-finance/access.ts`、`quote-engine/access.ts`、`compare.ts`、`tracker.ts`、`tracker-pure.ts`、比价两条路由）换回 `origin/main` 版本、只留新测试跑出来的，跑完已还原（`git status` 核对）。

门禁：

| 项 | 命令 | 结果 |
|---|---|---|
| 全量（新库 `qy_full_chain2e`，`npx prisma migrate deploy` 应用全部 42 个迁移；在合入 `22a87fb7` 之前的本分支上跑） | `npm test > /home/user/full-finance-view-compare-quote-gate.log 2>&1` | `710/720 通过, 10 失败`；10 项与 main 基线逐条相同：来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB（75 / 76）；本 change 的测试 44 / 36 / 67 / 96 / 18 / 54 / 119 都过。合入 main 后没有重跑全量（main 新改的文件与本 change 不重叠），改为重跑本 change 与 RFQ-PDF-1 的测试、注册校验、typecheck、CI 子集 |
| CI 子集（合入 main 前后各跑一次） | `env -u DATABASE_ENVIRONMENT DATABASE_URL=…/ci DIRECT_URL=…/ci JWT_SECRET=ci-only-… NODE_ENV=test npm run test:ci` | PASS 两次（`finance-access` 44、`quote-engine-contract` 36、`tracker-pure` 96；新隔离库测试按设计跳过） |
| 类型 | `npm run typecheck`（合入 main 前后各一次） | 通过 |
| lint | `npm run lint:baseline` | PASS（errors 38 / 基线 53，无新增指纹）；改过的文件直接跑 `eslint` 0 error（4 条 warning 是 `tracker-db` 既有的未用变量） |
| 测试注册 | `bash scripts/check-test-registry.sh` | 已注册 689 个（合入 main 后），历史欠账 66 条 |
| 运行时架构 | `bash scripts/test-runtime-architecture.sh` | 9 通过 0 失败，guards PASS |
| OpenSpec | `openspec validate finance-view-compare-quote-gate --strict`；`openspec validate --specs --strict` | valid；149 / 149 |
| 受保护文件 | `git diff origin/main -- prisma/ vercel.json package.json package-lock.json .claude/launch.json openspec/specs openspec/config.yaml` | 空 |

### 没验证到的

- 没有在浏览器里打开页面看（没有截图）：四处提示、单个报价页的客户视图整页、分析面板的提示只经源码断言与 `typecheck` 核对，接口侧经隔离库测试核对。
- 报价引擎在生产上关着，生产上这部分要开关打开后才能看到；没有在打开开关的环境里走一遍。
- 没有生产数据：不知道生产里有多少项目的负责人是系统账号（§5 第 1 条）、多少报价是不是负责人的同事做的。

## 5. 合并后要人做的事

1. **补负责人**：派发时「项目负责人（可选）」选了「不指定（保持系统默认）」的项目，负责人是导入时的系统账号——报价引擎开关打开后，这类项目只有平台超级管理员和老板能做报价。要做报价的同事请组织管理员或现负责人在项目成员页把他「设为主负责人」（GATE ① 的前提）。要不要让派发时必须指定负责人，留给 Evan 决定（没开任务）。
2. **告诉投标同事**：比价落地价（AI 报价分析、询价追踪页）合并即对他们不显示；需要看就找项目负责人，或请平台管理员给需要的人绑「查看项目结算」（组织范围）——CHAIN-2b GATE ① 已答不给 `bids` 岗位开组织范围财务权。
3. 组织管理员（没有财务岗位）在追踪页上看别人负责的项目不再有落地价——知会一下。
4. 打开 `TENDER_QUOTE_ENGINE_ENABLED` 之前，按 §1 的报价引擎几行走一遍（需要 Vercel 权限，本 change 不动开关）。

## 6. GATE（Evan 2026-11-22 已答）

1. 不是项目负责人的投标同事不能新建、编辑、批准报价——**接受**，前提是谁做报价谁就是该项目负责人（代码里成立，§2）；没权限的人打开报价入口要看到一句白话说明，不能停在加载中 → 四处提示 + 单个报价页的客户视图 / 读取失败（D6、D7、D8）。
2. 单个报价页的完整成本视图只给有财务查看权的人，其他人只看客户视图——**同意**（D7）。
3. 没权限的人仍能看到排序和「最便宜」标记，看不到金额与差额——**可以**（D3、D5）。

## 7. 回退办法

Revert 本 PR 的合并提交即可：零 schema、没有数据迁移、没有新开关，回退后比价 / 追踪页 / 报价引擎回到「项目读者 / 项目角色成本读权限」的口径。CHAIN-2b 的报价表助手不受影响（本 change 只 import 它的一句常量）。

## 8. 已知限制与后续

- 每次报价引擎请求多一次 `authorize`（`project.finance.read`），比价两条接口各多两次，追踪页整页多两次——与成本核算接口同代价。
- CHAIN-2b 的 `resolvePricingCostVisibility` 与本 change 的 `resolveFinanceViewSafe` 判定相同、各有一份兜底（前者只回布尔）→ TASKFLOW「编号待定」一行，另开整理收成一份。
- 比价矩阵对没有权限的人仍返回供应商报价原价（询价明细与旧比价接口本来就返回给项目读者）；供应商报 DDP 且币种是 CAD 时，原价就等于落地价——属于有意保留（design D3）。
- 解读格式异常的 502 照旧带模型原文 `raw`：模型输入里没有落地价，原文里不会有真实落地价。

## 9. 多维审查

（由协调会话补）

# CHAIN-2b 报告 — 报价表助手的我方成本只给有财务查看权的人（`pricing-helper-finance-gate`）

| 项 | 值 |
|---|---|
| TASKFLOW | CHAIN-2b（Phase F（续）— 情报串联的后续） |
| 起因 | CHAIN-2 第一轮多维审查发现；交接文档第四十四次 §0.5h「之后还有什么」第 4 条 |
| 拍板 | Lucas 2026-11-20：「报价助手里的落地成本与节省成本，改成只对有财务查看权的人显示，口径与其它页面一致。」（「节省成本」按交接文档读作「已保存的我方成本」，代码里没有「节省」字段；若指毛利，毛利一栏同样只给有财务查看权的人——两种读法都覆盖） |
| OpenSpec change | `openspec/changes/pricing-helper-finance-gate/`（修改 `tender/pricing-helper`：新增 5 条、改 2 条；修改 `tender/pricing-compare-cost-source` 5 条） |
| 基线 | origin/main `91d928e4` |
| PR | #532，2026-11-23 合并（合并提交 `d9de8490`）；归档 `openspec/changes/archive/2026-11-23-pricing-helper-finance-gate/` |
| 开关 | 没有新开关；随合并生效（比价建议部分仍跟 `TENDER_PRICING_COMPARE_SOURCE_ENABLED`） |

## 1. 做了什么

「财务查看权」与成本核算接口、CHAIN-2 寻源建议卡同一判定：`resolveFinancePrivilege(user, orgId, ownerId).canReadAll`——平台超级管理员、持**组织范围** `project.finance.manage` 或 `project.finance.read`、项目负责人。`bids` 岗位的 `project.finance.read` 只在 ASSIGNED 范围，不算；组织管理员本身也不算。

| 场景 | 以前 | 现在 |
|---|---|---|
| `GET …/pricing-helper`，没有财务查看权 | 返回已保存的我方成本；开关开着时返回比价矩阵的落地价、明细与已记来源里的落地价 | `inputs.ourCostCad = null`、`costHidden: true`；开关开着时只带 `compareCostHidden: true`，不带数字、也不去取比价数据；情景表按没有成本算（毛利为空、没有成本底价两种情景）；假设说明写 `需要财务查看权才能看我方成本；毛利一栏和「成本 + 目标毛利」「成本价」两种情景也不显示。` |
| 同上，有财务查看权 | — | 与以前完全相同（纯函数测试与直接 `buildScenarios` 的结果 `JSON.stringify` 相同） |
| `POST save`，没有财务查看权、带了我方成本或成本来源 | 照写 | 403 `没有保存：需要财务查看权才能修改我方成本。请刷新页面，重新填写后再保存。`，不写库；顺序 409（锁）→ 403 → 400 |
| 同上，没带成本 | 照写 | 照常保存对手价、目标毛利、评分模型；已保存的成本与来源原样保留；返回同样裁剪、不带成本来源 |
| 卡片，没有财务查看权 | 成本输入框 | 换成 `需要财务查看权才能看我方成本。`；情景表不显示毛利一栏；表上方写明少了什么、谁能看、找谁；目标毛利下面写它在这里不影响情景表；保存不带成本；被拒时红字写明并保留刚填的值 |
| `GET /api/projects`、`GET …/bid-intelligence` 的房间 JSON | `summaryJson` 原样带 `pricingInputs.ourCostCad` / `ourCostSource` 与投标策略备忘 `bidStrategyMemo` | 对所有人都去掉这三样（两个接口的界面都不读它们，已核对） |

判定出错（解析不到组织、`authorize` 抛错）时按 fail-closed：只认项目负责人与平台超级管理员（`resolvePricingCostVisibility`，纯函数注入解析器，单测覆盖各分支）。

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/tender-pricing/finance-view.ts`（新） | `resolvePricingCostVisibility`、`buildPricingHelperView`、`buildSavedInputsView`、`touchesCost`、`redactRoomSummaryCost`、固定文字 |
| `src/app/api/projects/[id]/pricing-helper/route.ts` | 读取与保存接财务判定；无权时不取比价建议；`inputs` 不是对象时按空对象（以前 500） |
| `src/components/tender/pricing-helper-card.tsx` | `costHidden` 时的显示；403 的说明与保留表单 |
| `src/app/api/projects/route.ts`、`src/app/api/projects/[id]/bid-intelligence/route.ts` | 房间 JSON 用 `redactRoomSummaryCost` |
| 测试 | 新 `finance-view.test.ts`（47）、隔离库 `pricing-helper-finance-db.isolated.test.ts`（34），都已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`compare-cost-source.test.tsx` 只改两条卡片接线断言（成本加成提示、目标毛利写法改按 `compareOn`），行为断言不改 |

## 3. 测试

| 测试 | 结果 |
|---|---|
| `tender-pricing/__tests__/finance-view.test.ts`（新） | 47 通过（判定各分支、读取 / 保存视图、`touchesCost`、房间 JSON 裁剪含备忘、卡片与接口源码断言） |
| 隔离库 `pricing-helper-finance-db.isolated.test.ts`（新） | 34 通过：七种身份（看不到：只读成员、项目编辑者、组织管理员（没有财务键）、`bids` 岗位（ASSIGNED 范围的 finance.read）；看得到：项目负责人、持组织范围 finance.read 的成员（`accounting` 岗位）、平台超级管理员）× 开关开关；建一个真实选定的比价轮次，把一个少见的落地价数字放进搜索串，核对无权的人整个响应里搜不到；保存的 403 / 照常保存 / 已保存成本保留；房间 JSON 两个接口对负责人也去掉成本与备忘 |
| `compare-cost-source.test.tsx` / 隔离库 `compare-cost-source-db` | 83 / 42 通过 |
| `pricing-helper-save-db` / `pricing-helper-lock-db`（FIX-8 / FIX-9） | 17 / 17 通过，不改期望 |

## 4. 门禁

| 项 | 结果 |
|---|---|
| `npm test`（本机，带隔离库） | `703/714 通过, 11 失败`，11 项全是 main 上同样失败的既有项（与 `docs/QINGYAN_CHAIN-3_REPORT.md` §4 同一批：Autopilot A2-P0、Mention Gateway M2-A、Phase3A-3 Approvals、Phase3A-4 Acceptance / Governance、Phase3A-5 Overview、客户报价 PDF 分页、Sunny 工艺单 DB、T4 授标情报 Postgres 矩阵、招标询价自动起草 DB 75 / 76、来信观察 DB） |
| `npm run test:ci`（不带数据库，与 CI 相同） | PASS（注册校验：已注册 681 个，历史欠账 66 条） |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（无新增指纹） |
| `openspec validate pricing-helper-finance-gate --strict` | valid |
| `git diff origin/main -- prisma/ vercel.json` | 空 |

### 2026-11-22 合入 main `8f65b77a` 后复跑

合并提交 `02a89fb9`（含 #540 FIX-12、#546 FIX-13 及其归档 #545 / #547）：无冲突，三个两边都改过的文件（TASKFLOW、`scripts/test-all.sh`、`scripts/test-ci-unit.sh`）都是两边各自追加的行，全部保留。本分支改的 8 个源文件与测试，main 在分叉（`91d928e4`）之后都没有动过；main 这次改的代码都在 `tender-auto-analysis` / `tender-understanding` / `files` / `ai/model-policy` 与两个分析面板、项目文件列表，本分支的代码不引用它们。

| 项 | 命令 | 结果 |
|---|---|---|
| 本 change 测试单跑（隔离库 `qy_iso_e`，迁移已是最新） | `npx tsx` 跑 `finance-view.test.ts`、`compare-cost-source.test.tsx`、`pricing-helper.test.ts`；`NODE_ENV=test npx tsx` 跑 `pricing-helper-finance-db` / `pricing-helper-save-db` / `pricing-helper-lock-db` / `compare-cost-source-db` 四个 `.isolated.test.ts` | 47 / 83 / 13；34 / 17 / 17 / 42，全部通过 |
| 全量（新建库 `qy_full_chain2b`，`npx prisma migrate deploy` 应用全部 42 个迁移） | `npm test > /home/user/full-chain2b.log 2>&1` | `707/717 通过, 10 失败`；10 项与 main 基线逐条相同：来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB（75 / 76）；上表的 Mention Gateway M2-A 这次通过；本 change 两条测试 47 / 34 通过 |
| CI 子集 | `env -u DATABASE_ENVIRONMENT DATABASE_URL=…/ci DIRECT_URL=…/ci JWT_SECRET=ci-only-… NODE_ENV=test npm run test:ci` | PASS（`finance-view` 47、`compare-cost-source` 83；隔离库测试按设计跳过） |
| 类型 | `npm run typecheck` | 通过 |
| lint | `npm run lint:baseline` | PASS（errors 38 / 基线 53，无新增指纹） |
| 测试注册 | `bash scripts/check-test-registry.sh` | 已注册 684 个，历史欠账 66 条 |
| 运行时架构 | `bash scripts/test-runtime-architecture.sh` | 9 通过 0 失败，guards PASS |
| OpenSpec | `openspec validate pricing-helper-finance-gate --strict` | valid |
| 受保护文件 | `git diff origin/main -- prisma/ vercel.json package.json package-lock.json` | 空 |

## 5. 多维审查

**开工前（一个子 agent，只给四件套与代码）**——逐条核实后并入四件套（`408e587a`）：项目列表与调查室两个接口的房间 JSON 也带出成本，一并去掉；开关开着时无权的人带 `compareCostHidden`、不取数；判定出错只收组织范围的键；保存顺序 409 → 403 → 400；五条比价规格限定为有财务查看权的人；投标同事看不到成本列为 GATE 问题。

**实现后（四个子 agent，各审一个维度）**——逐条核实后（`a9954f05`）：

| 维度 | 意见 | 处理 |
|---|---|---|
| 正确性与回归 | 隔离库测试在 CI 里跳过，CI 抓不到接线回退 | **已修**：源码断言 `inputs: view.inputs`、`result: view.result`、两个隐藏标记的展开，不留裸 `inputs,` |
| | 403 只断言状态码 | **已修**：同时断言那句话 |
| | 判定兜底分支没有测试 | **已修**：抽成 `resolvePricingCostVisibility`，注入解析器单测 |
| | 开关读了两次 | **已修**：用同一个 `compareEnabled` |
| 安全 / 隐私 / 硬纪律 | 房间 JSON 里的投标策略备忘由含成本与毛利的情景写成 | **已修**：两个接口一并去掉 `bidStrategyMemo`（界面不读，已核对） |
| | 备忘还经情报页签（`award-history` 的定价策略）、工作台摘要、投标文件草稿给项目读者 | 不改：Out of scope，根本修法是送进模型前去掉成本（§6 第 3 条） |
| | 能编辑项目的人可以把负责人改成自己，从而拿到财务查看权 | 不改：成本核算、寻源卡同样，另立 change（§6 第 2 条） |
| | `inputs` 不是对象时 500（既有） | **已修**：按空对象 |
| 规格—代码—测试一致性 | 兜底规则没写进规格 | **已改**规格 |
| | 场景写「比价矩阵有选定」，测试并没有建真实轮次 | **已修**：测试建真实选定轮次，落地价放进搜索串 |
| | 「调查室 JSON」那条要求标题与内容（含备忘） | **已改** |
| | 卡片的说明没有规格 | **已改**：新增「卡片上没有财务查看权时的显示」 |
| | 场景数字、列表也给负责人读、409 > 403 > 400 与 `derive` 的场景、错误文字断言、要求里写接口路径、tasks 说法 | **已改** |
| 使用流畅与文案 | 卡片把「需要财务查看权」那句从假设说明里滤掉，人看不出少了什么 | **已修**：情景表上方写明毛利与两种成本情景不显示 |
| | 不知道找谁 | **已修**：`只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。` |
| | 403 只说没权限，表单被清空 | **已修**：写明没保存、要刷新重填，红字、`aria-live`，保留刚填的值 |
| | 改目标毛利情景表不变，像坏了 | **已修**：目标毛利下面写 `目标毛利只用于按成本算的底价情景；你这里改了，情景表不会变。` |
| | 同一页「报价与成本」卡对几乎所有项目角色显示估算成本与毛利率 | 不改：列入 §6 第 4 条 |
| | 版式、`大幅让价——核对毛利` 等 | 小处已调；文案沿用既有 |

## 6. 留给 GATE 的问题（Lucas 2026-11-20 已答四条；第 4 条衍生的 CHAIN-2e 三问 Evan 2026-11-22 已答）

1. **投标同事看不到成本了**（`bids` 岗位的 `project.finance.read` 只在 ASSIGNED 范围）——**不用**改：照本 change 的口径，不给组织范围财务权。
2. **项目负责人可以被改成自己**——**另立 change**：已开 CHAIN-2c `project-owner-change-guard`（#539）。
3. **投标策略备忘可能转述成本或毛利**——**另立 change**：已开 CHAIN-2d `strategy-memo-cost-strip`（#538；它须在本 PR 之后合并）。
4. **口径不同的页面**：比价矩阵（`…/compare/matrix`、`…/compare/analysis`）对项目读者显示每家的落地价；同一工作台页的「报价与成本」卡（报价引擎）按 `canViewInternal` 显示估算成本与毛利率。要不要统一到财务查看权——**Lucas 2026-11-20 第三轮已答：统一**，另开 CHAIN-2e `finance-view-compare-quote-gate`（排在本 PR 之后）。CHAIN-2e 的三个待答问题 **Evan 2026-11-22 已答**：
   - ① 不是项目负责人的投标同事不能新建、编辑、批准报价——**接受**，前提是谁做报价谁就是该项目负责人；没权限的人打开报价入口要看到一句白话说明（为什么看不了、找谁），不能停在加载中。
   - ② 单个报价页的完整成本视图只给有财务查看权的人，其他人只看客户视图——**同意**。
   - ③ 没权限的人仍能看到排序和「最便宜」标记，看不到金额与差额——**可以**。

## 7. 已知限制

- 每次读取与保存多 2 次 `authorize`（与成本核算接口相同代价）。
- 没有财务查看权的人保存对手价等不会改成本，但看不到「成本 + 目标毛利」「成本价」两种情景，报价底价要找有权限的人看。

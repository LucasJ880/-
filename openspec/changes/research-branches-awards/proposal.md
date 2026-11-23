# Proposal：三个子代理（TREE-3）

TASKFLOW：TREE-3（Phase F（续）— 情报调研树）。任务书 `docs/QINGYAN_TREE_RESEARCH_TREE_TASKBRIEF.md`「TREE-3」一节（Evan 2026-11-22 拍板第 2、6 项）。不触碰 muse-bridge，无受影响的 Muse 意图（只复用 `muse-bridge/contract.ts` 的出站敏感词判断函数，不改它）。

## Why

TREE-2 的树已经能跑，但三支都还是同一个通用循环：条款一支交「未接通」，另两支只交散的事实，算不出单价、看不出哪条可比。本 change 把三支换成任务书要的三个子代理，并用纯函数把查到的授标变成「单价 + 口径 + 可比度」，给 TREE-4 核对、TREE-5 出区间用。

## What Changes

- 接通条款员（① 条款）：不联网，先用关键词规则（英法双语：等效品、不接受替代 / 指定品牌、加拿大含量、限制性招标）在已解析的标书页里找段落，有命中才发一次模型请求（每棵树一次），判断「是否要求加拿大 / 本地含量」「是否指定品牌」「是否接受等效品及要什么证明」；引文由代码逐字核对、页码由代码填。
- 新增条款三问「未写明」时的澄清问题草稿：固定模板（英文正文 + 中文说明），不调模型。
- 新增招标要求页的只读卡片「标书条款（调研树）」与读取接口 `GET /api/projects/[id]/research-tree`：第一步不带条件地调用项目读权限守卫；开关关 404、卡片不显示；卡片只读，不改已确认的要求、不进关键事实槽位。
- 改往期同标员（② 往期同标）：先确定性地查联邦合同公开数据（`tender-intel/canadabuys.ts` 的 `searchAwardHistory`，最多 2 次，每次算一次搜索、过外发闸），采购方与本项目同一的行转成带网址与摘录的事实；再接着用搜索与读页补中标方、合同额、数量、年份。
- 改同类项目员（③ 与第二波甲乙）：目标改成交回一组（采购方、年份、数量、合同额、币种）记录及其来源。
- 新增事实分组与结构化记录：同一网址、同一组的已核对事实由代码组装成授标记录 `records[]`；新事实类型币种、口径、品项，去掉「同类授标」这一类型。
- 新增单价纯函数：合同额 ÷ 数量，原币、不换汇、十进制精确到分；金额或数量缺、为 0、为区间时不算。
- 新增口径：含安装 / 含运费 / 多年期 / 多品项 / 不明，由子代理从原文判断并附摘录，代码核摘录。
- 新增可比度纯函数：同采购方、同规格、数量在一半到两倍之间、近 3 年四项，每项 是 / 否 / 不明，分数为「是」的个数。
- 改分叉规则：② 一条记录都没有 → 第二波甲跑；③（含甲）能算出单价的同类记录不足 3 条 → 第二波乙跑。
- 改交接单 `research-handoff/v1`：加 `records[]` 与 `clauses`；短标签「查到 N 条」的 N 改为记录数，条款一支改为「写明了 N 项」/「都未写明」。
- 改树干摘要：加每支记录数与条款三问的答案（不放摘录、页码、金额）。
- 改交给模型的项目资料：加数量与合同期（来自最新一次可用分析的关键事实，只读）。

## Out of scope

- 交叉验证与核对员、「单一来源」「已核实」标记（TREE-4）；证据表、建议区间与中位数、情报页签的调研树卡片、「开始调研」按钮、「重新查」与「这条不对」、确认招标要求时自动起一次（TREE-5）；补页（TREE-6）；资料申请与澄清问题清单（TREE-7、TREE-8）。
- 不改 `CRITICAL_FACT_TYPES`、不写任何分析运行（`TenderAnalysisRun` / 要求 / 事实），不改招标要求的确认入口（判断点 3 默认）。
- 不换汇；不把出厂价与中标价混算；模型不写结论里的数字（单价、可比度都由代码算）。
- 美国联邦授标接口（判断点 5，第三批）；中标方反查（第三批）。
- 不改数据库结构、不改任务运行时源码、不改 `vercel.json`、不改一键分析的 9 节点图、不改 TREE-1 的读页逻辑与守卫测试、不改 `canadabuys.ts`。
- 不发任何对外邮件、不建待批卡、不改报价、不写供应商库、不写授标权威记录（`AwardRecord`）。

## Capabilities

### New Capabilities

- `tender/research-branches`：调研树的三个子代理——条款员怎么找段落、怎么判断、怎么在招标要求页只读展示；往期同标员与同类项目员的来源与交回的记录；单价、口径、币种与可比度怎么算。

### Modified Capabilities

- `tender/research-tree`：条款一支接通；事实类型与分组；交接单加记录与条款；分叉规则按记录数；树干摘要加记录数与条款答案；交给模型的项目资料加数量与合同期；读取接口。

## Impact

- 新增：`src/lib/tender-research-tree/{awards.ts, clauses.ts, clauses-run.ts, federal.ts, view.ts}`（单价 / 口径 / 币种 / 可比度 / 记录组装纯函数；条款规则、核对与草稿纯函数；条款员执行；联邦数据一步；读取视图）、`src/components/tender-analysis/research-clauses-card.tsx`；测试 `src/lib/tender-research-tree/__tests__/research-branches-pure.test.ts`、`src/lib/web-reader/__tests__/tree3-research-branches.test.ts`、`src/lib/tender-research-tree/__tests__/research-branches-db.isolated.test.ts`、`src/components/tender-analysis/__tests__/research-clauses-card.test.tsx`，都注册进 `scripts/test-all.sh`（单元测试另进 `scripts/test-ci-unit.sh`）。
- 修改：`src/lib/tender-research-tree/{types.ts, limits.ts, fork-rules.ts, prompt.ts, guards.ts, cursor.ts, deps.ts, branch-run.ts, trunk.ts}`、`src/app/api/projects/[id]/research-tree/route.ts`（加 GET）、`src/components/project-detail/tabs/requirements-tab.tsx`（挂卡片，一行）；TREE-2 的四份测试里随行为改动的断言。
- 文档：`docs/QINGYAN_TREE-3_REPORT.md`、`docs/QINGYAN_TREE_HANDOFF.md`、`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 状态列。
- 零 schema、零依赖、零出站发送；新增模型调用只有条款员每棵树一次（config 第 7 条例外二已登记）；分支循环的上限不变。

# Tasks：招标分析「没做完的地方」用白话说清楚（FIX-16）

> 开工前提：
> 1. 合并顺序 **FIX-13 → FIX-18 → FIX-22 → FIX-16**。FIX-13（#546，`document-parse-nul-and-reason`）、FIX-18（`tender-analysis-single-entry`）、FIX-22（`tender-requirements-tab-converge`）都合并后，把本分支 rebase 到合并后的 main 再开工。然后核对两件事：
>    - FIX-13 规格里「分析面板提醒还没纳入的能读文件」一条的原文，与本 change `specs/tender/analysis-package-coverage/spec.md` 那一条的第一段与第一个场景逐字相同。不同就先改本 change 的规格，并跑 `openspec validate --strict`。
>    - design 里标「FIX-13 后」的行号。
> 2. 核对 FIX-22 已合并后的面板结构，对不上的地方先改四件套（`openspec validate --strict`）再实现。要核的六项：
>    - 进度部分的组成：一键分析卡片、分析状态那一栏、覆盖清单、增量变更、出错提示；
>    - 矩阵插槽的位置，以及交给矩阵的参数；
>    - 矩阵判定「已完成」的函数，以及「本次分析未完成，以下可能不全」那几句；
>    - 「项目解读」页是否在矩阵下方收起的分区里；
>    - FIX-22 的 GATE 对它的 G6 怎么定，选 B 时删掉矩阵那一句（本 change 的 G10）；
>    - FIX-18 合并后运行头部按钮栏的样子。
> 3. design「留给 GATE」里各条怎么处理：
>    - G1、G3 本次不做；
>    - G2、G4、G10 按 A 实施；
>    - GATE 若改了任何一条的推荐，先改四件套再动代码。
> 4. 开工前跑一遍将要触碰模块的已注册测试，记下通过数：
>    - 本模块：`v2-resumable.test.ts`（42）、`v2-slice-deadline.test.ts`（46）、`alerts.test.ts`（30）、`v2-map.test.ts`、`analyst-synthesis.test.ts`、`input-completeness.test.ts`、`addendum-disposition.test.ts`；
>    - 相邻 change：`package-coverage.test.ts`（FIX-13）、`single-entry.test.ts`（FIX-18）、`requirements-tab-converge.test.ts`（FIX-22）。

## 1. 句子查表先行

- [ ] 1.1 新建 `src/lib/tender-understanding/incomplete-notes.ts`：纯函数，不引用数据库、React 与其它业务模块。
  - 内容：
    - 未完成记录的类型与读取：宽进严出，形状不对返回空；
    - 位置写法：按包内顺序，超过 6 段接「等 N 处」；
    - 「要说的事项」的判定：记录 + 投标包 AI 体验开关 + 有没有「项目解读」→ 固定顺序的事项；
    - 规格里的全部句子：那一块的标题与四种行、复核横幅、矩阵那一句、四个通知短语、收尾句、文件覆盖那一句；
    - 由事项加「这次分析已完成」算出 `incompleteNotes`。「已完成」作为布尔参数传入，由调用方用 FIX-22 的判定函数算。
  - 新建 `src/lib/tender-understanding/__tests__/incomplete-notes.test.ts`（用例名用中文），同一步注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：`npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 全过，覆盖下面这些：
    - 规格每一句逐字断言；位置四种写法；超过 6 段；两种原因句子相同；
    - 开关与有无「项目解读」的四种组合；矩阵那一句随「已完成」与有无「内容没读完」的四种组合；
    - 记录缺失 / 形状不对 / 旧分析 → `null`；
    - 句子里不含内部用词、错误码、「综合」与方位词（上面 / 下面 / 上方 / 下方）；
    - 讲内容段的句子以「已纳入的文件里」开头，且不含「纳入这次分析」「未纳入」「没纳入」「没有读到」。
  - verify：`bash scripts/check-test-registry.sh` 输出 OK。

## 2. 记下没做完的地方

- [ ] 2.1 组装并写入未完成记录。
  - `src/lib/tender-understanding/clarify.ts`：澄清问题的组装多交回「编号 → 工作单条目」，既有两个返回字段不变。
  - 新建 `src/lib/tender-auto-analysis/v2-incomplete.ts`：纯函数，由检查点、内容段清单、澄清工作单与摘要里有没有「项目解读」组装出记录。判定「没核对成」= 有相关页，而结果为空或缺键；问题全文取组装后的澄清问题文字。
  - 新建 `src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts`，同一步注册进两个脚本。
  - `src/lib/tender-auto-analysis/v2-resumable.ts`：在 `buildInference` 并完「项目解读」之后，把记录放进 `summaryJson.incompleteSteps`，四项皆空不放。
  - verify：`npx tsx src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts` 全过，覆盖下面这些：
    - 内容段 × 两种原因；第一遍两次没写成；第一遍写成但组装出错；复核没结果；
    - 澄清问题四种情况（无相关页、有结果、结果为空、缺键）；四项皆空；
    - 上线前写的检查点得到同样的记录；
    - 记录里的问题全文与落库的澄清问题逐字相同；落库的澄清问题文字不变。
  - verify：`v2-resumable.test.ts` 补三个用例（「无事可记时没有 `incompleteSteps`」「第一遍两次失败」「复核两次失败」），RESUME-09 补 `qa.status === "NEEDS_HUMAN_REVIEW"`，之后全过。
  - verify：`v2-slice-deadline.test.ts` 46 / 46，一条不改；`git diff origin/main -- src/lib/tender-auto-analysis/v2-cursor.ts src/lib/tender-analyst` 为空。
- [ ] 2.2 改写局限说明那一句。
  - `src/lib/tender-understanding/analyzer.ts`：局限说明里讲没读完内容的那一句，改用 1.1 的模板。
  - `analyzeTender` 与 `v2-resumable.ts` 的 `exhaustedWindows`：给每个失败的内容段带上文件名与起止位置，生成句子前按包内顺序排。
  - `v2-resumable.test.ts`：RESUME-05 / RESUME-06 改认新句子，并断言全部局限说明不含「窗口」与错误码；补「单次编排并发失败按包内顺序」一例。
  - verify：`v2-resumable.test.ts`、`input-completeness.test.ts`、`addendum-disposition.test.ts`、`analyst-synthesis.test.ts`、`v2-map.test.ts` 全过；`grep -rn "窗口 LLM 抽取失败" src` 无结果。

## 3. 告诉人

- [ ] 3.1 接口：`src/app/api/projects/[id]/tender-analysis/runs/[runId]/route.ts` 的响应加 `incompleteNotes`。
  - 调用 1.1 的函数时传入三样：已算好的投标包 AI 体验开关、`readAnalystSynthesis` 的结果、FIX-22 判定的「这次分析已完成」。
  - 不下发记录原文；矩阵读接口 `bid-fit` 不改。
  - 在 `incomplete-notes.test.ts` 里补对接口文件的源码断言。
  - verify：源码断言通过：调用查表函数；响应里没有 `incompleteSteps` 原文；其它字段不变。
  - verify：`git diff origin/main -- 'src/app/api/projects/[id]/bid-fit'` 为空。
- [ ] 3.2 界面：面板、项目解读视图、矩阵卡片。三个组件自身都不写这些句子的文字。
  - `src/components/tender-analysis/analysis-panel.tsx`：
    - 带分析状态那一栏时，在分析状态那一栏之后、矩阵插槽之前，显示 `incompleteNotes.heading` 与 `incompleteNotes.lines`；用 `data-testid="analysis-incomplete-notes"`，不放进覆盖清单那一块；
    - 把 `incompleteNotes.matrixLine` 连同分析 id、状态交给矩阵插槽。
  - `src/components/tender-analysis/bid-fit-matrix-card.tsx`：多一个可选属性接矩阵那一句，非空时在顶部显示；标注、确认、批准、补翻的代码不动。
  - `src/components/tender-analysis/analyst-synthesis-view.tsx`：多一个可选属性接复核横幅的句子，非空时显示它，否则保持既有句子。只加属性，不动 FIX-13 加的 `currentParseErrors`，也不动 FIX-22 改的两个按钮。
  - 在 `incomplete-notes.test.ts` 里补三个组件的源码断言。
  - verify：源码断言通过：
    - 三个组件渲染接口下发的字符串，组件里搜不到规格的句子；
    - 那一块在分析状态那一栏之后、矩阵插槽之前，不在 `data-testid="package-coverage"` 里，不锚定增量变更横幅；
    - 面板把 `matrixLine` 交给插槽。
  - verify：`package-coverage.test.ts`、`single-entry.test.ts`、`requirements-tab-converge.test.ts` 照旧全过；`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0。
  - verify：本地用构造的 `summaryJson` 打开项目页截图（四种情况各一份，另一份同时带两份解析失败的文件），贴进报告：进度部分里那一块、矩阵顶部那一句、展开「项目解读」页后的复核横幅、与覆盖清单并列。
- [ ] 3.3 完成通知：`src/lib/tender-auto-analysis/alerts.ts`。
  - `tenderSuccessSummary` 加可选输入（要说的事项的短语清单）；文件覆盖那一句的括号改为「其余 k 个文件未纳入这次分析」。
  - `notifyTenderRunSucceeded`：读记录，用投标包 AI 体验开关与 `readAnalystSynthesis` 判断有没有「项目解读」，算出清单后传入；优先级按规格。
  - `alerts.test.ts` 补规格的八个通知场景。
  - verify：`npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts` 全过：八个场景的摘要逐字与优先级都对；ALERT-09 / ALERT-10 一条不改。

## 4. 验收

- [ ] 4.1 全部门禁。
  - verify：`npm test` 与既有失败清单（`docs/QINGYAN_CHAIN-3_REPORT.md` §4）对照，无新增失败。
  - verify：CI 环境变量下 `bash scripts/test-ci-unit.sh` 末行为 `CI unit subset PASS`。
  - verify：`npm run lint:baseline` PASS；`bash scripts/test-runtime-architecture.sh` PASS；`bash scripts/check-test-registry.sh` OK；`openspec validate tender-analysis-incomplete-notes --strict` valid。
  - verify：`git diff origin/main` 对下面这些路径为空：`prisma/`、`vercel.json`、`openspec/specs`、`src/lib/muse-bridge`、`src/lib/tender-auto-analysis/chat-context.ts`、`src/lib/tender-auto-analysis/requirement-matrix.ts`、`src/components/tender-analysis/agent-card.tsx`、`src/components/project-detail/tabs/requirements-tab.tsx`。
- [ ] 4.2 写 `docs/QINGYAN_FIX-16_REPORT.md` + 更新 TASKFLOW 状态列。
  - 报告内容：
    - 四种情况的改前 / 改后句子与截图，以及矩阵那一句；
    - 通知的改前 / 改后；
    - 已核对的现状；
    - 「留给 GATE」各条的状态，以及 2026-11-22 生产实测（项目 12-3）的结论；
    - 测试输出、多维审查结论。
  - `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：新增 FIX-16 一行，状态 `[~]`。同时登记四条后续任务，各一行，编号写「待定」，状态 `[ ]`：
    1. Muse `analysis.ready` 第一行与 `next_step` 的「有地方没做完」说法（G3）；
    2. 项目聊天与 Muse `ask` 上下文加「有内容没读完」（G6）；
    3. 删掉复核横幅里点不开的「详见 QA 记录 N 条」（G9）；
    4. 情报页覆盖说明「N 个文件文件解析失败」的拼接。
  - verify：报告存在；`grep -n "FIX-16" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行；`grep -c "| 待定 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 不少于 4。

## Workflow follow-up

- 开 PR 前，按 `openspec/config.yaml`「多维审查」并行派子 agent，逐条核实后修，重跑测试；PR 正文写「多维审查」一节。四个维度：
  - 正确性与回归；
  - 安全 / 隐私与硬纪律；
  - 规格—代码—测试一致性；
  - 使用流畅与文案：含与 FIX-13 覆盖清单、FIX-22 矩阵「本次分析未完成」、FIX-20「综合汇总」的用词是否分得开。
- 归档排在 FIX-13 归档之后（本 change 对 `tender/analysis-package-coverage` 是 MODIFIED；对 FIX-22 的能力没有 MODIFIED）。
- PR 合并后跑 `/opsx:archive tender-analysis-incomplete-notes --yes`，走独立小 PR；至少一个子 agent 核对主规格与 delta、TASKFLOW 状态。

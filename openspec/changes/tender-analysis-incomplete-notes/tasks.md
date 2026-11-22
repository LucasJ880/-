# Tasks：招标分析「没做完的地方」用白话说清楚（FIX-16）

> 开工前提：
> 1. FIX-13（#546，`document-parse-nul-and-reason`）合并后，把本分支 rebase 到合并后的 main 再开工。rebase 后核对 FIX-13 的规格里「分析面板提醒还没纳入的能读文件」一条的原文，与本 change `specs/tender/analysis-package-coverage/spec.md` 那一条的第一段逐字相同（不同就先改本 change 的规格并 `openspec validate --strict`）；核对 design 里标「FIX-13 后」的行号。
> 2. design「留给 GATE」的 G1–G4 等 2026-11-22 生产实测（项目 12-3）的结果，不在本 tasks 里；GATE 若改了 G5–G9 的推荐，先改四件套再动代码。
> 3. 开工前跑一遍将要触碰模块的已注册测试并记下通过数：`v2-resumable.test.ts`（42）、`v2-slice-deadline.test.ts`（46）、`alerts.test.ts`（30）、`v2-map.test.ts`、`package-coverage.test.ts`（FIX-13）、`analyst-synthesis.test.ts`、`input-completeness.test.ts`、`addendum-disposition.test.ts`。

## 1. 句子查表先行

- [ ] 1.1 新建 `src/lib/tender-understanding/incomplete-notes.ts`（纯函数，不引用数据库、React 与其它业务模块）：未完成记录的类型与读取（宽进严出，形状不对返回空）、位置写法（按包内顺序、超过 6 段接「等 N 处」）、「要说的事项」的判定（记录 + 投标包 AI 体验开关 + 有没有「项目解读」→ 固定顺序的事项）、规格里的全部句子（那一块的标题与四种行、复核横幅、四个通知短语、收尾句、文件覆盖那一句）、由事项算出 `incompleteNotes`；新建 `src/lib/tender-understanding/__tests__/incomplete-notes.test.ts`（用例名用中文），同一步注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 全过（规格每一句逐字断言、位置四种写法、超过 6 段、两种原因句子相同、开关与有无「项目解读」的四种组合、记录缺失 / 形状不对 / 旧分析 → `null`、句子不含内部用词、错误码与「综合」、讲内容段的句子以「已纳入的文件里」开头且不含「纳入这次分析」），`bash scripts/check-test-registry.sh` 输出 OK

## 2. 记下没做完的地方

- [ ] 2.1 `src/lib/tender-understanding/clarify.ts` 的澄清问题组装多交回「编号 → 工作单条目」（既有两个返回字段不变）；新建 `src/lib/tender-auto-analysis/v2-incomplete.ts`（纯函数：检查点 + 内容段清单 + 澄清工作单 + 摘要里有没有「项目解读」→ 记录；没核对成 = 有相关页而结果为空；问题全文取组装后的澄清问题文字）与 `src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts`，同一步注册进两个脚本；`src/lib/tender-auto-analysis/v2-resumable.ts` 在 `buildInference` 并完「项目解读」之后把记录放进 `summaryJson.incompleteSteps`（四项皆空不放）；verify：`npx tsx src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts` 全过（内容段 × 两种原因、第一遍两次没写成、第一遍写成但组装出错、复核没结果、澄清问题三种情况、四项皆空、上线前写的检查点得到同样的记录、记录里的问题全文与落库的澄清问题逐字相同、落库的澄清问题文字不变）；`v2-resumable.test.ts` 补「无事可记时没有 `incompleteSteps`」「第一遍两次失败」「复核两次失败」三个用例、RESUME-09 补 `qa.status === "NEEDS_HUMAN_REVIEW"` 后全过；`v2-slice-deadline.test.ts` 46 / 46 一条不改；`git diff origin/main -- src/lib/tender-auto-analysis/v2-cursor.ts src/lib/tender-analyst` 为空
- [ ] 2.2 `src/lib/tender-understanding/analyzer.ts`：局限说明里讲没读完内容的那一句改用 1.1 的模板；`analyzeTender` 与 `v2-resumable.ts` 的 `exhaustedWindows` 给每个失败的内容段带上文件名与起止位置，生成句子前按包内顺序排；`v2-resumable.test.ts` 的 RESUME-05 / RESUME-06 改认新句子并断言全部局限说明不含「窗口」与错误码，补「单次编排并发失败按包内顺序」一例；verify：`v2-resumable.test.ts`、`input-completeness.test.ts`、`addendum-disposition.test.ts`、`analyst-synthesis.test.ts`、`v2-map.test.ts` 全过，`grep -rn "窗口 LLM 抽取失败" src` 无结果

## 3. 告诉人

- [ ] 3.1 `src/app/api/projects/[id]/tender-analysis/runs/[runId]/route.ts`：响应加 `incompleteNotes`（用已算好的投标包 AI 体验开关与 `readAnalystSynthesis` 的结果调用 1.1 的函数，不下发记录原文）；verify：`incomplete-notes.test.ts` 里对接口文件的源码断言通过（调用查表函数、响应里没有 `incompleteSteps` 原文、其它字段不变）
- [ ] 3.2 `src/components/tender-analysis/analysis-panel.tsx`：带运行头部时，在运行头部之后、增量变更横幅之前显示 `incompleteNotes.heading` 与 `incompleteNotes.lines`（`data-testid="analysis-incomplete-notes"`，不放进覆盖清单那一块）；`src/components/tender-analysis/analyst-synthesis-view.tsx`：多一个可选属性接复核横幅的句子，非空时显示它、否则保持既有句子（只加属性，不动 FIX-13 加的 `currentParseErrors`）；组件自身不写这些句子的文字；verify：`incomplete-notes.test.ts` 里对两个组件的源码断言通过（渲染接口下发的字符串、组件里搜不到规格的句子、那一块在运行头部之后、增量变更横幅之前、不在 `data-testid="package-coverage"` 里），`npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 照旧全过，`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0，本地用构造的 `summaryJson`（四种情况各一份，另一份同时带两份解析失败的文件）打开项目页的截图（那一块、复核横幅、与覆盖清单并列）贴进报告
- [ ] 3.3 `src/lib/tender-auto-analysis/alerts.ts`：`tenderSuccessSummary` 加可选输入（要说的事项的短语清单），文件覆盖那一句的括号改为「其余 k 个文件没纳入这次分析」；`notifyTenderRunSucceeded` 读记录、用投标包 AI 体验开关与 `readAnalystSynthesis` 判断有没有「项目解读」、算出清单后传入，优先级按规格；`alerts.test.ts` 补规格的八个通知场景；verify：`npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts` 全过（八个场景的摘要逐字与优先级；ALERT-09 / ALERT-10 一条不改）

## 4. 验收

- [ ] 4.1 全部门禁；verify：`npm test` 与既有失败清单（`docs/QINGYAN_CHAIN-3_REPORT.md` §4）对照无新增失败；CI 环境变量下 `bash scripts/test-ci-unit.sh` 末行 `CI unit subset PASS`；`npm run lint:baseline` PASS；`bash scripts/test-runtime-architecture.sh` PASS；`bash scripts/check-test-registry.sh` OK；`openspec validate tender-analysis-incomplete-notes --strict` valid；`git diff origin/main -- prisma/ vercel.json openspec/specs src/lib/muse-bridge src/lib/tender-auto-analysis/chat-context.ts src/components/tender-analysis/agent-card.tsx` 为空
- [ ] 4.2 写 `docs/QINGYAN_FIX-16_REPORT.md`（四种情况的改前 / 改后句子与截图、通知的改前 / 改后、已核对的现状、「留给 GATE」各条的状态与 2026-11-22 生产实测（项目 12-3）的结论、测试输出、多维审查结论）+ 更新 TASKFLOW 状态列（`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 新增 FIX-16 一行，`[~]`）；verify：报告存在，`grep -n "FIX-16" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行

## Workflow follow-up

- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent（正确性与回归、安全 / 隐私与硬纪律、规格—代码—测试一致性、使用流畅与文案——含与 FIX-13 覆盖清单、FIX-20「综合汇总」的用词是否分得开），逐条核实后修，重跑测试；PR 正文写「多维审查」一节。
- 归档排在 FIX-13 归档之后（本 change 对 `tender/analysis-package-coverage` 是 MODIFIED）；PR 合并后 `/opsx:archive tender-analysis-incomplete-notes --yes`（独立小 PR，至少一个子 agent 核对主规格与 delta、TASKFLOW 状态）。

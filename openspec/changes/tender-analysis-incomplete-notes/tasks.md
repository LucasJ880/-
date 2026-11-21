# Tasks：招标分析「没做完的地方」用白话说清楚（FIX-16）

> 开工前提：FIX-12（#540）已合并上线；Evan 重测后回答了 proposal.md「待重测后确认 / 待拍板」。有已经回答的条目就先改四件套再动代码（第 2 条选 B 时删掉 3.3 与规格「Muse 的分析完成消息如实说有地方没做完」一条）。

开工前跑一遍将要触碰模块的已注册测试并记下通过数（`v2-resumable.test.ts`、`v2-slice-deadline.test.ts`、`alerts.test.ts`、`v2-map.test.ts`、`analyst-synthesis.test.ts`、`input-completeness.test.ts`、`addendum-disposition.test.ts`、`muse-bridge/__tests__/advisory.test.ts`、`muse-bridge-pure.test.ts`）。

## 1. 句子查表先行

- [ ] 1.1 新建 `src/lib/tender-understanding/incomplete-notes.ts`（纯函数，不引用数据库、React 与其它业务模块）：未完成记录的类型与读取（宽进严出，形状不对返回空）、位置写法、「要说的事项」的判定（记录 + 综合解读界面开关 + 是否有综合解读 → 固定顺序的事项）、规格里的全部句子（面板四句、横幅、澄清标注、四个短语、通知收尾句、Muse 第一行）、由事项 + 澄清问题清单算出 `incompleteNotes` 与每条的 `answerCheckNote`；新建 `src/lib/tender-understanding/__tests__/incomplete-notes.test.ts`（用例名用中文），同一步注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/tender-understanding/__tests__/incomplete-notes.test.ts` 全过（规格每一句逐字断言、位置四种写法、超过 6 段、两种原因句子相同、开关与有无综合解读的四种组合、记录缺失 / 形状不对 / 旧分析 → `null`、句子不含内部用词与错误码、Muse 第一行在项目名超长与三位数条数时不超过 60 字），`bash scripts/check-test-registry.sh` 输出 OK

## 2. 记下没做完的地方

- [ ] 2.1 `src/lib/tender-understanding/clarify.ts` 的澄清问题组装多交回「问题编号 → 工作单条目」（既有两个返回字段不变）；新建 `src/lib/tender-auto-analysis/v2-incomplete.ts`（纯函数：检查点 + 内容段清单 + 澄清工作单 → 记录；没核对成 = 有相关页而结果为空）与 `src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts`，同一步注册进两个脚本；`src/lib/tender-auto-analysis/v2-resumable.ts` 落库前把记录放进 `summaryJson.incompleteSteps`（四项皆空不放）；verify：`npx tsx src/lib/tender-auto-analysis/__tests__/v2-incomplete.test.ts` 全过（内容段 × 两种原因、综合解读没生成、复核没结果、澄清问题三种情况、四项皆空、上线前写的检查点得到同样的记录、落库的澄清问题文字逐字不变）；`v2-resumable.test.ts` 补「无事可记时没有 `incompleteSteps`」「综合解读两次失败」「复核两次失败」三个用例后全过、RESUME-09 不改；`v2-slice-deadline.test.ts` 43 / 43 一条不改；`git diff origin/main -- src/lib/tender-auto-analysis/v2-cursor.ts src/lib/tender-analyst` 为空
- [ ] 2.2 `src/lib/tender-understanding/analyzer.ts`：局限说明里讲没读完内容的那一句改用 1.1 的模板；`analyzeTender` 与 `v2-resumable.ts` 的 `exhaustedWindows` 给每个失败的内容段带上文件名与起止位置；`v2-resumable.test.ts` 的 RESUME-05 / RESUME-06 改认新句子并断言全部局限说明不含「窗口」与错误码；verify：`v2-resumable.test.ts`、`input-completeness.test.ts`、`addendum-disposition.test.ts`、`analyst-synthesis.test.ts`、`v2-map.test.ts` 全过，`grep -rn "窗口 LLM 抽取失败" src` 无结果

## 3. 告诉人

- [ ] 3.1 `src/app/api/projects/[id]/tender-analysis/runs/[runId]/route.ts`：响应加 `incompleteNotes` 与每条澄清问题的 `answerCheckNote`（都由 1.1 的函数算出，不下发记录原文）；`src/components/tender-analysis/analysis-panel.tsx`：带运行头部时在分栏导航上方逐条显示 `incompleteNotes.panel`（`data-testid="analysis-incomplete-notes"`），旧视图「澄清问题」每条下显示 `answerCheckNote`；`src/components/tender-analysis/analyst-synthesis-view.tsx`：复核横幅在 `incompleteNotes.review` 非空时显示它、否则保持既有句子，澄清分栏（含折叠的次要问题）按编号显示标注；组件自身不写这些句子的文字；verify：`incomplete-notes.test.ts` 里对接口文件与两个组件的源码断言通过（引用查表函数、响应里没有 `incompleteSteps` 原文、组件里搜不到规格的句子），`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0，本地用四份构造的 `summaryJson` 打开项目页的四张截图（顶部提示、没有中文解读、复核横幅、澄清标注）贴进报告
- [ ] 3.2 `src/lib/tender-auto-analysis/alerts.ts`：`tenderSuccessSummary` 加可选输入（要说的事项的短语清单），`notifyTenderRunSucceeded` 读记录、按该组织的综合解读界面开关算出清单后传入，优先级按规格；`alerts.test.ts` 补规格的五个通知场景；verify：`npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts` 全过（五个场景的摘要逐字与优先级；ALERT-09 / ALERT-10 一条不改）
- [ ] 3.3 `src/lib/muse-bridge/events-pure.ts`：`analysis.ready` 的事实多一个可选项（最要紧那一项的短语），有值时第一行用规格的句子、没有值时走既有分支；`src/lib/muse-bridge/hooks.ts`：读记录、用与 3.2 相同的判定算出该项后传入；`src/lib/muse-bridge/__tests__/advisory.test.ts` 补用例；verify：`npx tsx src/lib/muse-bridge/__tests__/advisory.test.ts` 全过（规格四个 Muse 场景：第一行逐字、不超过 60 字且不被截断、摘要里没有文件名且没有被替换成脱敏提示、没有未完成记录时与今天相同；仍是「结论 + 1 条理由」、按钮仍是 `next_step`），`npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts` 照旧全过，`git diff --stat origin/main -- src/lib/muse-bridge` 只有 `events-pure.ts`、`hooks.ts`、`__tests__/advisory.test.ts`

## 4. 验收

- [ ] 4.1 全部门禁；verify：`npm test` 与既有失败清单（`docs/QINGYAN_CHAIN-3_REPORT.md` §4）对照无新增失败；CI 环境变量下 `bash scripts/test-ci-unit.sh` 末行 `CI unit subset PASS`；`npm run lint:baseline` PASS；`bash scripts/test-runtime-architecture.sh` PASS；`bash scripts/check-test-registry.sh` OK；`openspec validate tender-analysis-incomplete-notes --strict` valid；`git diff origin/main -- prisma/ vercel.json openspec/specs` 为空
- [ ] 4.2 写 `docs/QINGYAN_FIX-16_REPORT.md`（四种情况的改前 / 改后句子与截图、通知与 Muse 的改前 / 改后、已核对的现状、「待重测后确认 / 待拍板」各条的处理、测试输出、多维审查结论）+ 更新 TASKFLOW 状态列（`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 新增 FIX-16 一行，`[~]`）；verify：报告存在，`grep -n "FIX-16" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行

## Workflow follow-up

- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent（正确性与回归、安全 / 隐私与硬纪律、规格—代码—测试一致性、使用流畅与文案），逐条核实后修，重跑测试；PR 正文写「多维审查」一节。
- Draft PR 合并后 `/opsx:archive tender-analysis-incomplete-notes --yes`（独立小 PR，至少一个子 agent 核对主规格与 delta、TASKFLOW 状态）。

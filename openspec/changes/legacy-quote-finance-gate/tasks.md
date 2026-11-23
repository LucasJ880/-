# Tasks：旧报价单、Excel、报价 AI 与报价工具里的内部成本和利润率只给有财务查看权的人（FIX-26）

**开工前提**：GATE 已定（design「GATE」一节）。实现分支从 CHAIN-2e 分支 `claude/inspiring-johnson-o54xbt-chain-2e`（`35e9ae91`）切出，把本分支的四件套带过去；确认那里有 `resolveFinanceViewSafe`、`resolveFinanceHintReason`、`src/lib/project-finance/view-hint.ts`、`src/lib/quote-engine/finance-hint.ts` 与 `resolveQuoteCapabilities(access, { finance })`（design D1）。CHAIN-2e 合并后变基到 main 再合；CHAIN-2e 长期不合时停下回报协调会话。开工前先跑一遍将要触碰模块已注册的测试（`project-routes-guard.test.ts`、`quote-engine-contract.test.ts`、`finance-access.test.ts`、`m2c-tool-policy.test.ts`、`bid-page-v2.test.tsx`），记下通过数写进报告。不改 `src/lib/quote/export-pdf.ts`（FIX-26a）与任何询价文件（FIX-26b）。

## 1. 纯函数与句子

- [ ] 1.1 新增 `src/lib/quote/finance-view.ts`（列表行裁剪、详情白名单与裁剪、是否报价引擎的报价、409 / 403 句子与按 `hintReason` 换句，句子由 `financeHiddenHintZh` 与 CHAIN-2e 的常量拼成）；`src/lib/quote/rules.ts` 的规则检查加「看不到成本」选项（不出利润率检查项，不传时结果不变）；`src/lib/quote/export-excel.ts` 把两张表的内容抽成同文件纯函数、按能不能看成本分两种。新增 `src/lib/quote/__tests__/legacy-quote-finance-view.test.ts` 并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（verify：`npx tsx src/lib/quote/__tests__/legacy-quote-finance-view.test.ts` 退出码 0——有财务查看权时列表行与详情视图与输入逐字段相同；没有时置空项逐个为 `null`、带 `costHidden`；详情白名单不含任何报价引擎字段与 `sourceJson`；兜底两条（出错、没有组织）；规则检查默认调用与改动前 `JSON.stringify` 相同、「看不到成本」时没有 `low_margin` / `margin_warning` / `high_margin`；两种 Excel 内容只差内部成本、利润率、成本价与首行；`bash scripts/check-test-registry.sh` 通过）

## 2. 旧报价单接口与报价 AI

- [ ] 2.1 新增隔离库 + HTTP 测试 `src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`（规格的八种身份 + 不是项目成员的普通组织成员；旧报价单与报价引擎的报价各一份，用少见的数；本机假模型服务记请求）并注册进 `scripts/test-all.sh`；先在改动前的代码上跑，记下失败条数。再改 `src/app/api/projects/[id]/quotes/route.ts`（GET、POST）、`…/quotes/[quoteId]/route.ts`（GET、PATCH、DELETE）、`…/quotes/save-ai-draft/route.ts`、`…/quotes/[quoteId]/ai/review/route.ts`、`…/quotes/ai/generate-draft/route.ts`：第一步仍是项目读权限并紧接着检查结果，之后按 design D1–D4、D6 判定、409 / 403、裁剪（verify：`NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts` 的列表、详情、写、409、AI 两个接口、少见数字搜索用例全部通过，被拒请求假模型服务 0 次、有资格的人 1 次且请求正文与改动前相同、被拒后库不变；`npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts` 全过）

## 3. 智能体报价技能与问青砚工具

- [ ] 3.1 `src/lib/agent/skills/quote.ts`：按 `ctx.userId` 判财务查看权；review 的 `quoteId` 必须属于本项目；看不到时 review 不调模型、规则检查用「看不到成本」选项、带 `costHidden`，draft 不调模型并返回那句话。`src/lib/agent-core/tools/project-skills.ts` 只对 `project_bid_quote`、`src/lib/agent-core/tools/enterprise-readonly.ts` 的 `project_get_project_quotes` 先用 `probeProjectAccess` 判项目读权限；后者按 design D7 裁剪 `profitMargin`（verify：同一隔离库测试的技能与工具用例通过——跨项目 `quoteId` 得「报价单不存在」，普通组织成员得「项目不存在或不属于当前组织」，只读成员三次请求假模型服务 0 次；`npx tsx src/lib/mention-gateway/__tests__/m2c-tool-policy.test.ts` 原样通过）

## 4. 界面

- [ ] 4.1 `src/components/quote/quote-editor.tsx`、`quote-summary-bar.tsx`、`quote-top-summary.tsx`、`quote-line-table.tsx`、`quote-ai-panel.tsx`、`project-quote-section.tsx` 按 `capabilities` / `costHidden` / `hintReason` 显示（design D8：两句话、没有成本价一栏 / 内部成本 / 利润率、只读、不出保存 / 确认 / AI 起草 / AI 审查 / AI 自动流 / 内部成本表 / 新建报价；读取失败与 409 写原因和链接）；Excel 按能不能看成本选内容，菜单写「导出内部成本表（Excel）」或「导出 Excel」，PDF 项写「导出客户报价单（PDF）」（verify：`npx tsx src/lib/quote/__tests__/legacy-quote-finance-view.test.ts` 的编辑器四种状态、合计条、行项表、AI 面板、报价管理区块的渲染与源码断言通过；`npx tsx src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx` 与 `npx tsx src/lib/quote/__tests__/export-customer-pdf.test.ts`（FIX-26a 合并后）原样通过）

## 5. 门禁

- [ ] 5.1 全量门禁与既有不改期望（verify：开工前记下的模块测试通过数不减；`npm test` 失败清单与 CHAIN-2e 分支基线逐条相同；`npm run test:ci` PASS；`npm run typecheck` 退出码 0；`npm run lint:baseline` PASS；`bash scripts/check-test-registry.sh` 通过且 `ci/test-registry-baseline.txt` 没有新增行；`bash scripts/test-runtime-architecture.sh` 通过；`npx openspec validate legacy-quote-finance-gate --strict` valid；对 CHAIN-2e 分支 `git diff -- prisma/ vercel.json package.json package-lock.json` 为空）

## 6. 报告与 TASKFLOW

- [ ] 6.1 写 `docs/QINGYAN_FIX-26_REPORT.md` + 更新 TASKFLOW 状态列：把 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 里「FIX-21 后续 8」那一行（核对时第 308 行）的 ID 由「待定」改成 FIX-26、写明本 change 与状态 `[~]`，描述里询价部分改指 FIX-26b；新增 FIX-26b 一行（状态 `[ ]`，待 Lucas 答 GATE ①，出口 #12–#16）；三个小问题各登记一行「待定」（GATE ⑨）；CHAIN-2e 带进来的「legacy 报价接口收口」与「问青砚 `project_get_project_quotes`」两行「编号待定」状态写「并入 FIX-26」。报告含：出口表与每条的处理、GATE 结论、改动前失败条数与改后数字、门禁结果、合并后仍能拿到供应商原价的地方、**没有开关、合并即生效**、回退办法、「多维审查」一节留空；另写只读查询 `docs/acceptance/fix-26/prod-check.sql`（`orgId` 不为空的报价份数、近 90 天由非负责人建 / 改的旧报价单、带成本价的行数）（verify：`grep -n "^| FIX-26 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有且只有一行、状态列为 `[~]`；`grep -n "^| FIX-26b |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行、状态 `[ ]`；`grep -n "^| 待定 |.*FIX-21 后续 8" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 无输出；`ls docs/QINGYAN_FIX-26_REPORT.md docs/acceptance/fix-26/prod-check.sql` 两个文件都在）

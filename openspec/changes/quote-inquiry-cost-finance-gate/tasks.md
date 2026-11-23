# Tasks：旧报价单、报价导出、报价 AI 与询价里的内部成本、利润率和供应商报价只给有财务查看权的人（FIX-26）

**开工前提**：task 1 不依赖任何在审 change，可以先做（GATE ⑤ 选拆分时它单独成 FIX-26a 的 PR）。task 2 起要等 CHAIN-2e（#556）合并，把 main 合入本分支，确认 main 上有 `resolveFinanceViewSafe`、`resolveFinanceHintReason`、`src/lib/project-finance/view-hint.ts`、`src/lib/quote-engine/finance-hint.ts` 与 `resolveQuoteCapabilities(access, { finance })`（design D1）。GATE ① 选 C 时删掉 task 5 与 task 6 里询价的部分；GATE ⑤ 选拆分时把它们移到 FIX-26b。开工前先跑一遍将要触碰模块已注册的测试（`project-routes-guard.test.ts`、`quote-engine-contract.test.ts`、`finance-access.test.ts`、`bid-page-v2` 三个），记下通过数写进报告。

## 1. 报价单 PDF（可单独成 PR）

- [ ] 1.1 新增纯模块 `src/lib/quote/export-content.ts`（不 import `jspdf` / `xlsx`）：由报价头、行项、合计算出 PDF 的报价头八项、行项表与合计行（只有 Subtotal、Total Amount）；`src/lib/quote/export-pdf.ts` 改用它、不再读 `profitMargin`；编辑器导出菜单的 PDF 项改为「导出客户报价单（PDF）」。新增 `src/lib/quote/__tests__/export-customer-pdf.test.ts` 并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（verify：`npx tsx src/lib/quote/__tests__/export-customer-pdf.test.ts` 退出码 0——利润率 23.45 / `null`、行项带成本价 17.31 三种输入下 PDF 内容里没有「Margin」「利润」「23.45」「17.31」与内部成本，合计只有两行；源码断言 `export-pdf.ts` 不含 `profitMargin`、`internalCost`、`costPrice`、`internalNotes`；`bash scripts/check-test-registry.sh` 通过）

## 2. 纯函数与句子

- [ ] 2.1 新增 `src/lib/quote/finance-view.ts`（列表行裁剪、详情白名单与裁剪、是否报价引擎的报价、409 / 403 句子与按 `hintReason` 换句，句子由 `financeHiddenHintZh` 与 CHAIN-2e 的常量拼成）；`src/lib/quote/rules.ts` 的规则检查加「看不到成本」选项（不出利润率检查项，不传时结果不变）；`export-content.ts` 加 Excel 两种内容（内部成本表首行那句 / 「报价单信息」）。新增 `src/lib/quote/__tests__/legacy-quote-finance-view.test.ts` 并注册进两个脚本（verify：`npx tsx src/lib/quote/__tests__/legacy-quote-finance-view.test.ts` 退出码 0——有财务查看权时列表行与详情视图与输入逐字段相同；没有时置空项逐个为 `null`、带 `costHidden`；详情白名单不含任何报价引擎字段与 `sourceJson`；兜底两条（出错、没有组织）；规则检查默认调用与改动前 `JSON.stringify` 相同、「看不到成本」时没有 `low_margin` / `margin_warning` / `high_margin`；两种 Excel 内容只差内部成本、利润率、成本价与首行）

## 3. 旧报价单接口与报价 AI

- [ ] 3.1 新增隔离库 + HTTP 测试 `src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`（规格 `projects/legacy-quote-finance-view` 的八种身份 + 不是项目成员的普通组织成员；旧报价单与报价引擎的报价各一份，用少见的数；本机假模型服务记请求）并注册进 `scripts/test-all.sh`；先在改动前的代码上跑，记下失败条数。再改 `src/app/api/projects/[id]/quotes/route.ts`（GET、POST）、`…/quotes/[quoteId]/route.ts`（GET、PATCH、DELETE）、`…/quotes/save-ai-draft/route.ts`、`…/quotes/[quoteId]/ai/review/route.ts`、`…/quotes/ai/generate-draft/route.ts`：第一步仍是项目读权限并紧接着检查结果，之后按 design D1–D4、D6 判定、409 / 403、裁剪（verify：`NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts` 的列表、详情、写、409、AI 两个接口、少见数字搜索用例全部通过，被拒请求假模型服务 0 次、有资格的人 1 次且请求正文与改动前相同、被拒后库不变；`npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts` 全过）

## 4. 智能体报价技能与问青砚工具

- [ ] 4.1 `src/lib/agent/skills/quote.ts`：按 `ctx.userId` 判财务查看权；review 的 `quoteId` 必须属于本项目；看不到时 review 不调模型、规则检查用「看不到成本」选项、带 `costHidden`，draft 不调模型并返回那句话。`src/lib/agent-core/tools/project-skills.ts` 只对 `project_bid_quote`、`src/lib/agent-core/tools/enterprise-readonly.ts` 的 `project_get_project_quotes` 先用 `probeProjectAccess` 判项目读权限；后者按 D7 裁剪 `profitMargin`（verify：同一隔离库测试的技能与工具用例通过——跨项目 `quoteId` 得「报价单不存在」，普通组织成员得「项目不存在或不属于当前组织」，只读成员三次请求假模型服务 0 次；`npx tsx src/lib/mention-gateway/__tests__/m2c-tool-policy.test.ts` 原样通过）

## 5. 询价接口（GATE ① 选 A；选 C 删掉，选拆分移到 FIX-26b）

- [ ] 5.1 新增 `src/lib/inquiry/finance-view.ts`（条目与轮次裁剪、`priceHidden`、句子）与 `src/lib/inquiry/__tests__/inquiry-price-view.test.ts`（注册进两个脚本）、`src/lib/inquiry/__tests__/inquiry-price-view-db.isolated.test.ts`（注册进 `scripts/test-all.sh`）；改 `src/app/api/projects/[id]/inquiries/route.ts`（GET）、`…/[inquiryId]/route.ts`（GET、PATCH）、`…/[inquiryId]/compare/route.ts`、`…/[inquiryId]/items/route.ts`、`…/items/[itemId]/{mark-sent,mark-replied,mark-declined,mark-no-response,select}/route.ts` 的返回裁剪，`…/items/[itemId]/record-quote/route.ts` 无权时在读请求体之前 403；`src/lib/inquiry/service.ts` 不改（verify：`npx tsx src/lib/inquiry/__tests__/inquiry-price-view.test.ts` 与 `NODE_ENV=test npx tsx src/lib/inquiry/__tests__/inquiry-price-view-db.isolated.test.ts` 通过——规格 `tender/inquiry-supplier-price-view` 的每条 Scenario；`record-quote` 被拒后库不变、没有新的 Muse 事件；`project-routes-guard.test.ts` 全过）

## 6. 界面

- [ ] 6.1 `src/components/quote/quote-editor.tsx`、`quote-summary-bar.tsx`、`quote-top-summary.tsx`、`quote-line-table.tsx`、`quote-ai-panel.tsx`、`project-quote-section.tsx` 按 `capabilities` / `costHidden` / `hintReason` 显示（design D9：两句话、没有成本价一栏 / 内部成本 / 利润率、只读、不出保存 / 确认 / AI 起草 / AI 审查 / AI 自动流 / 内部成本表 / 新建报价；读取失败与 409 写原因和链接）；Excel 按能不能看成本选内容、菜单写「导出内部成本表（Excel）」或「导出 Excel」；`src/components/inquiry/inquiry-detail.tsx` 按 `priceHidden` 显示「—」、那句话、不出录入 / 更新报价（询价部分随 task 5 增删）（verify：`npx tsx src/lib/quote/__tests__/legacy-quote-finance-view.test.ts` 的编辑器四种状态、合计条、行项表、AI 面板、报价管理区块的渲染与源码断言通过；`npx tsx src/lib/inquiry/__tests__/inquiry-price-view.test.ts` 的明细表渲染通过；`npx tsx src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx` 原样通过）

## 7. 门禁

- [ ] 7.1 全量门禁与既有不改期望（verify：开工前记下的模块测试通过数不减；`npm test` 只有 main 上同样的既有失败；`npm run test:ci` PASS；`npm run typecheck` 退出码 0；`npm run lint:baseline` PASS；`bash scripts/check-test-registry.sh` 通过且 `ci/test-registry-baseline.txt` 没有新增行；`npx openspec validate quote-inquiry-cost-finance-gate --strict` valid；`git diff origin/main -- prisma/ vercel.json` 为空；多维审查（正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案、权限）各维度结论写进 PR 正文）

## 8. 报告与 TASKFLOW

- [ ] 8.1 写 `docs/QINGYAN_FIX-26_REPORT.md` + 更新 TASKFLOW 状态列：把 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 里「FIX-21 后续 8」那一行（核对时第 308 行）的 ID 由「待定」改成 FIX-26、写明本 change 与状态 `[~]`；CHAIN-2e 合并带进来的「legacy 报价接口收口」与「问青砚 `project_get_project_quotes`」两行「编号待定」状态写「并入 FIX-26」；GATE ① 选 A 时新增 FIX-26b 一行（出口 #17–#20）。报告含：出口表与每条的处理、GATE 结论、门禁与多维审查结果、改动前失败条数、合并后仍能拿到供应商原价的地方、**没有开关、合并即生效**、已发出的 PDF 无法追回；另写只读查询 `docs/acceptance/fix-26/prod-check.sql`（`orgId` 不为空的报价份数、近 90 天由非负责人建 / 改的旧报价单、带成本价的行数、近 90 天非负责人录入的供应商报价）（verify：`grep -n "^| FIX-26 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有且只有一行、状态列为 `[~]`；`grep -n "^| 待定 |.*FIX-21 后续 8" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 无输出；`ls docs/QINGYAN_FIX-26_REPORT.md docs/acceptance/fix-26/prod-check.sql` 两个文件都在）

# Proposal：旧报价单、Excel、报价 AI 与报价工具里的内部成本和利润率只给有财务查看权的人（FIX-26）

TASKFLOW：FIX-26（原「待定」FIX-21 后续 8 的报价单部分，`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md:308`；FIX-25 design GATE ⑥ 定为紧接 FIX-25）。同时收掉 CHAIN-2e 报告 §5 登记的两行「编号待定」：「legacy 报价接口收口（打开 `TENDER_QUOTE_ENGINE_ENABLED` 之前必须修）」与「问青砚 `project_get_project_quotes` 返回毛利率、不查项目读权限与财务查看权」（这两行在 CHAIN-2e 分支的 TASKFLOW 里）。

GATE 已定（协调会话 2026-11-23，Lucas 2026-11-22 授权按推荐；① 例外）：① 询价里的供应商原价暂不改，整体移出本 change，记为 **FIX-26b**（待 Lucas 答）；② 旧报价单的编辑权与报价引擎同口径；③ AI 审查对没有财务查看权的人 403、不调模型；④ 不出内部版 PDF，Excel 给有财务查看权的人导「内部成本表」；⑤ 拆分：报价单 PDF 不印利润率单独做成 **FIX-26a**（change `quote-pdf-no-margin`，分支 `claude/zen-turing-azudvx-fix26a`）；⑥ 与 BIDPAGE 交叠时本 change 先合；⑦ **叠在 CHAIN-2e 分支上做**（`claude/inspiring-johnson-o54xbt-chain-2e`，`35e9ae91`），CHAIN-2e 合并后再合；⑧ 不设开关；⑨ 顺手的小问题登记「待定」（「抽屉与报价管理区块把引擎报价链到旧编辑器」随列表过滤消失，剩两条）；FIX-26a 审查后补两条按推荐写：旧报价单的行都存成客户行、旧报价单列表只列旧报价单（design「留给 GATE」② ③）；FIX-25 安全审查 S1 补一条按推荐写：审计日志详情读取侧裁剪 + 另起新版的审计不再记成本与毛利（design「留给 GATE」④）。

核对基线：main `c376be86`（四件套），实现基线 CHAIN-2e `35e9ae91`。不改 `src/lib/muse-bridge/**`，受影响的 Muse 意图见下。**没有开关，合并即生效。**

## Why

能读项目的人（含只读成员、不是项目成员的组织管理员；问青砚报价工具是本组织任一成员）能从旧报价单接口、编辑器、Excel、AI 审查与起草、智能体报价技能拿到我方内部成本、每行成本价和利润率，只读成员还能改价、确认、删草稿，并经旧接口改写报价引擎的报价；审计日志详情还把报价另起新版时记下的估算成本与毛利率原样给组织管理员与项目管理员。成本核算、报价表助手（CHAIN-2b）与报价引擎（CHAIN-2e）对同类数字早已只给有财务查看权的人，旧报价单这条路没收。

## What Changes

- 判定财务查看权与报价编辑权：与成本核算、报价引擎（CHAIN-2e）同一口径——能看 = 平台超级管理员、持组织范围 `project.finance.manage` 或 `project.finance.read` 的人、项目负责人；能编辑 = 能看且（财务特权，或项目角色带成本写权限）；授权查询出错时只剩平台超级管理员与负责人，提示写「暂时无法确认」。
- 收窄报价单列表 `GET /api/projects/{项目}/quotes`：只列所属组织为空的旧报价单（报价引擎、逐行报价、只报总价建的报价不再列出，与旧接口对它们 409 同一口径）；没有财务查看权的人每份报价 `profitMargin` 为 `null`、响应带 `costHidden: true`；所有人多拿到 `capabilities`；总额照旧。
- 收窄报价单详情 `GET …/quotes/{报价}`：对所有人只返回旧报价单字段，不再带报价引擎的估算成本、毛利、加成、成本分解、情景、定价比例与行项内部溯源；没有财务查看权的人内部成本、利润率、内部备注、AI 草稿与审查原文、每行成本价为 `null`，带 `costHidden: true`。
- 拒绝旧接口处理报价引擎的报价：所属组织不为空的报价（报价引擎、逐行报价、只报总价建的）经旧接口读详情、修改、删除、AI 审查 → 409 并给报价页地址，不写库、不调模型。
- 收紧旧报价单的写：新建、修改（含确认）、删除、保存 AI 草稿要能编辑报价，否则 403、不写库。
- 把旧报价单的行都存成客户行：修改时每一行「是否内部行」一律存为否，不再采用请求里的值（今天接口原样保存，标了内部行的照样印进客户 PDF、算进小计）。
- 收紧报价 AI：AI 审查要有财务查看权，AI 起草要能编辑报价，否则 403、不调模型；有资格的人请求与模型输入不变。
- 改旧报价单编辑器与报价管理区块：没有财务查看权时不显示成本价一栏、内部成本、利润率，规则检查不出利润率检查项；不能编辑时只读，不出保存 / 确认 / 新建 / AI 起草 / AI 审查 / AI 自动流，写一句为什么、找谁；读取失败写原因，不再显示空白表单。
- 改 Excel 导出：有财务查看权的人导出「内部成本表」（首行写明含成本和利润率、不要发给客户）；没有的人导出的文件不含内部成本、利润率与成本价一列；导出菜单的 PDF 项改为「导出客户报价单（PDF）」。
- 按执行的人改智能体报价技能：审查只认本项目的报价；没有财务查看权时审查不调模型、不出成本与利润率，起草不调模型并写明为什么。
- 收紧问青砚两个工具：`project_bid_quote` 与 `project_get_project_quotes` 先查项目读权限；后者对没有财务查看权的人 `profitMargin` 为 `null`、带 `costHidden`。
- 裁剪审计日志详情 `GET /api/audit-logs/{id}`：没有财务查看权的人，`beforeData` / `afterData` 里成本、毛利、落地价类的键（写死清单 + 键名含 cost / margin / markup / profit / landed 的兜底）置 `null`，带 `costHidden`；动作、操作人、时间、卖价照旧（FIX-25 安全审查 S1）。
- 报价另起新版的审计不再记原版的估算成本与毛利率（`src/lib/quote-engine/service.ts:351`，原版报价里查得到）。
- 加测试：裁剪、Excel 内容与界面的不连库测试；扫全仓审计写入调用、像金额的键都已分到「藏 / 可见」的守卫测试；隔离库按身份逐条核对每个出口、在响应里搜少见的数、本机假模型服务数调用次数。

## 受影响的 Muse 意图

不改 `src/lib/muse-bridge/**`，没有直接受影响的意图。间接影响：

- `compare` / `price_scenario`：取比价矩阵（`src/lib/muse-bridge/router.ts:475-560`），带所选供应商落地价（决定 A），不经旧报价单接口，行为不变。
- `next_step` / `status`：只数报价份数（`router.ts:594`），不读报价单的成本与利润率，不变。
- `quote.parsed` / `missing_fields`、`rfq` / `chase` / `ask`：不读报价单，不变。

## Out of scope

- 报价单 PDF 不印利润率：FIX-26a（`quote-pdf-no-margin`，单独一个 PR）；本 change 不改 `src/lib/quote/export-pdf.ts`。
- 询价里的供应商单价、总价、报价备注（询价列表、单轮明细、旧比价、询价写接口的返回、录入报价、询价明细表，以及比价矩阵行里的原价、AI 报价分析模型输入里的原价、询价追踪页原价、供应商履历、组织项目智能的供应商平均单价）：FIX-26b，待 Lucas 答 GATE ①（design「留给 GATE」）。
- CHAIN-2e（#556）已管的：比价矩阵与 AI 报价分析的落地价及其模型输入、询价追踪页的落地价、报价引擎 14 个路由文件与「报价与成本」卡、投标页报价区、「我方报价」卡、单个报价页。
- FIX-25（实现中）管的：报价表助手的目标毛利、两个房间 JSON 接口的 `pricingInputs` 与 `bidDraft`。
- 逐行报价 `src/app/api/projects/[id]/bid-page/quotes/**` 与 `src/lib/bid-page-v2/**`（BIDPAGE-3，已按金额门）；新页面挂哪些组件。
- 我方报价 `ourBidPrice` 的可见范围（FIX-25 D6）；判定规则本身（`src/lib/project-finance/access.ts`）；CHAIN-2b 与 CHAIN-2e 两份兜底判定合成一份（CHAIN-2e 登记的「编号待定」）。
- 两个顺手的小问题（登记「待定」，不在本 change）：旧报价单 `PATCH` 接受任意 `status` 字符串；AI 面板「输出版本」三个按钮没有接线（本 change 只对没有财务查看权的人藏起「内部成本表」）。
- 销售域报价（`SalesQuote`、`src/app/api/sales/quotes/**`）、外贸报价（`TradeQuote`）；项目财务接口、Muse 的权限与审计（CHAIN-2e 登记的「编号待定」）；智能体步骤输出经 `GET /api/agent/approvals` 的 `previewJson`（FIX-23 后续 1）。
- 不迁移、不清任何已存数据。

## Capabilities

### New Capabilities

- `projects/legacy-quote-finance-view`：旧报价单（列表、详情、写、AI 审查与起草、编辑器、Excel）、智能体报价技能与问青砚两个报价工具，谁能看内部成本与利润率、谁能改、被拒时返回什么、不输出什么、界面写什么。

### Modified Capabilities

无。

## Impact

- 新增：`src/lib/quote/finance-view.ts`（报价单的裁剪、白名单、是否报价引擎的报价、固定句子；纯函数）；`src/lib/audit/redact-finance.ts`（审计数据按键名裁剪；纯函数）。
- 修改：`src/app/api/projects/[id]/quotes/route.ts`、`…/quotes/[quoteId]/route.ts`、`…/quotes/[quoteId]/ai/review/route.ts`、`…/quotes/ai/generate-draft/route.ts`、`…/quotes/save-ai-draft/route.ts`；`src/lib/quote/export-excel.ts`、`rules.ts`；`src/lib/agent/skills/quote.ts`；`src/lib/agent-core/tools/project-skills.ts`、`enterprise-readonly.ts`；`src/components/quote/{quote-editor,quote-summary-bar,quote-top-summary,quote-line-table,quote-ai-panel,project-quote-section}.tsx`；`src/app/api/audit-logs/[id]/route.ts`、`src/app/(main)/admin/audit-logs/page.tsx`（详情里 `costHidden` 时写一句）；`src/lib/quote-engine/service.ts`（只改另起新版那一条审计的内容，CHAIN-2e 的文件，叠在它上面改）。
- 测试：新增 `src/lib/quote/__tests__/legacy-quote-finance-view.test.ts`、`src/lib/audit/__tests__/audit-detail-redaction.test.ts`（都进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）、`src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`（进 `scripts/test-all.sh`）。
- 接口（合并即生效）：只读成员、operator、不是负责人的项目管理员、没有财务键的组织管理员、`bids` 岗位同事从旧报价单接口、两个问青砚工具与审计日志详情拿不到成本与利润率，也不能再新建 / 修改 / 确认 / 删除旧报价单、不能用报价 AI；负责人、持组织范围财务键的人、平台超级管理员看到的数字与改动前相同。
- 零 schema、零依赖、不新增模型调用（被拒的 AI 请求不调模型）；文档 `docs/QINGYAN_FIX-26_REPORT.md`、`docs/acceptance/fix-26/prod-check.sql`；TASKFLOW 第 308 行改为 FIX-26，加 FIX-26b 一行与两个「待定」小问题。

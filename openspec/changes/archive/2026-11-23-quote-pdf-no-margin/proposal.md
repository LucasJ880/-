# Proposal：报价单 PDF 永远不印利润率（FIX-26a）

TASKFLOW：FIX-26a（从 FIX-26 拆出，协调会话 2026-11-23 定 GATE ④ / ⑤：内部版 PDF 不出、PDF 单独先做；原「待定」FIX-21 后续 8 的一部分，`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md:308`）。核对基线：main `325cbdc0`。不触碰 `src/lib/muse-bridge/**`，无受影响的 Muse 意图。不依赖任何在审 change。**没有开关，合并即生效。**

## Why

旧报价单编辑器导出的 PDF 版式就是给客户的报价单（标题「QUOTATION」），合计下面却印着「Profit Margin: x%」（`src/lib/quote/export-pdf.ts:137-139`）；谁导出、发给客户，我方利润率就到了客户手里。

## What Changes

- 删去 PDF 合计里的「Profit Margin」一行：对任何人、任何报价都不再印利润率，合计只剩 Subtotal 与 Total Amount。
- 核对 PDF 印出的全部字段，确认内部成本、每行成本价、内部备注都不印（今天就不印），加测试看住。
- 加测试：在 Node 里真的生成这份 PDF，从 PDF 里抽出页面文字，断言没有利润率、内部成本、成本价与内部备注，报价头、行项、合计照常；源码断言 PDF 生成代码不读这四个字段。

## Out of scope

- 编辑器上显示的内部成本与利润率、Excel 导出、旧报价单接口、AI 审查与起草、智能体报价技能、问青砚报价工具：FIX-26（叠在 CHAIN-2e 上做）。
- 询价里的供应商报价：FIX-26b（待 Lucas 答 GATE ①）。
- 带利润率的「内部版 PDF」：不出（GATE ④）；内部核算用 Excel（FIX-26 让有财务查看权的人导「内部成本表」）。
- 报价引擎的客户报价 PDF（`src/lib/quote-engine/quotation-pdf.ts`，已有禁出键清单 `CUSTOMER_PDF_FORBIDDEN_KEYS`）。
- PDF 的中文字体（报价头「Template」一行印中文模板名，helvetica 显示不出）、文件名、页脚文字。
- 「是否内部行」（`isInternal`）为真的行照旧印进 PDF 并算进 Subtotal（`src/lib/quote/calculate.ts:28-37`）：旧编辑器界面不会写 `true`，但旧报价单 PATCH 会把请求里的 `isInternal` 原样保存（`src/app/api/projects/[id]/quotes/[quoteId]/route.ts:88`，只要项目读权限 `:30`），报价引擎修订复制时也保留（`src/lib/quote-engine/service.ts:331`）；正确修法要同时动计算、编辑器与接口，归 FIX-26（报告列出生产只读查询）。
- 导出菜单的文字（「导出 PDF」）不改。
- 已经发出去的 PDF：PDF 在浏览器里生成、系统不留痕，查不到发给过谁；要不要通知客户由人定（报告写明）。

## Capabilities

### New Capabilities

- `projects/legacy-quote-pdf`：旧报价单编辑器导出的报价单 PDF 印什么、不印什么。

### Modified Capabilities

无。

## Impact

- 修改：`src/lib/quote/export-pdf.ts`（删 3 行）。
- 测试：新增 `src/lib/quote/__tests__/export-customer-pdf.test.ts`，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（不连库）。
- 界面：报价单 PDF 合计下面不再有「Profit Margin」一行，其余版式不变；编辑器里看到的东西不变。
- 零 schema、零依赖、不调模型、没有出站；文档 `docs/QINGYAN_FIX-26a_REPORT.md`，TASKFLOW 加 FIX-26a 一行。

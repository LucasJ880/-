# Proposal：目标毛利只给有财务查看权的人（FIX-25）

TASKFLOW：FIX-25（CHAIN-2d #538 交叉验证 F4，属 CHAIN-2b #532 范围，标「优先」；这一行目前只在 CHAIN-2d 分支的 TASKFLOW 里，main 上还没有，见 tasks 4.3）。核对基线：main `2a0eb964`（四件套）、`c376be86`（实施时合入，含 #564 BIDPAGE-3）。GATE 七条已定（协调会话 2026-11-23，Lucas 2026-11-22 授权按推荐，见 design「GATE（已定）」）。本 change 推翻 CHAIN-2b Out of scope 里「不改目标毛利、对手价、评分模型的可见与可改范围」中「目标毛利」这一项。不触碰 muse-bridge，无受影响的 Muse 意图（`price_scenario` 早已不传目标毛利，`src/lib/muse-bridge/router.ts:543-549`）。**没有开关，合并即生效。**

## Why

没有财务查看权的项目读者能从调查室读取、项目列表、报价表助手三个接口拿到目标毛利，前两个接口的同一份房间 JSON 里还有我方报价（项目列表对本组织任一 active 成员开放，不必是项目成员），报价按报价表助手的「成本 + 目标毛利」底价定时，报价 × (1 − 目标毛利) 就是我方成本（隔离库复现：成本 87,654.32、目标毛利 23.7%、报价 114,881.15，只读成员算出 87,654.32）。CHAIN-2b 收了成本、留下了目标毛利，与硬纪律第 4 条「不传目标毛利，避免用两价反推」的做法相反。

## What Changes

- 置空读取结果里的目标毛利：没有财务查看权的人（判定与 CHAIN-2b 报价表助手相同）读报价表助手时 `inputs.targetMarginPct` 为 `null`，与 `inputs.ourCostCad` 共用 `costHidden: true` 一个标记。
- 置空保存返回里的目标毛利：没有财务查看权的人保存成功时返回的 `inputs.targetMarginPct` 为 `null`。
- 拒绝越权改目标毛利：没有财务查看权的人保存时 `inputs` 里带了 `targetMarginPct`（不论值）→ 403、不写库；403 那句改为「页面已更新，没有保存：需要财务查看权才能修改我方成本和目标毛利。请刷新页面，重新填写后再保存。」（成本与目标毛利共用一句）；「请求里有没有这个键」的判断，403 与保存用同一个。
- 去掉房间 JSON 里的整个 `pricingInputs` 与投标文件草稿元信息 `bidDraft`：`GET /api/projects` 与 `GET /api/projects/{项目}/bid-intelligence` 返回的 `summaryJson` 对所有人不再带这两个键（`pricingInputs` 里有对手价、成本、目标毛利、成本来源、镜像的我方报价；`bidDraft.internalNotesZh` 是起草模型写的内部注，起草输入含旧版备忘；两处界面都不读这两个键），投标策略备忘照旧去掉。
- 改报价表助手卡：`costHidden` 时目标毛利输入框换成标签加「需要财务查看权才能看目标毛利。」，不显示成本加成提示，去掉「目标毛利只用于按成本算的底价情景；你这里改了，情景表不会变。」，保存请求不带 `targetMarginPct`。
- 加测试：不连库的纯函数与接线测试；隔离库按复现数据逐身份核对三个接口拿不到目标毛利、反推不成立，有财务查看权的人结果与改动前逐字节相同。

## Out of scope

- 我方报价（`Project.ourBidPrice`、报价引擎售价、投标文件草稿输入里的我方报价）照旧对项目读者可见：没有目标毛利与毛利率，单有报价算不出成本（design D6；GATE ① 已定不收，报告列出「与我方报价配对即可反推的字段」）。
- 报价引擎的毛利率、定价比例、估算成本（`src/lib/quote-engine/**`、`src/app/api/projects/[id]/quote-engine/**`）：CHAIN-2e #556 改为只认财务查看权；报价引擎开关生产未设。
- **FIX-26**（GATE ⑥ 已定，紧接本 change）：旧报价单直接给内部成本与利润率（`src/app/api/projects/[id]/quotes/**`、`src/components/quote/**`，含打印「Profit Margin」的报价单 PDF `src/lib/quote/export-pdf.ts:137-138`（优先）、Excel `src/lib/quote/export-excel.ts:45-46`、AI 审查 `src/app/api/projects/[id]/quotes/[quoteId]/ai/review/route.ts:11,53-54`、`src/lib/agent/skills/quote.ts:253-254`；原 TASKFLOW「待定」FIX-21 后续 8）；询价与旧比价接口给项目读者供应商报价（`src/lib/inquiry/service.ts:191-201`、`src/app/api/projects/[id]/inquiries/[inquiryId]/compare/route.ts:6-11`）；问青砚工具 `project_get_project_quotes` 给 `profitMargin` + `totalAmount`（`src/lib/agent-core/tools/enterprise-readonly.ts:517`）。
- 投标策略备忘送进模型的目标毛利（四件套基线上 `src/lib/tender-intel/orchestrate.ts:425-439`，#538 已于 `fc321a7d` 合并、改为只取对手价）与投标文件草稿读取接口 `GET …/bid-draft` 返回的 `internalNotesZh`（`src/app/api/projects/[id]/bid-draft/route.ts:50`）：CHAIN-2d #538 与它列的后续。
- 判定规则本身（`src/lib/project-finance/access.ts`）；CHAIN-2b 与 CHAIN-2e 两份兜底判定合成一份（CHAIN-2e 合并后另开整理）。
- 负责人是导入系统账号时「需要的话请找项目负责人」没人可找（CHAIN-2b 已有的同一句；CHAIN-2e D9 只改了报价引擎与比价的提示），并入上一条的整理。
- 已存的目标毛利不清、不迁移；有财务查看权的人在报价表助手看到、改到的一切不变；`derive`（重新推导评分模型）不变。
- Muse（`src/lib/muse-bridge/**`）、BIDPAGE（`src/lib/bid-page-v2/**`、`src/app/api/projects/[id]/bid-page-summary/route.ts`）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tender/pricing-helper`：新增「目标毛利只给有财务查看权的人」；修改「没有财务查看权的人改不了成本」「卡片上没有财务查看权时的显示」「没有财务查看权时不带出的内容」「调查室 JSON 不带出我方成本」；「保存只改人工输入」「保存的对外行为」只改末尾指向（加上目标毛利与新要求的名字），场景不变。
- `tender/pricing-compare-cost-source`：修改「毛利率与成本加成写清楚」（目标毛利的写法与成本加成提示只给有财务查看权的人）。

## Impact

- 修改：`src/lib/tender-pricing/finance-view.ts`（读取视图与保存返回置空目标毛利、「这次保存碰了受限的键」加上目标毛利、房间 JSON 去掉整个 `pricingInputs` 与 `bidDraft`、「请求里有没有这个键」的共用判断、403 那句与目标毛利格那句）、`src/app/api/projects/[id]/pricing-helper/route.ts` 的保存改用那个共用判断（对有财务查看权的人行为不变）、`src/components/tender/pricing-helper-card.tsx`（目标毛利格、成本加成提示、保存请求）。`src/app/api/projects/route.ts`、`src/app/api/projects/[id]/bid-intelligence/route.ts` 的接线不变（只改注释）。
- 测试：新增 `src/lib/tender-pricing/__tests__/target-margin-finance-view.test.ts`（不连库）与 `src/lib/tender-pricing/__tests__/target-margin-finance-db.isolated.test.ts`（隔离库），都登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`finance-view.test.ts`、`pricing-helper-finance-db.isolated.test.ts`、`compare-cost-source.test.tsx` 里随行为改变的断言更新（tasks 逐条列出）。
- 零 schema、零依赖、零新增模型调用；没有开关，合并即生效。

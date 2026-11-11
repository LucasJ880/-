# Design

## Context

- 现有三处与成本有关的代码，各缺一块：
  - 报价引擎（`src/lib/quote-engine/calc.ts`）：有成本加成与按售价毛利率两种口径、22 个成本类别（含 FREIGHT / CUSTOMS / DUTY / CONTINGENCY）、同时输出毛利率与加成率；但成本行不对应招标行，运算是 JS 浮点。
  - 落地成本（`src/lib/tender-rfq/landed-cost.ts`）：有贸易条款决定加哪些费用、缺参数不出数；但每个项目只有一个数量与一个关税率，不分进口与本地，没有进口环节税。
  - 定价助手（`src/lib/tender-pricing/calc.ts`）：输入是一个手填的总成本。
- 定点金额与汇率方向约定在 `src/lib/project-finance/money.ts`：`Prisma.Decimal`、ROUND_HALF_UP、汇率方向唯一（1 单位原币 = X 加元）、文件头写明「禁止 JS number 参与权威财务计算」。
- Skill 包自带一个 Python 成本样例（`scripts/cost_model.py` 与 `sample_cost_inputs.json`，两行合成数据），2026-11-11 在本地跑过：直接成本 914.12，报价 1,252.20，6 项单测通过。
- 第二轮开源调研（`docs/QINGYAN_TENDER_FLOW_OSS_SURVEY.md` §6）：没有一个项目同时做到逐行、进口与本地分流、税费现金流、预备金口径与两个比率并列；可借的是分摊方法、分摊后的对账检查、「显示但不计入」的税行、起订量与整包装取整、出处字段的形状。

## Goals / Non-Goals

**Goals:**

- 一套逐行成本的确定性计算，覆盖任务书验收项 A10–A14 与 A12。
- 一个与界面无关的核算表视图，界面、PDF、表格导出以后都从它渲染，数字只算一次。

**Non-Goals:**

- 不动 `src/lib/quote-engine/**`、`src/lib/tender-rfq/landed-cost.ts`、`src/lib/tender-pricing/**`、`src/lib/project-finance/**`（只引用 `money.ts`）。
- 不动 `src/components/tender/pricing-helper-card.tsx` 与 `src/app/api/projects/[id]/pricing-helper/route.ts`。
- 不动 `prisma/schema.prisma`；不加 `src/app/**` 下任何路由或页面；不加环境变量与开关。
- 不动 `src/lib/muse-bridge/**`。

## Decisions

### D1：新建纯函数目录 `src/lib/tender-bid-cost/`，不在报价引擎里加逐行计算

文件：`contract.ts`（输入输出类型）、`line-cost.ts`（逐行成本、采购数量、缺参数）、`freight.ts`（方案互斥与分摊）、`pricing.ts`（定价、预备金、比率、合计）、`reconcile.ts`（两套模型对账）、`sheet-view.ts`（核算表视图）、`render-markdown.ts`。成本分项的名称与报价引擎的成本类别对齐（MATERIAL / DUTY / FREIGHT / LOGISTICS / CONTINGENCY…），以后写回报价引擎时是一对一映射。

- 被否决：直接扩 `quote-engine/calc.ts`。它是浮点运算、绑定数据库里的报价模型、已有 60 多项测试钉着现有行为；在里面加逐行与定点会同时动两套语义。差距分析 §3.3 说的「扩报价引擎」落实为：复用它的类别与口径词表、结果以后写回它，而不是改它的计算核心。
- 被否决：扩 `landed-cost.ts`。它服务于比价矩阵（每家供应商一行），输入输出形状不同；保留它的两条语义——贸易条款决定加哪些费用、缺参数不出数。

### D2：金额与汇率用 `project-finance/money.ts`

`dec`、`roundMoney`、汇率方向沿用现成约定；汇率必须带来源与日期。

- 被否决：JS 浮点加输出取整。验收 A10 要对到分。
- 被否决：自写定点。重复造轮子，且会出现第三套舍入规则。

### D3：采购类型是显式字段，不从原产地字符串推断

行项带 `IMPORT` 或 `DOMESTIC`。Skill 的 Python 样例用 `origin` 是否等于 `Canada` 判断。

- 被否决：沿用字符串判断。原产地是中国、但从加拿大经销商处本地采购的货，按字符串会被错算进口关税与海运。

### D4：关税率只接受调用方输入，带依据级别

`VERIFIED` 须有 HS 编码、原产地、来源引用、取数日期四项；缺任一项只能是 `SENSITIVITY`。本次不查任何税则来源。

- 被否决：内置一张税率表。税率随修订变化（Skill 参考资料提到 T2026-2 自 2026-09-01 生效），把某一天的数字写死在代码里迟早会错；税则快照属于后续的只读适配器。
- 被否决：缺税率按零算。会把一个未知数变成一个看起来确定的低成本。

### D5：分摊方法四种，余数归最后一行

按体积、重量、货值、数量。先按比例算出各行未舍入的份额并舍入到分，差额加到参与分摊的最后一行；之后断言各行之和等于整票金额。

- 被否决：余数按最大余数法分配（开源里 LandedCompare 的做法）。更「公平」，但差额只有几分钱，「最后一行」更容易向人解释，也与 ERPNext、Odoo 一致。
- 被否决：所需依据缺失时自动退回按数量分摊。会悄悄改变结果；宁可拒绝并指出缺哪一行的体积或重量。

### D6：进口 GST 永远单列为现金流，是否进成本由「可否抵扣」决定

- 被否决：统一计入成本。可抵扣的进口 GST 只是占用资金，计入成本会把报价抬高约 5%。
- 被否决：统一不计。不可抵扣的情形下成本被低估。

### D7：合计等于各行舍入后之和

合计的每一项（成本、报价、利润、现金流）都是行项舍入值的和。这与 Skill 的 Python 样例有一处不同：样例的合计利润由合计报价与合计成本重新计算，得 313.04；逐行相加是 56.18 + 256.85 = 313.03。本设计取 313.03，并在金标测试里写明这一分钱的来历。

- 被否决：照搬样例的算法。表上的合计与各行相加对不上，是核算表最容易被质疑的地方。

### D8：对账只列差额，不排名

- 被否决：给出「推荐情景」。口径不同的两套模型没有可比的单一指标；选哪套是 Owner 的决定。

### D9：视图是纯数据，渲染是另一个函数

`sheet-view.ts` 产出四块结构化数据；`render-markdown.ts` 只做排版。测试断言 Markdown 里的每个金额都能在视图里找到。

- 被否决：只做 Markdown。以后界面与 PDF 各自再算一遍，三处数字迟早不一致。
- 被否决：本次就做界面。界面要接数据与权限，属于 Owner Gate B 之后的 change。

### D10：缺参数时该行为空，合计标不完整

沿用落地成本模块的语义。

- 被否决：用上次的值或行业均值补。Lucas 要的是不再逐项询问，不是替他编数；缺什么在「阻断与提示」块里一次列全。

## 与八条硬纪律的关系

1. 零 schema：不涉及。不落库。
2. 出站先审批：不涉及。没有任何对外动作。
3. 禁止第三套队列：不涉及。文件基本名已避开架构守卫的禁用词。
4. 脱敏：触碰——核算表含成本、毛利率与我方报价，都是 Muse 通道与通知不得输出的内容。本次没有任何通道（无接口、无通知、无 Muse 输出）；规格有一条「不发起网络请求、不读写数据库」。后续接界面的 change 须按财务访问规则（`openspec/specs/projects/finance-access`）授权，不沿用定价助手「能读项目就能看」的口径。
5. 不爬登录页：不涉及。不查询任何外部来源。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。全部是算术与查表，零模型调用，有源码断言。
8. 测试注册：新增 5 个测试文件，全部登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-bid-cost/__tests__/line-cost.test.ts`
- `npx tsx src/lib/tender-bid-cost/__tests__/freight.test.ts`
- `npx tsx src/lib/tender-bid-cost/__tests__/pricing.test.ts`
- `npx tsx src/lib/tender-bid-cost/__tests__/reconcile.test.ts`
- `npx tsx src/lib/tender-bid-cost/__tests__/sheet-view.test.ts`
- 金标数字的来源：Skill 包 `scripts/cost_model.py` 对 `sample_cost_inputs.json` 的输出（84.00 / 15.12 / 4.96 / 164.12 / 750.00 / 914.12 / 22.48 / 513.70 / 224.80 / 1,027.40 / 1,252.20），合计利润按 D7 取 313.03。
- `bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-bid-cost-sheet --strict`

## Risks / Trade-offs

- [与 Skill 样例差一分钱] → D7 已说明；报告里并排列出两种算法的结果，免得以后有人以为是缺陷。
- [又多一处成本计算] 仓库里已有报价引擎、落地成本、定价助手三处 → 本次不替换它们，但分项名称对齐报价引擎；持久化那个 change 里把核算表写回报价引擎，定价助手的成本来源改读核算表，收敛而不是并存。
- [起订量与整箱取整会让成本看起来偏高] → 超购件数单列显示，人能看出多出来的是什么；不填起订量就不取整。
- [本次代码线上不可达] → 有意为之，先过 Owner Gate B。
- [关税「已核实」只校验四项齐全，不校验对不对] → 规格与界面都写「带核实依据」，不写「正确」；归类是否正确由报关行或人工判断。

## Open Questions

无。

# Spec Delta

## ADDED Requirements

### Requirement: 详细订单 Roller 行按罩型计价
详细订单（Order Form）的 Roller 行 SHALL 按「基础面料 + 生效罩型」取定价面料：基础面料由该行 SKU 推出（Light Filtering / Blackout）；生效罩型为 `Cassette` 时取 `<基础面料> w Cassette`，为 `Fascia` 时取 `<基础面料> w Fascia`，为 `None` 或没有时取 `<基础面料> (Open Roll)`。带罩行 SHALL 在折后价上加 25（窗宽 < 50"）或 50（窗宽 ≥ 50"），无绳行的加价随无绳倍率一并放大。没有生效罩型且该行 SKU 本身就是一个完整的 Roller 定价面料时，SHALL 原样按该面料计价。非 Roller 产品的罩型 SHALL NOT 影响金额。

#### Scenario: 真实 SKU 带罩盒
- **WHEN** 详细订单一行 Roller、SKU `CABO-WHITE-BO`、55" × 72"、行上 Valance = Cassette，企业 Roller 折扣 45%
- **THEN** 该行商品金额为 271.88，提交给服务端的定价面料为 `Blackout w Cassette`；把 Valance 改为 None 后为 221.88、定价面料为 `Blackout (Open Roll)`；`npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts` 覆盖

#### Scenario: Fascia 与 Cassette 同价
- **WHEN** 同一行 Valance = Fascia
- **THEN** 该行商品金额为 271.88，定价面料为 `Blackout w Fascia`

#### Scenario: 加价档位以窗宽 50" 为界
- **WHEN** 同一 SKU、高 72"、Valance = Cassette，窗宽分别为 49"、50"、55"
- **THEN** 相对 Valance = None 的同尺寸行，商品金额分别多 25、50、50

#### Scenario: 无绳带罩行
- **WHEN** 同一行 55" × 72"、Cordless 开、Valance = Cassette，企业无绳策略为缺省值
- **THEN** 该行商品金额为 382.24（Valance = None 时为 324.74）

#### Scenario: SKU 本身是完整定价面料
- **WHEN** Roller 行的 SKU 为 `Blackout w Cassette`，行上 Valance 为空，表底部 Valance Type 未选
- **THEN** 该行按 `Blackout w Cassette` 计价，金额与本次改动前相同

#### Scenario: Zebra 行的罩型不进定价
- **WHEN** 一行 Zebra 的 Valance 由 Cassette 改为 Fascia
- **THEN** 该行商品金额不变

### Requirement: 定价罩型与工艺单罩盒同一取值
详细订单 Shades 行的生效罩型 SHALL 取行上 Valance；行上为空时 SHALL 取 Shades 表底部的 Valance Type；两处都为空则没有生效罩型。报价定价与签字后生成工艺单 SHALL 使用同一个生效罩型取值：对 SKU 不是完整定价面料的 Roller 行，定价含罩盒加价当且仅当工艺单该行的罩盒不是「单轨无盒」。

#### Scenario: 行上留空、表底部选了 Cassette
- **WHEN** Roller 行 SKU `CABO-WHITE-BO`、55" × 72"、行上 Valance 为空，表底部 Valance Type = Cassette
- **THEN** 该行商品金额为 271.88，由该表单生成的工艺单该行罩盒为「亮白插片圆盒」

#### Scenario: 行上明确选 None 优先于表底部
- **WHEN** 同一行行上 Valance = None，表底部 Valance Type = Cassette
- **THEN** 该行商品金额为 221.88，工艺单该行罩盒为「单轨无盒」

#### Scenario: 定价与工艺单逐组合一致
- **WHEN** 运行 `npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts`，对行上 Valance（空 / None / Cassette / Fascia）× 表底部 Valance Type（空 / Cassette / Fascia）的 12 种组合逐一计价并生成工艺单
- **THEN** 每种组合都满足「含罩盒加价 ⇔ 工艺单罩盒不是单轨无盒」

### Requirement: 详细订单实木百叶窗按价表计价
详细订单的百叶窗材质为 `Wooden` 时，系统 SHALL 按价表的 `Wood` 表计价并把定价面料 `Wood` 提交给服务端；材质为 `Vinyl` 时的金额 SHALL NOT 变化。表单、报价 PDF 与工艺单上显示的材质 SHALL 仍为 `Wooden`。系统 SHALL NOT 再显示「Wooden shutters pricing data is not available … set price manually in Part B」提示。

#### Scenario: 实木 72" × 60"
- **WHEN** 详细订单百叶窗材质 = Wooden，一行 72" × 60"、Panel 数 1，企业百叶窗折扣 35%，安装方式为默认
- **THEN** 该行商品金额为 1172.22、安装费 54，保存后该报价含一条产品为 Shutters、定价面料为 `Wood` 的报价行，且没有「Pricing … is not set yet」报错；`npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts` 覆盖

#### Scenario: Vinyl 不变
- **WHEN** 同一行材质 = Vinyl
- **THEN** 该行商品金额为 701.29，定价面料为 `Vinyl`

#### Scenario: 实木行超出价表范围仍报错
- **WHEN** 材质 = Wooden 的一行尺寸超出百叶窗价表的最大宽或最大高
- **THEN** 该行显示超范围报错、不计入小计，页面不出现「set price manually in Part B」提示

### Requirement: 详细订单预览、PDF 与保存金额一致
对同一份详细订单表单与同一组企业设置（各产品折扣、无绳策略、电机单价），页面上逐行预览的商品金额与安装费、报价 PDF 上的逐行金额、保存时服务端对该行算出的金额 SHALL 相同（误差 ≤ 0.01）。三处的定价面料 SHALL 出自同一个取值，SHALL NOT 各自从 SKU 或材质另行推导。

#### Scenario: 预览等于保存
- **WHEN** 运行 `npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts`，对 Roller（真实 SKU × 四种行上 Valance × 窗宽 49" / 50" / 55" × 有无无绳）、Shutters（Wooden / Vinyl，Panel 数 1 与 2）、Zebra、Drapery、Sheer 各行，分别取页面预览金额与「行构造 → 套企业默认折扣 → 引擎」的金额
- **THEN** 每一行两个金额之差 ≤ 0.01，安装费相同

#### Scenario: 企业折扣不是缺省值时仍一致
- **WHEN** 企业 Roller 折扣设为 40%、百叶窗折扣设为 30%，对带罩 Roller 行与实木百叶窗行重复上一场景
- **THEN** 预览与保存金额之差 ≤ 0.01

#### Scenario: 取值只有一处
- **WHEN** 运行同一测试的源码断言
- **THEN** 详细订单页面、预览计算与 PDF 的源码中不再出现直接由 SKU 推定价面料或直接把表单材质当定价面料的写法，三处都引用同一个取值

### Requirement: 口径标记与实木旧报价提醒
按本口径保存的详细订单 SHALL 在表单数据里带 `formDataJson.orderPricingRev: 2`，SHALL NOT 为此新增数据库字段。打开一份没有该标记（或标记小于 2）的已存报价或本地草稿，且其百叶窗材质为 `Wooden`、至少有一行百叶窗能算出价时，页面 SHALL 在表单顶部显示一条提醒，写明实木百叶窗现已自动计价、本单百叶窗商品金额，并要求检查 Part B、删除此前手填的百叶窗价格。提醒 SHALL NOT 阻止编辑或保存；点「知道了」后本次打开不再显示；该报价按本口径保存后再打开 SHALL NOT 再显示。

#### Scenario: 旧的实木报价
- **WHEN** 打开一份表单数据没有 `orderPricingRev`、材质 Wooden、含一行 72" × 60" 百叶窗的已存报价
- **THEN** 页面顶部显示提醒，文中含金额 $1,172.22 与「Part B」；`npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts` 覆盖提醒判定

#### Scenario: 保存后不再提醒
- **WHEN** 上述报价保存一次后重新打开
- **THEN** 落库的 `formDataJson` 含 `orderPricingRev: 2`，页面不显示提醒

#### Scenario: 不相关的报价不提醒
- **WHEN** 打开没有该标记的已存报价，材质为 Vinyl，或材质为 Wooden 但没有填了宽高的百叶窗行
- **THEN** 页面不显示提醒

#### Scenario: 新建报价不提醒
- **WHEN** 新建一份报价并选择材质 Wooden、填入百叶窗行
- **THEN** 页面不显示提醒

### Requirement: 口径变更不重算已存报价
本次口径变更 SHALL NOT 回填或批量重算已存报价：已存报价及其报价行在库里的金额在该报价再次保存之前 SHALL 保持不变。打开已存报价时页面预览 SHALL 按当前口径计算；再次保存时服务端 SHALL 按当前口径重算并落库。

#### Scenario: 无数据迁移
- **WHEN** 本 change 合并
- **THEN** `git diff --stat origin/main -- prisma/` 为空，改动中没有任何回填或批量重算脚本

#### Scenario: 旧的带罩 Roller 报价再次保存
- **WHEN** 一份改动前保存、尚未签约的报价含 Roller `CABO-WHITE-BO` 55" × 72"、Valance = Cassette（库里该行 221.88），销售打开后不做修改直接保存
- **THEN** 打开时该行预览为 271.88；保存后库里该行为 271.88；保存前库里仍为 221.88

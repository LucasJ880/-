# sales/price-list Specification

## Purpose
Sunny 零售价表：价表版本、各产品按宽高档位查 MSRP 并套折扣与最低价的定价规则、手动成交价覆盖、企业折扣的零 schema 落点、SKU 别名，以及以黄金用例文件为契约的对照验证。

## Requirements

### Requirement: 价表版本与来源
系统 SHALL 公布当前价表版本标识，本次为 `2026-10-28`；价表数值 SHALL 只来自 `config/pricelist/2026-10-28-lucas-quote.json`，该文件 SHALL 记录来源文件的 SHA-256。新建报价时系统 SHALL 把价表版本写入报价的表单数据 `formDataJson.pricelistVersion`，SHALL NOT 为此新增数据库字段。

#### Scenario: 新建报价带价表版本
- **WHEN** 销售通过 `POST /api/sales/quotes` 新建一份报价，表单数据为 JSON 对象
- **THEN** 落库的 `formDataJson` 解析后含 `pricelistVersion: "2026-10-28"`；`npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` 断言版本常量

### Requirement: Fauxwood 查表定价
系统 SHALL 把 `Fauxwood`（配置 `Standard`）按价表宽档 18 / 24 / 32 / 36 / 42 / 48 / 54 / 60 / 66 / 72 / 78 与高档 30 / 36 / 42 / 48 / 54 / 60 / 66 / 72 / 75 向上取档查 MSRP，默认折扣 30%，折后低于 209 时 SHALL 取 209；安装费宽 ≤ 70" 为 18、否则 26。宽 > 78" 或高 > 75" SHALL 返回超范围错误而非金额。

#### Scenario: 36.5" × 48"
- **WHEN** 定价 Fauxwood Standard 宽 36.5" 高 48"
- **THEN** 取档 42 × 48，MSRP 410.06，成交 287.05，安装 18；黄金用例 `fauxwood` 组覆盖

#### Scenario: 最低价兜底
- **WHEN** 定价 Fauxwood Standard 宽 18" 高 30"
- **THEN** MSRP 339.29，折后 237.50 高于 209 不触发；黄金用例覆盖最小档

#### Scenario: 超范围
- **WHEN** 定价 Fauxwood 宽 79" 高 75"
- **THEN** 返回错误，不返回金额

### Requirement: Allusion 查表定价
系统 SHALL 把 `Allusion`（配置 `Standard`）按价表 14 个宽档（24 … 72、84 … 108）与 15 个高档（36 … 120）查 MSRP，默认折扣 35%，折后低于 200 时 SHALL 取 200；安装费与其它帘子相同。Allusion SHALL NOT 再要求销售手填单价。

#### Scenario: 25.5" × 36.5"
- **WHEN** 定价 Allusion Standard 宽 25.5" 高 36.5"
- **THEN** 取档 30 × 42，金额与黄金用例 `allusion` 组一致，不报"需要手填单价"

#### Scenario: 超范围
- **WHEN** 定价 Allusion 宽 109" 高 120"
- **THEN** 返回错误

### Requirement: Allusion 手动成交单价覆盖
当 Allusion 行带有大于 0 的手动成交单价时，系统 SHALL 以该值为成交价，MSRP 仍取价表值，折扣额 = MSRP − 手动成交价（不为负）；未填或非法时 SHALL 走查表定价。`Roman` SHALL 维持手填单价分支不变。

#### Scenario: 手填覆盖
- **WHEN** Allusion 宽 24" 高 36"，手动成交单价 300
- **THEN** 成交价 300，MSRP 为价表值，安装费不受影响；黄金测试文件中的覆盖用例断言

#### Scenario: Roman 仍手填
- **WHEN** Roman 行未填单价
- **THEN** 该行报错"需要销售在报价单上手填单价"，与改动前一致

### Requirement: 老产品定价不变
价表版本升级 SHALL NOT 改变 Roman Shade、Zebra、SHANGRILA、Cordless Cellular、SkylightHoneycomb、Roller、Drapery、Sheer、Shutters 任何档位的 MSRP、折扣、最低价与安装费。

#### Scenario: 回归组
- **WHEN** 运行黄金对照测试的 `regression` / `zebra` / `roller` / `door-screen` 组
- **THEN** 全部与引擎输出一致（金额误差 ≤ 0.01，报错 ↔ 报错）

### Requirement: 黄金用例对照
`config/pricelist/2026-10-28-golden-cases.json` 是定价契约。对照测试 SHALL 按标签把用例分为"本次必须一致"与"留给后续 change"两组，两组并集 SHALL 覆盖文件中全部标签，出现未归组的标签 SHALL 失败；"本次必须一致"组 SHALL 含 fauxwood、allusion、regression、zebra、roller、door-screen、door-screen-err、cordless-ignored。

#### Scenario: 新标签不被静默跳过
- **WHEN** 黄金文件新增一个未归组的标签
- **THEN** `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` 失败并列出该标签

### Requirement: 企业折扣的零 schema 落点
Fauxwood 与 Allusion 的企业折扣 SHALL 存于企业设置 JSON `pricing.discounts.fauxwood` / `pricing.discounts.allusion`（0 到 1），缺失或非法时 SHALL 回落默认 0.30 / 0.35；`GET /api/sales/quote-settings/discounts` SHALL 返回 `fauxwood` 与 `allusion` 两项；定价、预览与报价创建 SHALL 使用同一来源。品类成本率 SHALL 接受 `fauxwood` / `allusion` 键。

#### Scenario: 读取回落
- **WHEN** 企业设置 JSON 的 `pricing.discounts.fauxwood` 为 `"abc"`
- **THEN** 折扣读作 0.30；纯函数测试覆盖

#### Scenario: 企业覆盖生效
- **WHEN** 企业设置 JSON 的 `pricing.discounts.allusion` 为 0.4
- **THEN** 预览与新建报价中 Allusion 行按 40% 折扣计价

### Requirement: SKU 别名
SKU 目录中 Zebra `LOUIA-WHITE-BL201-LF` SHALL 为正式编号；旧编号 `LOUIA-WHITE-LF-BL201` SHALL 解析到同一条目并映射到 `Light Filtering` 定价面料。目录条目总数 SHALL 保持 350。

#### Scenario: 旧编号仍可定价
- **WHEN** 历史报价行的 SKU 为 `LOUIA-WHITE-LF-BL201`
- **THEN** 查目录得到正式编号条目，定价面料为 `Light Filtering`

### Requirement: 产品下拉与文字解析
Order Form Shades 表、Part A、量房页的产品下拉 SHALL 含 `Fauxwood`；AI 报价文字解析 SHALL 把 `fauxwood` / `faux wood` / `仿木` 识别为 Fauxwood，把 `allusion` / `梦幻帘` 识别为 Allusion。

#### Scenario: 文字解析
- **WHEN** 解析文本 `2 faux wood 36x48; 1 allusion 48x60`
- **THEN** 得到 2 行 Fauxwood 与 1 行 Allusion；`npm run build` 通过作为下拉的可观察产物

### Requirement: 不输出成本
价表、折扣接口与报价预览响应 SHALL NOT 含经销商参考价或品类成本率以外的任何成本数据；经销商参考价 SHALL NOT 进入青砚。

#### Scenario: 预览无成本
- **WHEN** 调用 `POST /api/sales/quotes/preview`
- **THEN** 响应只含 MSRP、折扣、成交价、安装费与合计，无成本字段

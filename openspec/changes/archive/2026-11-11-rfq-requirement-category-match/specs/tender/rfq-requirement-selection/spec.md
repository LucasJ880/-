# Spec Delta

## Purpose
规定招标询价单收入哪些招标要求：只收已确认且属于供应商侧类别的要求，类别判定对入库的各种写法一致，未收入的要求留下原因。

## ADDED Requirements

### Requirement: 询价单只收已确认的供应商侧要求
询价单 SHALL 只收入审阅状态为「已确认」且类别属于供应商侧的招标要求。供应商侧类别为：产品、技术、性能、交付、质保、样品、安全、图纸、安装、培训。询价单 SHALL NOT 收入未确认或已驳回的要求，无论其类别是什么。

#### Scenario: 已确认的产品类要求进入询价单
- **WHEN** 一条要求已确认、类别为产品类
- **THEN** 它出现在询价单行项里，带原要求编号、是否强制与来源页码（`npx tsx src/lib/tender-rfq/__tests__/build.test.ts`）

#### Scenario: 未确认的要求不进入询价单
- **WHEN** 一条要求的类别属于供应商侧，但审阅状态不是「已确认」
- **THEN** 它不出现在行项里，排除清单里记 `not_confirmed`（同一测试）

#### Scenario: 保险类要求不进入询价单
- **WHEN** 一条要求已确认、类别为保险
- **THEN** 它不出现在行项里，排除清单里记 `not_supplier_facing`（同一测试）

### Requirement: 类别判定不区分写法
询价单对要求类别的判定 SHALL 不区分大小写并忽略首尾空白：同一类别的大写、小写、混合大小写写法得到相同的判定。分析契约里的每一个要求类别，其小写写法与大写写法的判定结果 SHALL 相同。

#### Scenario: 小写入库的类别照常进入询价单
- **WHEN** 三条已确认要求的类别分别写作 `product`、`delivery`、`technical`
- **THEN** 询价单生成成功，行项为 3 条（同一测试）

#### Scenario: 带空白与混合大小写
- **WHEN** 已确认要求的类别写作 ` Product `
- **THEN** 它进入询价单，判定与 `PRODUCT` 相同（同一测试）

#### Scenario: 契约里的每个类别两种写法判定一致
- **WHEN** 对分析契约列出的全部要求类别，分别用大写与小写写法各生成一次询价单
- **THEN** 每个类别两次的结果相同：同为进入行项，或同为记 `not_supplier_facing`（同一测试）

### Requirement: 旧式类别代码的归属
类别为旧式代码 `mandatory_technical` 的已确认要求 SHALL 按技术类进入询价单。类别为 `mandatory_general` 的要求 SHALL NOT 进入询价单。

#### Scenario: mandatory_technical 进入询价单
- **WHEN** 一条已确认要求的类别为 `mandatory_technical`
- **THEN** 它出现在行项里，行项类别为技术类（同一测试）

#### Scenario: mandatory_general 不进入
- **WHEN** 一条已确认要求的类别为 `mandatory_general`
- **THEN** 它不出现在行项里，排除清单里记 `not_supplier_facing`（同一测试）

### Requirement: 未知类别不进入询价单
类别为空、或不在分析契约与旧式代码之内的要求 SHALL NOT 进入询价单，并 SHALL 在排除清单里记 `not_supplier_facing`。系统 SHALL NOT 猜测未知类别的归属。

#### Scenario: 未知类别
- **WHEN** 一条已确认要求的类别为 `misc_notes` 或空字符串
- **THEN** 它不出现在行项里，排除清单里记 `not_supplier_facing`（同一测试）

### Requirement: 行项类别与附件提示按归一后的类别
询价单行项上的类别 SHALL 是归一后的标准写法。「请随报价提供」清单 SHALL 按归一后的类别生成：样品、图纸、安全、质保四类无论以何种写法入库，都触发各自的提示。

#### Scenario: 小写的样品类触发样品提示
- **WHEN** 一条已确认要求的类别写作 `samples`
- **THEN** 询价单的「请随报价提供」清单里出现样品一项，该行项的类别为标准写法（同一测试）

### Requirement: 没有可收入的要求时不生成询价单
没有任何要求可收入时，询价单生成 SHALL 失败并返回 `NO_CONFIRMED_REQUIREMENTS`，SHALL NOT 生成空询价单，SHALL NOT 建立询价轮次或审批卡。

#### Scenario: 全部要求都不属于供应商侧
- **WHEN** 所有已确认要求的类别都是保险、担保或行政类
- **THEN** 返回 `NO_CONFIRMED_REQUIREMENTS`（同一测试）

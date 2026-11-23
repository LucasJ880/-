# Spec Delta

## MODIFIED Requirements

### Requirement: 询价单只收已确认的供应商侧要求
询价单 SHALL 只收入审阅状态为「已确认」且类别属于供应商侧的招标要求。供应商侧类别为：产品、技术、性能、交付、质保、样品、安全、图纸、安装、培训。询价单 SHALL NOT 收入未确认或已驳回的要求，无论其类别是什么。

#### Scenario: 已确认的产品类要求进入询价单
- **WHEN** 一条要求已确认、类别为产品类
- **THEN** 它出现在询价单行项里，带原要求编号与是否强制（来源页码不进询价单）（`npx tsx src/lib/tender-rfq/__tests__/build.test.ts`）

#### Scenario: 未确认的要求不进入询价单
- **WHEN** 一条要求的类别属于供应商侧，但审阅状态不是「已确认」
- **THEN** 它不出现在行项里，排除清单里记 `not_confirmed`（同一测试）

#### Scenario: 保险类要求不进入询价单
- **WHEN** 一条要求已确认、类别为保险
- **THEN** 它不出现在行项里，排除清单里记 `not_supplier_facing`（同一测试）

### Requirement: 行项类别与附件提示按归一后的类别
询价单行项上的类别 SHALL 是归一后的标准写法。「请随报价提供」清单 SHALL 先按归一后的类别生成：样品、图纸、安全、质保四类无论以何种写法入库，都触发各自的提示；其后 SHALL 固定追加「首次合作或尚未提供过的，请一并提供」一组六项（见 `tender/rfq-supplier-attachment`「请随报价提供的勾选清单」），这一组不随要求类别变化。

#### Scenario: 小写的样品类触发样品提示
- **WHEN** 一条已确认要求的类别写作 `samples`
- **THEN** 询价单的「请随报价提供」清单里出现样品一项，其后是固定的一组六项，该行项的类别为标准写法（同一测试）

## ADDED Requirements

### Requirement: 行项的分组与顺序
询价单行项 SHALL 分四组并按此顺序：产品与规格（产品、技术、性能）；安全与认证（安全）；样品与图纸（样品、图纸）；交付、质保与服务（交付、质保、安装、培训）。组内 SHALL 按要求编号升序。询价单 SHALL 只用要求编号称呼行项，SHALL NOT 另编序号。邮件正文与附件 SHALL 用同一个顺序。

#### Scenario: 打乱类别的要求
- **WHEN** 已确认的要求按编号依次是交付、产品、安全、样品、技术、培训类
- **THEN** 行项顺序是产品、技术、安全、样品、交付、培训那几条（组内按编号升序），四个组的条数分别是 2、1、1、2；行项上没有序号（`npx tsx src/lib/tender-rfq/__tests__/build.test.ts`）

### Requirement: 招标原文的内部字段检查
要求的原文、译文、要求编号、交付要求与数量事实 SHALL 过「只属于我方内部的字段与词」检查：估值、我方报价、中标价这三个字段名，以及毛利、利润率、底价、我方预算、中标概率、我方报价、我方成本、内部成本、目标毛利、`our bid price`、`target margin`、`internal cost`。任一处命中时询价单生成 SHALL 失败（`SENSITIVE_LEAK`），SHALL NOT 把命中的部分替换或删去后继续。招标文件里常见的 `at no additional cost`、金额与 `budget` 一词 SHALL NOT 因此被拦。

#### Scenario: 译文、编号与数量里的内部字样
- **WHEN** 分别是：一条要求的译文写着「我方报价 98.7 万」；一条要求的原文写着 `target margin 31%`；一条要求的编号是「底价-01」；数量事实写着「内部成本 80 元，共 300 件」
- **THEN** 四种情形都生成失败，`SENSITIVE_LEAK`；原文写着 `at no additional cost to the buyer, within budget` 的要求照常进入询价单（`npx tsx src/lib/tender-rfq/__tests__/build.test.ts`）

# Spec Delta

## Purpose

首封回复草稿里企业确认过的参考值原句（起订量 / 大货周期 / 装运港）：原句只由企业配置的商务事实确定性生成，中文与英文各有固定措辞，草稿守卫与润色只认原句原文。

## ADDED Requirements

### Requirement: 中文参考原句的起订量计量口径写成中文

中文参考原句的起订量一句 SHALL 写成"起订量一般为每<口径> <数量> <单位>"，口径按下表写成中文：`color` → 色、`size` → 尺码、`design` → 款式、`style` → 款、`sku` → SKU、`item` → 品、`order` → 单。对照时忽略首尾空格与大小写。企业未配置口径时写"款"。

#### Scenario: 四种常见口径
- **WHEN** 企业商务事实配置起订量 500、单位 `pcs`，口径分别为 `color`、`size`、`style`、`order`，生成中文首封回复草稿
- **THEN** 参考原句分别为"供参考：起订量一般为每色 500 件。具体以我们针对您项目的报价为准。"、"…每尺码 500 …"、"…每款 500 …"、"…每单 500 件…"；`npx tsx src/lib/revenue-spine/__tests__/scoring-draft.test.ts` 中"中文参考原句：起订量口径与单位写成中文"一项通过

#### Scenario: 大小写与首尾空格不影响对照
- **WHEN** 起订量配置为 200、单位 `PCS`、口径 ` Color `
- **THEN** 中文参考原句含"起订量一般为每色 200 件"

#### Scenario: 默认口径不变
- **WHEN** 企业商务事实配置起订量 1000、单位 `pcs`、口径 `style`
- **THEN** 中文参考原句含"起订量一般为每款 1,000 件"（`npx tsx src/lib/revenue-spine/__tests__/commercial-facts.test.ts` 的"中文草稿：参考原句为中文"一项通过）

### Requirement: 中文参考原句的起订量单位写成中文量词

中文参考原句的起订量单位 SHALL 按下表写成中文量词：`pcs` → 件、`units` → 件、`sets` → 套、`m` → 米、`kg` → 公斤。对照时忽略首尾空格与大小写。

#### Scenario: 套与米
- **WHEN** 起订量单位为 `sets`（口径 `size`）或 `m`（口径 `style`）
- **THEN** 中文参考原句分别含"每尺码 500 套"与"每款 500 米"

### Requirement: 未知口径与单位原样保留

对照表里没有的口径或单位 SHALL 原样写进中文参考原句，不猜测译法、不丢弃。

#### Scenario: 未收录的口径与单位
- **WHEN** 起订量配置为 200、单位 `rolls`、口径 `fabric`
- **THEN** 中文参考原句为"供参考：起订量一般为每fabric 200 rolls。具体以我们针对您项目的报价为准。"

#### Scenario: 与对象内置属性同名的取值
- **WHEN** 起订量配置为 200、单位 `toString`、口径 `constructor`
- **THEN** 中文参考原句为"供参考：起订量一般为每constructor 200 toString。具体以我们针对您项目的报价为准。"

### Requirement: 中文草稿与中文审核对照不夹带已收录的英文口径

中文首封回复草稿正文，以及英文草稿审批预览里附带的"中文对照"，SHALL NOT 出现对照表已收录的英文口径或单位（如"每color"、"500 pcs"）；两处使用同一句中文参考原句。

#### Scenario: 每色进中文草稿
- **WHEN** 起订量配置为 500、单位 `pcs`、口径 `color`，生成中文首封回复草稿
- **THEN** 正文含"起订量一般为每色 500 件"，不含"每color"

#### Scenario: 英文草稿的中文审核对照
- **WHEN** 同样配置下生成英文首封回复草稿，并附同一模板的中文版进审批预览
- **THEN** 审批预览的"中文对照"部分含"起订量一般为每色 500 件"，英文部分含"500 pcs per color"

### Requirement: 英文参考原句不变

英文参考原句 SHALL 保持"For reference, our MOQ is typically <数量> <单位> per <口径>."的措辞，单位与口径照企业配置原样输出，不受中文对照表影响。

#### Scenario: 英文原句逐字不变
- **WHEN** 起订量配置为 500、单位 `pcs`、口径 `color`，生成英文参考原句
- **THEN** 原句为"For reference, our MOQ is typically 500 pcs per color. Both are confirmed for your project in our quotation."

### Requirement: 参考原句只由企业配置确定性生成，守卫白名单契约不变

参考原句 SHALL 只用企业商务事实里的数字与口径生成，同一配置每次生成逐字相同，并随草稿一起携带；草稿守卫 SHALL 先剔除这些原句再按最严规则检查，润色稿 SHALL 一字不差保留原句，否则回退模板。参考原句 SHALL NOT 读取买家来信里的数字或口径。

#### Scenario: 中文草稿守卫通过
- **WHEN** 起订量配置为 500、单位 `pcs`、口径 `color`，生成中文首封回复草稿
- **THEN** 草稿携带的参考原句为 `["供参考：起订量一般为每色 500 件。具体以我们针对您项目的报价为准。"]`，守卫违规为空，按原句白名单复查正文违规也为空

#### Scenario: 原句被改动即拦截
- **WHEN** 润色稿或正文里的起订量数字与原句不一致
- **THEN** 按原句白名单检查报出起订量违规（`commercial-facts.test.ts` 的原句白名单测试照旧通过）

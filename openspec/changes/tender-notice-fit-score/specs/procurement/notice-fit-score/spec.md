## Purpose

规定采购监控「新标」视图里每条招标公告的匹配度：四项确定性规则（业务匹配、与该采购方的往来、过往业绩相近、准备时间）、每项原因的写法、按看的人可见的项目计算、只写次数不写价格，以及按匹配度排序。匹配度不是中标概率。

## ADDED Requirements

### Requirement: 新标匹配度按四项规则计算
采购监控新标视图里的每条招标公告 SHALL 带一个 0–100 的匹配度，由四项相加：业务匹配（满分 40，来自扫描时的产品词 / 分类 / 服务词命中）、与该采购方的往来（满分 25）、过往业绩相近（满分 20，与已中标项目标题的相似度）、准备时间（满分 15，距截标的多伦多日期天数）。每项 SHALL 写出原因（依据的关键词、次数、项目名或天数；没有数据写明「没有」）。匹配度 SHALL 标明不是中标概率，SHALL NOT 调用模型。别的视图 SHALL NOT 显示匹配度。

#### Scenario: 命中产品词、与采购方中标过、截标还有三周
- **WHEN** 一条公告命中两个产品词，采购方与本组织一个已中标项目的客户相同，距截标 21 天
- **THEN** 业务匹配 20、往来 25、准备时间 15，原因分别写出两个词、「交过标 1 次，中标 1 次」与截标日期（`npx tsx src/lib/procurement-records/__tests__/fit-score-pure.test.ts`）

#### Scenario: 采购方只知道是 PSPC
- **WHEN** 公告没有使用部门、采购机关是 PSPC，本组织有客户写 PSPC 的已中标项目
- **THEN** 往来只给 5 分，原因写明 PSPC 代各部门采购、仅供参考（`fit-score-pure.test.ts`）

### Requirement: 只按看的人可见的项目计算
往来与业绩两项 SHALL 只计入看的人可见的本组织招投标项目（与相似项目检索同一可见规则）；往来 SHALL 只写次数，SHALL NOT 写项目名或任何价格；业绩 SHALL 只写看的人可见的已中标项目名。别的组织的项目 SHALL NOT 计入。

#### Scenario: 普通成员看不到的项目
- **WHEN** 一个已中标项目对普通成员不可见
- **THEN** 该成员看到的往来与业绩不计入它，管理员看到的计入（`npx tsx src/lib/procurement-records/__tests__/fit-score-db.isolated.test.ts`）

### Requirement: 可以按匹配度排序
新标视图 SHALL 默认按发布日期排序（与之前相同）；请求 `sort=fit` 时 SHALL 按匹配度从高到低排，同分按发布日期从新到旧。

#### Scenario: 切到按匹配度排序
- **WHEN** 在新标视图选「按匹配度」
- **THEN** 列表按匹配度从高到低（`fit-score-db.isolated.test.ts`）

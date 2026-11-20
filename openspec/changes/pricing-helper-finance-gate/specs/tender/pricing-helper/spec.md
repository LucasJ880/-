## ADDED Requirements

### Requirement: 我方成本只给有财务查看权的人
报价表助手的读取与保存 SHALL 按与成本核算相同的财务查看权判定：平台超级管理员、持组织范围 `project.finance.manage` 或 `project.finance.read` 的人、项目负责人；判定出错时 SHALL 按没有财务查看权处理。没有财务查看权的人：读取与保存的返回里 `inputs.ourCostCad` SHALL 为 `null` 并带 `costHidden: true`，情景表 SHALL 按没有成本计算（毛利为空、没有成本底价情景），假设说明 SHALL 写「需要财务查看权才能看我方成本；毛利一栏与成本底价情景也不显示。」；保存请求带了我方成本或成本来源时 SHALL 返回 403「需要财务查看权才能修改我方成本。」且 SHALL NOT 写库。卡片 SHALL 以这句说明代替成本输入框、不显示毛利一栏。有财务查看权的人的读取与保存 SHALL 与以前相同。

#### Scenario: 只读成员读取
- **WHEN** 已保存成本 90,000、目标毛利 15%，没有财务键的只读成员读取
- **THEN** `inputs.ourCostCad` 为 `null`、`costHidden` 为 true，情景里没有毛利、没有成本底价情景，假设说明有那一句（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`；`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts`）

#### Scenario: 有财务查看权的人读取
- **WHEN** 项目负责人、持 `project.finance.read` 的成员、平台超级管理员分别读取
- **THEN** 返回与本功能之前逐字节相同（`pricing-helper-finance-db.isolated.test.ts`）

#### Scenario: 没有财务查看权的编辑者保存
- **WHEN** 能编辑项目、没有财务键的成员保存时带了 `ourCostCad`；另一次只带对手价
- **THEN** 前一次 403、房间的 `summaryJson` 不变；后一次保存成功，已保存的成本与来源保留，返回的 `inputs.ourCostCad` 为 `null`（`pricing-helper-finance-db.isolated.test.ts`）

#### Scenario: 卡片
- **WHEN** 读取结果带 `costHidden`
- **THEN** 卡上没有「我方成本」输入框而是那句说明，情景表没有毛利一栏，保存请求不带 `ourCostCad`（`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts`）

### Requirement: 没有财务查看权时不带出的内容
对没有财务查看权的人，报价表助手的读取与保存返回 SHALL NOT 含已保存的我方成本、比价矩阵算出的落地价及其逐项金额、已记成本来源里的落地价，也 SHALL NOT 含能由价格与目标毛利反推成本的情景。

#### Scenario: 响应里搜不到成本数字
- **WHEN** 开关开着、比价矩阵有选定、已保存成本带来源，只读成员读取并保存一次对手价
- **THEN** 两次响应的 JSON 里都没有 `compareCost`、`ourCostSource`，也搜不到成本与落地价的数字（`pricing-helper-finance-db.isolated.test.ts`）

## MODIFIED Requirements

### Requirement: 保存的对外行为
保存成功时系统 SHALL 返回 `{ ok: true, inputs, model }`，其中 `inputs` SHALL 只含三项人工输入、不含报价引擎镜像的键；GET 返回的 `inputs` 同样只含这三项。没有财务查看权时 `inputs.ourCostCad` 的返回与 403 见「我方成本只给有财务查看权的人」。目标毛利不小于 100 时 SHALL 返回 400，项目没有投标调查室时 SHALL 返回 409，没有写权限时 SHALL 被拒绝；这几种情况 SHALL NOT 写库。

#### Scenario: 返回形状
- **WHEN** 已有权威报价镜像时保存
- **THEN** 返回的 `inputs` 只有 `competitorPriceCad`、`ourCostCad`、`targetMarginPct`；GET 的 `inputs` 也没有 `ourPriceCad`（`pricing-helper-save-db.isolated.test.ts`）

#### Scenario: 拒绝的保存不写库
- **WHEN** 目标毛利填 100；或只读成员保存；或项目没有投标调查室
- **THEN** 分别得到 400、403、409，房间的 `summaryJson` 与请求前相同（`pricing-helper-save-db.isolated.test.ts`）

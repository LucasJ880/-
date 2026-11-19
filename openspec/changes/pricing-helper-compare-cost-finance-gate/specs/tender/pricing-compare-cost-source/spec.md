# Spec Delta

## MODIFIED Requirements

### Requirement: 来自比价矩阵的成本建议
开关对项目的组织开启、且当前登录者有财务查看权（平台超级管理员、在本企业持企业级 `project.finance.manage` 或 `project.finance.read`、项目负责人）时，报价表助手的读取接口 SHALL 返回一项成本建议：项目里最近一轮有人工选定（`isSelected`）且已报价、未取消的询价，用比价矩阵同一套换算算出那一家的落地价（CAD），带供应商名、轮次、数量口径、逐项金额与换算假设；之后已取消或草稿的轮次 SHALL NOT 算作「之后还有」。取数出错时 SHALL 只这一项显示暂不可用，SHALL NOT 让整个接口失败。没有选定时 SHALL 返回「还没有选定」的说明；换算不出落地价时 SHALL 返回原因，SHALL NOT 给出数字。SHALL NOT 用推荐或最低价代替选定。没有财务查看权的人看到的这一项由「没有财务查看权的人拿不到落地价」规定。

#### Scenario: 最近一轮有选定
- **WHEN** 第 2 轮选定了一家 FOB 报价，汇率、海运、关税率、清关参数齐全
- **THEN** 接口返回这一家的落地价、第 2 轮、按询价单首档数量、逐项金额（`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source-db.isolated.test.ts`；`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx`）

#### Scenario: 有财务查看权、不是项目负责人
- **WHEN** 一个持 `accounting` 岗位（企业级 `project.finance.read`）的项目只读成员读取
- **THEN** 返回的这一项与项目负责人读取时逐字段相同，含落地价与逐项金额（`npx tsx src/lib/tender-pricing/__tests__/compare-cost-finance-gate-db.isolated.test.ts`）

#### Scenario: 最近一轮没有选定、更早一轮有
- **WHEN** 第 3 轮还没有选定，第 2 轮有
- **THEN** 建议来自第 2 轮，并写明之后还有第 3 轮尚未选定（`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 已取消、草稿的轮次
- **WHEN** 第 3 轮有选定但已取消，第 4 轮还是草稿
- **THEN** 建议仍来自之前的选定，不说「之后还有」（`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 供应商给了总价
- **WHEN** 选定的那一家报的是总价
- **THEN** 货值按总价，数量口径写明按件估算的费用按询价单首档数量（`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 没有选定
- **WHEN** 项目有报价但没有任何一轮选定
- **THEN** 返回「还没有选定」，不给数字，即使矩阵里有推荐或最低价（`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 换算不出落地价
- **WHEN** 选定的那一家缺汇率、缺贸易条款或缺关税率
- **THEN** 返回换算不出的原因，不给数字，卡片上没有填入按钮（`compare-cost-source-db.isolated.test.ts`；`compare-cost-source.test.tsx`）

#### Scenario: 开关关闭
- **WHEN** 开关关闭，或组织不在名单里
- **THEN** 接口不返回这一项，卡片与现在相同（`compare-cost-source-db.isolated.test.ts`；`compare-cost-source.test.tsx`）

### Requirement: 来源由服务端核对后才记
保存时有财务查看权的人在请求里声明成本来自比价矩阵，服务端 SHALL 按当前登录者有权访问的项目重新取选定的那一条报价并重新换算；只有保存的成本与重新算出的落地价相同（到分）时，SHALL 在既有的 `pricingInputs` JSON 里记来源：轮次、询价与报价条目 id、当时的落地价、数量口径、时间。否则成本数字变了 SHALL 记为手填，没变 SHALL 保留原来的来源。请求里的组织、金额、条目 id SHALL NOT 绕过服务端核对；别的项目或别的组织的条目 SHALL NOT 被记为来源。没有财务查看权的人保存时，请求里的来源声明 SHALL NOT 被采信（成本数字变了记为手填，没变保留原来的来源），保存响应 SHALL NOT 带成本来源；成本与其它输入照常保存。

#### Scenario: 数字相同
- **WHEN** 人点按钮后直接保存
- **THEN** 已保存的成本带来源：第 N 轮、那一条报价、落地价、数量口径（`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 改过数字、或伪造来源
- **WHEN** 人点按钮后把数字改了再保存；或请求声明来源却给了别的金额、别的项目或别的组织的条目、没有选定的条目
- **THEN** 成本照常保存，来源记为手填（`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 别的组织的人
- **WHEN** 别的组织的人读取或保存
- **THEN** 403，什么都不改（`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 没有财务查看权的人带声明保存
- **WHEN** 一个持 `bids` 岗位的项目管理员（有写权限、没有财务查看权）带来源声明保存，金额与选定那一家的落地价到分相同
- **THEN** 成本照常保存，来源记为手填，响应里没有 `ourCostSource`；之后项目负责人读取看到的来源是手填（`compare-cost-finance-gate-db.isolated.test.ts`）

#### Scenario: 没有财务查看权的人只改毛利
- **WHEN** 项目负责人按比价矩阵记了来源之后，同一个 `bids` 岗位的项目管理员只保存目标毛利
- **THEN** 库里的来源仍是比价矩阵那一条，响应里没有 `ourCostSource`（`compare-cost-finance-gate-db.isolated.test.ts`）

### Requirement: 矩阵变了只提示
已保存的成本带来源、而现在的建议与它不同（换了选定、换了轮次、落地价变了）时，读取接口 SHALL 向有财务查看权的人返回一句提示，写明现在的落地价与已保存的成本；SHALL NOT 自动改写成本。没有来源（手填）时 SHALL NOT 有这句提示。没有财务查看权的人 SHALL NOT 收到这句提示。

#### Scenario: 选定换了一家
- **WHEN** 成本按 A 家保存后，人把选定改为 B 家
- **THEN** 卡片提示比价矩阵现在是 B 家的落地价，已保存的成本仍是 A 家的（`compare-cost-source-db.isolated.test.ts`；`compare-cost-source.test.tsx`）

#### Scenario: 没有财务查看权的人不收提示
- **WHEN** 同样按 A 家保存后改选 B 家，持 `bids` 岗位的只读成员读取
- **THEN** 过时提示为空；项目负责人读取时提示照旧（`compare-cost-finance-gate-db.isolated.test.ts`）

## ADDED Requirements

### Requirement: 没有财务查看权的人拿不到落地价
开关开启而当前登录者没有财务查看权时，读取接口返回的这一项 SHALL 只有一句说明「比价矩阵的落地价只对有财务查看权的人显示」，已保存成本的来源与过时提示 SHALL 为空。这一项 SHALL NOT 含落地价、逐项金额、换算依据与警告、数量口径、供应商名、轮次、询价或报价条目 id。接口的其余字段 SHALL 与有财务查看权的人读取时相同。卡片 SHALL 只显示这句说明，SHALL NOT 显示金额与填入按钮。开关关闭时 SHALL 与改动前相同。

#### Scenario: 投标岗只读成员读取
- **WHEN** 开关开启，乙厂已选定且落地价算得出，项目负责人已按乙厂记了来源，一个持 `bids` 岗位的只读成员读取
- **THEN** 这一项只有那句说明，来源与过时提示为空，里面找不到落地价、逐项金额、供应商名与条目 id；`runId`、`model`、`modelOrigin`、`benchmark`、`inputs`、`result`、`note` 与项目负责人读取时相同（`npx tsx src/lib/tender-pricing/__tests__/compare-cost-finance-gate-db.isolated.test.ts`）

#### Scenario: 有写权限也不够
- **WHEN** 一个持 `bids` 岗位的项目管理员（有写权限、没有财务查看权）读取
- **THEN** 这一项同样只有那句说明（`compare-cost-finance-gate-db.isolated.test.ts`）

#### Scenario: 卡片只显示说明
- **WHEN** 卡片收到这一项，查看的人有写权限
- **THEN** 显示「来自比价矩阵」与那句说明，没有金额、没有填入按钮、没有来源与过时提示；「毛利率（按售价）」与成本加成提示照旧显示（`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx`）

#### Scenario: 开关关闭
- **WHEN** 开关关闭，持 `bids` 岗位的只读成员读取
- **THEN** 接口不返回这一项，与改动前相同（`compare-cost-finance-gate-db.isolated.test.ts`）

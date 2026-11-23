## MODIFIED Requirements

### Requirement: 来自比价矩阵的成本建议
开关对项目的组织开启、且读取的人对本项目有财务查看权（见 `tender/pricing-helper`「我方成本只给有财务查看权的人」）时，报价表助手的读取接口 SHALL 返回一项成本建议：项目里最近一轮有人工选定（`isSelected`）且已报价、未取消的询价，用比价矩阵同一套换算算出那一家的落地价（CAD），带供应商名、轮次、数量口径、逐项金额与换算假设；之后已取消或草稿的轮次 SHALL NOT 算作「之后还有」。取数出错时 SHALL 只这一项显示暂不可用，SHALL NOT 让整个接口失败。没有选定时 SHALL 返回「还没有选定」的说明；换算不出落地价时 SHALL 返回原因，SHALL NOT 给出数字。SHALL NOT 用推荐或最低价代替选定。

#### Scenario: 最近一轮有选定
- **WHEN** 第 2 轮选定了一家 FOB 报价，汇率、海运、关税率、清关参数齐全
- **THEN** 接口返回这一家的落地价、第 2 轮、按询价单首档数量、逐项金额（`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source-db.isolated.test.ts`；`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx`）

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

#### Scenario: 没有财务查看权
- **WHEN** 开关开着、比价矩阵有选定，没有财务键的只读成员读取
- **THEN** 接口不返回这一项，只带 `compareCostHidden`；没有财务查看权时路由不去取比价建议（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`；`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts` 源码断言）

### Requirement: 只建议，人保存才生效
以下只对有财务查看权的人（见 `tender/pricing-helper`「我方成本只给有财务查看权的人」）成立。卡片 SHALL 把建议显示为「来自比价矩阵」一行，写明换算依据与落地价不含 GST/HST（DDP 写以供应商报价为准）。按钮 SHALL 只把数字填进「我方成本」输入框，SHALL NOT 自己保存。读取接口 SHALL NOT 改写已保存的成本；已保存的成本与建议不同时 SHALL 照旧按已保存的计算。人手填的数字 SHALL 始终可以保存并覆盖建议。

#### Scenario: 点按钮之后没有保存
- **WHEN** 人点了「用这个作为我方成本」，没有点保存
- **THEN** 输入框里是建议的数字，已保存的成本与情景表不变（`compare-cost-source.test.tsx`；`compare-cost-source-db.isolated.test.ts`）

#### Scenario: DDP 与换算依据
- **WHEN** 建议是一家 DDP 报价；或建议带汇率、关税的换算依据
- **THEN** DDP 不写「不含 GST/HST」，写以供应商报价为准；换算依据显示在逐项下面（`compare-cost-source.test.tsx`）

#### Scenario: 已有手填的成本
- **WHEN** 已保存的成本是手填的 90,000，建议是 84,500
- **THEN** 读取后已保存的成本仍是 90,000，情景表按 90,000 计算（`compare-cost-source-db.isolated.test.ts`）

### Requirement: 来源由服务端核对后才记
以下只对有财务查看权的人（见 `tender/pricing-helper`「我方成本只给有财务查看权的人」）成立。保存时请求声明成本来自比价矩阵，服务端 SHALL 按当前登录者有权访问的项目重新取选定的那一条报价并重新换算；只有保存的成本与重新算出的落地价相同（到分）时，SHALL 在既有的 `pricingInputs` JSON 里记来源：轮次、询价与报价条目 id、当时的落地价、数量口径、时间。否则成本数字变了 SHALL 记为手填，没变 SHALL 保留原来的来源。请求里的组织、金额、条目 id SHALL NOT 绕过服务端核对；别的项目或别的组织的条目 SHALL NOT 被记为来源。

#### Scenario: 数字相同
- **WHEN** 人点按钮后直接保存
- **THEN** 已保存的成本带来源：第 N 轮、那一条报价、落地价、数量口径（`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 改过数字、或伪造来源
- **WHEN** 人点按钮后把数字改了再保存；或请求声明来源却给了别的金额、别的项目或别的组织的条目、没有选定的条目
- **THEN** 成本照常保存，来源记为手填（`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 别的组织的人
- **WHEN** 别的组织的人读取或保存
- **THEN** 403，什么都不改（`compare-cost-source-db.isolated.test.ts`）

### Requirement: 矩阵变了只提示
以下只对有财务查看权的人（见 `tender/pricing-helper`「我方成本只给有财务查看权的人」）成立。已保存的成本带来源、而现在的建议与它不同（换了选定、换了轮次、落地价变了）时，读取接口 SHALL 返回一句提示，写明现在的落地价与已保存的成本；SHALL NOT 自动改写成本。没有来源（手填）时 SHALL NOT 有这句提示。

#### Scenario: 选定换了一家
- **WHEN** 成本按 A 家保存后，人把选定改为 B 家
- **THEN** 卡片提示比价矩阵现在是 B 家的落地价，已保存的成本仍是 A 家的（`compare-cost-source-db.isolated.test.ts`；`compare-cost-source.test.tsx`）

### Requirement: 毛利率与成本加成写清楚
卡片 SHALL 把毛利列（只对有财务查看权的人显示）与目标毛利写作「毛利率（按售价）」（没有财务查看权、开关开着时目标毛利的写法与成本加成提示照旧），并在目标毛利旁显示等价的成本加成率（m ÷ (1 − m)）。计算 SHALL NOT 改变。

#### Scenario: 目标毛利 20%
- **WHEN** 目标毛利填 20
- **THEN** 旁边显示「相当于成本加成 25%」，情景表数字与改动前相同（`compare-cost-source.test.tsx`）

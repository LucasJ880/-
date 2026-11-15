## Purpose
规定报价表助手怎样从比价矩阵取「我方成本」：只取人工选定的那一家、只建议不自动覆盖、来源由服务端核对后才记、数字变了只提示，以及落地价含什么、不含什么。

## ADDED Requirements

### Requirement: 来自比价矩阵的成本建议
开关对项目的组织开启时，报价表助手的读取接口 SHALL 返回一项成本建议：项目里最近一轮有人工选定（`isSelected`）且已报价的询价，用比价矩阵同一套换算算出那一家的落地价（CAD），带供应商名、轮次、数量口径、逐项金额与换算假设。没有选定时 SHALL 返回「还没有选定」的说明；换算不出落地价时 SHALL 返回原因，SHALL NOT 给出数字。SHALL NOT 用推荐或最低价代替选定。

#### Scenario: 最近一轮有选定
- **WHEN** 第 2 轮选定了一家 FOB 报价，汇率、海运、关税率、清关参数齐全
- **THEN** 接口返回这一家的落地价、第 2 轮、按询价单首档数量、逐项金额（`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source-db.isolated.test.ts`；`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx`）

#### Scenario: 最近一轮没有选定、更早一轮有
- **WHEN** 第 3 轮还没有选定，第 2 轮有
- **THEN** 建议来自第 2 轮，并写明之后还有第 3 轮尚未选定（`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 没有选定
- **WHEN** 项目有报价但没有任何一轮选定
- **THEN** 返回「还没有选定」，不给数字，即使矩阵里有推荐或最低价（`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 换算不出落地价
- **WHEN** 选定的那一家缺汇率、缺贸易条款或缺关税率
- **THEN** 返回换算不出的原因，不给数字，卡片上没有填入按钮（`compare-cost-source-db.isolated.test.ts`；`compare-cost-source.test.tsx`）

#### Scenario: 开关关闭
- **WHEN** 开关关闭，或组织不在名单里
- **THEN** 接口不返回这一项，卡片与现在相同（`compare-cost-source-db.isolated.test.ts`；`compare-cost-source.test.tsx`）

### Requirement: 只建议，人保存才生效
卡片 SHALL 把建议显示为「来自比价矩阵」一行，并写明落地价不含 GST/HST。按钮 SHALL 只把数字填进「我方成本」输入框，SHALL NOT 自己保存。读取接口 SHALL NOT 改写已保存的成本；已保存的成本与建议不同时 SHALL 照旧按已保存的计算。人手填的数字 SHALL 始终可以保存并覆盖建议。

#### Scenario: 点按钮之后没有保存
- **WHEN** 人点了「用这个作为我方成本」，没有点保存
- **THEN** 输入框里是建议的数字，已保存的成本与情景表不变（`compare-cost-source.test.tsx`；`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 已有手填的成本
- **WHEN** 已保存的成本是手填的 90,000，建议是 84,500
- **THEN** 读取后已保存的成本仍是 90,000，情景表按 90,000 计算（`compare-cost-source-db.isolated.test.ts`）

### Requirement: 来源由服务端核对后才记
保存时请求声明成本来自比价矩阵，服务端 SHALL 按当前登录者有权访问的项目重新取选定的那一条报价并重新换算；只有保存的成本与重新算出的落地价相同（到分）时，SHALL 在既有的 `pricingInputs` JSON 里记来源：轮次、询价与报价条目 id、当时的落地价、数量口径、时间。否则成本数字变了 SHALL 记为手填，没变 SHALL 保留原来的来源。请求里的组织、金额、条目 id SHALL NOT 绕过服务端核对；别的项目或别的组织的条目 SHALL NOT 被记为来源。

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
已保存的成本带来源、而现在的建议与它不同（换了选定、换了轮次、落地价变了）时，读取接口 SHALL 返回一句提示，写明现在的落地价与已保存的成本；SHALL NOT 自动改写成本。没有来源（手填）时 SHALL NOT 有这句提示。

#### Scenario: 选定换了一家
- **WHEN** 成本按 A 家保存后，人把选定改为 B 家
- **THEN** 卡片提示比价矩阵现在是 B 家的落地价，已保存的成本仍是 A 家的（`compare-cost-source-db.isolated.test.ts`；`compare-cost-source.test.tsx`）

### Requirement: 毛利率与成本加成写清楚
卡片 SHALL 把毛利列与目标毛利写作「毛利率（按售价）」，并在目标毛利旁显示等价的成本加成率（m ÷ (1 − m)）。计算 SHALL NOT 改变。

#### Scenario: 目标毛利 20%
- **WHEN** 目标毛利填 20
- **THEN** 旁边显示「相当于成本加成 25%」，情景表数字与改动前相同（`compare-cost-source.test.tsx`）

### Requirement: 不带出不该带的
这一项 SHALL NOT 带出报价邮件正文、供应商联系方式、报价备注原文。读取 SHALL NOT 建审批卡、发信、改选定或询价状态。

#### Scenario: 读取前后什么都没变
- **WHEN** 读取报价表助手接口，返回了建议
- **THEN** 审批卡、询价、报价条目、选定都没有变；返回里没有邮件正文、联系方式、备注原文（`compare-cost-source-db.isolated.test.ts`）

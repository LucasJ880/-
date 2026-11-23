# Spec Delta：tender/research-branches

## Purpose

调研树的三个子代理：条款员在已解析的标书里找等效品、指定品牌、加拿大含量条款并带页码，结果在招标要求页只读可见；往期同标员与同类项目员交回带出处的授标记录；单价、口径、币种与可比度由代码算。

## ADDED Requirements

### Requirement: 条款员只读本项目已解析的标书

条款员 SHALL NOT 发任何搜索或读页请求；它 SHALL 只读本项目与一键分析同一口径的标书文件（排除系统生成文件、非招标文件、没解析好的与空文件）的页文字，SHALL NOT 写任何文件、页、分析运行、要求或事实。没有可用标书时 SHALL 交「未接通：项目里还没有解析好的标书文件，没法查条款」；有标书但没有一页有文字时 SHALL 交「未接通：标书都是扫描件，没有文字可查」。

#### Scenario: 没有标书
- **WHEN** 项目没有解析好的招标文件
- **THEN** 条款一支交「未接通」，搜索、读页、模型请求都是 0（`src/lib/web-reader/__tests__/tree3-research-branches.test.ts`）

#### Scenario: 读真实的页表
- **WHEN** 项目在库里有一份已解析的招标文件，第 7 页写着 Equivalent Products 条款
- **THEN** 条款员读到第 7 页，库里的文件、页、分析记录都不变（`src/lib/tender-research-tree/__tests__/research-branches-db.isolated.test.ts`）

### Requirement: 关键词规则先找段落

条款员 SHALL 先用确定性的关键词规则（英法双语，分等效品、指定品牌 / 不接受替代 / 限制性招标、加拿大 / 本地含量、等效证明四组）在标书页里找命中，每个命中取前后各 300 字成段、同页重叠的合并，按三问轮流取、最多 16 段、合计不超过 12 000 字。一条都没命中时 SHALL NOT 请求模型，三问都交「未写明」。

#### Scenario: 规则命中
- **WHEN** 标书页里分别写着 or approved equal、No substitutes will be accepted、Canadian content、ou l'équivalent、Limited Tendering
- **THEN** 各自命中对应的那一问（`src/lib/tender-research-tree/__tests__/research-branches-pure.test.ts`）

#### Scenario: 两种条款都没有
- **WHEN** 标书里没有任何条款关键词
- **THEN** 三问「未写明」、各有一条澄清问题草稿，模型请求为 0（`tree3-research-branches.test.ts`）

### Requirement: 条款员每棵树最多一次模型请求

有命中时条款员 SHALL 只发一次模型请求（同一次请求里的重试与换备用模型不另算），请求前 SHALL 先记游标；续跑时见到已请求过而没有交单 SHALL NOT 再请求，交「未接通」。剩余时间不到模型超时加 15 秒时 SHALL 先让出、不请求。组织把每支模型请求额度调到 0 时 SHALL NOT 请求，交「到上限」。段落 SHALL 只放在不可信资料块里交给模型。

#### Scenario: 请求过一次后续跑
- **WHEN** 条款员记下请求后、交单前中断，再执行一次
- **THEN** 不再请求模型，交「未接通」（`tree3-research-branches.test.ts`）

### Requirement: 条款判断要有核对过的出处

模型 SHALL 只交三问的答案（加拿大 / 本地含量：要求 / 有加分或优先 / 写明不要求 / 未写明；品牌：指定品牌 / 没有指定品牌 / 未写明；等效品：接受 / 不接受 / 未写明）、引文（段号 + 摘录）与等效证明的摘录。引文 SHALL 段号存在、摘录 12–200 字且逐字（不计空白多少与大小写）出现在该段里；页码与文件名 SHALL 由代码按段号填。不是「未写明」却没有一条核对通过的引文时 SHALL 改成「未写明」并标出处对不上。

#### Scenario: 接受等效品
- **WHEN** 第 7 页的段落写着 equivalent products will be considered，模型答「接受」并引这一句
- **THEN** 结论「接受等效品」，引文带「第 7 页」（`tree3-research-branches.test.ts`）

#### Scenario: 出处对不上
- **WHEN** 模型答「指定品牌」，引的摘录不在段落里
- **THEN** 这一问改为「未写明」并标出处对不上，有澄清问题草稿（`research-branches-pure.test.ts`）

### Requirement: 未写明时给澄清问题草稿

三问里每一问是「未写明」时，条款员 SHALL 给一条固定模板的澄清问题草稿（英文正文 + 中文说明），SHALL NOT 调模型写草稿；不是「未写明」的问 SHALL NOT 给草稿。草稿 SHALL NOT 自动加进澄清问题清单或发出。

#### Scenario: 草稿只给未写明的
- **WHEN** 等效品「接受」、另两问「未写明」
- **THEN** 只有两条草稿（`research-branches-pure.test.ts`）

### Requirement: 子代理出错不编结果

条款员的模型请求失败或交回的内容过不了结构校验时，这一支 SHALL 交「未接通」并写明原因，SHALL NOT 交任何答案、引文或草稿。往期同标员与同类项目员某一轮过不了结构校验时，SHALL NOT 收这一轮的任何事实；连续 3 次失败时这一支交「未接通」，之前已核对收下的事实与记录照常交回。

#### Scenario: 条款员格式不对
- **WHEN** 模型两次都交回不合格式的内容
- **THEN** 条款一支「未接通」，没有答案与草稿（`tree3-research-branches.test.ts`）

### Requirement: 招标要求页只读展示条款结果

招标要求页 SHALL 在投标合规矩阵之后显示「标书条款（调研树）」卡片：本项目最新一棵调研树没有时不显示；在查时写条款员还在查；查完列三问、引文（文件名、页码或单元标签、摘录）、等效证明与未写明的澄清草稿；未接通写原因。卡片与它读的接口 SHALL NOT 写任何数据、改已确认的要求或进关键事实槽位。接口 404 时卡片 SHALL NOT 渲染任何东西。

#### Scenario: 卡片各状态
- **WHEN** 给卡片在查、查完（含出处对不上）、未接通、404 几种数据
- **THEN** 显示的文字与上述一致，404 时什么都不渲染（`src/components/tender-analysis/__tests__/research-clauses-card.test.tsx`）

### Requirement: 调研树读取接口

`GET /api/projects/<id>/research-tree` 的第一步 SHALL 是不带条件地校验项目读权限，失败原样返回；项目没有组织或开关关着时 SHALL 返回 404。成功时 SHALL 返回本项目最新一棵调研树的 Job 号与状态（没有为 `null`）和条款一步的结果（状态、短标签、原因句、条款结论；没有为 `null`）；SHALL NOT 返回金额、网页内容或网址。其它失败 SHALL 返回 500「调研结果暂时读不出来，请稍后再试」。

#### Scenario: 开关关与无权限
- **WHEN** 开关关着读取，或不是项目成员读取
- **THEN** 分别得到 404 与守卫的结果（`research-branches-db.isolated.test.ts`）

#### Scenario: 读到条款结果
- **WHEN** 一棵调研树的条款一步已完成
- **THEN** 返回里有三问与引文，没有金额与网址（同上测试）

### Requirement: 往期同标员先查联邦合同公开数据

往期同标员 SHALL 在第一轮模型请求之前，用从项目名、采购方与类别取出的前 2 个英文检索词查联邦合同公开数据；每次 SHALL 先过外发闸、先记游标、算本支一次搜索。采购方与本项目同一（公司名三档不是无关；本项目没有采购方时全收）的行 SHALL 按日期从近到远取前 5 行转成记录（来源联邦合同公开数据、币种 CAD、带合同编号与查询网址）；全部行 SHALL 只作不可信资料交给模型。外部情报开关没开时 SHALL 跳过并写明。

#### Scenario: 联邦数据有同一采购方的授标
- **WHEN** 数据接口交回 3 行，其中 2 行采购方与本项目同一
- **THEN** 往期同标交回 2 条来自联邦数据的记录，搜索计 1 次（`tree3-research-branches.test.ts`）

### Requirement: 授标记录由代码组装

同一网址、同一组（模型给的组名；没给就按页）的已核对事实 SHALL 由代码组装成一条授标记录，字段带原值与摘录，金额、数量、年份由代码从值解析。往期同标记录 SHALL 有中标方、合同额或往期标名之一；同类记录 SHALL 有合同额或中标方之一；凑不成记录的事实留在事实列表里。每支 SHALL 最多 20 条记录，按网址与组去重。

#### Scenario: 同一页两笔授标
- **WHEN** 一页上两组事实分别是两笔授标
- **THEN** 组装成两条记录，各自的金额与数量不混（`research-branches-pure.test.ts`）

### Requirement: 单价由纯函数算

单价 SHALL 是合同额 ÷ 数量（十进制精确运算、四舍五入到分），币种照合同额的，SHALL NOT 换汇；金额或数量缺、为 0、写成区间或一个值里有两个数时 SHALL 不算单价。

#### Scenario: 验收合成数
- **WHEN** 三条记录分别是 10000 个 / 230000、8000 个 / 200000、12500 个 / 262500
- **THEN** 单价分别为 23.00、25.00、21.00（`research-branches-pure.test.ts`）

### Requirement: 口径由子代理判断、代码核摘录

口径 SHALL 只取含安装、含运费、多年期、多品项四个标签：每个标签 SHALL 有逐字在页上的摘录、且摘录里有对应的提示词，对不上 SHALL 丢弃；一条记录一个标签都没有时口径 SHALL 是「不明」。口径 SHALL NOT 改变单价的算法。

#### Scenario: 口径
- **WHEN** 一条记录的摘录写着 including installation，另一条没有任何口径摘录
- **THEN** 前者「含安装」，后者「不明」（`research-branches-pure.test.ts`）

### Requirement: 币种分写明、推断、数据集与不明

币种 SHALL 按这个顺序定：币种事实或合同额的值与摘录里写明（CAD / C$ / CA$ / CDN$ / Canadian dollars；USD / US$ / U.S. dollars；两种都有算不明）；没写明时按网站推断（.ca → CAD；.gov / .mil / .us → USD）并标「按网站推断」；联邦合同公开数据为 CAD；其余为不明。

#### Scenario: 只写了 $
- **WHEN** 一条授标在某 .ca 政府网站上只写「$230,000」
- **THEN** 币种 CAD、标「按网站推断」（`research-branches-pure.test.ts`）

### Requirement: 可比度四项由纯函数算

每条记录 SHALL 有四项可比度，每项 是 / 否 / 不明：同采购方（公司名三档为同名或建议同一实体）、同规格（项目名与类别的关键词与记录品项的关键词相同的不少于一半、至少 1 个）、数量相近（记录数量 ÷ 项目数量在 0.5 到 2 之间含两端）、近 3 年（截标年份或今年往前 3 年到往后 1 年）；任一方缺数据为不明。分数 SHALL 是「是」的个数（0–4）。

#### Scenario: 可比度表
- **WHEN** 项目 20000 个、截标 2026 年，三条记录分别是 10000 个 2024 年、40001 个 2021 年、没有数量也没有年份
- **THEN** 数量相近依次为 是 / 否 / 不明，近 3 年依次为 是 / 否 / 不明（`research-branches-pure.test.ts`）

# Spec Delta：tender/research-branches

## Purpose

调研树的三个子代理：条款员在已解析的标书里找等效品、限定品牌、加拿大含量条款并带页码，结果在招标要求页只读可见；往期同标员与同类项目员交回带出处的授标记录；单价、口径、币种与可比度由代码算。

## ADDED Requirements

### Requirement: 条款员只读本项目已解析的标书

条款员 SHALL NOT 发任何搜索或读页请求；它 SHALL 只读本项目与一键分析同一口径的标书文件（排除系统生成文件、非招标文件、没解析好的与空文件）的页文字，SHALL NOT 写任何文件、页、分析运行、要求或事实。没有可用标书时 SHALL 交「未接通：项目里还没有解析好的标书文件…」；有标书但没有一页有文字时 SHALL 交「未接通：标书都是扫描件，没有文字可查…」。

#### Scenario: 没有标书
- **WHEN** 项目没有解析好的招标文件
- **THEN** 条款一支交「未接通」，搜索、读页、模型请求都是 0（`src/lib/web-reader/__tests__/tree3-research-branches.test.ts`）

#### Scenario: 读真实的页表
- **WHEN** 项目在库里有一份已解析的招标文件，第 7 页写着 Equivalent Products 条款
- **THEN** 条款员读到第 7 页，库里的文件、页、分析记录都不变（`src/lib/tender-research-tree/__tests__/research-branches-db.isolated.test.ts`）

### Requirement: 关键词规则先找段落

条款员 SHALL 先用确定性的关键词规则（英法双语，分等效品、限定品牌 / 不接受替代 / 限制性招标、加拿大 / 本地含量、等效证明四组）在标书页里找命中：每条规则每页最多取 8 个命中，每个命中取前后各 300 字成段，同页重叠且合并后不超过 900 字的合并；按三问轮流取，最多 16 段、合计不超过 12 000 字。一条都没命中时 SHALL NOT 请求模型，三问都交「未写明」。

#### Scenario: 规则命中
- **WHEN** 标书页里分别写着 or approved equal、No substitutes will be accepted、Canadian content、ou l'équivalent、Limited Tendering、sole source、local suppliers、Equivalents will be accepted
- **THEN** 各自命中对应的那一问（「不接受替代」同时给品牌与等效品两问）（`src/lib/tender-research-tree/__tests__/research-branches-pure.test.ts`）

#### Scenario: 两种条款都没有
- **WHEN** 标书里没有任何条款关键词
- **THEN** 三问「未写明」、各有一条澄清问题草稿，模型请求为 0（`tree3-research-branches.test.ts`）

### Requirement: 条款员每棵树最多一次模型请求

有命中时条款员 SHALL 只发一次模型请求（常量；同一次请求里的重试与换备用模型不另算），请求前 SHALL 先记游标，请求成功后 SHALL 把核对后的整份结论记进游标；续跑时见到已记下的结论 SHALL 原样交回，见到已请求过而没有结论 SHALL 交「未接通」，都 SHALL NOT 再请求。剩余时间不到模型超时加 15 秒时 SHALL 先让出。组织把每支模型请求额度调到 0 时 SHALL NOT 请求，交「到上限」。段落 SHALL 只放在不可信资料块里，正文里仿冒的段号 SHALL 被换掉。

#### Scenario: 请求过一次后续跑
- **WHEN** 条款员记下请求后、交单前中断，再执行一次
- **THEN** 不再请求模型；有记下的结论就原样交回，没有就交「未接通」（`tree3-research-branches.test.ts`）

### Requirement: 条款判断要有核对过的出处

模型 SHALL 只交三问的答案（加拿大 / 本地含量：要求 / 有加分或优先 / 写明不要求 / 未写明；品牌：限定品牌，不接受替代 / 不限定（没写品牌，或品牌只作参考）/ 未写明；等效品：接受 / 不接受 / 未写明）、引文（段号 + 摘录）与等效证明的摘录。引文 SHALL 段号存在、摘录 12–200 字且逐字（不计空白多少与大小写）出现在该段里；存下的 SHALL 是段落里的原文，页码与文件名 SHALL 由代码按段号填。不是「未写明」却没有核对通过的引文时 SHALL 改成「未写明」并标出处对不上；「限定品牌」与「接受等效品」同时成立时 SHALL 标出矛盾。

#### Scenario: 接受等效品
- **WHEN** 第 7 页的段落写着 equivalent products will be considered，模型答「接受」并引这一句
- **THEN** 结论「接受等效品」，引文带「第 7 页」（`tree3-research-branches.test.ts`）

#### Scenario: 出处对不上
- **WHEN** 模型答「限定品牌」，引的摘录不在段落里
- **THEN** 这一问改为「未写明」并标出处对不上，有澄清问题草稿（`research-branches-pure.test.ts`）

#### Scenario: 引文存原文
- **WHEN** 模型交的摘录全是大写、多了换行
- **THEN** 存下的是标书里的原文写法（`research-branches-pure.test.ts`）

### Requirement: 未写明时给澄清问题草稿

三问里每一问是「未写明」时，条款员 SHALL 给一条固定模板的澄清问题草稿（英文正文 + 中文说明），SHALL NOT 调模型写草稿；不是「未写明」的问 SHALL NOT 给草稿。草稿 SHALL NOT 自动加进澄清问题清单或发出。

#### Scenario: 草稿只给未写明的
- **WHEN** 等效品「接受」、另两问「未写明」
- **THEN** 只有两条草稿（`research-branches-pure.test.ts`）

### Requirement: 子代理出错不编结果

条款员的模型请求失败或交回的内容过不了结构校验时，这一支 SHALL 交「未接通」并写明原因，SHALL NOT 交任何答案、引文或草稿。往期同标员与同类项目员某一轮过不了结构校验时，SHALL NOT 收这一轮的任何事实；连续 3 次失败时这一支 SHALL 停下：一条记录都没有就交「未接通」；之前已核对收下的记录照常交回、状态按记录数，原因里 SHALL 写明「未接通：模型暂时不可用」。

#### Scenario: 条款员格式不对
- **WHEN** 模型两次都交回不合格式的内容
- **THEN** 条款一支「未接通」，没有答案与草稿（`tree3-research-branches.test.ts`）

#### Scenario: 有记录后模型不可用
- **WHEN** 同类项目一支收下记录后，模型连续 3 次交回不合格式的内容
- **THEN** 状态「查到」，原因里有「未接通：模型暂时不可用」（`tree3-research-branches.test.ts`）

### Requirement: 招标要求页只读展示条款结果

招标要求页 SHALL 在投标合规矩阵之后显示「标书条款（调研树）」卡片：没有调研树时不显示；在查时写「正在查标书条款」并每 15 秒重读、最多 10 分钟；查完列三问、引文（文件名、页码或单元标签原样、原文）、等效品要交的证明、矛盾提示与未写明的澄清草稿；调研停下或未接通写原因；写调研发起时间。卡片与它读的接口 SHALL NOT 写任何数据、改已确认的要求或进关键事实槽位。接口 404、首次读取中或读取出错时 SHALL NOT 渲染任何东西。

#### Scenario: 卡片各状态
- **WHEN** 给卡片在查、查完（含出处对不上与矛盾）、都未写明、未接通、调研停下、404 几种数据
- **THEN** 显示的文字与上述一致，404 时什么都不渲染（`src/components/tender-analysis/__tests__/research-clauses-card.test.tsx`）

### Requirement: 调研树读取接口

`GET /api/projects/<id>/research-tree` 的第一步 SHALL 是不带条件地校验项目读权限，失败原样返回；项目没有组织或开关关着时 SHALL 返回 404。成功时 SHALL 返回本项目最新一棵调研树的 Job 号、状态与发起时间（没有为 `null`）和条款的视图：在查 / 停下了（Job 完成、失败、取消、需要人工处理或步骤停下而条款没有结果，或结果读不出来）/ 查完（状态、短标签、原因句、结论）；SHALL NOT 返回金额、网页内容或网址。其它失败 SHALL 返回 500「调研结果暂时读不出来，请稍后再试」。

#### Scenario: 开关关与无权限
- **WHEN** 开关关着读取，或不是项目成员读取（开关开或关）
- **THEN** 分别得到 404 与守卫的 403（`research-branches-db.isolated.test.ts`）

#### Scenario: 读到条款结果
- **WHEN** 一棵调研树的条款一步已完成
- **THEN** 返回里有三问与引文，没有金额与网址（同上测试）

#### Scenario: 调研停下了
- **WHEN** 调研 Job 被取消、条款一步没有结果
- **THEN** 条款视图是「停下了」，不是「在查」（同上测试）

### Requirement: 往期同标员先查联邦合同公开数据

往期同标员 SHALL 在第一轮模型请求之前，用从项目名、采购方与类别取出的前 2 个英文检索词查联邦合同公开数据；每次 SHALL 先过外发闸、先记游标、算本支一次搜索，SHALL 有从发出到读完正文的超时；出错、超时或额度不够时 SHALL 写明并接着用搜索与读页。采购方同一（三档不是无关；本项目没有采购方时全收）、规格不是明显不同的行 SHALL 按日期从近到远转成记录，全支最多 5 条，记录号按合同编号；全部行 SHALL 只作不可信资料交给模型，直到模型第一次交回可用的决定。

#### Scenario: 联邦数据有同一采购方的授标
- **WHEN** 两个检索词各查一次，都交回同一份同采购方的椅子合同（查询网址不同）与一份同部门的 IT 咨询合同
- **THEN** 往期同标交回 1 条来自联邦数据的记录，搜索计 2 次，两行都在交给模型的不可信资料块里（`tree3-research-branches.test.ts`）

### Requirement: 授标记录由代码组装

同一网址、同一组的已核对事实 SHALL 由代码组装成一条授标记录，字段带原值与摘录，金额、数量、年份由代码从值解析。组名 SHALL 先归一（小写、空白换连字符、只留字母数字下划线连字符，清完是空的用原文的哈希；截短或去掉过字符的 SHALL 带按小写、空白归一后的写法算的哈希，不同的组名 SHALL NOT 并成一组）；同一页没写组名的采购方与币种 SHALL 补到这一页各组缺这一项的记录上。往期同标记录 SHALL 有中标方、合同额或往期标名之一；同类记录 SHALL 有合同额或中标方之一；凑不成记录的事实留在事实列表里。每支 SHALL 最多 20 条记录，按记录号去重。

#### Scenario: 同一页两笔授标
- **WHEN** 一页上两组事实分别是两笔授标（组名 Lot 1、Lot 2）
- **THEN** 组装成两条记录，各自的金额与数量不混（`research-branches-pure.test.ts`、`tree3-research-branches.test.ts`）

#### Scenario: 组名截短或去掉符号后相同
- **WHEN** 两组的组名是「Contract 2024-001」与「Contract 2024-002」，或「Lot 1/2」与「Lot 12」
- **THEN** 组键不同，不并成一条；「CONTRACT 2024-001」与「Contract 2024-001」照并（`research-branches-pure.test.ts`）

### Requirement: 单价由纯函数算

单价 SHALL 是合同额 ÷ 数量（十进制精确运算、四舍五入到分），币种照合同额的，SHALL NOT 换汇；金额或数量缺、为 0、写成区间、一个值里有两个数、认不清的写法（点做千分位、只有一个点且点后三位）、减项（负号、括号）、数量的单位认不清（m、mm）或单价不到半分时 SHALL 不算单价。金额与数量 SHALL 认千分位、空格千分位（最后一组紧跟字母时不算）、法文小数与 k / thousand / million / 万 / 亿 等倍数。

#### Scenario: 验收合成数
- **WHEN** 三条记录分别是 10000 个 / 230000、8000 个 / 200000、12500 个 / 262500
- **THEN** 单价分别为 23.00、25.00、21.00（`research-branches-pure.test.ts`）

#### Scenario: 写法边界
- **WHEN** 金额写「1,25 million $」、数量写「1.5 million bags」「500 240L carts」「5 m of fence」
- **THEN** 依次认成 1250000、1500000、不认、不认（`research-branches-pure.test.ts`）

#### Scenario: 认不清的写法与减项
- **WHEN** 金额写「$1.000.000」「-$230,000」「– 230 000 $」「(230 000 $)」，数量写「10.000 units」
- **THEN** 都不认，不算单价；「Total - $230,000」照认 230000（`research-branches-pure.test.ts`）

### Requirement: 口径由子代理判断、代码核摘录

口径 SHALL 只取含安装、含运费、多年期、多品项四个标签：每个标签 SHALL 有逐字在页上的摘录、且摘录里有对应的提示词（多年期要写出两年以上的合同期、起止不同的年份或 multi-year，保修年限与财年不算；含运费要写到运费、FOB / DDP、供货并送货或含送货，只写交货时间或写明不含运费的不算；多品项要写出复数的品项 / 批次或 various / assorted 一类），对不上 SHALL 丢弃；一条记录一个标签都没有时口径 SHALL 是「不明」。口径 SHALL NOT 改变单价的算法。

#### Scenario: 口径
- **WHEN** 一条记录的摘录写着 supply and installation，另一条没有任何口径摘录；还有一条标「多年期」的摘录只写着 an amount of
- **THEN** 前者「含安装」，第二条「不明」，第三条的标签被丢弃（`research-branches-pure.test.ts`）

#### Scenario: 一年与交货时间不算
- **WHEN** 标「多年期」的摘录写着 1-year warranty、2-year warranty 或 2024 to 2024，标「含运费」的摘录只写着 delivered by March
- **THEN** 这几个标签都被丢弃；摘录写 Supply and delivery of… 或 y compris la livraison 的「含运费」照收（`research-branches-pure.test.ts`）

### Requirement: 币种分写明、推断、数据集与不明

币种 SHALL 按这个顺序定：联邦合同公开数据为 CAD；合同额的值与摘录里写明的（CAD / C$ / CA$ / CDN$ / $ CA / Canadian dollars；USD / US$ / $US / U.S. dollars / dollars américains）——写的是别的币种（€ / £ / EUR / AU$ 等）、两种都写了，或与币种事实不一致，SHALL 记为不明、不再推断；只有币种事实写明的照它；都没写明时按网站推断（.ca → CAD；.gov / .mil / .us → USD）并标「按网站推断」；其余为不明。

#### Scenario: 只写了 $
- **WHEN** 一条授标在某 .ca 政府网站上只写「$230,000」
- **THEN** 币种 CAD、标「按网站推断」（`research-branches-pure.test.ts`）

#### Scenario: 两处写的不一样
- **WHEN** 合同额写「US$230,000」，同组的币种事实写 CAD
- **THEN** 币种不明（`research-branches-pure.test.ts`）

#### Scenario: .ca 网站上写的是欧元
- **WHEN** 一条授标在 .ca 网站上写「€230,000」或「230 000 $ US」
- **THEN** 前者币种不明、不按网站推断成 CAD，后者是写明的 USD；「230 000 $ CA」认成 CAD（`research-branches-pure.test.ts`）

### Requirement: 可比度四项由纯函数算

每条记录 SHALL 有四项可比度，每项 是 / 否 / 不明：同采购方（公司名三档为同名或建议同一实体）、同规格（项目名与类别的关键词与记录品项、往期标名的关键词相同的不少于一半、至少 1 个）、数量相近（记录数量 ÷ 项目数量在 0.5 到 2 之间含两端）、近 3 年（截标年份或今年往前 3 年到往后 1 年）；任一方缺数据为不明。分数 SHALL 是「是」的个数（0–4）。

#### Scenario: 可比度表
- **WHEN** 项目 20000 个、截标 2026 年，三条记录分别是 10000 个 2024 年、40001 个 2021 年、没有数量也没有年份
- **THEN** 数量相近依次为 是 / 否 / 不明，近 3 年依次为 是 / 否 / 不明（`research-branches-pure.test.ts`）

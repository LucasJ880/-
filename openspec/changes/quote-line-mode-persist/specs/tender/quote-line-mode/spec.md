# Spec Delta

## Purpose

「标书与报价」新页面 ② 定报价里的「逐行报价」：招标方有价格表、每行填单价的标，逐行录入供应商报价与共用参数，成本存进报价引擎的成本行，所有数取报价引擎一套算法的结果。

## ADDED Requirements

### Requirement: 新建报价先问怎么交价与业务类型
新页面开着、看得到金额且有报价编辑权限的人在 ② 新建报价时，系统 SHALL 先问「这个标怎么交价？」与「业务类型」（只供货、供货加安装、长期供货协议，默认只供货）。选逐行报价且只供货时 SHALL 新建一份逐行报价（只供货报价、按售价毛利定价、报价配置里记做法为逐行），并在同一次写入里建好货品行（有可用价格表时）、四条共用参数行与四条预置行；选另两种业务时 SHALL 照改版前的模板新建、不记做法，并打开专业模式。

#### Scenario: 逐行 + 只供货
- **WHEN** 项目有校验通过的价格表（3 行），有编辑权限且有财务查看权的人选逐行报价、只供货
- **THEN** 新报价是只供货报价，报价配置的做法为逐行，有 3 条货品成本行、4 条共用参数行、4 条预置行，审计里有一条新建报价（`npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 供货加安装
- **WHEN** 选业务类型「供货加安装」
- **THEN** 新报价与改版前同一模板、配置里没有做法，返回专业模式的地址（同一测试）

### Requirement: 做法记在报价配置里，旧报价按专业模式打开
报价配置 SHALL 接受可选的做法字段（逐行）；没有这个字段的配置 SHALL 解析得与改版前相同。没有做法字段的报价 SHALL 在新页面上显示为「专业模式」并链到专业模式页。专业模式保存引擎配置与另起新版 SHALL 保留做法字段。

#### Scenario: 旧配置不受影响
- **WHEN** 用改版前的多种配置（空、只有税、长期供货协议的配置、含未知键）解析
- **THEN** 结果与去掉做法字段的旧校验逐字段相同（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

#### Scenario: 专业模式保存后做法还在
- **WHEN** 逐行报价经专业模式的保存（引擎配置传空对象）与另起新版
- **THEN** 两份报价的做法都还是逐行（`npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

### Requirement: 逐行表的列与行来源
逐行表 SHALL 有 7 列：品名、数量、供应商报价（原币）、到手单位成本（加元）、我方单价、行合计、毛利率。行 SHALL 来自投标工作区已保存且校验通过的价格表；没有时 SHALL 可以从招标分析带入到粘贴框（由人核对后导入）、粘贴或手加行。单位 SHALL 从价格表单位里选；行数上限 300；删行后行号从 1 起连续重排。

#### Scenario: 表头与行
- **WHEN** 渲染一份有 2 行的逐行报价
- **THEN** 表头依次是那 7 列，两行的品名与数量照价格表（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

#### Scenario: 粘贴有问题的行
- **WHEN** 粘贴的文本里有一行数量不是数字
- **THEN** 那一行不导入，并写明第几行、什么问题；其它行导入（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

### Requirement: 共用参数与四项预置
逐行报价 SHALL 有共用参数：每种出现的币一个汇率（含来源）、海运费（柜数 × 每柜）、报关费、关税率、国内运费；以及四项预置：资金使用（年化 8%、1 个月）、管理费（自含 3%）、现金备用金 1%、提成（毛利的 30%），每项可改、可关，旁边一句话写出真实算法；以及目标毛利率（按售价）。预置的计算方式、比例与月数 SHALL 与专业模式只供货模板相同。空着的共用参数 SHALL 不计入，而不是按 0 计入。

#### Scenario: 预置与模板相同
- **WHEN** 新建逐行报价
- **THEN** 四条预置行的类别、计算方式、比例、月数与只供货模板的对应行逐项相同（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

#### Scenario: 说明写真实算法
- **WHEN** 渲染共用参数区
- **THEN** 管理费的说明含「100 → 103.09」、提成的说明写明计入成本、顶部毛利率比目标低（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

### Requirement: 顶部四个数只取报价引擎的结果
逐行报价顶部 SHALL 显示报价合计、成本合计、利润、毛利率，SHALL 等于对同一组成本行调用报价引擎的卖价、成本、毛利、毛利率；系统 SHALL NOT 另用一套算法算这四个数。引擎算不出时 SHALL 写出引擎给的原因，不显示数。

#### Scenario: 与引擎相同
- **WHEN** 两行（合成数字）加共用参数与预置，目标毛利率 25%
- **THEN** 四个数与直接调用 `computeQuote` 的结果相同（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

#### Scenario: 缺汇率
- **WHEN** 一行报价是人民币、没填人民币汇率
- **THEN** 不显示四个数，写明要先填汇率（同一测试）

### Requirement: 每行的数按引擎结果分摊，差额如实说明
每行的到手成本、我方单价、毛利率 SHALL 按该行货值占全部货品货值的比例从引擎结果分摊；我方单价 SHALL 四舍五入到分，行合计 SHALL 等于单价乘数量。各行到手成本之和 SHALL 等于引擎的到手成本。逐行合计与报价合计不相等时，页面顶部 SHALL 写明差多少、为什么，差额 SHALL 不超过各行数量 × 0.005 之和（数量带小数的行再各加 0.005）。没填报价的行 SHALL 不显示单价。

#### Scenario: 差额不超过上限
- **WHEN** 多组合成数据（含外币、未定价行、其它成本行）
- **THEN** 各行到手成本之和等于引擎，逐行合计与报价合计之差不超过上限（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

#### Scenario: 差额说明
- **WHEN** 逐行合计比报价合计多 0.03
- **THEN** 顶部写「逐行合计 … 比报价合计 … 多 0.03」并说明是每行单价取到分造成、导出用逐行合计（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

### Requirement: 供应商报价从询价回复点选或手填带证据
逐行表的供应商报价 SHALL 可以从本项目已报价的询价回复里点选一家（带入单价与币种，记下是哪一条回复和哪家供应商），也可以手填。手填时 SHALL 必须选证据类别（已签报价、平台标价、零售价、估计），没选 SHALL 拒绝保存并指出是哪一行。只报了总价的回复 SHALL NOT 按数量折算成单价。价格表行有包装数时 SHALL 可以按件报价，保存时换成招标单位价。

#### Scenario: 手填没选证据
- **WHEN** 第 2 行手填了报价、没选证据类别，保存
- **THEN** 400，写明第 2 行要选证据类别，库里没变（`npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 按件报价
- **WHEN** 价格表行每包 10 件，按件报价 2.5 元
- **THEN** 成本行的单价是 25 元，原价与口径留在行身份里（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

### Requirement: 成本存进系统
逐行报价的输入与选择 SHALL 写进报价的成本行（行身份放在成本行的附加信息里，保留其中已有的其它内容）；SHALL NOT 写给客户报价单的明细行、浏览器本地存储或投标工作区。另一位看得到金额的同事 SHALL 读到同样的行、共用参数与结果。

#### Scenario: 换人看到同样的数
- **WHEN** 负责人保存两行报价与共用参数，另一位有财务查看权的同事读取
- **THEN** 读到同样的行、参数与四个数；客户报价单明细行数与投标工作区内容不变（`npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 不写浏览器
- **WHEN** 检查新组件源码
- **THEN** 没有把成本写进浏览器本地存储（只有一个不含金额的「提示过」标记）（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

### Requirement: 逐行保存只动自己管的成本行
逐行保存 SHALL 只新建、更新、删除带逐行行身份的成本行；在专业模式里加的、没有逐行行身份的成本行 SHALL 不被改动并照样计入四个数，页面 SHALL 写明另有几条其它成本行。保存 SHALL 带读取时的修改时间，库里已被别人改过时 SHALL 返回 409 且不写；已冻结的报价 SHALL 返回 409。

#### Scenario: 其它成本行不被碰
- **WHEN** 专业模式里加了一条加拿大境内运费，再在逐行表里保存
- **THEN** 那一条原样还在、计入成本，逐行表写「另有 1 条其它成本行」（`npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 并发
- **WHEN** 两人读到同一版本，先后保存
- **THEN** 后保存的人得到 409，库里是先保存的内容（同一测试）

### Requirement: 逐行报价的接口与权限
逐行报价的接口 SHALL 第一步调用报价权限守卫并紧接着检查（读要内部成本权限、写要编辑权限）；之后新页面开关关、组织不在名单或不是招投标项目时 SHALL 返回 404，再 SHALL 要求财务查看权，否则 403。没有财务查看权的人 SHALL NOT 从这些接口拿到任何成本、供应商报价或金额。

#### Scenario: 各种身份
- **WHEN** 没有财务查看权的成员、只读成员、组织外的人、开关关时分别调用读与写
- **THEN** 前两种 403，组织外的人被拒，开关关 404；响应里没有金额，库里没变（`npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 守卫写法
- **WHEN** 检查新接口每个处理函数的源码
- **THEN** 取参数后第一句是报价权限守卫并紧接着检查，之后先判开关与招投标项目、再判财务查看权（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

### Requirement: 旧的本地成本草稿提示一次、人点了才导入
打开逐行报价时，这台电脑上有旧的本地成本草稿的，页面 SHALL 提示一次「发现这台电脑上有未保存到系统的成本草稿，导入到这份报价？」。人点导入后 SHALL 按行号把供应商报价、口径、币种、证据类别、汇率（以及报价还没填时的目标毛利率）填进表里，并写明没导入的项；SHALL NOT 自动保存或上传；草稿 SHALL NOT 被删除或修改。

#### Scenario: 导入
- **WHEN** 草稿里第 1、2 行有报价，点导入
- **THEN** 表里第 1、2 行带上报价，库里没变，直到人点保存（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts` 与 `npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

### Requirement: 按招标方价格表导出
② 底部 SHALL 有「按招标方价格表导出」：当前我方报价已定且是逐行报价时可用，导出的单价与行合计 SHALL 与逐行表相同；否则 SHALL 不可用并写明原因。导出接口 SHALL 与读接口同一道权限，SHALL 拒绝不是当前我方报价的报价。

#### Scenario: 已定后导出
- **WHEN** 逐行报价已批准并选为我方报价，导出
- **THEN** 得到 CSV，各行单价与合计与逐行表相同（`npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 没定
- **WHEN** 报价还是草稿，调用导出
- **THEN** 409，写明报价定为我方报价后才能导出（同一测试）

### Requirement: 专业模式入口
逐行报价的「更多」里 SHALL 有「专业模式」，打开改版前的报价引擎页面（同一份报价）；不是逐行做的报价 SHALL 在列表里直接链到专业模式。提交、批准、选为我方报价在本能力内 SHALL 仍在专业模式与我方报价卡里做。

#### Scenario: 专业模式链接
- **WHEN** 渲染列表里一份逐行报价与一份专业模式报价
- **THEN** 两者都有指向 `/projects/{id}/quote-engine/{quoteId}` 的入口（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

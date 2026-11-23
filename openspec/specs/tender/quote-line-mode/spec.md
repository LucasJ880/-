# tender/quote-line-mode Specification

## Purpose
「标书与报价」新页面 ② 定报价里的「逐行报价」：招标方有价格表、每行填单价的标，逐行录入供应商报价与共用参数，成本存进报价引擎的成本行，所有数取报价引擎一套算法的结果。

## Requirements

### Requirement: 新建报价先问怎么交价与业务类型
新页面开着、看得到金额且有报价编辑权限的人在 ② 新建报价时，系统 SHALL 先问「这个标怎么交价？」与「业务类型」（只供货、供货加安装、长期供货协议，默认只供货）。选逐行报价且只供货时 SHALL 新建一份逐行报价（只供货报价、报价币种加元、按售价毛利定价、报价配置里记做法为逐行），并在同一次写入里建好货品行（有可用价格表时）、四条共用参数行与四条预置行，写一条新建报价的审计；选另两种业务时 SHALL 照改版前的模板新建、不记做法，并返回专业模式的地址。新建接口是 `POST /api/projects/{id}/bid-page/quotes`，成功返回 201 与新报价的标识、做法、专业模式地址；请求里的做法或业务类型不认识时 SHALL 返回 400。

#### Scenario: 逐行 + 只供货
- **WHEN** 项目有校验通过的价格表（2 行），有编辑权限且有财务查看权的人选逐行报价、只供货
- **THEN** 201；新报价是只供货报价、做法为逐行，有 2 条货品成本行、4 条共用参数行、4 条预置行，审计里有一条新建报价（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 供货加安装
- **WHEN** 选业务类型「供货加安装」
- **THEN** 新报价与改版前同一模板、配置里没有做法，返回专业模式的地址（同一测试）

#### Scenario: 没有编辑权限的人
- **WHEN** 看得到金额、没有编辑权限的人打开 ②
- **THEN** 没有「新建报价」，写着「新建、修改报价需要项目编辑权限，请找项目负责人」；调新建接口 403（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx` 与隔离库测试）

### Requirement: 做法记在报价配置里，旧报价按专业模式打开
报价配置 SHALL 接受可选的做法字段（逐行）；没有这个字段的配置 SHALL 解析得与改版前相同（字段与键集合都相同）；不认识的做法值 SHALL 只丢掉这个字段、配置的其它内容照旧。做法字段 SHALL 只由新页面新建逐行报价时写：专业模式保存报价（表头里的引擎配置）SHALL NOT 接受这个字段，库里已有的做法 SHALL 在专业模式保存与另起新版后保留。只有做法为逐行且是只供货报价的才是逐行报价；其余报价 SHALL 在新页面上标为「专业模式」并链到专业模式页。

#### Scenario: 旧配置不受影响
- **WHEN** 用改版前的多种配置（空、只有税、带情景、长期供货协议的配置、含未知键）解析
- **THEN** 结果与去掉做法字段的校验深度相同、键集合相同（不多出做法键）；带不认识的做法值时税与情景照旧（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

#### Scenario: 专业模式保存不收做法字段
- **WHEN** 专业模式保存时请求里带了做法字段（逐行、空、不认识的值），库里原来是逐行报价或不是
- **THEN** 表头解析后没有做法字段；库里原来是逐行的合并后仍是逐行，原来不是的仍不是（同一测试）

#### Scenario: 专业模式保存后做法还在
- **WHEN** 逐行报价经专业模式的保存（引擎配置传空对象）与另起新版
- **THEN** 两份报价的做法都还是逐行（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 不是只供货的报价
- **WHEN** 一份供货加安装或长期供货协议报价的配置里带着做法字段
- **THEN** 不算逐行报价，按专业模式打开（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

### Requirement: 逐行表的列与行来源
逐行表 SHALL 有 7 列：品名、数量、供应商报价（原币）、到手单位成本（加元）、我方单价、行合计、毛利率；表下 SHALL 写明到手单位成本怎么来、行毛利率的口径。行 SHALL 来自投标工作区已保存且校验通过的价格表；没有时 SHALL 可以从招标分析带入到粘贴框（由人核对后导入）、粘贴或加一行。粘贴导入后粘贴框里 SHALL 只去掉已导入的行，没导入的行（缺单位、数量不是数字等）SHALL 留在框里并写明原因。单位 SHALL 从价格表单位里选（保留原文，附中文）；行数上限 300；删行后行号从 1 起连续重排。数量 SHALL 大于 0、最多 4 位小数；数量、供应商报价、行金额、汇率、共用参数超出能存的范围时 SHALL 拒绝保存并指出是哪一项。数字输入框 SHALL 保留人打的字（「12.」「0.」不被改写），填的不是数字时 SHALL 标出并不让保存。

#### Scenario: 表头与行
- **WHEN** 渲染一份有 2 行的逐行报价
- **THEN** 表头依次是那 7 列，两行的品名照状态显示，单位下拉写「Box（盒）」这样的原文加中文，表下有到手单位成本与行毛利率的说明（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

#### Scenario: 粘贴有问题的行
- **WHEN** 粘贴的文本里第 3 行数量写成「十二」、第 5 行没有单位
- **THEN** 这两行不导入，写明第几行有什么问题，并留在粘贴框里；其它行导入（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

#### Scenario: 从招标分析带入的说明
- **WHEN** 招标分析里有 3 行带数量的线索（1 行没单位、1 行与前面重复）、1 条没放进来
- **THEN** 说明写「招标分析里找到 3 行带数量的（其中 1 行没单位，导入前在粘贴框里补上）」、重复与没放进来的条数，以及点按钮填进粘贴框、核对后导入；不提尺寸、认证要求（同一测试）

#### Scenario: 数字输入
- **WHEN** 依次解析「12.」「0.」「12.5」「1,234.5」「-」「abc」
- **THEN** 前四个分别读成 12、0、12.5、1234.5，后两个不合法（同一测试）

#### Scenario: 数量位数与范围
- **WHEN** 数量填 2.12345、0.00004、2.1235；数量 10 亿、供应商报价 10 亿、数量 × 单价超过一万亿、汇率 100 万
- **THEN** 前两个指出「数量最多 4 位小数」，2.1235 可以；其余分别指出数量、供应商报价、行金额、汇率太大（同一测试）

### Requirement: 共用参数与四项预置
逐行报价 SHALL 有共用参数：每种出现的外币一个汇率（含来源）、海运费（柜数 × 每柜）、报关费、关税率、国内运费；以及四项预置：资金使用（年化 8%、1 个月）、管理费（含自身 3%）、现金备用金 1%、销售提成（毛利的 30%），每项可改、可关，旁边一句话写出真实算法；以及目标毛利率（按售价）。预置的类别、计算方式、比例与月数 SHALL 与专业模式只供货模板相同。空着的共用参数（以及柜数为 0 的海运费）SHALL 不计入，而不是按 0 计入；柜数为 0 时填过的每柜金额 SHALL 照样显示。页面 SHALL 写明共用参数算进报价合计、按货值分到各行；目标毛利率空着时 SHALL 写明按 0% 算。

#### Scenario: 预置与模板相同
- **WHEN** 新建逐行报价
- **THEN** 四条预置行的类别、计算方式、比例、月数、是否计入与只供货模板的对应行逐项相同（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

#### Scenario: 说明写真实算法
- **WHEN** 渲染共用参数与预置区
- **THEN** 管理费的说明含「100 → 103.09」、销售提成的说明写明算进成本、定价写「报价 = 不含销售提成的成本 ÷（1 − 目标毛利率）」并写明专业模式里按售价算的费用会再从分母里减去、共用参数写明算进报价合计（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

#### Scenario: 柜数为 0
- **WHEN** 海运柜数填 0、每柜 3,000，保存后再读
- **THEN** 柜数空着（不计入），每柜 3,000 照样显示（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

### Requirement: 顶部四个数只取报价引擎的结果
逐行报价顶部 SHALL 显示报价合计、成本合计、利润、毛利率，SHALL 等于对同一组成本行调用报价引擎的卖价、成本、毛利、毛利率；系统 SHALL NOT 另用一套算法算这四个数。引擎算不出时 SHALL 用中文写出原因与下一步，不显示数；引擎的其它报错（多半来自专业模式里加的行）SHALL 写成叫人去专业模式检查，不照搬引擎原文。销售提成计入且比例大于 0 时 SHALL 写明顶部毛利率已扣销售提成、比目标毛利率低。

#### Scenario: 与引擎相同
- **WHEN** 两行合成报价（人民币 50 × 100、按件 30 × 每包 10 × 20 包）、汇率 0.19、海运 1 柜 3,000、报关 250、国内运费 1,500 人民币、关税 8%、模板预置、目标毛利率 25%
- **THEN** 四个数与直接调用报价引擎相同：报价 8,092.08、成本 6,675.97、利润 1,416.11（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

#### Scenario: 缺汇率
- **WHEN** 有人民币报价的行、没填人民币汇率
- **THEN** 不显示四个数，写明要先填汇率（同一测试）

#### Scenario: 关掉销售提成
- **WHEN** 销售提成关着，或目标毛利率空着
- **THEN** 不写「比目标毛利率低」；目标毛利率空着时写「目标毛利率还没填，按 0% 算」（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

### Requirement: 每行的数按引擎结果分摊，差额如实说明
每行的到手成本、我方单价、毛利率 SHALL 按该行货值占全部已报价货品货值的比例从引擎结果分摊；我方单价 SHALL 四舍五入到分，行合计 SHALL 等于单价乘数量；到手单位成本不到 1 元时 SHALL 显示到 4 位小数。各行到手成本之和 SHALL 等于引擎的到手成本。逐行合计与报价合计不相等时，页面顶部 SHALL 写明差多少、为什么、最多差多少、系统记的是哪一个、导出用哪一个，差额 SHALL 不超过各行数量 × 0.005 之和（数量带小数的行再各加 0.005）。没填报价的行 SHALL 不显示单价；报价填 0 的行 SHALL 显示单价 0、行合计 0 并能导出。

#### Scenario: 合成数字
- **WHEN** 上一条的两行合成报价
- **THEN** 我方单价 36.78 与 220.69，行合计 3,678.00 与 4,413.80，逐行合计 8,091.80 比报价合计少 0.28，上限 0.60（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

#### Scenario: 不变量
- **WHEN** 60 组随机合成数据（外币、小数数量、未定价行、其它成本行）
- **THEN** 各行到手成本之和等于引擎，逐行合计与报价合计之差不超过上限，行合计等于单价乘数量（同一测试）

#### Scenario: 报价填 0 的行
- **WHEN** 在两行合成报价上再加一行报价 0 加元 × 5
- **THEN** 那一行单价 0.00、行合计 0.00、导出单价 0.00；前两行单价不变（同一测试）

#### Scenario: 差额说明
- **WHEN** 渲染逐行合计比报价合计少 0.28 的报价
- **THEN** 顶部写「逐行合计 8,091.80 加元 比报价合计 8,092.08 加元 少 0.28 加元」，说明是每行单价四舍五入到分再乘数量造成、最多差 0.60 加元、系统记的我方报价是报价合计、导出给招标方的价格表用逐行合计（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

### Requirement: 供应商报价从询价回复点选或手填带证据
逐行表的供应商报价 SHALL 可以从本项目已报价的询价回复里点选一家（带入单价与币种，记下是哪一条回复；供应商取自库里的回复，不取提交的），也可以手填。手填时 SHALL 必须选证据类别（已签报价、平台标价、零售价、估计），没选 SHALL 拒绝保存并指出是哪一行。手填的行 SHALL NOT 采用提交里带的供应商：只沿用库里同一条货品行原有的（那一行原来也不是点选来的），否则为空；点选的行改成手填后 SHALL 不再记那家供应商。点选的行价或币种与回复不一致、或选的回复不是本项目已报价的那一条时 SHALL 拒绝保存。只报了总价的回复、币种用不了的回复 SHALL NOT 能点选，并写明原因；只报了总价的 SHALL NOT 按数量折算成单价。价格表行有包装数时 SHALL 可以按件报价，保存时换成招标单位价；按件但这一行不能按件时 SHALL 仍能改回按招标单位。

#### Scenario: 手填没选证据
- **WHEN** 第 1 行手填了报价、没选证据类别，保存
- **THEN** 400，写明「第 1 行的供应商报价是手填的，要选证据类别」，库里没变（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 点选后改了价
- **WHEN** 第 2 行点选了 30 元的回复、提交时改成 31
- **THEN** 400「和选中的询价回复对不上」，库里没变（同一测试）

#### Scenario: 手填行带了供应商
- **WHEN** 手填的第 1 行在请求里带了供应商 id 与名字；另起新版后把点选的第 2 行改成手填 25 元；专业模式里给手填的第 1 行填了供应商名字后再逐行保存
- **THEN** 第 1 行库里没有供应商；第 2 行的供应商 id 与名字都清掉；专业模式填的名字照留，不用请求里的（同一测试）

#### Scenario: 按件报价
- **WHEN** 价格表行每包 10 件，按件报价 30 元
- **THEN** 成本行的单价是 300 元，供应商是库里那条回复的供应商（同一测试）；原价与口径留在行身份里（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

### Requirement: 成本存进系统
逐行报价的输入与选择 SHALL 写进报价的成本行（行身份放在成本行的附加信息里，保留其中已有的其它内容）；SHALL NOT 写给客户报价单的明细行、浏览器本地存储（只有一个不含金额的「提示过」标记）或投标工作区。另一位看得到金额的同事 SHALL 读到同样的行、共用参数与结果。

#### Scenario: 换人看到同样的数
- **WHEN** 负责人保存两行报价与共用参数，另一位有财务查看权的同事读取
- **THEN** 读到同样的行、参数与四个数；客户报价单明细行数为 0、投标工作区内容不变（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 不写浏览器
- **WHEN** 检查新组件源码
- **THEN** 只往本地存储写一个不含金额的「提示过」标记（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

### Requirement: 逐行保存只动自己管的成本行
逐行保存（`PUT /api/projects/{id}/bid-page/quotes/{quoteId}/line`）SHALL 只新建、更新、删除带逐行行身份的成本行；在专业模式里加的、没有逐行行身份的成本行 SHALL 不被改动并照样计入四个数，页面 SHALL 写明另有几条其它成本行、标了金额的已算进报价合计和成本合计。提交里的行 id 不是这份报价的货品行时 SHALL 当作新行，原来那一行不动。保存 SHALL 带读取时的修改时间，库里已被别人改过时 SHALL 返回 409 且不写，界面 SHALL 写明这次的修改还在框里、怎么看最新内容；已冻结（已批准等）的报价 SHALL 返回 409 并写出状态名；校验不过 SHALL 返回 400 并在说明里指到第几行。保存成功 SHALL 写一条报价修改的审计（带做法与行数）。

#### Scenario: 其它成本行不被碰
- **WHEN** 专业模式里加了一条加拿大境内运费 400，再在逐行表里保存
- **THEN** 那一条原样还在、计入成本（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）；读回写「另有 1 条其它成本行」并列出 400（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

#### Scenario: 行 id 指向不是货品的行
- **WHEN** 提交的一行带着同一份报价里一条预置行的 id
- **THEN** 新建一条货品行，那条预置行仍是预置行（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 并发
- **WHEN** 拿读取时的旧修改时间保存
- **THEN** 409「这份报价刚被别人改过」，不写（同一测试）

#### Scenario: 已冻结
- **WHEN** 报价已批准，再逐行保存
- **THEN** 409，写明「这份报价「已批准」，内容锁定」（同一测试；`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

#### Scenario: 审计
- **WHEN** 逐行保存两行报价成功
- **THEN** 审计里有一条报价修改，带做法为逐行、行数 2（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

### Requirement: 与专业模式改同一份报价
同一份逐行报价在专业模式里改过时，逐行读取 SHALL 按改后的读出（供应商报价、品名）并提示；同一币种不同汇率 SHALL 读第一个并提示保存后统一；专业模式里加的其它成本行用了另一个汇率时 SHALL 提示、逐行保存不改它；海运行的数量被改过时 SHALL 按「数量 × 柜数」读成柜数并提示，原样保存后金额不变；货品行被设成不计入、货品或共用参数 / 预置行的类别或算法被改、共用参数或预置行被删、定价方式被改成成本加成时，SHALL 提示在这里保存会改回。定价方式被改过且目标毛利率空着时，逐行保存 SHALL 返回 400「请先填目标毛利率」且不写。报价币种被改成加元以外时，逐行读、存、导出 SHALL 返回 409 并叫去专业模式。

#### Scenario: 专业模式改了单价与算法
- **WHEN** 专业模式里改了第 1 行单价、把它设成不计入、改了关税的基数
- **THEN** 逐行读出改后的单价并提示，提示第 1 行会重新计入、关税会改回原来的算法（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

#### Scenario: 专业模式改了海运数量与其它行的汇率
- **WHEN** 专业模式把海运行的数量改成 2；另加一条人民币汇率 0.2 的其它成本行（逐行表里是 0.19）
- **THEN** 读成 2 柜并提示，原样保存后报价不变；提示那条其它行用的汇率不一样、在这里保存不会改它（同一测试）

#### Scenario: 改了定价方式
- **WHEN** 专业模式改成成本加成 10%，逐行读取后不填目标毛利率就保存
- **THEN** 读取时目标毛利率空着并提示；保存 400、库里没变；填 20% 再保存后定价方式是按售价毛利 20%（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 改了币种
- **WHEN** 专业模式把报价币种改成美元
- **THEN** 逐行读、存都 409，说明里有「美元（USD）」并叫去专业模式；列表照实写出美元（同一测试）

### Requirement: 逐行报价的接口与权限
逐行报价的五个接口（`GET` / `POST /api/projects/{id}/bid-page/quotes`、`GET` / `PUT …/{quoteId}/line`、`GET …/{quoteId}/export`）SHALL 第一步调用报价权限守卫并紧接着检查（读与导出要内部成本权限、新建与保存要编辑权限）；之后新页面开关关、组织不在名单、报价引擎没开或不是招投标项目时 SHALL 返回 404（在读请求体、读写库之前），再 SHALL 要求内部成本权限与财务查看权，否则 403。没有财务查看权的人 SHALL NOT 从这些接口拿到任何成本、供应商报价、品名或金额。地址里的报价不属于这个项目时，读与存 SHALL 返回 404、导出 SHALL 返回 409，都不带内容。不是逐行报价时读逐行视图 SHALL 返回 409 并叫去专业模式。

#### Scenario: 各种身份
- **WHEN** 没登录、开关关、组织不在名单、报价引擎没开、有编辑权没有财务查看权的成员、只读成员、组织外的人分别调用
- **THEN** 401 / 404 / 404 / 404 / 403 / 403 / 被拒；被拒的响应里没有金额与品名，被拒的写请求前后库里的成本行一行没变（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 开关关时的写接口
- **WHEN** 新页面开关没开，调新建、读、存、导出
- **THEN** 都 404「新版标书与报价页未启用」，库里没多出报价（同一测试）

#### Scenario: 跨项目
- **WHEN** 拿 A 项目的报价走 B 项目的地址读、存、导出；在 B 项目的报价里点选 A 项目的询价回复
- **THEN** 404 / 404 / 409，没有内容、库里不变；点选别的项目的回复 400、库里不变（同一测试）

#### Scenario: 有财务查看权的只读成员
- **WHEN** 有财务查看权、只读的成员读与存
- **THEN** 能读、保存 403（同一测试）

#### Scenario: 守卫写法
- **WHEN** 检查五个处理函数与接口门的源码
- **THEN** 取参数后第一句是报价权限守卫并紧接着检查，之后先判开关与招投标项目、再判内部成本权限与财务查看权（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`；`npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts`）

#### Scenario: 不是逐行报价
- **WHEN** 读一份供货加安装报价的逐行视图
- **THEN** 409，说明里叫去专业模式（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

### Requirement: 报价列表
报价列表（`GET /api/projects/{id}/bid-page/quotes`）SHALL 返回每份报价的名称、编号、版本、状态、做法、币种、报价合计、是否我方报价、专业模式地址，以及能否编辑、可用价格表行数、能否导出（不能时的原因）；金额 SHALL 按每份报价自己的币种写。报价没有名称时 SHALL 显示业务类型加报价编号，SHALL NOT 显示内部标题（那里可能是英文类型码）。

#### Scenario: 列表内容
- **WHEN** 渲染一份逐行报价与一份美元的供货加安装报价
- **THEN** 两份都列出做法、版本、状态、报价合计（美元那份写美元）与我方报价标记（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

#### Scenario: 报价显示名
- **WHEN** 一份报价没有名称、编号 Q-1、是供货加安装
- **THEN** 显示「供货加安装报价 · Q-1」；有名称的显示名称（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

### Requirement: 旧的本地成本草稿提示一次、人点了才导入
打开逐行报价时，这台电脑上有旧的本地成本草稿、里面有填了报价的行、表里有按行号对得上的行、且没提示过的，页面 SHALL 提示一次「发现这台电脑上有未保存到系统的成本草稿，导入到这份报价？」；表还是空的时 SHALL NOT 提示。人点导入后 SHALL 按行号把供应商报价、口径、币种（用不了的那一行不带入）、证据类别（草稿没写的按「估计」带入并写明）、汇率（以及报价还没填时的目标毛利率）填进表里；表里已经填了供应商报价的行 SHALL NOT 被覆盖；行不是从存下的价格表来的 SHALL 提示按行号对上、要逐行核对品名；每条说明 SHALL 自己写清楚带入了什么、没带入什么。SHALL NOT 自动保存或上传；草稿 SHALL NOT 被删除或修改；「不导入」SHALL 写明草稿留在这台电脑上、不再提示。

#### Scenario: 要不要提示
- **WHEN** 分别是：有报价的草稿、表里有行且没提示过；已提示过；没有草稿；空草稿；读不出的草稿；表还是空的
- **THEN** 只有第一种提示（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

#### Scenario: 导入
- **WHEN** 草稿里第 1、2 行有报价（第 2 行没写证据类别）、带人民币汇率与 22% 毛利率，报价还没填目标毛利率，点导入
- **THEN** 写「已带入 2 行（第 1、2 行），请核对后点「保存」」；第 1、2 行带上报价与证据类别（第 2 行按估计并写明），汇率与目标毛利率带上，写明逐行关税率与进口 GST 没带入；原来的状态对象不变（同一测试）

#### Scenario: 已填的行不覆盖
- **WHEN** 表里第 1 行已有供应商报价 60，草稿里第 1 行是 48.5
- **THEN** 第 1 行仍是 60，写明第 1 行已经有供应商报价、草稿里的没带入；一行都对不上时写「草稿里没有能对上的行……什么都没带入」（同一测试）

### Requirement: 按招标方价格表导出
② 的报价区底部 SHALL 有「按招标方价格表导出」：当前我方报价已定且是逐行报价时可用，否则 SHALL 不可用并写明原因与去哪里做（没定、有新版还没定时写明提交、批准、定为我方报价目前在专业模式里做；我方报价是专业模式做的时写明这里只能导出逐行报价）；导出处 SHALL 写明导出的是逐行表里的行、交出去前与招标方价格表核对。导出接口（`GET /api/projects/{id}/bid-page/quotes/{quoteId}/export`）SHALL 返回 CSV（`text/csv`，附件文件名含报价编号与版本），单价与行合计 SHALL 与逐行表相同；以 = + - @ 或制表符、回车开头的品名 SHALL 在前面加 ' 以免被表格软件当成公式；不是当前我方报价、不是逐行报价、缺单价、引擎算不出时 SHALL 返回 409 并写明原因；没有财务查看权时 SHALL 返回 403。

#### Scenario: 已定后导出
- **WHEN** 逐行报价已批准并选为我方报价，导出
- **THEN** 得到 CSV 附件（`text/csv`，文件名 `price-schedule-<报价编号>-v1.csv`），表头是招标方价格表的列，各行单价、行合计与合计与逐行表相同（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 不能导出的情况
- **WHEN** 报价还是草稿；导出另一份不是我方报价的报价；没有财务查看权的人导出；另起新版后
- **THEN** 409「报价定为我方报价后才能导出」/ 409 / 403 / 我方报价状态是「新版待定」、不可用且原因写「新版还没定」（同一测试）

#### Scenario: 品名像公式
- **WHEN** 品名是「=SUM(A1)」「+1」「-2」「@x」或以制表符开头
- **THEN** 导出时前面多一个 '；普通品名原样（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

### Requirement: 专业模式入口
逐行报价的「更多」里 SHALL 有「用专业模式打开」，打开改版前的报价引擎页面（同一份报价）；列表里逐行报价写「用专业模式打开」，不是逐行做的报价写「在专业模式里打开」，都链到专业模式。提交、批准、选为我方报价在本能力内 SHALL 仍在专业模式里做，逐行报价 SHALL 写明「提交、批准在专业模式里做」。

#### Scenario: 专业模式链接
- **WHEN** 渲染列表里一份逐行报价与一份专业模式报价
- **THEN** 两者都有指向 `/projects/{id}/quote-engine/{quoteId}` 的入口，专业模式报价写「在专业模式里打开」（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

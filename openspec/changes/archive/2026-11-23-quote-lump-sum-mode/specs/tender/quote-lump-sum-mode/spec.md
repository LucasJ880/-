# Spec Delta

## Purpose

「标书与报价」新页面 ② 定报价里的「只报总价」：招标方只要一个总价的标，用一张只列用得上的大项、能填销售税的总价构成表做报价，成本存进报价引擎的成本行，所有数取报价引擎一套算法的结果，并能与逐行报价互转。

## ADDED Requirements

### Requirement: 哪些报价按总价构成表打开
做法为只报总价、业务类型是只供货或供货加安装、报价币种是加元的报价 SHALL 在新页面 ② 里按总价构成表打开。做法为只报总价但业务类型是长期供货协议，或币种在专业模式里改成了别的币种时，SHALL 按专业模式打开：读与存总价视图 SHALL 返回 409 并写明原因与去专业模式。

#### Scenario: 判定
- **WHEN** 分别判定：只报总价 + 只供货；只报总价 + 供货加安装；只报总价 + 长期供货协议；逐行 + 只供货；没有做法字段
- **THEN** 只有前两种是总价报价（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`）

#### Scenario: 币种在专业模式里改了
- **WHEN** 一份总价报价的币种在专业模式里改成美元后读总价视图
- **THEN** 409，说明里写着「只报总价」只能用加元做、请在专业模式里打开（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

### Requirement: 新建的总价报价只有用得上的行
新建只报总价的报价 SHALL 在同一次写入里只建货品、海运费、关税三项（都空着）与四条预置（值与只供货模板相同），销售税三个比例为空，按售价毛利定价、目标毛利率为空、币种加元、做法记为只报总价；SHALL NOT 套改版前的 15 行或 31 行模板；SHALL 写一条新建报价的审计。总价构成表开始 SHALL 只有货品、海运费、关税、销售税 4 行，SHALL NOT 预置空行。

#### Scenario: 只供货
- **WHEN** 有编辑权限且有财务查看权的人选只报总价、只供货新建
- **THEN** 201；新报价是只供货报价、做法为只报总价，成本行恰好是货品、海运费、关税各一条与四条预置，配置里的税三项为空，审计里有一条新建报价（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 供货加安装
- **WHEN** 选只报总价、供货加安装新建
- **THEN** 新报价是供货加安装报价、做法为只报总价，成本行与只供货时相同（同一测试）

#### Scenario: 界面上的 4 行
- **WHEN** 渲染一份刚新建的总价报价
- **THEN** 构成表里只有货品、海运费、关税、销售税 4 行，另有「添加一项」与预置区，没有空行（`npx tsx src/components/bid-page-v2/__tests__/lump-sum-editor.test.tsx`）

### Requirement: 总价构成表与「添加一项」
总价构成表 SHALL 一行一个大项：项目、金额或比例、备注。「添加一项」SHALL 从中文清单里列出还没加的项：国内运费、报关费、加拿大境内运费、包装、安装、测量、深化图、设备 / 场地、保函、保险、清洁、差旅、项目管理、售后预留、下错单 / 漏单预备金、其它；「其它」可以加多条且要填名称（最多 300 字，与成本行说明的上限相同），其余每项最多一条。除货品与销售税外每项 SHALL 可以删掉。加了没填的项 SHALL 不计入并写明；计入了但没填数的项（专业模式或转换带来的）读出时 SHALL 写明保存会改成不计入。备注 SHALL 最多 2000 字。

#### Scenario: 添加一项的清单
- **WHEN** 新建后打开「添加一项」，再加上安装
- **THEN** 清单依次是国内运费……其它共 16 项；加上安装后清单里没有安装、仍有其它（`npx tsx src/components/bid-page-v2/__tests__/lump-sum-editor.test.tsx`）

#### Scenario: 同一项加两次与其它没名称
- **WHEN** 要保存的表里有两条安装；或有一条没填名称的其它
- **THEN** 校验不过，分别指到「安装只能有一项」「「其它」要填名称」（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`）；经接口保存时 400、库里不变（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 没填的项
- **WHEN** 加了保险没填金额就保存
- **THEN** 保险那一行不计入，表上写「没填，不计入」，合计与没加时相同（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts` 与 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 备注
- **WHEN** 给海运费写备注「2 个 40 尺柜」保存，换人读
- **THEN** 读出的海运费备注是「2 个 40 尺柜」，存在海运费那条成本行的备注里（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

### Requirement: 每项落到既有成本类别与计算方式
每一项 SHALL 落到报价引擎既有的成本类别与计算方式，SHALL NOT 新增类别或计算方式。填金额 SHALL 是固定金额，可以是外币（同一币种一个汇率，1 原币 = 多少加元）。只有关税（货值 × 比例）、保函（税前报价 × 比例）、售后预留与下错单 / 漏单预备金（直接成本 × 比例）SHALL 可以改填比例；预备金、售后预留、保函加上时默认填比例，其余默认填金额。比例一格旁 SHALL 写明基数含什么。

#### Scenario: 类别与算法对照
- **WHEN** 每一项都填上金额，再把关税、保函、售后预留、预备金改成比例
- **THEN** 货品总数是采购类固定金额；海运费、加拿大境内运费是运费类；国内运费、包装是物流类；报关费是报关类；关税是关税类；安装、测量是人工类；深化图是工程类；设备 / 场地、差旅是现场类；保函是保函类；保险是保险类；项目管理是项目管理类；清洁、售后预留、其它是其它类；预备金是预备金类；金额都是固定金额；比例分别是按采购成本的成本百分比、售价百分比、按直接成本的成本百分比（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`）

#### Scenario: 默认填法与基数说明
- **WHEN** 加上预备金、保函、安装
- **THEN** 预备金与保函默认是比例、安装是金额；预备金的比例旁写着直接成本不含按比例算的关税（`npx tsx src/components/bid-page-v2/__tests__/lump-sum-editor.test.tsx`）

### Requirement: 金额、比例与汇率的范围
范围 SHALL 与库里能存的一致：金额大于等于 0、不超过一百亿、最多 4 位小数；关税、售后预留、预备金的比例 0 到 100，保函比例大于等于 0、小于 100，都最多 4 位小数；销售税每项 0 到 100、最多 4 位小数；汇率大于 0、不超过一万；预置比例与资金使用月数同逐行报价。不在范围里或不是数字时 SHALL 拒绝保存（400）并指出是哪一项，SHALL NOT 改写人填的数。

#### Scenario: 超出范围
- **WHEN** 分别校验：海运费 -1；保函比例 100；安装 12.34567；销售税 HST 101；美元汇率 0
- **THEN** 都校验不过，说明里分别指到海运费、保函、安装、销售税、美元汇率（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`）

#### Scenario: 原样带回的数能原样保存
- **WHEN** 转换或专业模式写进来的数（例如海运费 3,518.505、关税比例 100、1,500 字的备注）读出后不改直接保存
- **THEN** 200，各项的数与备注不变（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts` 与 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

### Requirement: 销售税
销售税 SHALL 是总价构成表里的一行，填 HST / GST / PST 三个比例（空着按 0），存进这份报价配置里的税，由报价引擎的税计算算出（每项 = 税前报价 × 比例，取到分）。销售税 SHALL NOT 存成成本行，SHALL NOT 进成本合计或定价；系统记的我方报价 SHALL 仍是税前报价。保存 SHALL 只改配置里的税，配置里的做法等其它内容照旧。

#### Scenario: 7% 填在哪一项都一样
- **WHEN** 同一组成本分别把 7 填进 HST、GST、PST
- **THEN** 三次的销售税都是 84,000.00、含税总价都是 1,284,000.00（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`）

#### Scenario: 不是成本行
- **WHEN** 填销售税 7% 保存
- **THEN** 库里没有多出成本行；报价配置里的税是 7%、做法仍是只报总价；存下的报价结果里税前报价不含税（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 专业模式保存后税还在
- **WHEN** 填了销售税的总价报价经专业模式保存（表头里的引擎配置不带税）与另起新版
- **THEN** 两份报价配置里的税与做法都还在（同一测试）

### Requirement: 三项预置与现金备用金
总价报价 SHALL 带资金使用、管理费、现金备用金、销售提成四条预置，默认值与只供货模板相同（年化 8% × 1 个月、3%、1%、毛利的 30%），可改比例（资金使用还可改月数）、可关；说明文字 SHALL 与逐行报价相同、写真实算法。

#### Scenario: 默认值与说明
- **WHEN** 读一份刚新建的总价报价
- **THEN** 四条预置的比例、月数、开关与只供货模板相同，说明与逐行报价的四条相同（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`）

#### Scenario: 关掉
- **WHEN** 关掉全部预置保存
- **THEN** 四条预置不计入，成本合计里没有它们（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

### Requirement: 定价一行的结果只取报价引擎
定价一行 SHALL 有目标毛利率（按售价）；结果 SHALL 显示成本合计、税前报价、销售税、含税总价、利润、毛利率，一律取报价引擎对这份报价的计算结果，页面 SHALL NOT 另算。目标毛利率空着时 SHALL 按 0 算并写明还没填。缺汇率、比例合计到 100% 等算不出时 SHALL 写明原因、不显示这几个数。没有预备金时 SHALL 提示可以从「添加一项」里加。

#### Scenario: 合成数字（验收 3）
- **WHEN** 只供货的总价报价填货品 800,000、海运费 60,000、关税 40,000，关掉全部预置，销售税 7%，目标毛利率 25%
- **THEN** 成本合计 900,000.00、税前报价 1,200,000.00、销售税 84,000.00、含税总价 1,284,000.00、利润 300,000.00、毛利率 25%（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`；存库后同样的数：`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`；页面上：`npx tsx src/components/bid-page-v2/__tests__/lump-sum-editor.test.tsx`）

#### Scenario: 与专业模式相同（验收 4）
- **WHEN** 同一份报价打开四条预置（管理费 3%、资金 8% × 1 个月、现金备用金 1%、提成 = 毛利 × 30%）保存
- **THEN** 总价视图的成本合计、税前报价、利润、毛利率是 1,037,322.68 / 1,257,360.83 / 220,038.15 / 17.5%，与专业模式的读接口对同一份报价返回的结果逐项相同（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 算不出
- **WHEN** 海运费填 8,000 美元、没填美元汇率
- **THEN** 不显示结果，写着要填美元汇率（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts` 与 `npx tsx src/components/bid-page-v2/__tests__/lump-sum-editor.test.tsx`）

### Requirement: 算式写真实算法
按售价毛利定价时，定价一行下方 SHALL 用这份报价的数写出算式：税前报价 = 不含销售提成与按税前报价算的各项的成本 ÷（1 − 目标毛利率 − 按税前报价算的各项比例合计）；开着销售提成时 SHALL 写明提成 =（税前报价 − 同一个成本）× 比例、算进成本合计，两句都写出这个成本的数；含税总价 = 税前报价 + 销售税。定价方式在专业模式里改成成本加成时 SHALL 不写这个算式、写明要先填目标毛利率（只写一次）。SHALL NOT 写「成本合计 ÷（1 − 毛利率）」。

#### Scenario: 预置全关
- **WHEN** 验收 3 的数
- **THEN** 写着「税前报价 1,200,000.00 = 900,000.00 ÷（1 − 25%）」与「含税总价 1,284,000.00 = 1,200,000.00 + 销售税 84,000.00」（`npx tsx src/components/bid-page-v2/__tests__/lump-sum-editor.test.tsx`）

#### Scenario: 开着提成与保函
- **WHEN** 开着销售提成，加了保函 1.5%（按报价）
- **THEN** 算式的分母写「1 − 25% − 1.5%」，另有一句写提成 =（税前报价 − 不含提成和保函的成本）× 30%、算进成本合计；式子里的数与引擎结果相同（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`；提成金额与专业模式读接口里提成那一行相同：`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 成本加成
- **WHEN** 定价方式在专业模式里改成成本加成
- **THEN** 没有算式，写着要先填目标毛利率（`npx tsx src/components/bid-page-v2/__tests__/lump-sum-editor.test.tsx`）

### Requirement: 货品填一个总数或展开成明细
货品 SHALL 二选一：填一个总数（可以是外币），或展开成明细；两者 SHALL NOT 同时计入。明细 SHALL 与逐行表的行同一结构（品名、数量、单位、报价口径与包装数、供应商报价；最多 300 行；校验规则相同），按件报价、包装数原样保留。展开成明细时总数留着、不计入；改回填总数 SHALL 先删掉全部明细，页面上要人确认。货品没填时 SHALL 照引擎写明未定价。总数那一行在专业模式里被删、设成不计入时，保存 SHALL 重建、重新计入并写明；被改了算法时 SHALL 写明照样计入、再填会算两遍。

#### Scenario: 明细
- **WHEN** 货品展开成两条明细：5 个 × 100、10 个 × 20，保存
- **THEN** 货品计入 700，总数那一行不计入（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 总数和明细都填了
- **WHEN** 要保存的表里货品写着填总数，又带着明细
- **THEN** 校验不过「货品已展开成明细，要改回填总数请先删掉明细」（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`）

#### Scenario: 改回填总数
- **WHEN** 有 2 条明细时点「改回填一个总数」
- **THEN** 先问「会删掉 2 行明细，原来留着的总数回到框里并计入，确定？」，确定后明细清空、显示原来留着的总数（`npx tsx src/components/bid-page-v2/__tests__/lump-sum-editor.test.tsx`）

#### Scenario: 按件报价的行
- **WHEN** 一份逐行报价里有一行按件报价（每盒 10 件、每件 3 元），转成总价、在总价表里保存、再转回逐行
- **THEN** 那一行仍是按件报价、每盒 10 件、每件 3 元，成本不变（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

### Requirement: 货品的报价从询价回复点选或手填带证据
货品总数 SHALL 可以从本项目询价回复的总价点选，明细的单价 SHALL 可以从回复的单价点选。服务端 SHALL 核对回复是本项目已报价、没取消的那一条，价与币种与回复一致，否则 SHALL 返回 400、库里不变；供应商 SHALL 一律取自库里，SHALL NOT 用提交里的供应商。手填的总数或单价 SHALL 选证据类别（已签报价 / 平台标价 / 零售价 / 估计）。

#### Scenario: 点选回复的总价
- **WHEN** 货品总数点选一条总价 50,000 加元的回复保存
- **THEN** 货品是 50,000，供应商是那条回复的供应商（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 对不上与别的项目的回复
- **WHEN** 点选后把总数改成 49,000；或点选的是别的项目的回复；或提交里带了另一个供应商
- **THEN** 前两种 400、库里不变；第三种存下的供应商仍取自回复（同一测试）

#### Scenario: 手填没选证据
- **WHEN** 货品总数手填、没选证据类别
- **THEN** 校验不过，写着要选证据类别（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`）

### Requirement: 总价表只动自己管的成本行
保存 SHALL 只写由总价构成表管的成本行（货品总数、明细、各项、预置；行身份记在成本行的附加信息里）；专业模式里加的其它成本行 SHALL NOT 被碰，SHALL 列在表下、照样计入。保存 SHALL 按读取时的修改时间防并发（不同 → 409、整笔不写）；已冻结的报价 SHALL 返回 409；SHALL 写一条更新报价的审计。SHALL NOT 写浏览器存储、给客户的报价行或投标工作区。

#### Scenario: 其它成本行不被碰
- **WHEN** 报价里有一条专业模式加的仓储费，在总价表里保存
- **THEN** 仓储费那一行一个字段都没变，表下列着它、合计里有它（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 并发与冻结
- **WHEN** 读取后别人改过报价再保存；报价已批准再保存
- **THEN** 都是 409，库里的成本行一行没变（同一测试）

#### Scenario: 换人看到同样的数
- **WHEN** 一个人保存后，另一个有成本权限与财务查看权的人读
- **THEN** 读到同样的各项、备注、销售税与结果；审计里有一条更新报价（同一测试）

#### Scenario: 不写浏览器
- **WHEN** 检查总价表组件与共用小件的源码
- **THEN** 都没有读写浏览器存储（`npx tsx src/components/bid-page-v2/__tests__/lump-sum-editor.test.tsx`）

### Requirement: 与专业模式改同一份报价
专业模式里把某一项改成这一项不允许的类别或算法时，总价表 SHALL 把那一行当作其它成本行列出并写明「在专业模式里改了类别或算法，这张表不再管它（按专业模式里的设置计算…）」，SHALL NOT 在保存时改回。改了金额、比例、备注、币种或汇率时 SHALL 按改后的显示。某一项设成了不计入但还带着数时 SHALL 按没填显示并写明原来填的数，保存时那个数留着、仍不计入。改了某一项的说明时 SHALL 写明保存时会改回项目名称。明细行在专业模式里被改时 SHALL 与逐行表同样提示；定价方式改了时没填目标毛利率 SHALL 不让保存。

#### Scenario: 改了海运费的算法
- **WHEN** 专业模式把海运费那一行改成按柜计，再在总价表里保存
- **THEN** 海运费那一行列在其它成本行里并写明，保存后它的算法仍是按柜计（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts` 与 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 改了金额与设成不计入
- **WHEN** 专业模式把关税金额从 40,000 改成 42,000；把安装 2,000 设成不计入
- **THEN** 总价表显示关税 42,000；安装按没填显示并写明原来填的是 2,000.00 加元，保存后安装那一行仍是 2,000、不计入（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`）

#### Scenario: 改了定价方式
- **WHEN** 专业模式把定价方式改成成本加成、目标毛利率清空后，在总价表里保存
- **THEN** 400，写着先填目标毛利率（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

### Requirement: 总价报价的接口与权限
三个接口（`GET` / `PUT /api/projects/{id}/bid-page/quotes/{quoteId}/lump`、`POST …/{quoteId}/convert`）SHALL 第一步调用报价权限守卫并紧接着检查（读要内部成本权限，存与转换要编辑权限）；之后新页面开关关、组织不在名单、报价引擎没开或不是招投标项目时 SHALL 返回 404（在读请求体、读写库之前），再 SHALL 要求内部成本权限与财务查看权，否则 403。地址里的报价不属于这个项目时 SHALL 返回 404、不带内容；请求体格式不对时 SHALL 返回 400。

#### Scenario: 各种身份
- **WHEN** 没登录、开关关、组织不在名单、报价引擎没开、有编辑权没有财务查看权的成员、有财务查看权的只读成员、组织外的人分别读、存、转换
- **THEN** 401 / 404 / 404 / 404 / 403 / 能读、存与转换 403 / 被拒（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 开关关
- **WHEN** 新页面开关没开，读、存、转换、新建只报总价的报价
- **THEN** 都 404「新版标书与报价页未启用」，库里不变（同一测试）

#### Scenario: 跨项目
- **WHEN** 拿 A 项目的报价走 B 项目的地址读、存、转换
- **THEN** 都 404，没有内容、库里不变（同一测试）

#### Scenario: 守卫写法
- **WHEN** 检查三个处理函数的源码
- **THEN** 取参数后第一句是报价权限守卫并紧接着检查，之后才走开关与金额门（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`；`npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts`）

#### Scenario: 不是总价报价
- **WHEN** 读、存一份逐行报价的总价视图
- **THEN** 409，写着这份报价不是按「只报总价」做的（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

### Requirement: 看不到金额的人拿不到任何总价报价的内容
没有财务查看权的人 SHALL NOT 从总价报价的接口拿到任何成本、金额、比例、销售税、备注、品名或供应商；被拒的写请求与转换请求 SHALL NOT 改库里的任何一行。

#### Scenario: 被拒的响应
- **WHEN** 有编辑权、没有财务查看权的成员读、存、转换一份填了数与备注的总价报价
- **THEN** 都 403（不断言提示文字），响应里没有那些金额、备注、品名与供应商名，前后库里的成本行与报价配置一样（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

### Requirement: 逐行报价转成只报总价
没冻结的逐行报价 SHALL 可以转成总价报价：货品行留作货品明细；共用参数四项变成总价表的同名项（海运费的柜数 × 每柜换成一个金额，原币与汇率不变；关税率变成按货值的比例；没计入的变成空着的项、不带数；这一项已经有总价项时，空着的共用参数行删掉）；预置与其它成本行不动；做法改成只报总价。共用参数的类别或算法在专业模式里改过时 SHALL 返回 409 并写明先在逐行表里保存一次。

#### Scenario: 转换
- **WHEN** 一份填了 2 行货品、2 柜 × 每柜 3,000 美元海运、报关费 500、关税率 8% 的逐行报价转成总价
- **THEN** 200，返回报价标识与做法「只报总价」；货品展开成 2 条明细，海运费是 6,000 美元（汇率不变），报关费 500，关税按货值 8%；转换前后的成本合计、税前报价、利润相同；审计里有一条转换（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 共用参数的算法在专业模式里改过
- **WHEN** 逐行报价的海运费那一行在专业模式里改成固定金额，再转成总价
- **THEN** 409，写明先在逐行表里保存一次或在专业模式里改回，库里不变（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`）

### Requirement: 只报总价转成逐行报价
只供货、货品是明细（总数不计入）的总价报价 SHALL 可以转成逐行报价：明细变成逐行表的行；报关费、国内运费的金额与按货值的关税比例变成逐行表的共用参数；其余共用参数补成没填的；其余有数的项留在报价里，逐行表里列为「从只报总价转来的项」、照样计入、逐行保存不碰，和共用参数同名的另写不要再填一遍；销售税比例留在配置里；做法改成逐行。货品是一个总数、总数和明细都计入、供货加安装时 SHALL 返回 409 并写明原因。

#### Scenario: 转换与往返
- **WHEN** 一份有 2 条明细、海运费金额 6,000、报关费 500、关税 8%（按货值）、安装 2,000 的只供货总价报价转成逐行，在逐行表里保存一次，再转回总价
- **THEN** 逐行表有 2 行，报关费 500、关税率 8%，海运费柜数空着并写着海运费按金额算在「从只报总价转来的项」里；海运费与安装列在那里、照样计入；每一步的成本合计、税前报价、利润都相同；转回总价后只有一项海运费（6,000）、一项安装，备注都还在（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 不能转的情况
- **WHEN** 货品是一个总数；总数和明细在专业模式里都设成了计入；是供货加安装报价
- **THEN** 都 409，分别写着先展开成明细、先在总价表里保存一次、逐行报价限于只供货的报价，库里不变（同一测试）

### Requirement: 转换前后报价引擎算出的数不变
转换 SHALL 在写库前用报价引擎分别算转换前后的结果（按库里能存的位数与读出的行序），成本合计、税前报价、利润、销售税任一项不同，或未定价的行会变少、前后有一边算不出时 SHALL 返回 409、写明原因、什么都不改；写库后 SHALL 按读出的行序再核对一次，不同就整笔回滚；转换后的内容通不过目标做法的校验、或同一项会有两条有数的行时 SHALL 返回 409 并写明。转换到当前做法、不是逐行或总价报价、币种不是加元时 SHALL 返回 409。转换 SHALL 按读取时的修改时间防并发，已冻结的 SHALL 返回 409；成功 SHALL 写一条转换的审计。

#### Scenario: 多组数据前后相同
- **WHEN** 用多组合成数据（外币、空着的项、预置开关、专业模式加的行、按件报价，另有 300 组随机数据与审查找到的行序反例）两个方向各转一次
- **THEN** 核对放行的每一组，按库里读出的行序算，转换前后的成本合计、税前报价、利润、销售税逐项相同；行序会让结果差一分的那一组被拦下（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`；经接口：`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 未定价不变成已定价 0
- **WHEN** 逐行报价的海运费计入、每柜金额在专业模式里清空（未定价），转成总价
- **THEN** 海运费那一项仍是未定价、金额空着，读出时写明它计入了但没填数、在这里保存会改成不计入；引擎核对拦下未定价行变少的转换，未定价变多（例如还没有货品行的逐行报价转过来）照转（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`；没有货品行的逐行报价经接口转换：`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 会差几分时不转
- **WHEN** 逐行报价的海运柜数 × 每柜换成一个金额后，按库里能存的 4 位小数取整会让海运费差一分
- **THEN** 不转，写明转换后会差几分、可以先把每柜金额改成两位小数再转（同一测试）

#### Scenario: 同一项两边都有
- **WHEN** 逐行报价里填了关税率，报价里另有一条有数的总价关税，转成总价
- **THEN** 不转，写明「转换后会有两项关税：请先在逐行表里清掉关税率，或在专业模式里删掉另一条」（同一测试）

#### Scenario: 不该转的请求
- **WHEN** 把逐行报价转成逐行；转一份专业模式报价；报价已批准；拿旧修改时间转
- **THEN** 都 409，库里不变（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

### Requirement: 互转的入口
逐行报价的「更多」里 SHALL 有「转成只报总价」；只供货的总价报价的「更多」里 SHALL 有「转成逐行报价」（货品是一个总数时不可用并写明先展开成明细）。点了 SHALL 先确认一次，写明转换后会变什么、合计不变、能再转回来；没保存的修改 SHALL 先保存或放弃才能转。转换成功后 SHALL 直接打开转换后的表。

#### Scenario: 入口与确认
- **WHEN** 渲染逐行报价与总价报价的「更多」，点转换
- **THEN** 两边都有转换入口；确认框写着合计不变、能再转回来；总价报价货品是总数时「转成逐行报价」不可用并写明原因（`npx tsx src/components/bid-page-v2/__tests__/lump-sum-editor.test.tsx` 与 `npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

## Purpose

让人把自己在 Alberta Purchasing Connection（APC）上看到的授标公告如实录进青砚：来源标为人工录入、带 APC 公告链接、信任级为待人工复核，由组织管理员确认后才进入统计；系统从头到尾不访问 APC。

## ADDED Requirements

### Requirement: 录入入口与权限
「历史中标」页 SHALL 提供可展开的表单 `录入 Alberta 授标（APC）`（说明见「表单的说明」）。系统 SHALL 提供 `POST /api/organizations/{组织}/tender-awards/manual`，判定顺序 SHALL 是未登录 401、不是本组织组织角色不低于 `org_member` 的有效成员 403（平台超级管理员按既有规则，组织不存在时 404 `组织不存在`）、授标情报开关关闭 409 `组织授标情报尚未启用`（SHALL NOT 访问授标表）、请求有误 400；被拒时 SHALL NOT 写库。列表接口 SHALL 返回 `canEnterManual`，表单只对它为 true 的人显示；开关关闭时页面 SHALL NOT 显示表单。

#### Scenario: 谁能录入
- **WHEN** 组织成员、组织查看者、别的组织的管理员、平台超级管理员分别录入一条；平台超级管理员往不存在的组织录入
- **THEN** 成员与平台超级管理员录入成功；查看者、别的组织的管理员 403；不存在的组织 404；被拒的都没有新记录；列表接口对成员 `canEnterManual` 为 true、对查看者为 false（`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`）

#### Scenario: 开关关闭
- **WHEN** 授标情报开关关闭时调用录入接口
- **THEN** 409 `组织授标情报尚未启用`，没有新记录；开关在访问授标表之前判断（`npx tsx src/lib/tender-intel/__tests__/award-manual-entry.test.ts` 源码断言；`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`）

### Requirement: 表单的说明
表单收起时 SHALL 写 `把在 APC 上看到的中标结果录进来，经人工确认后计入统计。`；展开后 SHALL 先写 `只录入你在 Alberta Purchasing Connection（APC）上亲眼看到的授标公告。系统只保存这个链接，不会自动访问它；复核的人会点开核对。录入后先列在下表、标为「待人工复核」，不计入金额、周期、可比价格和已确认的竞争对手；经人工确认属实后才计入（一般由组织管理员在下表确认）。`。

#### Scenario: 说明逐字
- **WHEN** 读取表单的固定文字与表单源码
- **THEN** 两句逐字如上，表单在收起时显示前一句、展开后显示后一句（`npx tsx src/lib/tender-intel/__tests__/award-manual-entry.test.ts` 固定文字与源码断言）

### Requirement: 录入的校验
采购方、中标方、APC 公告链接 SHALL 必填（去空白后非空，采购方与中标方各 ≤ 200 字）。APC 公告链接 SHALL 符合「APC 公告链接」。招标编号选填 ≤ 100 字；授标日期选填，SHALL 是真实存在的 `年-月-日`，不早于 1900-01-01，不晚于今天（按 UTC 日期，留一天时区余量）；合同金额选填，SHALL 是 0 到 1,000,000,000,000 之间、最多两位小数的数字，可以带开头的 `$`、全角数字与千分位逗号，逗号不在千分位上 SHALL 拒绝；币种只认 `CAD`、`USD`（不分大小写，缺省 `CAD`，没填金额时忽略）；范围摘要选填 ≤ 2000 字。

#### Scenario: 逐项校验
- **WHEN** 分别漏填采购方、中标方、链接；链接是 `http://purchasing.alberta.ca/posting/AB-2026-07664`、`https://purchasing.alberta.ca/posting/AB-1`、`https://purchasing.alberta.ca:8443/posting/AB-2026-07664`、`https://evil.example/purchasing.alberta.ca`；日期是后天、`2023-02-29`、`1899-12-31`；金额是 -1、1.234、`1234,56`；币种是 EUR；摘要 2001 字
- **THEN** 每次 400，依次是 `请填写采购方。`、`请填写中标方。`、`请填写 APC 公告链接。`、四次 `这不是一条 APC 公告的链接。请在 APC 打开这条公告，复制地址栏里形如 https://purchasing.alberta.ca/posting/AB-2026-07664 的链接（搜索结果页、附件链接都不行）。`、三次 `授标日期要写成 年-月-日，且在 1900 年到今天之间。`、三次 `合同金额只填数字（可以带千分位逗号和 $），不能为负，最多两位小数。`、`币种只能是 CAD 或 USD。`、`范围摘要太长了（最多 2000 字）。`；库里没有新记录（`npx tsx src/lib/tender-intel/__tests__/award-manual-entry.test.ts`；`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`）

#### Scenario: 能接受的写法
- **WHEN** 金额是 `$1,250,000.00`、`１，２３４`、`48,000`；币种是 `usd`；授标日期是 UTC 明天
- **THEN** 都通过；金额分别为 1250000、1234、48000，币种 `USD`（`npx tsx src/lib/tender-intel/__tests__/award-manual-entry.test.ts`）

### Requirement: APC 公告链接
APC 公告链接原文 SHALL ≤ 2048 字，SHALL 只接受 `https:`（只写了 `purchasing.alberta.ca/…` 的补上）、主机名恰为 `purchasing.alberta.ca`、没有端口（`:443` 视同没写）与用户名密码、路径恰为 `/posting/AB-年份-编号`（不分大小写，编号 4–6 位，末尾的 `/` 不算；样例 `https://purchasing.alberta.ca/posting/AB-2026-07664`），并 SHALL 统一存成 `https://purchasing.alberta.ca/posting/AB-…`（编号大写，去掉 `?` 与 `#` 之后），同一条公告只有一种写法。不合格 SHALL 返回 400 `这不是一条 APC 公告的链接。请在 APC 打开这条公告，复制地址栏里形如 https://purchasing.alberta.ca/posting/AB-2026-07664 的链接（搜索结果页、附件链接都不行）。`

#### Scenario: 链接的写法
- **WHEN** 链接是 `purchasing.alberta.ca/posting/ab-2026-07664/?x=1#top`、`https://purchasing.alberta.ca:443/posting/AB-2026-07664`；另有 `https://purchasing.alberta.ca/posting/AB-1`、`https://purchasing.alberta.ca/x/AB-2026-07664`、`https://purchasing.alberta.ca/posting/AB-2026-07664/extra`
- **THEN** 前两个都存成 `https://purchasing.alberta.ca/posting/AB-2026-07664`；后三个 400 那句话（`npx tsx src/lib/tender-intel/__tests__/award-manual-entry.test.ts`）

### Requirement: 请求有误时的回答
不合格时 SHALL 返回 400 `{ error, code, field }`，`error` 是按采购方、中标方、链接、编号、日期、金额、币种、摘要的顺序第一处错误的那句话，`code` 为 `MISSING_BUYER`、`MISSING_WINNER`、`MISSING_URL`、`BAD_URL`、`BAD_DATE`、`BAD_AMOUNT`、`BAD_CURRENCY`、`TOO_LONG` 之一，`field` 是那一项；超长的写 `{项}太长了（最多 N 字）。`（项为 `采购方`、`中标方`、`APC 公告链接`、`招标编号`、`范围摘要`）。请求体超过 16 KB SHALL 返回 400 `请求太大`（`code` 为 `TOO_LARGE`），没声明长度的边读边数、超了就停；请求体不是 JSON SHALL 按空表单处理。数字形式的字段 SHALL 按字符串校验，SHALL NOT 静默丢掉。以上都 SHALL NOT 写库。

#### Scenario: 400 的形状
- **WHEN** 链接带端口；日期写成数字 20261120；请求体 17 KB；请求体是 `not json`
- **THEN** 依次 400 `code` `BAD_URL` 与 `field` `apcUrl`；`BAD_DATE` 与 `awardDate`；`TOO_LARGE` 与 `请求太大`；`请填写采购方。`；都没有新记录（`npx tsx src/lib/tender-intel/__tests__/award-manual-entry.test.ts`；`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`）

### Requirement: 落库口径
录入 SHALL 经既有授标写入服务落一条授标记录：来源类型为人工录入（`USER_ENTRY`），来源链接为规整后的 APC 公告链接，信任级为待人工复核（`NEEDS_REVIEW`），可信度为中，不挂项目。录入 SHALL NOT 落为 `SYSTEM_VERIFIED` 或 `HUMAN_CONFIRMED`。按既有写入规则先判挂到既有、再判疑似重复：与已有记录招标编号和中标方都相同时；或招标编号没对上、而中标方、授标日期、金额都相同且不是两边都有编号而规范化后不同时（见 `tender/award-records`），SHALL 把这条来源挂到那条记录上，那条记录的内容与信任级 SHALL NOT 改变；疑似重复 SHALL 照既有规则标为疑似重复。组织管理员 SHALL 能用既有的「确认属实 / 撤回」处理这些记录，确认后为人工确认；项目里人工确认同编号同中标方的授标时，既有规则也会把它提升为人工确认。

#### Scenario: 新录入与复核
- **WHEN** 成员录入一条，组织管理员随后确认属实
- **THEN** 录入后记录的来源类型 `USER_ENTRY`、来源链接是规整后的 APC 链接、信任级 `NEEDS_REVIEW`、状态 `ACTIVE`；确认后信任级 `HUMAN_CONFIRMED`，不是 `SYSTEM_VERIFIED`（`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`）

#### Scenario: 挂到既有与疑似重复
- **WHEN** 另录一条与一条 CanadaBuys 的权威记录招标编号和中标方相同的；另录一条没有编号、中标方授标日期金额都与一条 AI 提取的记录相同的；另录一条编号与采购方都与那条 CanadaBuys 记录不同、中标方授标日期金额相同的；另录一条同采购方同中标方但日期不同的
- **THEN** 前两种来源挂到那条记录上，那条的信任级不变（CanadaBuys 那条仍是 `SYSTEM_VERIFIED`、AI 提取的仍是 `AI_EXTRACTED`），来源多一个；第三种不挂上，新记录标为疑似重复、指向那条 CanadaBuys 记录（那条不变）；第四种新记录状态为疑似重复（`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`）

### Requirement: 重录与撤回后重录
同一条公告链接的同一个中标方再录 SHALL 不新建、不写审计；两次同时提交 SHALL 只有一条记录且两次都成功返回。这条公告与中标方对应的记录被组织管理员撤回后再录，SHALL 新建一条（撤回的那条保持撤回），再重放 SHALL 仍不重复。同一条公告的同一个中标方撤回满 10 次后再录 SHALL 返回 409 `这条公告的这个中标方撤回过太多次，没有录入；请联系组织管理员。`（`code` 为 `RETRACTED_TOO_MANY`），SHALL NOT 写库。

#### Scenario: 重录、并发、撤回后重录
- **WHEN** 同一链接同一中标方再录；两次同时提交另一条；组织管理员撤回一条后同样的内容再录两次
- **THEN** 第一种不新建；第二种只有一条、两次都 200；第三种新建一条、撤回的那条仍是撤回，第二次再录不新建（`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`；撤回太多次的 409 由 `npx tsx src/lib/tender-intel/__tests__/award-manual-entry.test.ts` 源码断言）

### Requirement: 不访问 APC
录入、校验、列表显示 SHALL NOT 发起任何网络请求：APC 公告链接 SHALL 只保存，系统 SHALL NOT 打开、请求、下载或解析它指向的内容，也 SHALL NOT 访问任何 Alberta 网站。列表里的链接只供人自己点开，SHALL NOT 被预取或嵌入。

#### Scenario: 零外部请求
- **WHEN** 录入几条、重录、读取列表
- **THEN** 外部请求次数为 0；录入模块与接口源码里没有网络调用，页面用原生链接、不预取（`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`；`npx tsx src/lib/tender-intel/__tests__/award-manual-entry.test.ts` 源码断言）

### Requirement: 录入的结果
录入成功 SHALL 返回 200 `{ outcome, record, messageZh }`（五种 `outcome` 见场景；`record` 为编号、信任级、状态、采购方、招标编号、授标日期），`messageZh`：新建 `已录入，等组织管理员复核。`；疑似重复 `已录入；和已有的一条记录可能重复，等组织管理员裁决。`；按编号挂到既有 `已有同一条授标（招标编号与中标方相同），这条公告链接已挂到那条记录上。那条记录原有的内容和可信度不变（你这次填的没有写进去）；有出入请告诉组织管理员。`；按日期金额挂到既有 `已有同一条授标（中标方、授标日期、金额都相同），这条公告链接已挂到那条记录上。那条记录原有的内容（含招标编号与采购方）和可信度不变（你这次填的没有写进去）；有出入请告诉组织管理员。`；重录 `这条公告的这个中标方已经录过了（同一公告同一中标方只录一条；中了几个标段的请合成一条，金额合计或留空）。`。

#### Scenario: 五种结果
- **WHEN** 依次触发新建、疑似重复、按编号挂到既有、按日期金额挂到既有、重录
- **THEN** `outcome` 依次为 `CREATED`、`NEEDS_REVIEW`、`ATTACHED_BY_SOLICITATION`、`ATTACHED_BY_DATE_AMOUNT`、`ALREADY_ENTERED`，`messageZh` 为上面对应的一句；新建时 `record` 的信任级 `NEEDS_REVIEW`、状态 `ACTIVE`，采购方、招标编号、授标日期是规整后的值（`npx tsx src/lib/tender-intel/__tests__/award-manual-entry.test.ts`；`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`）

### Requirement: 录入表单
表单 SHALL 分「公告信息」（链接、采购方、招标编号、授标日期、范围摘要）与「这个中标方」（中标方、金额、币种）两组；采购方给出候选，范围摘要给出本页已有的写法作候选；采购方、招标编号、金额、范围摘要旁各写一句提示（逐字见 design D6）。录入成功后 SHALL 写 `「{中标方}」：{那一句}`，保留公告信息、只清空中标方与金额并把焦点放回中标方（重录时不清空），另有 `换一条公告（清空）`。出错时 SHALL 标出那一项并显示接口返回的那句话，403 换成 `你在本组织没有录入权限（需要成员及以上角色），请联系组织管理员。`，接口没有说明时写 `没有录入成功，请稍后再试。`，断网 `网络出错，请稍后再试。`。按钮写 `录入`，提交期间写 `正在录入…` 且不可再点；没填金额时币种不可选。

#### Scenario: 表单
- **WHEN** 读取表单与页面源码
- **THEN** 两组、两个候选、四句提示、成功后只清空中标方与金额、重录不清、403 那句、错误指向字段、按钮文字都在（`npx tsx src/lib/tender-intel/__tests__/award-manual-entry.test.ts` 源码断言与固定文字）

### Requirement: 采购方候选
列表接口 SHALL 只给 `canEnterManual` 为 true 的人返回 `buyerSuggestions`（其他人为空），取调用人按项目可见性看得到的本组织招标项目的采购方写法（项目写法在前、最近更新的在前），再加本组织未撤回授标的采购方写法；按采购方规整名去重（大小写、标点、开头的 The 不同算同一个），最多 200 个。对任何调用人（含平台超级管理员）SHALL NOT 带出待分派、不是招标、或调用人看不到的项目的客户名。

#### Scenario: 候选
- **WHEN** 本组织有一个已分派的招标项目、一个待分派的招标项目、一个不是招标的项目，另有一条采购方写成 `ALBERTA HEALTH SERVICES.` 的授标；成员与查看者读取列表
- **THEN** 成员与平台超级管理员的候选含 `Alberta Health Services` 一次（不含大写那种写法）、不含待分派与不是招标的项目的客户名；查看者的候选为空（`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`）

### Requirement: 列表里的来源与统计
「历史中标」列表 SHALL 对有人工录入 APC 来源的记录（列表字段 `manualApcUrl`）在中标方下写 `人工录入 · APC 公告 ↗`（无障碍名称 `在新窗口打开 APC 公告`），链接到最早那条人工录入 APC 来源（新窗口打开，不带来源页信息），并在招标编号下显示范围摘要。列表接口 SHALL 只返回人工录入的 APC 链接（再按「APC 公告链接」校验一次），SHALL NOT 返回别的来源的链接或原文片段。统计条里未经人工确认或权威来源的记录数 SHALL 标为 `待确认（AI 提取 / 人工录入，不计入统计）`，疑似重复的标为 `疑似重复待裁决（不计入统计）`。刚录入的那一行 SHALL 高亮并滚到它，被筛选条件挡住时写 `已录入，但被当前筛选条件挡住了，清空筛选可以看到。`；组织管理员提示与空状态 SHALL 提到人工录入（逐字见 design D6）。

#### Scenario: 列表显示
- **WHEN** 录入一条后读取列表；另有一条只有项目结果回灌来源的记录
- **THEN** 那条人工录入带 APC 链接，页面写 `人工录入 · APC 公告`；回灌的那条不带链接；统计条写两个新名称（`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`；`npx tsx src/lib/tender-intel/__tests__/award-manual-entry.test.ts` 源码断言）

### Requirement: 录入的审计
新建、疑似重复、挂到既有 SHALL 在同一事务里写一条审计 `tender.award_manual_entry`（结果、提交的全部字段、APC 链接、信任级，挂到既有时另记那条记录的信任级）；重录与被拒的 SHALL NOT 写审计。审计 SHALL NOT 记联系方式。

#### Scenario: 审计
- **WHEN** 成员新建、重录、被拒、平台超级管理员新建、按编号挂到既有、按日期金额挂到既有、编号不同而中标方日期金额相同、疑似重复、再新建
- **THEN** 审计依次是新建、新建、按编号挂到既有、按日期金额挂到既有、疑似重复、疑似重复、新建；挂到既有那几条记着结果与那条记录的信任级（`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`）

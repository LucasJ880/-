## Purpose

让人把自己在 Alberta Purchasing Connection（APC）上看到的授标公告如实录进青砚：来源标为人工录入、带 APC 公告链接、信任级为待人工复核，由组织管理员确认后才进入统计；系统从头到尾不访问 APC。

## ADDED Requirements

### Requirement: 录入入口与权限
「历史授标」页 SHALL 提供表单 `录入 Alberta 授标（APC）`，并写明 `只录入你在 Alberta Purchasing Connection（APC）上自己看到的授标公告。系统不会打开这个链接。录入后标为「待人工复核」，组织管理员确认属实后才进入统计。`。系统 SHALL 提供 `POST /api/organizations/{组织}/tender-awards/manual`。只有本组织有效成员且组织角色不低于 `org_member`（平台超级管理员按既有规则）能看到表单与录入；其他人 SHALL 得到 403 且 SHALL NOT 写库。列表接口 SHALL 返回 `canEnterManual`。授标情报开关关闭时 SHALL NOT 显示表单，接口 SHALL 返回 409 `授标情报未启用` 且 SHALL NOT 访问授标表。

#### Scenario: 谁能录入
- **WHEN** 组织成员、组织查看者、别的组织的管理员、平台超级管理员分别录入一条
- **THEN** 成员与平台超级管理员录入成功；查看者 403；别的组织的管理员 403；后两者库里没有新记录；列表接口对成员 `canEnterManual` 为 true、对查看者为 false（`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`）

#### Scenario: 开关关闭
- **WHEN** 授标情报开关关闭时调用录入接口
- **THEN** 409 `授标情报未启用`，授标表的查询次数为 0（`award-manual-entry-db.isolated.test.ts`）

### Requirement: 录入的校验
采购方、中标方、APC 公告链接 SHALL 必填（去空白后非空，采购方与中标方各 ≤ 200 字）。APC 公告链接 SHALL 只接受 `https:`、主机名恰为 `purchasing.alberta.ca`、不带用户名密码、路径不为空也不只是 `/`、≤ 2048 字；`#` 之后的部分 SHALL 去掉。招标编号选填 ≤ 100 字；授标日期选填，SHALL 写成 `年-月-日` 且不晚于今天；合同金额选填，SHALL 是 0 到 1,000,000,000,000 之间、最多两位小数的数字，币种只认 `CAD`、`USD`（缺省 `CAD`）；范围摘要选填 ≤ 2000 字。不合格时 SHALL 返回 400 与第一处错误的那句话，SHALL NOT 写库。

#### Scenario: 逐项校验
- **WHEN** 分别漏填采购方、中标方、链接；链接是 `http://purchasing.alberta.ca/x`、`https://purchasing.alberta.ca/`、`https://evil.example/purchasing.alberta.ca`；日期是明天；金额是 -1、1.234；币种是 EUR；摘要 2001 字
- **THEN** 每次 400，依次是 `请填写采购方。`、`请填写中标方。`、`请填写 APC 公告链接。`、三次 `APC 公告链接要以 https://purchasing.alberta.ca/ 开头，并指向具体的公告。`、`授标日期要写成 年-月-日，且不能晚于今天。`、两次 `合同金额要是不小于 0 的数字，最多两位小数。`、`币种只能是 CAD 或 USD。`、`范围摘要太长了（最多 2000 字）。`；库里没有新记录（`npx tsx src/lib/tender-intel/__tests__/award-manual-entry.test.ts`；`award-manual-entry-db.isolated.test.ts`）

### Requirement: 落库口径
录入 SHALL 经既有授标写入服务落一条授标记录：来源类型为人工录入（`USER_ENTRY`），来源链接为规整后的 APC 公告链接，信任级为待人工复核（`NEEDS_REVIEW`），可信度为中，不挂项目。录入 SHALL NOT 落为 `SYSTEM_VERIFIED` 或 `HUMAN_CONFIRMED`。同一条公告链接的同一个中标方再录 SHALL 不新建；与已有记录招标编号和中标方都相同时 SHALL 把这条来源挂到那条记录上、不改那条记录的信任级；疑似重复 SHALL 照既有规则标为疑似重复。组织管理员 SHALL 能用既有的「确认属实 / 撤回」处理这些记录。

#### Scenario: 新录入与复核
- **WHEN** 成员录入一条，组织管理员随后确认属实
- **THEN** 录入后记录的来源类型 `USER_ENTRY`、来源链接是那条 APC 链接、信任级 `NEEDS_REVIEW`、状态 `ACTIVE`；确认后信任级 `HUMAN_CONFIRMED`（`award-manual-entry-db.isolated.test.ts`）

#### Scenario: 重录、挂到既有、疑似重复
- **WHEN** 同一链接同一中标方再录；另录一条与一条 CanadaBuys 记录招标编号和中标方相同的；另录一条同采购方同中标方但日期不同的
- **THEN** 第一种不新建；第二种来源挂到那条 CanadaBuys 记录上，那条仍是 `SYSTEM_VERIFIED`；第三种新记录状态为疑似重复（`award-manual-entry-db.isolated.test.ts`）

### Requirement: 不访问 APC
录入、校验、列表显示 SHALL NOT 发起任何网络请求：APC 公告链接 SHALL 只保存，系统 SHALL NOT 打开、请求、下载或解析它指向的内容，也 SHALL NOT 访问任何 Alberta 网站。列表里的链接只供人自己点开。

#### Scenario: 零外部请求
- **WHEN** 录入几条、重录、读取列表
- **THEN** 外部请求次数为 0；录入模块与接口源码里没有网络调用（`award-manual-entry-db.isolated.test.ts`；`award-manual-entry.test.ts` 源码断言）

### Requirement: 录入的结果
录入成功 SHALL 返回结果类别与一句话：新建 `已录入，等组织管理员复核。`；疑似重复 `已录入；和已有的一条记录可能重复，等组织管理员裁决。`；挂到既有 `已有同一条授标（招标编号与中标方相同），这条公告链接已挂到那条记录上。`；重录 `这条公告的这个中标方已经录过了。`。表单 SHALL 在采购方旁写 `照公告原文填写；与项目里的采购方写法一致，系统才能把它们对上。`。

#### Scenario: 四种结果
- **WHEN** 依次触发新建、疑似重复、挂到既有、重录
- **THEN** 返回上面对应的一句（`award-manual-entry.test.ts`；`award-manual-entry-db.isolated.test.ts`）

### Requirement: 列表里的来源
「历史授标」列表 SHALL 对有人工录入 APC 来源的记录在中标方下写 `人工录入 · APC 公告`，链接到那条 APC 链接（新窗口打开，不带来源页信息）。列表接口 SHALL 只返回这条链接，SHALL NOT 返回其它来源的原文片段。

#### Scenario: 列表显示
- **WHEN** 录入一条后读取列表
- **THEN** 那条记录带 APC 链接，页面写 `人工录入 · APC 公告`；没有人工录入来源的记录不带（`award-manual-entry-db.isolated.test.ts`；`award-manual-entry.test.ts` 源码断言）

### Requirement: 录入的审计
新建、疑似重复、挂到既有 SHALL 在同一事务里写一条审计 `tender.award_manual_entry`（结果、采购方、中标方、招标编号、APC 链接、信任级）；重录 SHALL NOT 写审计。审计 SHALL NOT 记联系方式。

#### Scenario: 审计
- **WHEN** 新建一条、重录一次
- **THEN** 只有一条 `tender.award_manual_entry` 审计，内容如上（`award-manual-entry-db.isolated.test.ts`）

## Purpose
规定「供应商分组」：一个人怎样把自己的供应商按品类分成几组、系统怎样确定一个投标项目该用哪一组、询价抽屉怎样按分组预选。分组只决定「先勾选谁」，不批准、不发信，分组的名字与关键词不会出现在发给供应商的任何内容里。

## ADDED Requirements

### Requirement: 开关关闭时没有分组
开关 `TENDER_RFQ_SUPPLIER_GROUPS_ENABLED` 未开启，或组织不在 `TENDER_RFQ_SUPPLIER_GROUPS_ORG_ALLOWLIST`（非空时）之内时，询价入口的响应 SHALL NOT 含 `supplierGroups`；保存分组的接口 SHALL 拒绝；界面 SHALL NOT 出现任何分组相关的文字或控件；已保存的分组 SHALL NOT 影响抽屉的预选与自动起草。

#### Scenario: 开关关闭
- **WHEN** 开关未开启，一个之前保存过分组的人打开询价抽屉
- **THEN** 入口响应里没有 `supplierGroups`，预先勾选的仍是他的常用供应商；保存分组返回 404（`npx tsx src/lib/tender-rfq/__tests__/supplier-groups-db.isolated.test.ts`）

### Requirement: 分组的内容与上限
一个人在一个组织里 SHALL 最多有 10 个分组。每组 SHALL 有一个 1–30 字的名字（本人的分组之间不分大小写不得重名）、1–8 家有顺序的供应商（不重复）、0–10 个关键词。关键词 SHALL 为 2–40 字；只含半角英文字母、数字、空格与标点的关键词（全角写法同样算）SHALL 至少 3 个字符。不满足的保存请求 SHALL 被整体拒绝并说明哪一项不对，SHALL NOT 部分保存。

#### Scenario: 超出上限或内容不合规
- **WHEN** 分别提交：11 个分组、一组 9 家供应商、一组 0 家供应商、两组同名（大小写不同）、关键词为 `ab`、名字为空
- **THEN** 每一种都被拒绝（400），说明原因，库里的分组不变（`npx tsx src/lib/tender-rfq/__tests__/supplier-groups.test.ts` 逐条覆盖；`supplier-groups-db.isolated.test.ts`）

### Requirement: 分组内容里的字符
分组的名字与关键词 SHALL NOT 含控制字符、零宽或其它看不见的格式字符、无效的字符编码；关键词 SHALL NOT 含逗号、顿号或分号（界面按这些符号拆分关键词）；供应商号 SHALL 只含字母、数字、下划线与连字符。不满足的保存请求 SHALL 被整体拒绝（400）并说明原因，SHALL NOT 以服务器错误结束。名字里的换行与制表符 SHALL 按空白处理。

#### Scenario: 看不见或无效的字符
- **WHEN** 分别提交：名字里有空字符、名字只有零宽字符、关键词是字母后跟一个零宽字符、关键词是 `blinds, shades`、供应商号里有空字符
- **THEN** 每一种都是 400，库里的分组不变（`supplier-groups.test.ts`；`supplier-groups-db.isolated.test.ts`）

### Requirement: 只能保存本人的分组
保存分组 SHALL 要求登录、对所在项目有写权限。系统 SHALL 只写登录者本人在该项目所属组织里的分组，SHALL NOT 接受请求里指定的用户或组织。新加入分组的每家供应商 SHALL 属于该组织，否则整体拒绝；此前已在本人分组里、之后不再属于该组织的供应商 SHALL NOT 阻止保存别的修改，预选与起草时 SHALL 按不可用跳过。一个人的分组 SHALL NOT 被别人读到或用到。

#### Scenario: 混入别的组织的供应商
- **WHEN** 保存的一组里有一家供应商属于另一个组织
- **THEN** 请求被拒绝，库里的分组不变（`supplier-groups-db.isolated.test.ts`）

#### Scenario: 组里的供应商之后不在本组织了
- **WHEN** 分组里的一家供应商之后不再属于该组织，本人改了另一组的关键词并保存；随后又想把一家别的组织的供应商加进新的一组
- **THEN** 前一次保存成功；后一次被拒绝；自动起草时那一家被跳过（`supplier-groups-db.isolated.test.ts`）

#### Scenario: 没有写权限或没登录
- **WHEN** 只读成员、不是本组织成员的人、没登录的人分别调用保存接口
- **THEN** 都被拒绝，没有写入任何记录（`supplier-groups-db.isolated.test.ts`）

#### Scenario: 别人的分组不被使用
- **WHEN** 甲有分组、乙没有，乙打开同一个项目的询价抽屉
- **THEN** 乙的入口响应里分组为空，预选仍按乙自己的常用供应商（`supplier-groups-db.isolated.test.ts`）

### Requirement: 保存不互相覆盖并留记录
每次保存 SHALL 是整份替换，并带上请求方读到的那一版的标识；库里最新的一版不是那一版时 SHALL 拒绝（409）并返回最新的分组，SHALL NOT 覆盖。两个同时到达、基于同一版的保存 SHALL 只有一个成功。每次成功的保存 SHALL 留下一条不可改的记录（谁、何时、保存前后的内容）；当前生效的分组 SHALL 是本人最近一次成功保存的内容。内容与当前一版相同的保存 SHALL 成功但不新增记录。保存 SHALL NOT 修改组织设置。

#### Scenario: 两个标签页先后保存
- **WHEN** 同一个人在两个标签页打开抽屉，先在甲页保存了一次，再在乙页（仍是旧的一版）保存
- **THEN** 乙页的保存返回 409 与最新的分组，甲页保存的内容还在（`supplier-groups-db.isolated.test.ts`）

#### Scenario: 各台服务器的时钟不一致
- **WHEN** 上一次保存的记录时间比现在还晚（写它的那台机器时钟更快），本人在它之上再保存一次
- **THEN** 新保存的内容成为当前的一版，返回的是新的版本标识；此后基于旧版的保存仍然 409（`supplier-groups-db.isolated.test.ts`）

#### Scenario: 同时保存
- **WHEN** 基于同一版的两个保存请求同时到达
- **THEN** 一个成功、一个 409；库里只多一条记录（`supplier-groups-db.isolated.test.ts`）

### Requirement: 读不出来的保存记录不等于没有分组
读取已保存的分组 SHALL NOT 套用保存时的各项上限：之前合规保存、按现在的规则不再合规的内容 SHALL 仍被读出并生效。本人最近一条保存记录完全读不出来时，系统 SHALL NOT 把他当成没有分组：自动起草 SHALL NOT 起草、SHALL NOT 退回常用供应商，并说明分组读不出来；询价入口 SHALL 给出空的分组与该记录的版本标识，让他能在其上重新保存。

#### Scenario: 最近一条记录读不出来
- **WHEN** 本人最近一条分组记录的内容不是分组，他有 2 家可选的常用供应商，并批准了一个项目的招标分析
- **THEN** 不起草，结果说明保存的分组读不出来；他在询价入口基于那条记录重新保存后分组恢复（`supplier-groups-db.isolated.test.ts`）

#### Scenario: 存量内容不合现在的规则
- **WHEN** 已保存的一组里有一个只有 1 个字符的英文关键词，项目名称对不上
- **THEN** 这一组仍被读出；不起草，没有退回常用供应商（`supplier-groups-db.isolated.test.ts`）

### Requirement: 按项目名称确定用哪一组
系统 SHALL 用确定性的文字比对确定一个项目用哪一组：把项目名称与关键词都做同样的规整（全半角统一、去掉软连字符等看不见的格式字符、不分大小写、连续空白并成一个），某组有任一关键词出现在项目名称里即为对上。结果 SHALL 是三种之一：恰好一组对上（给出该组与第一个对上的关键词）、没有一组对上、不止一组对上（列出这些组）。系统 SHALL NOT 在后两种情况下替人选一组，SHALL NOT 调用模型，SHALL NOT 用项目名称以外的内容比对。没有关键词的组 SHALL NOT 被自动对上。

#### Scenario: 恰好一组
- **WHEN** 分组「窗饰」的关键词有 `blind`、`窗帘`，分组「家具」的关键词有 `furniture`；项目名称是 `Supply and Install Window BLINDS – Phase 2`
- **THEN** 结果是「窗饰」，依据是 `blind`（`supplier-groups.test.ts`）

#### Scenario: 对不上与对上多组
- **WHEN** 项目名称分别是 `Janitorial Services 2027` 与 `Blinds and Furniture Supply`
- **THEN** 前者结果为没有一组对上；后者为不止一组对上，列出「窗饰」「家具」（`supplier-groups.test.ts`）

#### Scenario: 全角与大小写
- **WHEN** 关键词是 `Roller Shade`，项目名称是 `ＲＯＬＬＥＲ   shade replacement`
- **THEN** 对上（`supplier-groups.test.ts`）

### Requirement: 询价入口返回分组
开关开启时，询价入口的响应 SHALL 含 `supplierGroups`：本人的各个分组（名字、关键词、供应商及其顺序、其中几家现在可选）、这个项目的比对结果、当前这一版的标识、各项上限。分组里已停用、没有邮箱或已不存在的供应商 SHALL 仍列在组里并标明不可选，SHALL NOT 被悄悄移出。

#### Scenario: 组里有停用的供应商
- **WHEN** 分组「窗饰」有 3 家供应商，其中 1 家后来被停用
- **THEN** 入口响应里这一组仍是 3 家，可选的是 2 家（`supplier-groups-db.isolated.test.ts`）

### Requirement: 抽屉按分组预选
本人有至少一个分组时，打开询价抽屉 SHALL 这样预选：恰好一组对上 → 预先勾选这一组里可选的供应商（按组内顺序），并写明用了哪一组、凭哪个关键词；否则 SHALL NOT 预先勾选任何供应商，并提示选一组或手动勾选（不止一组对上时列出这些组）。点一个分组 SHALL 把勾选换成该组里可选的供应商。那一行说明 SHALL 跟着当前的勾选走：勾选已不是对上的那一组时 SHALL NOT 仍写「已按这一组勾选」。预选之后人 SHALL 仍能自由增减勾选；提交的收件人 SHALL 以人最终勾选的为准。本人没有分组时，预选 SHALL 与现在相同（常用供应商）。

#### Scenario: 对上一组
- **WHEN** 项目名称对上分组「窗饰」（3 家，其中 1 家没有邮箱），打开抽屉
- **THEN** 预先勾选的是另外 2 家，抽屉里写着「项目名称里有『blind』，对上了分组『窗饰』，已按这一组勾选」（`npx tsx src/lib/tender-rfq/__tests__/supplier-groups.test.ts`；截图 `docs/acceptance/rfq-auto-5/drawer-matched.png`）

#### Scenario: 对不上
- **WHEN** 本人有两个分组，项目名称一个都对不上，打开抽屉
- **THEN** 没有预先勾选的供应商，抽屉里提示选一组或手动勾选；点「家具」后勾选变成这一组里可选的供应商（`supplier-groups.test.ts`；截图 `drawer-undetermined.png`）

### Requirement: 在抽屉里管理分组
抽屉 SHALL 提供：把当前勾选的供应商存为一个新分组（填名字与关键词）、用当前勾选覆盖某一组的供应商、改某一组的名字与关键词、删除某一组。删除 SHALL 先确认。保存成功后抽屉 SHALL 显示最新的分组；保存被拒（内容不合规、版本已变、供应商不属于本组织）时 SHALL 显示原因，SHALL NOT 丢掉人当前的勾选。版本已变时 SHALL 换成最新的分组并提示重新操作。

#### Scenario: 存为新分组
- **WHEN** 勾选了 3 家供应商，点「存为分组」，填名字「窗饰」与关键词 `blind, shade`，保存
- **THEN** 分组列表里出现「窗饰（3 家）」；重新打开抽屉仍在（`supplier-groups-db.isolated.test.ts`；截图 `drawer-manage.png`）

### Requirement: 分组信息不出站
分组的名字与关键词 SHALL NOT 出现在发给供应商的邮件标题、正文或附件里，SHALL NOT 改变询价单的内容。用分组与手动勾选同样几家供应商，生成的询价邮件 SHALL 逐字相同。

#### Scenario: 邮件内容不变
- **WHEN** 同一个项目，一次经分组预选 3 家后送审，一次手动勾选同样 3 家后送审
- **THEN** 两张审批卡里每家的邮件标题与正文逐字相同，且都不含分组的名字与关键词（`supplier-groups-db.isolated.test.ts`）

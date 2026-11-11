## Purpose
规定招标分析怎样保留它抽到的数量与单位，以及投标工作区怎样把这些线索带进价格表的粘贴框供人核对。带入只是省去转录：系统不替人保存，数量与单位看不准的不猜。

## ADDED Requirements

### Requirement: 招标分析保留数量线索
招标分析（V2）入库时 SHALL 保留它抽到的数量线索：每条带数量或单位的有效要求、每条有效的数量类事实，各记下说明、数量原文、单位原文、页码与来源（哪条要求）。数量与单位 SHALL 按原文保存，SHALL NOT 在入库时改写或换算。被取代或有冲突的要求与事实 SHALL NOT 记入。没有任何数量线索时 SHALL 记下一个空的清单（区别于「这份分析是在本功能之前做的」）。

#### Scenario: 要求与事实里的数量
- **WHEN** 分析结果里有一条要求（数量 `2,367`、单位 `Each`）、一条不带数量的要求、一条数量类事实（原文 `approx. 120 per year`）、一条已被取代的带数量的要求
- **THEN** 入库的数量线索是 2 条：那条要求（数量原文 `2,367`、单位原文 `Each`、带要求编号与页码）与那条事实（数量原文 `approx. 120 per year`、没有单位）；不带数量的与被取代的不在其中（`npx tsx src/lib/tender-bid-workspace/__tests__/schedule-prefill.test.ts`）

### Requirement: 数量线索到价格表行的转换是确定性的
系统 SHALL 用确定性的规则把数量线索变成价格表粘贴框的行，SHALL NOT 调用模型。数量 SHALL 只在原文里恰好有一个数字时取用（千分位逗号去掉）；原文里没有数字、有不止一个数字、或是一个范围时 SHALL NOT 带入，并说明原因。单位 SHALL 按一张固定的对照表规整到价格表的单位目录（如 `EA`、`pcs`、`piece` → `Each`）；对照表里没有的 SHALL 原样保留，由既有的价格表校验去报告。说明、数量、单位都相同的重复线索 SHALL 只留一条。行号 SHALL 从 1 连续编号；尺寸、包装数、认证要求几列 SHALL 留空。

#### Scenario: 能确定的与不能确定的
- **WHEN** 数量原文分别是 `2,367`、`approx. 120 per year`、`100-200`、`as required`、`3 lots of 50`
- **THEN** 前两条带入（数量 `2367`、`120`）；后三条不带入，原因分别是「是一个范围」「没有数字」「有不止一个数字」（`schedule-prefill.test.ts`）

#### Scenario: 单位规整
- **WHEN** 单位原文分别是 `EA`、`pcs`、`Boxes`、`rolls`、`LF`、空
- **THEN** 带入的单位分别是 `Each`、`Each`、`Box`、`Roll`、`LF`（原样）、空；对照表里没有的单位与空单位由既有的粘贴解析与价格表校验照常报告，本功能不替人选（`schedule-prefill.test.ts`）

#### Scenario: 生成的文本就是粘贴框认得的格式
- **WHEN** 把生成的文本交给既有的粘贴解析
- **THEN** 有单位的行解析出来与带入的行逐项相同（行号、说明、数量、单位）；没有单位的行由既有的解析照常报「缺少单位」、不进入解析出的行，由人补上单位；说明里的制表符与换行不会把一行拆成两行或多出一列（`schedule-prefill.test.ts`）

### Requirement: 带入接口
系统 SHALL 提供一个只读接口，返回项目当前有效的那份招标分析（最新一份等待审核或已批准的）里的数量线索、生成的粘贴文本、每一行对应的原文与页码、没能带入的条目及原因。接口 SHALL 要求项目读权限，SHALL 受投标工作区的功能开关控制（关闭时 404），SHALL NOT 写任何东西。来自已被人驳回的要求的线索 SHALL NOT 返回。响应 SHALL NOT 含任何金额。

#### Scenario: 有数量线索
- **WHEN** 项目当前有效的分析里有 3 条数量线索，其中 1 条对应的要求已被驳回、1 条数量是范围
- **THEN** 响应里带入 1 行，未带入 1 条并写明原因，被驳回的那条不出现（`npx tsx src/lib/tender-bid-workspace/__tests__/schedule-prefill-db.isolated.test.ts`）

#### Scenario: 没有可用的分析或分析是旧的
- **WHEN** 项目没有等待审核或已批准的分析；或那份分析入库时还没有本功能
- **THEN** 响应分别说明「还没有可用的招标分析」「这份分析没有保留数量与单位，重新分析后才能带入」，带入 0 行（`schedule-prefill-db.isolated.test.ts`）

#### Scenario: 权限与开关
- **WHEN** 没登录的人、不是项目成员的人调用；或功能开关关闭
- **THEN** 分别是 401、被拒、404；另一个项目的线索不会被返回（`schedule-prefill-db.isolated.test.ts`）

### Requirement: 带入不替人保存
投标工作区的粘贴导入区 SHALL 提供「从招标分析带入」：把生成的文本填进粘贴框，并列出每一行对应的原文数量与页码、没能带入的条目及原因。带入 SHALL NOT 保存价格表；保存 SHALL 仍由人点既有的保存按钮完成，经既有的解析与校验。粘贴框里已有内容时，带入 SHALL 先确认再替换。界面 SHALL 写明这些行是从招标分析里抽出来的、需要逐行核对。

#### Scenario: 带入后核对再保存
- **WHEN** 在一个已有招标分析的项目里点「从招标分析带入」
- **THEN** 粘贴框里出现带入的行，下方列出各行的原文与页码；价格表此时没有变化；人改完点「保存」后价格表才更新（截图 `docs/acceptance/fix-2/prefill-filled.png`、`prefill-saved.png`；`schedule-prefill-db.isolated.test.ts` 验证接口不写库）

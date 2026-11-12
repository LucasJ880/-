## Purpose
规定投标提交之后在青砚里怎么留记录：人在门户或线下交完标，在项目页上记下实际提交的时间、方式与回执编号；系统据此写入提交时间，并保留每一次记录与更正。青砚不代为提交，只记录已经发生的事。

## ADDED Requirements

### Requirement: 记录提交
有项目写权限的人 SHALL 能对一个招投标项目记录提交：实际提交的时间、提交方式、回执编号（可空）、备注（可空）。提交时间 SHALL 可以早于现在，SHALL NOT 晚于现在（允许 5 分钟的时钟误差）。项目此前没有提交时间时，记录 SHALL 经既有的阶段推进把提交时间写成人填的时间、把招投标状态写成已提交；SHALL NOT 为「项目提交」阶段新建任务。系统 SHALL NOT 代为向任何门户或邮箱提交。

#### Scenario: 第一次记录
- **WHEN** 项目负责人对一个还没提交的项目记录：昨天下午提交、门户、回执编号 ABC-123
- **THEN** 项目的提交时间是昨天下午那一刻，招投标状态是已提交，阶段是项目提交；没有新建「准备投标文件」「提交投标」任务；上一阶段的自动任务被关掉（`npx tsx src/lib/tender-submission/__tests__/submission-record-db.isolated.test.ts`）

#### Scenario: 时间在将来
- **WHEN** 填的提交时间是明天
- **THEN** 返回 400 并说明原因，什么都没有写（`submission-record-db.isolated.test.ts`；`npx tsx src/lib/tender-submission/__tests__/submission-record.test.ts`）

#### Scenario: 同时点了两次
- **WHEN** 两个相同的第一次记录同时到达
- **THEN** 提交时间只写入一次，成员只收到一次阶段通知，两个请求都成功，留下两条记录、内容相同（`submission-record-db.isolated.test.ts`）

### Requirement: 更正与补记
项目已有提交时间时，再次记录 SHALL 视为更正：提交时间改成新填的值，其余阶段信息不动。项目没有提交时间、但招投标状态已使它算作提交阶段（如已中标、未中标）时，记录 SHALL 只补上提交时间，SHALL NOT 改动招投标状态。更正与补记 SHALL NOT 发阶段推进的通知，SHALL NOT 新建任务。

#### Scenario: 更正时间与回执
- **WHEN** 已提交的项目再记录一次，时间改成早一小时、回执编号改成 ABC-124
- **THEN** 提交时间是新的值，招投标状态不变，没有新的阶段推进消息与成员通知；最新的记录是新的这一条，之前那条还在（`submission-record-db.isolated.test.ts`）

#### Scenario: 已中标的项目补记
- **WHEN** 招投标状态是已中标、没有提交时间的项目记录一次提交
- **THEN** 提交时间被补上，招投标状态仍是已中标（`submission-record-db.isolated.test.ts`）

### Requirement: 记录只追加
每一次记录与更正 SHALL 追加保存为一条记录（谁、何时记的、提交时间、方式、回执编号、备注），SHALL NOT 覆盖或删除之前的。读取 SHALL 返回最新的一条与历次的条数。记录 SHALL NOT 包含金额、毛利、我方报价；备注里出现金额时 SHALL 拒绝保存并说明原因。

#### Scenario: 读取
- **WHEN** 一个项目先后记录了两次
- **THEN** 读取返回第二次的内容、记录人与记录时间，以及「共 2 次」（`submission-record-db.isolated.test.ts`）

#### Scenario: 备注里写了金额
- **WHEN** 备注是「报了 $128,000」
- **THEN** 返回 400，说明这里不记金额，什么都没有写（`submission-record.test.ts`；`submission-record-db.isolated.test.ts`）

### Requirement: 权限与隔离
接口 SHALL 只对招投标项目、且开关对该项目的组织开启时可用，否则 SHALL 返回 404。读取 SHALL 要求项目读权限，记录 SHALL 要求项目写权限。组织 SHALL 取自项目记录本身，SHALL NOT 取自请求里的任何参数。别的组织的人 SHALL NOT 能读到或写入。

#### Scenario: 只读成员
- **WHEN** 项目里的只读成员读取，再尝试记录
- **THEN** 读取成功并得知自己不能记录；记录被拒（403），什么都没有写（`submission-record-db.isolated.test.ts`）

#### Scenario: 别的组织、开关关闭、非招投标项目
- **WHEN** 别的组织的人访问；或开关关闭；或项目不是招投标项目
- **THEN** 分别被拒、404、404，都没有写入（`submission-record-db.isolated.test.ts`）

### Requirement: 页面与下一步
开关开启时，「提交」页签 SHALL 有「提交记录」一块：显示最新的记录（或「还没有记录」）；有写权限的人 SHALL 能记录与更正，保存前 SHALL 再确认一次并写明第一次记录会把项目标为已提交、不能撤销。「下一步」卡片在「截标日期已过、没有提交记录」时 SHALL 指到这一块。开关关闭时页面与卡片 SHALL 与现在相同。

#### Scenario: 截标已过
- **WHEN** 截标日期过了一天以上、没有提交时间，开关开启
- **THEN** 卡片的按钮去「提交」页签的提交记录（`npx tsx src/lib/tender-next-step/__tests__/web-next-step.test.ts`；截图 `docs/acceptance/flow-h4a/past-closing.png`）

#### Scenario: 开关关闭
- **WHEN** 开关关闭
- **THEN** 「提交」页签没有这一块，卡片仍指到关键日期（`web-next-step.test.ts`；截图 `docs/acceptance/flow-h4a/flag-off.png`）

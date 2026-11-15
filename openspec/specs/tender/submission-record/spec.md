# tender/submission-record Specification

## Purpose
规定投标提交之后在青砚里怎么留记录：人在门户或线下交完标，在项目页上记下实际提交的时间、方式与回执编号；系统据此写入提交时间，并保留每一次记录与更正。青砚不代为提交，只记录已经发生的事。

## Requirements

### Requirement: 记录提交
有项目写权限的人 SHALL 能对一个招投标项目记录提交：实际提交的时间、提交方式、回执编号（可空）、备注（可空）。提交时间 SHALL 是带时区的时刻，可以早于现在，SHALL NOT 晚于现在（允许 5 分钟的时钟误差）。项目此前没有提交时间、也没有投标结果时，记录 SHALL 经既有的阶段推进把提交时间写成人填的时间、把招投标状态写成已提交；SHALL NOT 为「项目提交」阶段新建任务。系统 SHALL NOT 代为向任何门户或邮箱提交。

#### Scenario: 第一次记录
- **WHEN** 项目负责人对一个还没提交的项目记录：昨天下午提交、门户、回执编号 ABC-123
- **THEN** 项目的提交时间是昨天下午那一刻，招投标状态是已提交，阶段是项目提交；上一阶段的自动任务被关掉，没有为「项目提交」阶段建任务（`npx tsx src/lib/tender-submission/__tests__/submission-record-db.isolated.test.ts`）

#### Scenario: 时间在将来或写法不对
- **WHEN** 填的提交时间是明天；或只有日期、不带时区
- **THEN** 返回 400 并说明原因，什么都没有写（`submission-record-db.isolated.test.ts`；`npx tsx src/lib/tender-submission/__tests__/submission-record.test.ts`）

#### Scenario: 同时点了两次
- **WHEN** 两个相同的第一次记录同时到达
- **THEN** 提交时间只写入一次，成员只收到一次阶段通知，两个请求都成功，留下两条记录，提交时间与回执相同（后到的那条按更正记）（`submission-record-db.isolated.test.ts`）

#### Scenario: 记录的同时别人记了投标结果
- **WHEN** 第一次记录读到项目之后、写入之前，项目被记为已中标（或被放弃）
- **THEN** 阶段推进不写入；已中标的转为只补提交时间、结果不变，已放弃的被拒（`submission-record-db.isolated.test.ts` 里阶段推进带着过时状态的用例）

### Requirement: 更正与补记
项目已有提交时间时，再次记录 SHALL 视为更正：提交时间改成新填的值，其余阶段信息不动。项目没有提交时间、但已经有投标结果（已中标、未中标、招投标状态已是已提交等）时，记录 SHALL 只补上提交时间，SHALL NOT 改动招投标状态。更正与补记 SHALL NOT 发阶段推进的通知，SHALL NOT 新建任务。已放弃或已归档的项目、以及投标结果是不投标 / 已放弃投标 / 已取消且没有提交时间的项目 SHALL NOT 能记录（409，说明原因）。

#### Scenario: 更正时间与回执
- **WHEN** 已提交的项目再记录一次，时间改成早一小时、回执编号改成 ABC-124
- **THEN** 提交时间是新的值，招投标状态不变，没有新的阶段推进消息与成员通知；最新的记录是新的这一条，之前那条还在（`submission-record-db.isolated.test.ts`）

#### Scenario: 已中标的项目补记
- **WHEN** 招投标状态是已中标、没有提交时间的项目记录一次提交
- **THEN** 提交时间被补上，招投标状态仍是已中标，留下的记录标为补记（`submission-record-db.isolated.test.ts`）

#### Scenario: 没投的标
- **WHEN** 投标结果是不投标（或已放弃投标、已取消）、没有提交时间的项目记录一次提交
- **THEN** 返回 409，说明没有提交可记，什么都没有写；同样的结果但已有提交时间的仍可更正（`submission-record-db.isolated.test.ts`；`submission-record.test.ts`）

#### Scenario: 已放弃、已归档
- **WHEN** 项目已放弃或已归档
- **THEN** 返回 409 并说明原因，什么都没有写（`submission-record-db.isolated.test.ts`）

### Requirement: 记录只追加
每一次记录与更正 SHALL 追加保存为一条记录（谁、何时记的、提交时间、方式、回执编号、备注），SHALL NOT 覆盖或删除之前的。读取 SHALL 返回与项目上的提交时间对得上的最新一条、以及历次的条数；没有对得上的 SHALL 照实返回没有记录。记录 SHALL NOT 有金额、毛利、我方报价的字段；备注里出现常见的金额写法时 SHALL 拒绝保存并说明原因。

#### Scenario: 读取
- **WHEN** 一个项目先后记录了两次
- **THEN** 读取返回第二次的内容、记录人与记录时间，以及「共 2 次」（`submission-record-db.isolated.test.ts`）

#### Scenario: 后写进来的记录记的是另一个时间
- **WHEN** 两个人同时第一次记录、填的不一样，项目上最后生效的是其中一个的时间，而另一个的记录后写进来
- **THEN** 读取返回与项目提交时间对得上的那一条，不把一个人的回执配上另一个人的时间（`submission-record-db.isolated.test.ts`）

#### Scenario: 备注里写了金额
- **WHEN** 备注是「报了 $128,000」
- **THEN** 返回 400，说明这里不记金额，什么都没有写（`submission-record.test.ts`；`submission-record-db.isolated.test.ts`）

#### Scenario: 金额过滤的边界
- **WHEN** 回执编号是 `CAD-2026-00123` 这样带货币代码的标识；或备注里用不常见的写法写金额（纯数字、全角符号）
- **THEN** 前者能保存（回执编号不按金额拦）；后者拦不住——过滤只拦常见写法，不是保证（`submission-record.test.ts`）

### Requirement: 权限与隔离
接口 SHALL 只对招投标项目、且开关对该项目的组织开启时可用，否则（在通过登录与项目权限检查之后）SHALL 返回 404。读取 SHALL 要求项目读权限，记录 SHALL 要求项目写权限；读取时告诉页面的「能不能记录」SHALL 与写接口的判断逐条一致。组织 SHALL 取自项目记录本身，SHALL NOT 取自请求里的任何参数。别的组织的人 SHALL NOT 能读到或写入。

#### Scenario: 只读成员
- **WHEN** 项目里的只读成员读取，再尝试记录
- **THEN** 读取成功并得知自己不能记录；记录被拒（403），什么都没有写（`submission-record-db.isolated.test.ts`）

#### Scenario: 负责人、项目管理员、超级管理员
- **WHEN** 普通组织成员身份的项目负责人、项目管理员读取；超级管理员读取一个还没分发的项目
- **THEN** 都得知自己能记录，并且真的能记录（`submission-record-db.isolated.test.ts`）

#### Scenario: 别的组织、开关关闭、非招投标项目
- **WHEN** 别的组织的人访问；或开关关闭；或项目不是招投标项目
- **THEN** 分别被拒、404、404，都没有写入（`submission-record-db.isolated.test.ts`）

### Requirement: 页面与下一步
开关开启时，「提交」页签 SHALL 有「提交记录」一块：显示记录（或「还没有记录」）；有写权限的人 SHALL 能记录与更正，保存前 SHALL 再确认一次并写明第一次记录会把项目标为已提交、会通知成员、不能撤销，项目有来源系统时还 SHALL 写明状态会同步回去。页面上填的时间 SHALL 按所填那一天的本地时区换算。「下一步」卡片在「截标日期已过、没有提交记录」时 SHALL 指到这一块。开关关闭时页面与卡片 SHALL 与现在相同。

#### Scenario: 截标已过
- **WHEN** 截标日期过了一天以上、没有提交时间，开关开启
- **THEN** 卡片的按钮去「提交」页签的提交记录（`npx tsx src/lib/tender-next-step/__tests__/web-next-step.test.ts`；截图 `docs/acceptance/flow-h4a/past-closing.png`）

#### Scenario: 跨夏令时的日期
- **WHEN** 在已经回到标准时间的日子里，补记夏令时期间某一天 14:00 的提交
- **THEN** 存下的时刻按那一天的偏移换算（多伦多：10 月 30 日 14:00 是 18:00Z，不是 19:00Z）；只补回执、没动时间时已有的时刻原样保留（`submission-record.test.ts`）

#### Scenario: 开关关闭
- **WHEN** 开关关闭
- **THEN** 「提交」页签没有这一块，卡片仍指到关键日期（`web-next-step.test.ts`；截图 `docs/acceptance/flow-h4a/flag-off.png`）

### Requirement: 可投标判定看提交记录
投标工作区给出的可投标判定（工作区读取与成本核算表两处）SHALL 带上与项目当前提交时间对得上的那条提交记录。那条记录有回执编号时，截标之后 SHALL NOT 报「已过截标」的阻断项，SHALL 给出「已有带回执的提交记录；本判定仅供复盘」的提示，判定 SHALL 为「已交标（仅供复盘）」。项目有提交时间、但没有对得上的记录或记录没有回执编号时，SHALL 仍报「已过截标」：提交记录对这个组织开着时，文字 SHALL 写明在「提交」页签的「提交记录」里补上回执编号；没开时 SHALL 只说有提交时间、没有回执编号，SHALL NOT 指向「提交记录」。项目没有提交时间时，阻断项的文字 SHALL 与原来相同。与项目当前提交时间对不上的记录（被更正之前的、更晚写下但时间不同的）SHALL NOT 算数；别的项目、别的组织的记录 SHALL NOT 算数；同一项目上别的动作的审计行 SHALL NOT 把真正的记录挤出去。截标还没到时 SHALL NOT 受影响。

#### Scenario: 记了回执
- **WHEN** 截标已过，项目经提交记录记下了提交时间与回执编号，读取投标工作区与成本核算表
- **THEN** 两处的判定都没有「已过截标」，有「已有带回执的提交记录」的提示，判定是「已交标（仅供复盘）」（`npx tsx src/lib/tender-bid-workspace/__tests__/readiness-submission-db.isolated.test.ts`）

#### Scenario: 记了但没有回执编号
- **WHEN** 截标已过，项目有提交时间，记录里回执编号是空的；或项目的提交时间是在对话里推进阶段写下的、没有记录
- **THEN** 仍有「已过截标」，文字写明去「提交记录」里补上回执编号（`readiness-submission-db.isolated.test.ts`；`npx tsx src/lib/tender-bid-readiness/__tests__/readiness.test.ts`）

#### Scenario: 提交记录对这个组织没开
- **WHEN** 截标已过，项目有提交时间、没有回执编号，提交记录的开关对这个组织关着
- **THEN** 「已过截标」只说有提交时间、没有回执编号，不提「提交记录」（`readiness-submission-db.isolated.test.ts`；`readiness.test.ts`）

#### Scenario: 时间对不上的、别的动作的
- **WHEN** 之后又写下一条带回执、但时间与项目当前提交时间不同的记录；或同一项目上之后又有 25 条别的动作的审计行
- **THEN** 前者不算；后者不影响真正的记录被找到（`readiness-submission-db.isolated.test.ts`）

#### Scenario: 更正之后
- **WHEN** 第一次记录带回执编号，之后更正了提交时间、这次没填回执编号
- **THEN** 判定按更正后的那条算：仍有「已过截标」（`readiness-submission-db.isolated.test.ts`）

#### Scenario: 别的项目的记录
- **WHEN** 同组织另一个项目记了带回执的提交，本项目只有提交时间
- **THEN** 本项目的判定仍有「已过截标」（`readiness-submission-db.isolated.test.ts`）

#### Scenario: 没有提交时间、截标还没到
- **WHEN** 截标已过、项目没有提交时间；或截标还没到
- **THEN** 前者「已过截标」的文字与原来相同；后者没有这一项（`readiness.test.ts`）

### Requirement: 判定不带出回执编号与备注
可投标判定 SHALL NOT 在阻断项、提示或任何字段里带出提交记录的回执编号、备注或提交方式；只用「有没有回执编号」这一点。

#### Scenario: 判定里没有回执的内容
- **WHEN** 记录的回执编号是 `ABC-123`、备注有一段文字，读取投标工作区
- **THEN** 工作区判定的全部文字与字段里都不出现 `ABC-123` 与那段备注（`readiness-submission-db.isolated.test.ts`）

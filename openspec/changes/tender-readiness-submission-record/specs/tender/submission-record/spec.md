## ADDED Requirements

### Requirement: 可投标判定看提交记录
投标工作区给出的可投标判定（工作区读取与成本核算表两处）SHALL 带上与项目当前提交时间对得上的那条提交记录。那条记录有回执编号时，截标之后 SHALL NOT 报「已过截标」的阻断项，SHALL 给出「已有带回执的提交记录；本判定仅供复盘」的提示。项目有提交时间、但没有对得上的记录或记录没有回执编号时，SHALL 仍报「已过截标」，文字 SHALL 写明在「提交」页签的「提交记录」里补上回执编号。项目没有提交时间时，阻断项的文字 SHALL 与原来相同。与项目当前提交时间对不上的记录（被更正之前的）SHALL NOT 算数；别的项目、别的组织的记录 SHALL NOT 算数。截标还没到时 SHALL NOT 受影响。

#### Scenario: 记了回执
- **WHEN** 截标已过，项目经提交记录记下了提交时间与回执编号，读取投标工作区与成本核算表
- **THEN** 两处的判定都没有「已过截标」，有「已有带回执的提交记录」的提示（`npx tsx src/lib/tender-bid-workspace/__tests__/readiness-submission-db.isolated.test.ts`）

#### Scenario: 记了但没有回执编号
- **WHEN** 截标已过，项目有提交时间，记录里回执编号是空的；或项目的提交时间是在对话里推进阶段写下的、没有记录
- **THEN** 仍有「已过截标」，文字写明去「提交记录」里补上回执编号（`readiness-submission-db.isolated.test.ts`；`npx tsx src/lib/tender-bid-readiness/__tests__/readiness.test.ts`）

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

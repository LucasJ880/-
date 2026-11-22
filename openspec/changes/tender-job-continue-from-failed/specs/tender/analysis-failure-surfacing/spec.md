# Spec Delta

## MODIFIED Requirements

### Requirement: 只对招投标 Job、每个 Job 只收尾一次
系统 SHALL 只对招投标域的 Job 收尾。其它域的 Job 失败时，SHALL NOT 读写任何招投标分析记录，SHALL NOT 发招投标失败通知。

同一个 Job 的每一轮 SHALL 只收尾一次。一轮指从发起、或从一次「从失败的这一步继续」开始，到停下为止。同一轮里无论被处理器重复判为失败多少次，系统 SHALL 只改一次分析记录、只写一条审计 `tender.workforce.failed_surfaced`（目标为该 Job），每位收件人只收到一条失败通知。继续之后再次停下属于新的一轮：系统 SHALL 再收尾一次、写一条新的审计，每位收件人收到一条新的失败通知。

#### Scenario: 重放收尾
- **WHEN** 对同一个已收尾的招投标 Job、同一轮再调用一次收尾
- **THEN** 审计仍只有一条，发起人的失败通知仍只有一条（`job-failure-surfacing-db.isolated.test.ts`）

#### Scenario: 继续之后再次停下
- **WHEN** Job 被继续一次后又停下
- **THEN** 审计共两条，发起人共收到两条失败通知（`continue-from-failed-db.isolated.test.ts`）

#### Scenario: 非招投标 Job
- **WHEN** 一个没有 `workDomain` 的 Job 失败
- **THEN** 没有招投标分析记录被改，没有招投标失败通知，没有该审计（`job-failure-surfacing-db.isolated.test.ts`）

## ADDED Requirements

### Requirement: 个人开关的最后一次设置一定生效
个人开关的状态 SHALL 是本人最后一次成功设置的结果，SHALL NOT 取决于各台服务器时钟的快慢或是否被回拨：在一条时间比现在还晚的记录之后再设置，新的设置 SHALL 仍然生效。同一个人同时到达的多次设置 SHALL 依次执行，最终状态 SHALL 是其中最后执行的那一次的结果，SHALL NOT 出现两条都写入而状态与最后一次不符的情况。状态已经是想要的那样时 SHALL NOT 新增记录。

#### Scenario: 上一条记录的时间比现在还晚
- **WHEN** 本人最近一条「开启」记录的时间比现在晚 30 秒（写它的那台服务器时钟更快），他在网页上关闭开关
- **THEN** 状态为关；之后他触发的自动起草的卡不带跟进授权；再开启一次，状态为开（`npx tsx src/lib/tender-rfq/__tests__/auto-draft-db.isolated.test.ts`）

#### Scenario: 同时到达的开与关
- **WHEN** 同一个人的四次开启与四次关闭同时到达
- **THEN** 八次都成功返回；写下的记录严格是开与关交替的（没有连着两条相同的），时间严格递增；最终状态就是最后那条记录（`auto-draft-db.isolated.test.ts`）

#### Scenario: 同时到达的两次相同设置
- **WHEN** 开关是关，同时到达两次开启；随后状态已经是开，又同时到达两次开启
- **THEN** 第一回只新增一条记录，第二回没有新增记录（`auto-draft-db.isolated.test.ts`）

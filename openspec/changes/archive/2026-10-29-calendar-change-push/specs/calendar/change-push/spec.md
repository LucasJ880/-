# Spec Delta

## Purpose

把 CAL-1 的日历变更通知同时送到员工常用的 Muse 与微信：已绑定 Muse 的收件人改走 Muse 事件，新通知再推一条销售域微信消息；收件人、时机与条数不变，推送内容不含邮箱。

## ADDED Requirements

### Requirement: 已绑定 Muse 的收件人走 Muse 事件
CAL-1 给某收件人发变更通知时，若 Muse Bridge 开启、企业在 Muse 放行名单内、且该收件人在该企业的 Muse 绑定表里，SHALL 改发一条 Muse 事件 `calendar.changed`（`eventId` 为 CAL-1 通知键、发生时间为 Google 更新时间；站内类型 `calendar_event`，标题为 CAL-1 通知标题），SHALL NOT 再发 `calendar_watch` 通知。其余情况 SHALL 照旧发 `calendar_watch` 通知；信封不成立、摘要会被出站脱敏整段替换、或落库失败时 SHALL 回落为 `calendar_watch` 通知。

#### Scenario: 老板已绑定 Muse
- **WHEN** Muse 开启，老板已绑定、运营主管未绑定，有人在 Google 改了量房时间
- **THEN** 老板收到一条 `muse_bridge` 分类的站内通知且 Bridge 能拉到 `calendar.changed`，运营主管收到 `calendar_watch` 通知；`calendar-change-push-db.isolated.test.ts` 覆盖

#### Scenario: Muse 关闭
- **WHEN** `MUSE_BRIDGE_ENABLED` 未开，收件人已绑定
- **THEN** 只发 `calendar_watch` 通知

#### Scenario: 事件 ID 过长
- **WHEN** 通知键超过 200 字
- **THEN** 回落为 `calendar_watch` 通知；`calendar-change-push-db.isolated.test.ts` 覆盖

#### Scenario: 标题命中出站敏感词
- **WHEN** 已绑定的老板收到标题为"Margin trim install"的新建日程通知
- **THEN** 老板收到完整标题的 `calendar_watch` 通知，而不是脱敏提示；`calendar-change-push-db.isolated.test.ts` 覆盖

### Requirement: 同一变更跨渠道只送一次
同一变更同一收件人 SHALL 最多有一条站内记录（`calendar_watch` 或 Muse 二选一）、最多一次微信推送；重放、中断后重跑、同一事件出现在两个观察日历、或两次运行之间收件人绑定 / 解绑 Muse、Muse 开关变化，SHALL NOT 重发。

#### Scenario: 运行之间刚绑定
- **WHEN** 第一轮老板未绑定收到 `calendar_watch` 通知，随后绑定 Muse，同一批变更被重放
- **THEN** 不新增站内记录、不再推微信；`calendar-change-push-db.isolated.test.ts` 覆盖

#### Scenario: 两个观察日历
- **WHEN** 一条新建日程同时出现在两个观察日历
- **THEN** 账本各记一条，每位收件人一条通知、一次推送；`calendar-change-push-db.isolated.test.ts` 覆盖

### Requirement: 新通知推送微信
每新建一条变更通知（任一渠道）后 SHALL 用销售域微信推送发给该收件人（只发给启用、开了销售提醒、推送域含销售、不在静默时段的绑定；静默时段内跳过、不补发），每条至多推一次（建好通知后、推送前中断的不补推）。每轮 SHALL 至多推 30 条且只在 cron 截止时间前推，超出的不推、通知照建。员工微信推送按用户 2026-10-29 拍板不算出站，SHALL NOT 建 PendingAction。推送失败 SHALL NOT 影响账本、游标与其它收件人。

#### Scenario: 推送失败
- **WHEN** 给老板推送时抛错
- **THEN** 运营主管照常收到推送，账本照常记入，运行结果微信失败数为 1；`calendar-change-push-db.isolated.test.ts` 覆盖

#### Scenario: 每轮上限
- **WHEN** 一轮新建 4 条通知而额度只剩 1
- **THEN** 只推 1 条，4 条通知都建好；`calendar-change-push-db.isolated.test.ts` 以注入的额度覆盖

#### Scenario: 首次全量
- **WHEN** 首次开启观察读到历史日程
- **THEN** 零条推送；`calendar-change-push-db.isolated.test.ts` 覆盖

### Requirement: 推送内容不含邮箱
微信正文与 Muse 事件摘要 SHALL 只含 CAL-1 通知标题与来源说明（来源与命中规则），SHALL NOT 含创建者邮箱或任何邮箱地址；标题或正文中"本地部分 + @ + 域名（可截断或为空）"的串 SHALL 替换为 `[邮箱]`。Muse 摘要 SHALL 经既有出站脱敏与 300 字截断。

#### Scenario: 成员新建
- **WHEN** 一条归因为外部邮箱创建者的新建日程被通知
- **THEN** 站内 `calendar_watch` 摘要仍含创建者邮箱，微信正文与 Muse 摘要不含；`calendar-change-push-pure.test.ts` 覆盖

#### Scenario: 标题截断在邮箱中间
- **WHEN** 日程标题较长，账本截到 120 字后末尾是 `jo@acmecorp`
- **THEN** 推送标题中为 `[邮箱]`；`calendar-change-push-pure.test.ts` 覆盖

### Requirement: 授权失效提醒推微信
日历观察读取账号的 Google 授权失效、当天第一次建立重新连接提醒时，SHALL 同时推一条销售域微信消息给读取账号；同一天再次失效 SHALL NOT 再推。该提醒 SHALL NOT 走 Muse。

#### Scenario: 同一天两次失效
- **WHEN** 同一天两轮运行都遇到授权失效
- **THEN** 读取账号只收到一次微信推送；`calendar-change-push-db.isolated.test.ts` 覆盖

### Requirement: Muse 契约只追加
`muse-bridge/v1` 的事件类型 SHALL 追加 `calendar.changed`，信封其它字段与 Bridge 拉取接口 SHALL NOT 变化；`calendar.changed` 事件 SHALL NOT 带动作。

#### Scenario: 信封校验
- **WHEN** 用一条修改通知构造 `calendar.changed` 事件
- **THEN** 信封通过 `museEventEnvelopeSchema` 校验且无 `action`；`calendar-change-push-pure.test.ts` 覆盖

### Requirement: 运行结果计数
日历观察每轮的结果（按日历与汇总，含 cron 步骤记录）SHALL 给出走 Muse 的条数，以及微信推送的成功、失败、跳过（非生产环境禁用外发）与超额（超过每轮上限或截止时间）条数。

#### Scenario: 测试环境
- **WHEN** 测试环境用缺省推送跑出 2 条新通知
- **THEN** 跳过 2、失败 0、成功 0，运行不算出错；`calendar-change-push-db.isolated.test.ts` 覆盖

#### Scenario: 适配器失败
- **WHEN** 推送服务返回失败 1
- **THEN** 失败数为 1；`calendar-change-push-db.isolated.test.ts` 覆盖

# Spec Delta

## ADDED Requirements

### Requirement: 询价轮次的跳转地址
`entityType` 为 `tender_rfq_round` 的通知，跳转地址 SHALL 为 `/projects/{projectId}?tab=bid#rfq-round-{entityId}`（`entityId` 为询价轮次 id）。通知没有 `projectId` 时 SHALL 按「跳转地址的取用顺序」继续往下取，不生成缺项目的地址。

顶栏铃铛、通知页与邮件里的链接 SHALL 使用同一地址（见「铃铛、通知页与邮件跳到同一地址」）。

#### Scenario: 询价轮次通知
- **WHEN** 一条 `tender_rfq_round` 通知的 `projectId` 为 P、`entityId` 为 R
- **THEN** 跳转地址为 `/projects/P?tab=bid#rfq-round-R`

#### Scenario: 缺项目 id
- **WHEN** 一条 `tender_rfq_round` 通知没有 `projectId`
- **THEN** 不生成 `/projects/…?tab=bid` 地址，按取用顺序回落

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/notifications/__tests__/notification-href.test.ts`
- **THEN** `tender_rfq_round` 的跳转与回落断言通过，退出码 0

## ADDED Requirements

### Requirement: 待批准报价的跳转地址
`entityType` 为 `bid_quote` 的通知（新版「标书与报价」页提交报价给负责人时发出），跳转地址 SHALL 为 `/projects/{projectId}?tab=bid#bid-quote-{entityId}`（`entityId` 为报价 id）。通知没有 `projectId` 时 SHALL 按「跳转地址的取用顺序」继续往下取，不生成缺项目的地址。

顶栏铃铛、通知页与邮件里的链接 SHALL 使用同一地址（见「铃铛、通知页与邮件跳到同一地址」）。

#### Scenario: 待批准报价通知
- **WHEN** 一条 `bid_quote` 通知的 `projectId` 为 P、`entityId` 为 Q
- **THEN** 跳转地址为 `/projects/P?tab=bid#bid-quote-Q`（`npx tsx src/lib/bid-page-v2/__tests__/quote-confirm.test.ts`）

#### Scenario: 缺项目 id
- **WHEN** 一条 `bid_quote` 通知没有 `projectId`
- **THEN** 不生成 `/projects/…?tab=bid` 地址，按取用顺序回落（同一测试）

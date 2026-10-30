# Spec Delta

## ADDED Requirements

### Requirement: 叙述开关回显
`GET /api/sales/period-summary` 的成功响应 SHALL 含布尔字段 `narrativeEnabled`，取值等于 AI 解读开关是否开启；`narrative` 字段 SHALL 仍固定为 `null`（解读只经独立接口按需生成）。

#### Scenario: 开关关闭
- **WHEN** 未设置 `SALES_PERIOD_NARRATIVE_ENABLED`，老板请求期间汇总
- **THEN** `narrativeEnabled` 为 `false`，`narrative` 为 `null`；`period-narrative-db.isolated.test.ts` 覆盖

#### Scenario: 开关开启
- **WHEN** `SALES_PERIOD_NARRATIVE_ENABLED=true`，老板请求期间汇总
- **THEN** `narrativeEnabled` 为 `true`，`narrative` 仍为 `null`

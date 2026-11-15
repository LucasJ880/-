# settings/sender-copy Specification

## Purpose
`/settings` 与 `/settings/email` 的发信文案按企业设置决定，不按企业代码写死；用代发通道的企业看到代发说明，其余企业看到标准的邮箱绑定。

## Requirements

### Requirement: 发信文案按企业设置显示
`/settings` 的邮件发送面板与 `/settings/email` SHALL 按当前企业设置 `settingsJson.ui.senderCopy` 决定文案：值为 `platform_relay` 时显示平台代发说明（标题为「〈企业名〉发信通道」，正文不含企业专属的人名、邮箱与域名），且 SHALL NOT 显示 Gmail 绑定入口与 OAuth 配置说明、当前发信通道提示、Google 一键授权与 SMTP 配置区块；缺省或其他值时显示标准邮箱绑定。两页 SHALL NOT 按企业代码判定。

#### Scenario: 代发企业
- **WHEN** 运行 `npx tsx src/lib/settings/__tests__/sender-copy.test.ts`，当前企业 `senderCopy` 为 `platform_relay`
- **THEN** 文案判定为代发，绑定与授权区块不显示，测试通过

#### Scenario: 未设置的企业
- **WHEN** 当前企业没有 `senderCopy`，或值不是 `platform_relay`
- **THEN** 文案判定为标准邮箱绑定（同一测试覆盖）

#### Scenario: 不再写死企业代码
- **WHEN** 运行同一测试
- **THEN** 源码断言两页都不再出现 `MENGXIN_ORG_CODE` 与 `mengxin-home-textile`，测试通过

### Requirement: 企业列表带发信文案模式
`GET /api/organizations` 返回的每个企业 SHALL 带 `senderCopy` 字段：企业设置里为 `platform_relay` 时为该值，否则为 `null`。接口 SHALL NOT 透出企业设置里的其他内容。

#### Scenario: 只透出已知值
- **WHEN** 企业设置 `ui.senderCopy` 为 `platform_relay`，另有 `onboarding`、`rules` 等键
- **THEN** 该企业的 `senderCopy` 为 `platform_relay`，响应里没有 `settingsJson`、`onboarding`、`rules`（同一测试覆盖）

### Requirement: 发信文案回填脚本
`scripts/set-org-sender-copy.ts --org <企业代码> --mode <platform_relay|clear> --actor <邮箱> [--dry-run]` SHALL 只在 `ALLOW_SENDER_COPY_UPDATE=true` 且执行者为平台 super_admin 时运行。脚本 SHALL 只改 `settingsJson.ui.senderCopy`，保留其他键；带 `--dry-run` 时只打印前后值、不写库；写库时 SHALL 记一条审计日志。

#### Scenario: 保留其他设置
- **WHEN** 运行同一测试，对 `settingsJson = { onboarding: {...}, ui: { theme: "x" } }` 计算 `platform_relay` 的新值
- **THEN** 结果保留 `onboarding` 与 `ui.theme`，只新增 `ui.senderCopy`；`clear` 时只删 `ui.senderCopy`，测试通过

#### Scenario: 没有显式开关时拒绝
- **WHEN** 未设 `ALLOW_SENDER_COPY_UPDATE=true`，或 `--actor` 不是平台 super_admin，运行回填脚本（含 `--dry-run`）
- **THEN** 脚本退出码非 0、不读写企业设置（同一测试以源码断言覆盖）

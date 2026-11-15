# Spec Delta

## MODIFIED Requirements

### Requirement: 设置页微信入口
开关关闭时，设置页 SHALL NOT 显示"微信集成"入口卡片，页面上 SHALL NOT 有指向 `/settings/wechat` 的链接；开关打开时，该卡片 SHALL 与改动前一致地出现在"邮箱绑定"卡片的位置之后（"邮箱绑定"对当前用户不显示时，见 `navigation/entry-visibility`「/settings 索引只列放行的卡片」，微信卡片照旧在该位置）。

#### Scenario: 关闭时没有微信卡片
- **WHEN** 开关关闭，已登录用户打开 `/settings`
- **THEN** 页面上没有"微信集成"卡片，也没有指向 `/settings/wechat` 的链接

#### Scenario: 打开时有微信卡片
- **WHEN** 开关打开，`/settings/email` 对其放行的已登录用户打开 `/settings`
- **THEN** "邮箱绑定"卡片之后是"微信集成"卡片，点击进入 `/settings/wechat`

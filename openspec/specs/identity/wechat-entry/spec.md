# identity/wechat-entry Specification

## Purpose
微信扫码登录与微信绑定入口的平台开关：规定开关的取值，以及开关关闭时登录页、设置页、导航、两个微信页面与组织开通页如何隐藏这些入口；开关只管页面入口，不改微信登录 / 绑定接口、回调与推送任务。

## Requirements

### Requirement: 开关取值
系统 SHALL 以服务端环境变量 `WECHAT_BINDING_ENABLED` 决定微信扫码登录与微信绑定入口是否开放：值去掉首尾空白、不分大小写后等于 `1`、`true` 或 `on` 时为开；未设置、空串或其他任何值 SHALL 视为关。开关 SHALL 只在服务端读取，SHALL NOT 作为前端构建变量。

#### Scenario: 未设置为关
- **WHEN** 环境中没有 `WECHAT_BINDING_ENABLED`
- **THEN** 微信入口按"关"处理

#### Scenario: false 为关、true 为开
- **WHEN** 分别设 `WECHAT_BINDING_ENABLED=false` 与 `WECHAT_BINDING_ENABLED=true`
- **THEN** 前者为关，后者为开

#### Scenario: 取值表
- **WHEN** 运行 `npx tsx src/lib/messaging/__tests__/wechat-entry-flag.test.ts`
- **THEN** 未设置、空串、`false`、`0`、`off`、`yes` 判为关，`true`、`TRUE`、` 1 `、`on` 判为开，进程以 0 退出

### Requirement: 登录页微信扫码入口
开关关闭时，登录页 SHALL NOT 显示"微信扫码登录"按钮与它上方的"或"分隔线；邮箱密码登录与注册链接 SHALL 不受影响。开关打开时，登录页 SHALL 与改动前一致。

#### Scenario: 关闭时只有邮箱登录
- **WHEN** 开关关闭，打开 `/login`
- **THEN** 页面有邮箱、密码输入框、"登录"按钮与"注册"链接，没有"或"分隔线和"微信扫码登录"按钮

#### Scenario: 打开时恢复
- **WHEN** 开关打开，打开 `/login`
- **THEN** "登录"按钮下方出现"或"分隔线与"微信扫码登录"按钮，点击后跳转 `/api/auth/wechat`

### Requirement: 设置页微信入口
开关关闭时，设置页 SHALL NOT 显示"微信集成"入口卡片，页面上 SHALL NOT 有指向 `/settings/wechat` 的链接；开关打开时，该卡片 SHALL 与改动前一致地出现在"邮箱绑定"卡片之后。

#### Scenario: 关闭时没有微信卡片
- **WHEN** 开关关闭，已登录用户打开 `/settings`
- **THEN** 页面上没有"微信集成"卡片，也没有指向 `/settings/wechat` 的链接

#### Scenario: 打开时有微信卡片
- **WHEN** 开关打开，已登录用户打开 `/settings`
- **THEN** "邮箱绑定"卡片之后是"微信集成"卡片，点击进入 `/settings/wechat`

### Requirement: 导航里的微信入口
开关关闭时，侧边栏与手机导航抽屉 SHALL NOT 出现"微信集成"（`/wechat`）入口，不论平台角色、企业角色或岗位。开关打开时，该入口 SHALL 按改动前的角色与岗位规则显示。

#### Scenario: 关闭时任何人都看不到
- **WHEN** 开关关闭，旧模式下平台角色为 `boss` 或 `operations` 的企业成员、岗位模式下持 `owner` 岗位的成员分别加载导航
- **THEN** 导航中都没有 `/wechat`

#### Scenario: 打开时按原规则
- **WHEN** 开关打开，旧模式下平台角色为 `boss` 的企业成员与平台角色为 `sales` 的企业成员分别加载导航
- **THEN** 前者导航中有"微信集成"，后者没有（销售本来就不显示）

### Requirement: 微信页面暂未开放
开关关闭时，访问 `/settings/wechat` 与 `/wechat` SHALL 只显示"暂未开放"说明，SHALL NOT 渲染微信绑定、扫码登录或消息列表，SHALL NOT 发起这些内容的接口请求（绑定列表、二维码、消息记录）。开关打开时，两个页面 SHALL 与改动前一致。

#### Scenario: 关闭时直接访问绑定页
- **WHEN** 开关关闭，已登录用户直接访问 `/settings/wechat`
- **THEN** 页面显示"暂未开放"，没有二维码、"扫码登录"按钮与企业微信绑定内容，也没有发出微信绑定相关的接口请求

#### Scenario: 关闭时直接访问消息页
- **WHEN** 开关关闭，已登录用户直接访问 `/wechat`
- **THEN** 页面显示"暂未开放"，没有消息列表与"绑定微信"按钮

#### Scenario: 打开时恢复
- **WHEN** 开关打开，已登录用户访问 `/settings/wechat`
- **THEN** 显示个人微信与企业微信的连接设置，与改动前相同

### Requirement: 组织开通页微信步骤
开关关闭时，组织开通详情页的"微信绑定"步骤 SHALL NOT 显示前往「设置 → 微信」扫码绑定的提示与业务员绑定表；该步未完成时，步骤说明 SHALL 为"微信绑定暂未开放"并提示可勾选"暂不绑定微信"；"暂不绑定微信"确认 SHALL 保留且可用。就绪判定与开通状态接口的返回 SHALL 与改动前一致。开关打开时，该步骤 SHALL 与改动前一致。

#### Scenario: 关闭时展开微信步骤
- **WHEN** 开关关闭，平台管理员打开一家有一名未绑定业务员、尚未确认微信步骤的企业开通页，展开"微信绑定"
- **THEN** 没有 `/settings/wechat` 提示和绑定表，有"暂不绑定微信"确认框；步骤条上该步说明以"微信绑定暂未开放"开头，就绪检查仍把该步列为未完成

#### Scenario: 关闭时勾选确认
- **WHEN** 开关关闭，在上述企业勾选"暂不绑定微信"
- **THEN** 该步状态变为已确认，与改动前相同

### Requirement: 组织开通页成员表的微信列
开关关闭时，组织开通详情页的成员表 SHALL NOT 显示"微信"列（已绑定 / 未绑定）；开关打开时 SHALL 显示该列，与改动前一致。

#### Scenario: 关闭时成员表三列
- **WHEN** 开关关闭，展开"邀请业务员"步骤
- **THEN** 成员表只有成员、平台角色、企业角色三列

#### Scenario: 打开时成员表四列
- **WHEN** 开关打开，展开"邀请业务员"步骤
- **THEN** 成员表在企业角色之后有"微信"列，已绑定的成员显示"已绑定"

### Requirement: 开关不改微信接口与推送
开关 SHALL 只影响页面入口：微信扫码登录与回调接口、微信与企业微信绑定接口、`wechat-push` 定时任务及其调度 SHALL 在开关开 / 关两种状态下都保持改动前的行为；已有的微信绑定记录 SHALL NOT 被修改或删除。

#### Scenario: 接口、调度与数据结构不在改动内
- **WHEN** 在本 change 的分支上执行 `git diff --stat origin/main...HEAD -- src/app/api/auth/wechat src/app/api/messaging src/app/api/cron/wechat-push src/lib/messaging/binding.ts src/lib/messaging/push-service.ts vercel.json prisma`
- **THEN** 输出为空

#### Scenario: 关闭时已绑定成员照常收推送
- **WHEN** 开关关闭，一名已有 active 微信绑定的成员收到新的站内通知
- **THEN** `wechat-push` 定时任务照常把它转发到该成员的微信，与改动前相同

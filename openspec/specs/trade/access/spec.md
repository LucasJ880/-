# trade/access Specification

## Purpose
外贸模块（`/api/trade/**`）的授权口径：按岗位权限键判定，平台角色不带来隐含外贸权限（平台 super_admin 除外）；旧模式企业的平台 `trade` 成员经兼容回退保持现状。

## Requirements

### Requirement: 外贸权限键
权限目录 SHALL 包含 `trade.read`（看外贸数据）、`trade.manage`（写外贸数据）、`trade.settings.manage`（管理消息通道、发件档案、发件人），三者范围均为 `ORG`，只允许人类主体。

#### Scenario: 键已登记
- **WHEN** 读取权限目录
- **THEN** 含 `trade.read`、`trade.manage`、`trade.settings.manage`，均只允许 `HUMAN`

### Requirement: 外贸模板与兼容回退
系统 SHALL 提供系统模板 `trade_rep`（含 `trade.read`、`trade.manage`）。系统模板 `org_owner` SHALL 含三个外贸键，系统模板 `org_admin` SHALL 含 `trade.settings.manage`，窗饰 `owner` SHALL 含三个外贸键。旧模式企业中，平台角色为 `trade`、成员角色为 `org_member` 且无岗位绑定的人 SHALL 回退到 `trade_rep`。企业授权种子 SHALL 把平台角色 `trade` 的 active 成员自动绑定到 `trade_rep`。

#### Scenario: 旧模式平台 trade 成员
- **WHEN** 无岗位模板企业中平台角色为 `trade` 的 `org_member` 没有岗位绑定，请求 `trade.manage`
- **THEN** 允许，来源为兼容回退

#### Scenario: 系统模板 org_admin 不含外贸读写
- **WHEN** 读取系统模板 `org_admin`
- **THEN** 含 `trade.settings.manage`，不含 `trade.read` / `trade.manage`

### Requirement: 外贸接口按键放行
`/api/trade/**` 中按用户鉴权的接口 SHALL 由 `requireTradePermission` 判定：
- 平台 super_admin 放行；
- 其余人 SHALL 在服务端解析出的当前企业内经授权判定持有所需键之一才放行，否则返回 403；
- 读接口（GET）所需键为 `trade.read` 或 `trade.manage`，写接口为 `trade.manage`；
- 发件档案与发件人接口所需键为 `trade.settings.manage`，删除发件人与修改发件邮箱只允许平台 super_admin。

webhook 与 cron 接口 SHALL 维持签名 / 密钥鉴权，不看用户角色。

#### Scenario: 外贸业务员读写
- **WHEN** 持 `trade_rep` 的成员列出与新建外贸客户
- **THEN** 都返回成功

#### Scenario: 没有外贸键
- **WHEN** 只持 `sales_rep` 的成员列出外贸客户
- **THEN** 返回 403

#### Scenario: 老板岗位
- **WHEN** 持窗饰 `owner` 或系统 `org_owner` 模板的成员列出外贸客户
- **THEN** 返回成功

### Requirement: 平台 admin 不带隐含外贸权限
平台角色 `admin`（非 super_admin）、`boss`、`manager` SHALL NOT 因平台角色获得外贸接口权限。企业解析中"显式指定 orgId 即可访问该企业"的通道 SHALL 只对平台 super_admin 开放；其他人（含平台 admin）SHALL 按 active 成员关系与当前企业解析，显式 orgId 只能与解析结果一致。

#### Scenario: 平台 admin 访问非成员企业
- **WHEN** 平台角色为 `admin` 的人带着自己不是成员的企业 orgId 请求外贸接口
- **THEN** 返回 403 或企业上下文不一致，不返回该企业数据

#### Scenario: 平台 super_admin 显式企业
- **WHEN** 平台 super_admin 带着任一企业 orgId 请求外贸接口
- **THEN** 允许，按该企业处理

### Requirement: 消息通道管理按键
外贸消息通道的新增、修改、删除、轮换与查看密钥 SHALL 要求 `trade.settings.manage`（或平台 super_admin）；通道列表读取 SHALL 要求 `trade.read`、`trade.manage` 或 `trade.settings.manage` 之一。

#### Scenario: 企业管理员管通道
- **WHEN** 系统模板 `org_admin` 的成员修改消息通道
- **THEN** 允许

#### Scenario: 外贸业务员不能管通道
- **WHEN** 只持 `trade_rep` 的成员修改消息通道
- **THEN** 返回 403（`CHANNEL_MANAGE_FORBIDDEN`）

### Requirement: 导航与外贸聊天按键
岗位模式企业中，外贸导航入口 SHALL 对持 `trade.read` 的成员可见（另保留平台 `trade` 与管理层）。外贸聊天助手的工具策略 SHALL 使用岗位派生平台角色。

#### Scenario: 岗位模式外贸业务员看导航
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `trade_rep` 的成员加载导航（企业启用外贸模块）
- **THEN** 外贸入口可见

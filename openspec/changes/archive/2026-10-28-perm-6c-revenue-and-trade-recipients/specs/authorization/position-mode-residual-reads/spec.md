## MODIFIED Requirements

### Requirement: 微信绑定默认推送与入职清单按岗位
在岗位模式企业中，新建或重绑微信 / 企微账号的默认推送设置 SHALL 按岗位派生平台角色决定。管理员入职清单的"业务员"判定 SHALL 按是否持 `sales.quote.create`、`sales.quote.pricing_close` 或 `trade.manage`。

#### Scenario: 压扁后的销售绑定微信
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员新绑定微信
- **THEN** 默认开启销售推送，与压扁前平台角色 `sales` 时相同

#### Scenario: 压扁后的外贸业务员算业务员
- **WHEN** 岗位模式企业中平台角色为 `user`、只绑定 `trade_rep` 的成员，生成管理员入职清单
- **THEN** 该成员计入"业务员"，与压扁前平台角色 `trade` 时相同

## ADDED Requirements

### Requirement: 外贸侧栏布局按派生角色
侧栏的外贸"核心 + 更多"两段式布局 SHALL 按 `/api/auth/me` 返回的岗位派生平台角色（`effectiveRole`）判定；派生角色为 `trade` 时启用。旧模式企业的派生角色即平台角色，行为不变。

#### Scenario: 压扁后的外贸业务员
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `trade_rep`（派生角色 `trade`）的成员加载侧栏
- **THEN** 使用外贸两段式布局，与压扁前平台角色 `trade` 时相同

#### Scenario: 老板不用外贸布局
- **WHEN** 岗位模式企业中绑定 `owner`（派生角色 `boss`）的成员加载侧栏
- **THEN** 使用常规布局

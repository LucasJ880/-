## MODIFIED Requirements

### Requirement: 压扁范围
脚本 SHALL 只处理目标企业 active 成员中平台角色为 `boss`、`manager`、`operations`、`sales`、`trade`、`admin` 的人，把其平台角色改为 `user`。平台角色为 `super_admin`、`user` 的人 SHALL NOT 被修改，非 active 成员 SHALL NOT 被修改。`trade` 自 PERM-6c 起纳入（外贸接口、营收中心、外贸收件人与外贸侧栏布局已按岗位判定）；`admin` 自 PERM-7b 起纳入（平台特权只认 `super_admin`，`admin` 已等同 `user`）。前置校验对 `trade` 与 `admin` 成员同样适用。

#### Scenario: 只改四种旧角色
- **WHEN** 企业成员平台角色分别为 `boss`、`sales`、`super_admin`、`admin`、`user`，`admin` 成员有 active 岗位绑定，执行压扁
- **THEN** `boss`、`sales` 与 `admin` 三人变为 `user`，`super_admin` 与 `user` 不变

#### Scenario: 外贸成员一并压扁
- **WHEN** 企业成员平台角色分别为 `boss`、`trade`、`super_admin`，`trade` 成员有 active 岗位绑定，执行压扁
- **THEN** `boss` 与 `trade` 两人变为 `user`，`super_admin` 不变

#### Scenario: 再跑一次无变化
- **WHEN** 压扁成功后对同一企业再执行一次
- **THEN** 计划为 0 人待改，不新增审计记录

#### Scenario: 外贸成员缺岗位绑定
- **WHEN** 待改的平台 `trade` 成员在该企业没有任何 active 岗位绑定
- **THEN** 退出码 2，列出该成员"无岗位绑定"，任何人都不被修改

#### Scenario: 平台 admin 缺岗位绑定
- **WHEN** 待改的平台 `admin` 成员在该企业没有任何 active 岗位绑定
- **THEN** 退出码 2，列出该成员"无岗位绑定"，任何人都不被修改

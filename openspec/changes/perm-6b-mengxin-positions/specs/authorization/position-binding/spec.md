## ADDED Requirements

### Requirement: 入驻与邀请注册后的默认岗位
岗位模式企业中没有绑定即没有权限，因此平台管理员经入驻流程建企业、交接企业负责人，以及成员经企业邀请码注册加入之后，系统 SHALL 立即：
- 落地该企业的岗位模板，并按自动绑定规则绑定：`org_owner` / `org_admin` 成员绑对应系统模板；没有任何绑定的平台 `sales` 成员绑 `sales_rep`、平台 `trade` 成员绑 `trade_rep`；已有任何绑定的人 SHALL NOT 被改动。
- 入驻或交接中指定了企业负责人、且行业包有 `owner` 岗位时，SHALL 给该负责人绑 `owner`，并写一条 `authorization.position.bind` 审计（来源标记为入驻）。

这一步 SHALL NOT 把 `owner` 自动绑给其他 `org_owner` 成员（管理层只来自显式指定或岗位绑定）。

#### Scenario: 入驻家纺外贸工厂
- **WHEN** 平台管理员以 `home_textile_trade_v1` 入驻新工厂并指定老板
- **THEN** 老板绑定 `owner`（管理层），审计来源为入驻；入驻清单把老板算作第一位业务员

#### Scenario: 业务员经邀请码注册
- **WHEN** 平台角色为 `trade` 的业务员用企业邀请码注册加入该工厂
- **THEN** 该业务员绑定 `trade_rep`，可以访问外贸接口并收到询盘通知

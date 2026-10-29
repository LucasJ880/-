# authorization/position-binding Specification

## Purpose
岗位绑定脚本：平台管理员把"人 → 岗位"的对应关系以受控、幂等、可审计的方式写入系统，是 PERM 主线里成员岗位的唯一写入口。

## Requirements

### Requirement: 脚本入口与参数
脚本入口 SHALL 为 `scripts/bind-positions.ts`，接受 `--org <企业 code>`、`--file <绑定文件路径>`、`--actor <平台管理员邮箱>`，可选 `--prune`、`--dry-run`、`--principal-type <HUMAN|DIGITAL_EMPLOYEE>`（缺省 `HUMAN`）。三个必选参数缺任一 SHALL 以退出码 2 结束并打印用法；`--principal-type` 取其他值 SHALL 以退出码 2 结束。

#### Scenario: 缺参数
- **WHEN** 不带 `--file` 运行脚本
- **THEN** 退出码为 2，输出包含用法说明

#### Scenario: 未知主体类型
- **WHEN** 以 `--principal-type GROUP` 运行脚本
- **THEN** 退出码为 2，输出包含用法说明

### Requirement: 保护条件
脚本 SHALL 在环境变量 `ALLOW_POSITION_BINDING` 不等于 `true` 时拒绝执行（退出码 1）；SHALL 在 `--actor` 邮箱对应的用户不存在或平台角色不是 `super_admin` 时拒绝执行（退出码 1）；拒绝时 SHALL NOT 写入任何绑定。

#### Scenario: 未显式允许
- **WHEN** 未设置 `ALLOW_POSITION_BINDING=true` 运行脚本
- **THEN** 退出码为 1，输出包含"ALLOW_POSITION_BINDING"，数据库无变化

#### Scenario: 执行者不是平台管理员
- **WHEN** `--actor` 指向一个平台角色为 `sales` 的用户
- **THEN** 退出码为 1，输出说明执行者必须是平台管理员，数据库无变化

### Requirement: 绑定文件格式与校验
绑定文件 SHALL 为 JSON，顶层 `bindings` 为"邮箱 → 岗位 key 数组"的对象。脚本 SHALL 在以下任一情况下以退出码 2 结束且不写入：邮箱值以 `TODO:` 开头；岗位 key 不在该企业已落地的岗位模板中；邮箱对应的用户不是该企业 active 成员；同一邮箱出现两次。

#### Scenario: 占位邮箱
- **WHEN** 文件中任一键为 `TODO:Bob`
- **THEN** 退出码为 2，输出列出全部占位键，数据库无变化

#### Scenario: 未知岗位 key
- **WHEN** 文件中某邮箱的岗位列表含 `fulfillment_unknown`
- **THEN** 退出码为 2，输出指出该邮箱与未知 key

#### Scenario: 非本企业成员
- **WHEN** 文件中某邮箱的用户不是 `--org` 企业的 active 成员
- **THEN** 退出码为 2，输出指出该邮箱

### Requirement: 幂等写入与差异计划
脚本 SHALL 先计算差异（新增 / 已存在 / 待停用），再写入。已存在且 active 的绑定 SHALL 不重复创建；文件中列出的岗位 SHALL 被创建为 active 绑定；仅在 `--prune` 时，该企业该人身上属于本行业包模板集但未在文件中列出的 active 绑定 SHALL 置为 inactive。`--dry-run` SHALL 只打印差异不写入。

#### Scenario: 重复执行幂等
- **WHEN** 同一文件连续执行两次
- **THEN** 第二次输出"新增 0"，绑定行数与第一次相同

#### Scenario: 不带 prune 不停用
- **WHEN** 文件里去掉某人的一个岗位且不带 `--prune` 执行
- **THEN** 该岗位绑定仍为 active

#### Scenario: 带 prune 停用
- **WHEN** 文件里去掉某人的一个岗位且带 `--prune` 执行
- **THEN** 该岗位绑定置为 inactive，输出"停用 1"

#### Scenario: dry-run
- **WHEN** 带 `--dry-run` 执行
- **THEN** 输出差异计划，数据库无变化，退出码 0

### Requirement: 审计与输出
每条新增或停用的绑定 SHALL 写一条审计记录，含执行者、企业、目标用户、岗位 key、动作。脚本输出 SHALL 包含每人的邮箱与岗位 key 列表及新增 / 停用计数；SHALL NOT 输出数据库连接串、用户密码哈希或任何 token。

#### Scenario: 审计记录
- **WHEN** 脚本新增一条绑定
- **THEN** 审计日志出现一条动作为 `authorization.position.bind` 的记录，目标为该用户

#### Scenario: 输出不含敏感信息
- **WHEN** 脚本以任何退出码结束
- **THEN** 输出不包含 `postgresql://` 字样

### Requirement: 数字员工绑定文件与校验
`--principal-type DIGITAL_EMPLOYEE` 时，绑定文件顶层 `bindings` SHALL 为"Agent id → 岗位 key 数组"。脚本 SHALL 在以下任一情况下以退出码 2 结束且不写入：键以 `TODO:` 开头；Agent 不存在、不是 active 或所属项目不在 `--org` 企业；岗位 key 不在 `sales_rep`、`ops_staff`、`bids`、`accounting` 之内或不在该企业已落地的岗位模板中。保护条件（`ALLOW_POSITION_BINDING`、执行者为平台管理员）、差异计划、`--prune` / `--dry-run` 语义 SHALL 与人类绑定相同。

#### Scenario: 占位配置被拒
- **WHEN** 以 `--principal-type DIGITAL_EMPLOYEE --file config/positions/sunny-digital-employees.json`（仍含 `TODO:` 键）运行
- **THEN** 退出码为 2，输出列出全部占位键，数据库无变化

#### Scenario: 数字员工不能绑老板岗
- **WHEN** 文件中某 Agent 的岗位列表含 `owner`
- **THEN** 退出码为 2，输出指出该 Agent 与不允许的岗位

#### Scenario: 不属于本企业的 Agent
- **WHEN** 文件中某 Agent 属于其他企业的项目
- **THEN** 退出码为 2，输出指出该 Agent

### Requirement: 数字员工绑定写入与审计
数字员工绑定 SHALL 写为主体类型 `DIGITAL_EMPLOYEE`、主体 id 为 Agent id 的岗位绑定；每条新增或停用 SHALL 写一条审计记录，记录中 SHALL 标明主体类型 `DIGITAL_EMPLOYEE` 与 Agent 名称。人类绑定的执行 SHALL NOT 读取或停用数字员工绑定，反之亦然。

#### Scenario: 写入数字员工绑定
- **WHEN** 以合法文件为一个 Agent 绑定 `sales_rep`
- **THEN** 出现一条主体类型 `DIGITAL_EMPLOYEE`、主体 id 为该 Agent id 的 active 绑定，审计动作为 `authorization.position.bind`

#### Scenario: 两类主体互不影响
- **WHEN** 以人类绑定文件带 `--prune` 执行
- **THEN** 已有的数字员工绑定保持不变

### Requirement: 岗位模式企业不做成员角色兼容回退
对岗位模式企业（行业包有岗位模板，如窗饰 `window_covering_services_v1`）的人类主体，有效权限 SHALL 只来自其在该企业的 active 岗位绑定；没有任何 active 绑定时 SHALL 为空，SHALL NOT 按 `OrganizationMember.role`（`org_owner` / `org_admin` / `org_viewer`）或平台角色 `sales` 回退到系统模板。旧模式企业（无岗位模板）SHALL 保持原兼容回退。平台 `super_admin` 的全权 SHALL NOT 受影响。

#### Scenario: 岗位模式企业无绑定的 org_owner
- **WHEN** 窗饰企业的 `org_owner` 成员没有任何 active 岗位绑定，请求 `sales.quote.read`
- **THEN** 判定为拒绝，原因为无绑定

#### Scenario: 岗位模式企业无绑定的平台 sales
- **WHEN** 窗饰企业平台角色为 `sales` 的 `org_member` 没有任何 active 岗位绑定
- **THEN** 有效权限为空（不回退到 `sales_rep`）

#### Scenario: 有绑定照常
- **WHEN** 窗饰企业成员绑定了 `sales_rep` 岗位
- **THEN** 有效权限为该岗位（系统模板 + 行业包并集）的绑定，来源为 `binding:*`

#### Scenario: 旧模式企业照旧回退
- **WHEN** 无岗位模板企业的 `org_owner` 成员没有岗位绑定
- **THEN** 有效权限为系统模板 `org_owner` 的绑定，来源为 `compat:*`

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

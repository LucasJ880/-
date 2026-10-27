# authorization/position-binding Specification

## Purpose
岗位绑定脚本：平台管理员把"人 → 岗位"的对应关系以受控、幂等、可审计的方式写入系统，是 PERM 主线里成员岗位的唯一写入口。

## Requirements

### Requirement: 脚本入口与参数
脚本入口 SHALL 为 `scripts/bind-positions.ts`，接受 `--org <企业 code>`、`--file <绑定文件路径>`、`--actor <平台管理员邮箱>`，可选 `--prune`、`--dry-run`。三个必选参数缺任一 SHALL 以退出码 2 结束并打印用法。

#### Scenario: 缺参数
- **WHEN** 不带 `--file` 运行脚本
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

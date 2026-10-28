# Spec Delta

## MODIFIED Requirements

### Requirement: 脚本入口与参数
脚本入口 SHALL 为 `scripts/bind-positions.ts`，接受 `--org <企业 code>`、`--file <绑定文件路径>`、`--actor <平台管理员邮箱>`，可选 `--prune`、`--dry-run`、`--principal-type <HUMAN|DIGITAL_EMPLOYEE>`（缺省 `HUMAN`）。三个必选参数缺任一 SHALL 以退出码 2 结束并打印用法；`--principal-type` 取其他值 SHALL 以退出码 2 结束。

#### Scenario: 缺参数
- **WHEN** 不带 `--file` 运行脚本
- **THEN** 退出码为 2，输出包含用法说明

#### Scenario: 未知主体类型
- **WHEN** 以 `--principal-type GROUP` 运行脚本
- **THEN** 退出码为 2，输出包含用法说明

## ADDED Requirements

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

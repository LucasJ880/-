# authorization/position-binding-console Specification

## Purpose
岗位绑定的第二个写入口：平台 super_admin 在企业详情页查看并设置成员 / 数字员工的岗位。与 `scripts/bind-positions.ts` 共用同一套校验、差异计算与审计，脚本侧的要求不变。

## Requirements

### Requirement: 只有平台 super_admin 可用
`GET` / `PUT /api/organizations/{orgId}/positions` SHALL 只允许平台 super_admin；其他人（含平台 `admin`、企业 `org_owner` / `org_admin`、持 `owner` 岗位的人）SHALL 收到 403，响应 `code` 为平台管理员要求码。企业不存在 SHALL 返回 404。企业详情页的"岗位"一节 SHALL 只对平台 super_admin 显示。

#### Scenario: 平台 admin 被拒
- **WHEN** 平台角色 `admin` 的人请求某企业的岗位绑定
- **THEN** 返回 403，`code` 为平台管理员要求码

#### Scenario: 老板岗位被拒
- **WHEN** 持 `owner` 岗位、平台角色 `user` 的人提交岗位变更
- **THEN** 返回 403，绑定不变

### Requirement: 读取岗位与绑定
`GET` SHALL 返回：
- 企业是否岗位模式；
- 本企业可绑岗位（active RoleProfile 的 key 与名称，区分行业包岗位与系统模板）；
- 每位 active 成员的 active 人类绑定；
- 本企业 active Agent 的 active 数字员工绑定，含 sponsor（Agent 创建人）；
- 数字员工允许的岗位集合。

#### Scenario: 列出成员岗位
- **WHEN** super_admin 读取 Sunny 的岗位绑定，某成员绑了 `owner` 与 `bids`
- **THEN** 该成员条目的岗位为 `owner`、`bids`

### Requirement: 设置主体的完整岗位集合
`PUT` SHALL 接受主体类型（`HUMAN` / `DIGITAL_EMPLOYEE`）、主体 id 与岗位 key 数组，表示该主体在本企业的完整岗位集合：
- 集合中尚未 active 的岗位 SHALL 新建或重新启用；
- 该主体在本企业、集合之外的 active 绑定 SHALL 停用；
- 已 active 且在集合中的 SHALL 不变。

校验 SHALL 与绑定脚本一致，任一不满足 SHALL 返回 400、列出全部原因且不写入：
- 人：必须是本企业 active 成员，岗位必须是本企业已落地的 RoleProfile；
- 数字员工：Agent 必须存在、active、属于本企业，岗位只允许 `sales_rep` / `ops_staff` / `bids` / `accounting` 且已落地。

人类绑定的变更 SHALL NOT 影响数字员工绑定，反之亦然。

#### Scenario: 给成员加岗位
- **WHEN** super_admin 把某 Sunny 成员的岗位集合设为 `["ops_staff"]`（原来没有绑定）
- **THEN** 新建一条 active `ops_staff` 绑定，该成员随后持运营权限

#### Scenario: 换岗位
- **WHEN** 某成员原有 `sales_rep`，super_admin 把集合设为 `["ops_staff"]`
- **THEN** `ops_staff` 新建，`sales_rep` 停用

#### Scenario: 非成员被拒
- **WHEN** 主体 id 不是本企业 active 成员
- **THEN** 返回 400，不写入

#### Scenario: 数字员工越权岗位
- **WHEN** 给数字员工设置 `owner`
- **THEN** 返回 400，提示只允许四个岗位，不写入

### Requirement: 预览差异
`PUT` 带 `dryRun: true` 时 SHALL 只返回差异（新增 / 保留 / 停用），SHALL NOT 写入绑定或审计。界面 SHALL 先展示差异，经确认后再提交写入。

#### Scenario: 预览不写库
- **WHEN** super_admin 以 `dryRun: true` 提交变更
- **THEN** 返回差异，绑定与审计记录都不变

### Requirement: 最后一个 owner 护栏
岗位模式企业中，若变更后本企业不再有任何 active 的人类 `owner` 绑定，`PUT` SHALL 返回 409（`code` 为 `LAST_OWNER_BINDING`），SHALL NOT 写入。

#### Scenario: 停用唯一老板
- **WHEN** Sunny 只有一人绑 `owner`，super_admin 把此人的集合设为不含 `owner`
- **THEN** 返回 409 `LAST_OWNER_BINDING`，绑定不变

### Requirement: 审计与脚本一致
每条新增或停用的绑定 SHALL 写一条审计记录：
- 动作与绑定脚本相同（`authorization.position.bind` / `authorization.position.unbind`）；
- 含执行者、企业、目标主体、岗位 key；
- 来源标记为界面（脚本为脚本路径）；
- 数字员工记录 SHALL 标明主体类型与 Agent 名称。

审计与响应 SHALL NOT 包含密码哈希或 token。绑定脚本经共用服务执行后，输出、退出码与审计内容 SHALL 与改动前一致。

#### Scenario: 界面绑定留痕
- **WHEN** super_admin 在界面给成员新增 `ops_staff`
- **THEN** 有一条 `authorization.position.bind` 审计，来源为界面，岗位 `ops_staff`

#### Scenario: 脚本行为不变
- **WHEN** 用同一绑定文件运行 `bind-positions --dry-run`
- **THEN** 输出与改动前相同

# authorization/platform-admin-scope Specification

## Purpose
平台特权的归属：跨企业访问、平台控制台入口、AI 平台工具档与平台角色签发只属于平台 `super_admin`；平台角色 `admin` 不带任何平台特权，等同 `user`，能力全部来自岗位绑定（旧模式企业另有企业角色兼容回退）。

## Requirements

### Requirement: 平台控制台入口只认 super_admin
入驻控制台（`/api/admin/onboarding/**`）、能力运行记录（`/api/capabilities/runs/**`）、项目诊断、新建企业（`POST /api/organizations`）、平台公司（`/api/admin/companies`）与邀请码（`/api/admin/invite-codes/**`）SHALL 只放行平台 `super_admin`。其他平台角色（含 `admin`）SHALL 返回 403，错误码 `PLATFORM_ADMIN_REQUIRED`。服务端页面门禁与客户端"平台管理员"判断 SHALL 同口径。

#### Scenario: 平台 admin 打开入驻控制台
- **WHEN** 平台角色 `admin` 的人请求 `GET /api/admin/onboarding`
- **THEN** 返回 403，错误码 `PLATFORM_ADMIN_REQUIRED`

#### Scenario: 平台 admin 新建企业
- **WHEN** 平台角色 `admin` 的人请求 `POST /api/organizations`
- **THEN** 返回 403，不创建企业

#### Scenario: super_admin 照旧
- **WHEN** 平台 `super_admin` 请求入驻控制台、能力运行记录或新建企业
- **THEN** 与本次改动前相同（放行）

#### Scenario: 客户端不显示平台管理员入口
- **WHEN** 平台角色 `admin` 的人加载设置页与侧栏
- **THEN** 不显示只给平台管理员的入口（与 `user` 相同）

### Requirement: 跨企业访问只认 super_admin
企业列表、企业详情 / 修改 / 归档、企业级角色校验的平台旁路、项目访问与可见性、按显式 orgId 解析企业 SHALL 只对平台 `super_admin` 跨企业放行。其他平台角色（含 `admin`）SHALL 按其在该企业的 active 成员资格、岗位绑定与企业角色判定，与平台角色 `user` 相同。

#### Scenario: 平台 admin 的企业列表
- **WHEN** 平台角色 `admin`、只是 Sunny active 成员的人请求 `GET /api/organizations`
- **THEN** 只返回 Sunny

#### Scenario: 平台 admin 访问非成员企业
- **WHEN** 平台角色 `admin` 的人请求自己不是成员的企业的详情或项目列表
- **THEN** 返回 403

#### Scenario: 平台 admin 在本企业按岗位
- **WHEN** 平台角色 `admin`、在岗位模式企业绑定 `owner` 的人请求管理层工作区
- **THEN** 与平台角色 `user` 且绑定 `owner` 的人相同（放行）

#### Scenario: super_admin 跨企业照旧
- **WHEN** 平台 `super_admin` 请求任一企业的详情或项目列表
- **THEN** 与本次改动前相同（放行）

### Requirement: AI 平台工具档只认 super_admin
智能体按平台角色过滤工具、判定智能体追踪的组织级范围、消息网关与执行器的平台视图时，SHALL 只把平台 `super_admin` 当作平台管理员（工具策略表中的 `admin` 档）。平台角色 `admin` SHALL 按 `user` 处理（岗位模式企业先按岗位派生，见 `agents/position-derived-role`）。旧模式企业 Muse 的销售管理层平台角色 SHALL NOT 含 `admin`。

#### Scenario: 旧模式企业平台 admin 无岗位
- **WHEN** 无岗位模板企业中平台角色 `admin`、企业角色 `org_member` 的人启动智能体运行
- **THEN** 工具列表按 `user` 过滤，不含只给 `admin` 档的工具

#### Scenario: super_admin 的工具档
- **WHEN** 平台 `super_admin` 启动智能体运行
- **THEN** 工具列表按 `admin` 档过滤，与本次改动前相同

#### Scenario: 平台 admin 的智能体追踪
- **WHEN** 平台角色 `admin` 的人查询智能体追踪（`GET /api/agent/trace`，该入口只给平台管理员）
- **THEN** 返回 403，错误码 `PLATFORM_ADMIN_REQUIRED`，与 `user` 相同

### Requirement: 不签发平台 admin
创建邀请码与修改平台用户角色 SHALL 拒绝角色 `admin`，返回 400。用历史上签发为 `admin` 的邀请码注册时，新用户的平台角色 SHALL 为 `user`。

#### Scenario: 创建 admin 邀请码
- **WHEN** 平台 `super_admin` 创建角色为 `admin` 的邀请码
- **THEN** 返回 400，不创建

#### Scenario: 把用户改为 admin
- **WHEN** 平台 `super_admin` 把某用户的平台角色改为 `admin`
- **THEN** 返回 400，角色不变

#### Scenario: 旧 admin 邀请码注册
- **WHEN** 用一张角色为 `admin` 的历史邀请码注册
- **THEN** 新用户的平台角色为 `user`

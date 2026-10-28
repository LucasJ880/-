# Spec Delta

## Purpose

销售可视化方案（session 及其照片、窗区、变体、产品选项、导出文件）的访问判定：先限定在调用者的当前企业，再按企业内可见范围放行，任何平台角色都不得跨企业读写。

## ADDED Requirements

### Requirement: 可视化接口按当前企业解析
所有登录态可视化方案接口 SHALL 先解析调用者的当前企业：普通用户取其当前企业（唯一企业时取该企业），请求带的 `orgId` 与当前企业不一致 SHALL 返回 403 `ORG_CONTEXT_MISMATCH`；平台 `admin` / `super_admin` SHALL 显式带 `orgId`，缺少时 SHALL 返回 400；平台 `super_admin` 以外的人在所带企业不是活跃成员时 SHALL 返回 403。

#### Scenario: 平台 admin 带非所属企业
- **WHEN** 平台角色为 `admin`、只是企业 A 成员的人以 `orgId=企业 B` 请求可视化方案列表
- **THEN** 返回 403，不返回任何方案

#### Scenario: 平台 super_admin 缺少企业
- **WHEN** 平台 super_admin 不带 `orgId` 请求可视化方案列表
- **THEN** 返回 400

#### Scenario: 普通用户带他企业 orgId
- **WHEN** 当前企业为 A 的老板以 `orgId=企业 B` 请求可视化方案列表
- **THEN** 返回 403 `ORG_CONTEXT_MISMATCH`

### Requirement: 方案列表只含当前企业
可视化方案列表与"可复用照片"候选 SHALL 只返回所属客户属于当前企业的方案，对平台 `admin`、`boss`、`super_admin` 同样适用。

#### Scenario: 企业 A 老板列方案
- **WHEN** 平台角色为 `boss`、当前企业为梦馨的人请求可视化方案列表，库里同时有 Sunny 客户的方案
- **THEN** 结果只含客户属于梦馨的方案

#### Scenario: 按他企业客户筛选
- **WHEN** 当前企业为 A 的老板以企业 B 某客户的 `customerId` 筛选方案列表
- **THEN** 返回空列表

#### Scenario: 平台 super_admin 以企业 A 为上下文
- **WHEN** 平台 super_admin 以 `orgId=企业 A` 请求可视化方案列表
- **THEN** 返回企业 A 的全部方案，不含企业 B 的方案

### Requirement: 企业内可见范围
在当前企业内，平台角色数据范围为全部（`admin`、`boss`）的人与平台 `super_admin` SHALL 看到企业内全部方案；其他人 SHALL 只看到本人创建、本人为销售负责人、或所属客户由本人创建的方案。

#### Scenario: 销售看他人方案
- **WHEN** 平台角色为 `sales` 的人读取同企业另一位销售为另一位销售的客户创建的方案
- **THEN** 返回 403

#### Scenario: 销售看本人客户的方案
- **WHEN** 平台角色为 `sales` 的人读取同企业他人为该销售创建的客户所建的方案
- **THEN** 返回 200

#### Scenario: 老板看企业内方案
- **WHEN** 平台角色为 `boss` 的人读取同企业任一销售的方案
- **THEN** 返回 200

### Requirement: 跨企业单条访问返回 404
按方案、照片、窗区、变体、产品选项 ID 读取或修改时，方案所属客户不属于当前企业 SHALL 返回 404，与不存在相同；同企业内不在可见范围 SHALL 返回 403。

#### Scenario: 跨企业打开方案详情
- **WHEN** 当前企业为梦馨、平台角色为 `boss` 的人读取 Sunny 某方案详情
- **THEN** 返回 404，响应不含该方案或客户的任何字段

#### Scenario: 跨企业改变体
- **WHEN** 当前企业为 A 的平台 `admin` 修改企业 B 某方案下的变体
- **THEN** 返回 404，变体未变

### Requirement: 新建与打开方案只针对当前企业客户
新建方案与"打开或新建"方案 SHALL 要求客户属于当前企业且未归档；客户不属于当前企业 SHALL 返回 404，与客户不存在同文案；同企业内非全部范围的人 SHALL 只能为本人创建的客户新建，否则返回 403。

#### Scenario: 为他企业客户新建方案
- **WHEN** 当前企业为梦馨、平台角色为 `boss` 的人为 Sunny 的客户新建可视化方案
- **THEN** 返回 404，不创建方案

#### Scenario: 销售为他人客户新建
- **WHEN** 平台角色为 `sales` 的人为同企业他人创建的客户新建方案
- **THEN** 返回 403

### Requirement: 方案文件按所属企业成员放行
文件代理读取 `visualizer/sessions/{方案ID}/…` 下的文件 SHALL 要求调用者是该方案所属企业的活跃成员（平台 `super_admin` 例外），再按企业内可见范围判定；不满足 SHALL 返回 403。

#### Scenario: 他企业老板读方案照片
- **WHEN** 只是梦馨成员、平台角色为 `boss` 的人请求 Sunny 某方案下的照片文件
- **THEN** 返回 403

### Requirement: AI 可视化工具按当前企业限定
AI 助手的"打开或新建可视化方案"与"列出客户可视化方案"工具 SHALL 只在会话的当前企业内解析客户与方案；客户名搜索 SHALL 只匹配当前企业的客户。

#### Scenario: 按客户名找到他企业客户
- **WHEN** 当前企业为 A 的平台 super_admin 用只存在于企业 B 的客户名调用列出方案工具
- **THEN** 工具返回"未找到客户"，不列出企业 B 的方案

### Requirement: 不输出他企业方案与客户
任何登录态可视化接口、文件代理与 AI 工具 SHALL NOT 输出客户不属于当前企业的方案标题、客户名称、照片地址、变体导出图或分享链接。

#### Scenario: 列表与候选不泄露
- **WHEN** 企业 A 的任一平台角色请求方案列表或某方案的可复用照片候选
- **THEN** 响应中不出现企业 B 的客户名称、方案标题或照片地址

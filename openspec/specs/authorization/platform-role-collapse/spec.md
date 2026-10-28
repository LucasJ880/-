# authorization/platform-role-collapse Specification

## Purpose
把岗位模式企业成员的旧平台角色（`boss` / `manager` / `operations` / `sales`）压成 `user` 的受控数据脚本：双闸、前置校验、幂等写入、审计与还原，以及在残留平台角色读点收口前挡住真正写入的代码闸门。

## Requirements

### Requirement: 脚本入口与双闸
系统 SHALL 提供 `scripts/collapse-platform-roles.ts`，参数为 `--org <企业 code>`、`--actor <执行者邮箱>`，可选 `--dry-run`、`--restore`。脚本 SHALL 在环境变量 `ALLOW_ROLE_COLLAPSE` 不等于 `true` 时拒绝（退出码 1），SHALL 在执行者不是平台 `super_admin` 时拒绝（退出码 1），缺少必选参数或企业不存在时退出码 2。

#### Scenario: 未显式允许
- **WHEN** 未设置 `ALLOW_ROLE_COLLAPSE=true` 运行脚本
- **THEN** 退出码 1，不连库写入

#### Scenario: 执行者不是平台管理员
- **WHEN** `--actor` 是平台角色 `admin` 的账号
- **THEN** 退出码 1，不写入

### Requirement: 压扁范围
脚本 SHALL 只处理目标企业 active 成员中平台角色为 `boss`、`manager`、`operations`、`sales` 的人，把其平台角色改为 `user`。平台角色为 `super_admin`、`admin`、`trade`、`user` 的人 SHALL NOT 被修改，非 active 成员 SHALL NOT 被修改。

#### Scenario: 只改四种旧角色
- **WHEN** 企业成员平台角色分别为 `boss`、`sales`、`trade`、`super_admin`、`admin`、`user`，执行压扁
- **THEN** 只有 `boss` 与 `sales` 两人变为 `user`，其余不变

#### Scenario: 再跑一次无变化
- **WHEN** 压扁成功后对同一企业再执行一次
- **THEN** 计划为 0 人待改，不新增审计记录

### Requirement: 前置校验
写入前脚本 SHALL 对整批计划做校验，任一条不满足 SHALL 整批不写、退出码 2 并列出不满足的人与原因：
- 目标企业为岗位模式（行业包有岗位模板）；
- 每个待改的人在目标企业至少有一条 active 的人类岗位绑定；
- 每个待改的人不是任何旧模式企业（行业包无岗位模板）的 active 成员。

#### Scenario: 缺岗位绑定
- **WHEN** 待改的平台 `sales` 成员在该企业没有任何 active 岗位绑定
- **THEN** 退出码 2，列出该成员"无岗位绑定"，任何人都不被修改

#### Scenario: 同时是旧模式企业成员
- **WHEN** 待改的平台 `boss` 成员同时是梦馨（无岗位模板）的 active 成员
- **THEN** 退出码 2，列出该成员与梦馨企业，任何人都不被修改

#### Scenario: 非岗位模式企业
- **WHEN** `--org` 指向无岗位模板的企业
- **THEN** 退出码 2，提示该企业不是岗位模式

### Requirement: 写库闸门
代码常量 `PLATFORM_ROLE_COLLAPSE_READY` 为 false 时，脚本 SHALL 只允许 `--dry-run` 与 `--restore`；不带这两个参数的写入 SHALL 退出码 1，并提示残留平台角色读点清单 `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md`。`--dry-run` SHALL 在闸门关闭时照常打印计划与前置校验结果。残留读点（清单 A / B / C / D1 / D5 组）收口完成后，该常量 SHALL 为 true，写入按前置校验结果执行。

#### Scenario: 闸门关闭时写入被拒
- **WHEN** `PLATFORM_ROLE_COLLAPSE_READY` 为 false，带合法参数且不带 `--dry-run` 执行
- **THEN** 退出码 1，没有任何人的平台角色被修改

#### Scenario: 闸门关闭时 dry-run 可用
- **WHEN** `PLATFORM_ROLE_COLLAPSE_READY` 为 false，带 `--dry-run` 执行
- **THEN** 打印每人"邮箱：前角色 → user"与前置校验结果，退出码按校验结果为 0 或 2，不写库

#### Scenario: 残留读点收口后闸门打开
- **WHEN** 读取代码常量 `PLATFORM_ROLE_COLLAPSE_READY`
- **THEN** 其值为 true

### Requirement: 审计与还原
每压扁一人，脚本 SHALL 写一条审计记录，动作 `authorization.platform_role.collapse`，含目标用户、前角色、后角色 `user` 与来源脚本。`--restore` SHALL 读取目标企业的压扁审计记录，把当前平台角色仍为 `user` 的人还原为记录中的前角色，每人写一条 `authorization.platform_role.restore`；当前角色已不是 `user` 的人 SHALL 跳过并列出。审计与输出 SHALL NOT 包含密码哈希、token 或连接串。

#### Scenario: 压扁留痕
- **WHEN** 平台 `sales` 成员被压扁
- **THEN** 审计记录含前角色 `sales`、后角色 `user`

#### Scenario: 还原
- **WHEN** 压扁后执行 `--restore`
- **THEN** 该成员平台角色回到 `sales`，并有一条还原审计

#### Scenario: 还原跳过已被改过的人
- **WHEN** 压扁后该成员平台角色被另行改为 `trade`，再执行 `--restore`
- **THEN** 该成员不被修改，输出中列为跳过

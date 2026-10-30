# operations/content-approval Specification

## Purpose
运营内容（内容选题、账号与账号组 Playbook、发布任务）的分权：运营人员与运营主管起草和提交，运营主管与老板批准，提交人或创建人不能批准自己的内容（平台 super_admin 例外）；判定只看岗位权限，不看平台角色。

## Requirements

### Requirement: 起草与提交按 operations.content.draft
新建或修改内容选题、AI 生成选题、删除未派发的选题、新建或修改 Playbook 草稿、生成 Playbook AI 草稿与提交 Playbook 审核 SHALL 要求操作者持有 `operations.content.draft`；不持有的人 SHALL 收到 403。平台角色 `operations` / `manager` SHALL NOT 因平台角色获得允许。

#### Scenario: 运营人员起草 Playbook
- **WHEN** 只持 `ops_staff` 岗位的 Maggie 新建账号 Playbook 草稿并提交
- **THEN** 两次请求均返回 200

#### Scenario: 销售起草选题
- **WHEN** 只持 `sales_rep` 岗位的人新建内容选题
- **THEN** 返回 403

### Requirement: Playbook 读取按 operations.read
读取账号或账号组的 Playbook 列表、详情与账号生效上下文 SHALL 要求 `operations.read`；不持有的人 SHALL 收到 403。

#### Scenario: 销售读 Playbook
- **WHEN** 只持 `sales_rep` 岗位的人请求账号 Playbook 列表
- **THEN** 返回 403

### Requirement: 批准与驳回按 operations.content.approve
批准或驳回 Playbook（账号与账号组）、批准或驳回发布任务、把内容选题改为已通过 SHALL 要求操作者持有 `operations.content.approve`；不持有的人 SHALL 收到 403。

#### Scenario: 运营人员批准发布任务
- **WHEN** 只持 `ops_staff` 岗位的 Maggie 批准一条待审发布任务
- **THEN** 返回 403，任务状态不变

#### Scenario: 老板批准选题
- **WHEN** 持 `owner` 岗位的人把一条内容选题改为已通过
- **THEN** 返回 200

### Requirement: 不得自批
批准 Playbook 时，操作者 SHALL NOT 是该 Playbook 的提交人；批准发布任务时，操作者 SHALL NOT 是该任务的创建人；违反时 SHALL 返回 403。只有平台 super_admin SHALL 例外；平台角色 `boss` SHALL NOT 例外。驳回只撤下内容，持 `operations.content.approve` 的提交人 / 创建人 SHALL 可以驳回自己的内容。

#### Scenario: 运营主管批自己提交的 Playbook
- **WHEN** 持 `ops_lead` 岗位的 Marty 批准他自己提交的 Playbook
- **THEN** 返回 403，Playbook 仍为待审

#### Scenario: 老板批运营主管的 Playbook
- **WHEN** 持 `owner` 岗位的人批准 Marty 提交的 Playbook
- **THEN** 返回 200，Playbook 为已批准

#### Scenario: 运营主管批运营人员创建的发布任务
- **WHEN** 持 `ops_lead` 岗位的 Marty 批准 Maggie 创建的发布任务
- **THEN** 允许并按既有流程派发

#### Scenario: 平台角色 boss 自批发布任务
- **WHEN** 平台角色为 `boss`、持 `owner` 岗位的人批准自己创建的发布任务
- **THEN** 返回 403

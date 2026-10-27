# Spec Delta

## ADDED Requirements

### Requirement: 安装工岗位
窗饰企业岗位模板集 SHALL 包含 `installer`（安装工），绑定 `install.task.read`、`install.task.update`、`install.window.complete`，数据范围均为 ASSIGNED。该模板 SHALL NOT 绑定任何 `sales.*` 权限、`install.task.assign` 或 `install.photo.read`。

#### Scenario: 安装工模板
- **WHEN** 读取 `installer` 模板的权限绑定
- **THEN** 三个 `install.*` 键均为 ASSIGNED，无 `sales.` 前缀键，无 `install.task.assign`

### Requirement: 安装相关权限键
权限目录 SHALL 包含 `install.task.read`、`install.task.update`、`install.window.complete`（支持 ASSIGNED 与 ORG）、`install.task.assign`、`install.photo.read`（仅 ORG），每个键 SHALL 有中文标签与风险等级。

#### Scenario: 权限键可识别
- **WHEN** 以上任一键用于授权判定
- **THEN** 判定结果不是 `UNKNOWN_PERMISSION`

### Requirement: 既有岗位追加安装权
`owner`、`ops_lead`、`fulfillment_vinyl`、`fulfillment_drapery`、`fulfillment_shades` SHALL 追加 `install.task.assign`、`install.task.read`、`install.photo.read`（ORG）；`accounting` SHALL 追加 `install.photo.read`（ORG）；`sales_rep` SHALL NOT 追加任何 `install.*`。

#### Scenario: 出单岗可安排安装
- **WHEN** 读取 `fulfillment_vinyl` 模板
- **THEN** 包含 `install.task.assign`（ORG）与 `install.photo.read`（ORG）

#### Scenario: 销售不参与安装
- **WHEN** 读取 `sales_rep` 并集绑定
- **THEN** 不包含任何 `install.` 前缀键

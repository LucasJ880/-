# Spec Delta

## MODIFIED Requirements

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

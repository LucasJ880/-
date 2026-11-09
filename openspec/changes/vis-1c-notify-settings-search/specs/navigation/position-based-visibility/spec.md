# Spec Delta

## ADDED Requirements

### Requirement: 管理总览只对管理层
岗位模式下，侧栏「管理总览」（`/`）SHALL 只对管理层出现（见「岗位模式的管理层」：平台 super_admin 或持 `organization.dashboard.read` 的成员）。旧模式不变。`/` 本身仍为登录即可的路由，进入后的落地规则不变。

#### Scenario: 非管理层的侧栏
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/position-nav.test.ts`
- **THEN** 只持 `ops_lead`、`ops_staff`、`bids`、`accounting`、`installer`、出单岗位或无岗位成员的侧栏不含 `work-home`；`owner` 仍含；其余快照不变，测试通过

#### Scenario: 未绑岗位的平台管理员
- **WHEN** 岗位模式下平台 super_admin 未绑任何岗位
- **THEN** 侧栏仍含 `work-home`（同一测试覆盖）

# Spec Delta

## MODIFIED Requirements

### Requirement: 岗位模式的底栏
岗位模式下，手机底栏 SHALL 在默认落地为 `/sales/home` 时使用销售布局，否则使用通用布局；平台角色 `sales` SHALL NOT 单独决定布局。两种布局里的每个页签 SHALL 只在其目标对当前用户放行时出现（见 `navigation/entry-visibility`「入口判定与路由门同源」）：通用布局的「AI」（`/capabilities`）只在 AI 工作中心放行时出现，「助手」（`/assistant`）只在数字员工放行时出现。通用布局首格在默认工作区不是安装、运营、招投标时 SHALL 指向当前用户的落地页：落地页为 `/` 时为「总览」，为 `/tasks` 时为「任务」，为 `/accounting` 时为「会计」。

#### Scenario: 销售岗位用销售底栏
- **WHEN** 岗位模式下平台角色为 `user`、只持 `sales_rep` 岗位的成员打开手机端
- **THEN** 底栏为销售布局

#### Scenario: 出单的底栏没有 AI 页签
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`，以只持 `fulfillment_vinyl` 岗位的输入计算通用布局页签
- **THEN** 页签里没有「AI」（`/capabilities` 不放行），有「助手」，测试通过

#### Scenario: 首格指向落地页
- **WHEN** 运行同一测试
- **THEN** 只持 `accounting` 时首格为「会计」→ `/accounting`；只持 `fulfillment_vinyl` 或无岗位时首格为「任务」→ `/tasks`；`owner` 首格仍为「总览」→ `/`，测试通过

## ADDED Requirements

### Requirement: 管理总览只对管理层
岗位模式下，侧栏「管理总览」（`/`）SHALL 只对管理层出现。旧模式不变。`/` 本身仍为登录即可的路由，进入后的落地规则不变。

#### Scenario: 非管理层的侧栏
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/position-nav.test.ts`
- **THEN** 只持 `ops_lead`、`ops_staff`、`bids`、`accounting`、`installer`、出单岗位或无岗位成员的侧栏不含 `work-home`；`owner` 仍含；其余快照不变，测试通过

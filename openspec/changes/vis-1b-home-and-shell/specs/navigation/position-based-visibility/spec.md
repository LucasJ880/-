# Spec Delta

## MODIFIED Requirements

### Requirement: 岗位模式的底栏
岗位模式下，手机底栏 SHALL 在默认落地为 `/sales/home` 时使用销售布局，否则使用通用布局；平台角色 `sales` SHALL NOT 单独决定布局。两种布局里的每个页签 SHALL 只在其目标对当前用户放行时出现（见 `navigation/entry-visibility`「入口判定与路由门同源」）：通用布局的「AI」（`/capabilities`）只在 AI 工作中心放行时出现，「助手」（`/assistant`）只在数字员工放行时出现。

#### Scenario: 销售岗位用销售底栏
- **WHEN** 岗位模式下平台角色为 `user`、只持 `sales_rep` 岗位的成员打开手机端
- **THEN** 底栏为销售布局

#### Scenario: 出单的底栏没有 AI 页签
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`，以只持 `fulfillment_vinyl` 岗位的输入计算通用布局页签
- **THEN** 页签里没有「AI」（`/capabilities` 不放行），有「助手」，测试通过

### Requirement: 手机底栏的招投标入口与招投标中心同口径
手机底栏的"招投标"入口 SHALL 与侧栏"招投标中心"按同一规则判定（同一导航入口、同一判定输入，含成员身份、模块与岗位键），侧栏不可见时底栏 SHALL NOT 出现。岗位模式下只对持 `project.create` 或 `project.update` 的成员与管理层出现，只持 `project.read` 或只是某项目成员 SHALL NOT 使其出现；旧模式按旧模式侧栏。

#### Scenario: 会计与出单的底栏没有招投标
- **WHEN** 岗位模式下只持 `accounting` 岗位、或只持 `fulfillment_vinyl` 岗位的成员打开手机端
- **THEN** 底栏没有"招投标"入口（`npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts` 覆盖）

#### Scenario: 招投标岗位的底栏有招投标
- **WHEN** 岗位模式下只持 `ops_lead` + `bids` 岗位的成员打开手机端
- **THEN** 底栏有"招投标"入口

#### Scenario: 底栏与侧栏一致
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`
- **THEN** 对每种测试身份，底栏是否出现"招投标"与侧栏"招投标中心"是否可见的结果相同，测试通过

## ADDED Requirements

### Requirement: 纯销售侧栏不含 AI 任务与数字员工
岗位模式的纯销售（持销售工作键、不是管理层、不持运营 / 招投标 / 会计 / 安装 / 出单键）与旧模式平台角色 `sales` 的侧栏 SHALL NOT 含「AI 任务」（`/workforce`）与「数字员工」（`/assistant`）。按路由门与侧栏同源的规则，这类用户请求 `/workforce/**`、`/assistant`、`/inbox` SHALL 被 302 到 `/sales/home`。其他岗位的侧栏不变。

#### Scenario: 销售侧栏快照
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/position-nav.test.ts`
- **THEN** `sales_rep` 与 `pricing_lead` 的侧栏为日历、销售首页、客户与商机、报价、报价记录、我的业绩、邮箱绑定，不含 `work-ai-jobs` 与 `work-assistant`；其余岗位快照不变，测试通过

#### Scenario: 销售敲 AI 任务
- **WHEN** 只持 `sales_rep` 岗位的成员请求 `/workforce` 或 `/assistant`
- **THEN** 返回 302，`Location` 为 `/sales/home`（`npx tsx src/lib/navigation/__tests__/route-gate.test.ts` 覆盖）

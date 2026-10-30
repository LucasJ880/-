# Design

## Context

- **岗位模式开关**是 `hasPositionTemplates(industryPackId)` = 该行业包在 `POSITION_PROFILE_SETS` 里有岗位（`role-defaults.ts`）。
  - 目前只登记了窗饰；`home_textile_trade_v1`（`industry-packs/registry.ts:124`）没有登记。
  - 登记后，岗位模式的全部规则自动作用于梦馨，不需改判定代码：
    - 导航 / 默认落地 / 管理层（4c2）；
    - 兼容回退关闭（4c3）；
    - 派生角色（4c4 / 6a）；
    - 残留读点（4c5）；
    - 外贸 / 营收 / 收件人（6a / 6c）；
    - 压扁（4c3 / 6c）。
- **梦馨生产成员**：Lucas（`org_owner`，平台 `admin`；已安排改为 super_admin）、Cathy（`org_member`）。
  - 提案时按文档写 Cathy 为平台 `trade`；2026-10-29 在生产库核对，实际是平台 **`boss`**（老板级），且 6a 之后一直没跑 seed（梦馨没有 `trade_rep` 岗位、Cathy 无任何绑定）。见 D6。
- **6a seed 已能自动绑**：`org_owner` 成员 → 系统 `org_owner`，平台 `trade` 成员 → 系统 `trade_rep`。
  - 只要在 6b 上线前对梦馨跑过一次 seed，Cathy 就有一条 `trade_rep` 绑定（岗位模式下绑定照常有效）。
- **Cathy 的落地**：旧模式（平台 `trade`）与岗位模式（只持 `trade_rep`）都是 `/tasks`（本地按 `getDefaultWorkspace` / `resolveHomeRedirect` 核对过）。
- 外贸侧栏布局 6c 起按 `effectiveRole`；Cathy 的派生角色在两种模式下都是 `trade`。

## Goals / Non-Goals

**Goals**：
- 梦馨进入岗位模式；
- Cathy、Lucas 上线前后可用功能一致；
- 之后可以压扁梦馨的平台角色。

**Non-Goals**：
- 收窄数据范围；
- 新外贸岗位；
- 改落地规则。

## Decisions

### D1 只加一个行业包岗位 `owner`，业务员复用系统 `trade_rep`
- `HOME_TEXTILE_TRADE_INDUSTRY_PACK = "home_textile_trade_v1"`：
  - `POSITION_PROFILE_SETS` 登记 `[ owner ]`；
  - `POSITION_TEMPLATE_SETS` 登记 `[{ key: "owner", name: "老板", roleProfileKey: "owner" }]`。
  - `trade_rep` 已是系统模板 + 系统岗位，所有企业都会落地，不重复登记。
- `owner` 的键 = 系统 `org_owner` 的全部键 + `organization.read` + `organization.dashboard.read`（管理层信号）。用代码合成，`org_owner` 以后加键时自动跟上。
- 否决：
  - 复制窗饰 `owner`：含报价 / 出单 / 库存 / 项目财务等窗饰业务键，梦馨用不到；
  - 现在就加"外贸主管"：只有一名业务员。

### D2 上线顺序由合并时机控制
- 岗位模式随部署生效，没有绑定的人立刻无权限。
- **合并前**：
  - Lucas 对梦馨执行 seed（6a 代码已在线）：Cathy 自动绑 `trade_rep`，Lucas 自动绑系统 `org_owner`；
  - 可选 `bind-positions --dry-run` 核对。
  - 我等 Lucas 确认后再合并 6b PR。
- **合并后**：
  - 再跑一次 seed（落 `owner` 模板）；
  - `bind-positions`（或 PERM-7 界面）给 Lucas 绑 `owner`。
  - Lucas 若已是 super_admin，则无论有无绑定都持全部键。
- 否决：为梦馨单独加"岗位模式开关"字段：违反零 schema；也可以用 `settingsJson`，但那是第二套判定，不值得。

### D3 绑定文件
`config/positions/mengxin.json`：

```json
{ "bindings": { "cathy@hlmbedding.com": ["trade_rep"], "lucas@sunnyshutter.ca": ["owner"] } }
```

格式与 `sunny.json` 相同，由既有脚本执行。

### D4 等价核对
沿用 4c2 的对比法：同一 tsx 脚本分别加载 main 与本分支的导航 / 工作区策略，对梦馨两人各打印"默认落地 / 首页重定向 / 可见导航 key"，再做 diff。
- 预期两人一致；
- 有差异逐条写进报告：Lucas 在旧模式按平台 `admin` 全可见，岗位模式下取决于他是否 super_admin / 是否绑 `owner`。
- Cathy 若出现非预期差异，先停下来回报。

### D5 入驻 / 交接 / 邀请注册后落岗位（实施中补充）
- 回归时发现：`onboarding-db.isolated` 在 main 82 / 82，在本分支失败。
  - 原因：新入驻的家纺外贸工厂上线即岗位模式；
  - 入驻流程（`provisionFactoryOrg`）、交接负责人（`updateOnboardingSettings`）与企业邀请码注册（`/api/auth/register`）都不落岗位；
  - 结果：老板不算业务员、询盘通知无人可发。
- 新 `src/lib/authorization/onboarding-positions.ts` 的 `ensureDefaultPositions`：
  - 先 `seedOrgAuthorizationProfiles`（落模板 + 既有自动绑规则）；
  - 岗位模式、行业包有 `owner` 且指定了负责人时，经 PERM-7 共用服务给负责人绑 `owner`（审计 `via: "onboarding"`）。
- 三处调用：入驻之后、交接之后、邀请注册之后。
- 这是平台管理员在入驻中的显式指定，不是"所有 `org_owner` 自动当管理层"，4c1 / 4c2 口径不变。
- 窗饰新企业经入驻也一并受益。原来同样没有绑定，只是没有测试覆盖。

## 与八条硬纪律的关系

1. **零 schema**：触碰。只改代码常量，模板走既有 seed，不加字段（否决 D2 的开关字段）。
2. **出站先审批**：不涉及。
3. **第三套队列**：不涉及。
4. **脱敏**：不涉及。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及（Cathy 的发件设置不变）。
7. **确定性优先**：触碰。全部查表。
8. **测试注册**：触碰。纯测试注册 `test-all` 与 `test-ci-unit`，隔离库测试注册 `test-all`。

### D6 Cathy 绑 `trade_rep` + `owner`（实施中补充，用户 2026-10-29 拍板）
- 生产核对发现 Cathy 是平台 `boss`：旧模式下她是管理层（管理总览、团队分析、Muse 全企业金额、发布营收策略、老板早报）。只绑 `trade_rep` 会让她在合并后失去这些。
- 用户定："外贸业务员 + 老板"。绑定文件改为 Cathy → `trade_rep`、`owner`。
- 结果（本地按生产实情建库核对，main 与本分支同一脚本）：Cathy 压扁前后、Lucas 的派生角色 / 管理层 / 落地 / 可见导航 / 外贸读写 / 收件人与今天完全一致；默认询盘负责人与今天相同（回退企业 owner）。
- 上线方式：生产侧没有可用的本地仓库，合并前用 Neon SQL Editor 执行与 seed 等价的 SQL（落 `trade_rep` 并绑 Cathy；落 `owner` 并绑 Cathy、Lucas）。本地核对过：SQL 可重复执行，之后再跑 6b 的 seed 不再新增任何行。

## Risks / Trade-offs

- **BREAKING**：合并即对梦馨关闭兼容回退。按 D2 操作可避免中断；若漏跑 seed，Cathy 会 403，补跑 seed 即恢复（无需回滚代码）。
- 梦馨导航改按键判定，平台 `admin` 但非 super_admin 的 Lucas 可见范围会缩小到 `org_owner` / `owner` 模板。他已安排改为 super_admin。
- 既有测试里假定"梦馨是旧模式"的用例要改，例如 `platform-role-collapse` 的"同时是旧模式企业成员"阻断。若这些用例用的是无行业包的企业作代表，则不受影响。

## 验证方式

- `npx tsx src/lib/authorization/__tests__/mengxin-positions.test.ts`（新，纯）：
  - 行业包登记；`hasPositionTemplates` 为真；
  - `owner` 含管理层信号与外贸三键、不含 `identity.*.manage`；
  - 模板不含窗饰岗位；
  - 绑定文件可解析且不含 `TODO:`；
  - Cathy（`trade_rep`）与 Lucas（`owner`）的派生角色 / 落地 / 管理层 / 外贸布局；
  - 收件人选择（工作收件人含 Cathy、管理层是 Lucas、默认负责人是 Cathy）。
- `mengxin-positions-db.isolated.test.ts`（新，隔离库，真实路由）：
  - 家纺外贸企业 seed 后落 `owner` 与 `trade_rep`；
  - "先 seed 后进入岗位模式"的顺序下，平台 `trade` 成员外贸 / 营收 200；无绑定成员 403；
  - `owner` 是管理层；
  - 压扁 dry-run：Cathy `trade → user` 进计划、无阻断。
- 回归：`authorize`、`position-nav`、`effective-platform-role`、`platform-role-collapse`、`residual-reads`、`trade-access`、`trade-recipients` 与外贸 / revenue-spine 既有测试。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate perm-6b-mengxin-positions --strict`。

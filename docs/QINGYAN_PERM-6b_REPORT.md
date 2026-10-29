# PERM-6b 报告：梦馨（家纺外贸）落岗位，进入岗位模式

- change：`openspec/changes/perm-6b-mengxin-positions/`（proposal / specs ×2 / design / tasks 5/5）
- 任务书：`docs/QINGYAN_PERM-6_TRADE_TASKBRIEF.md`（6b 段，"拍板结果 · PERM-6b 人员"）
- 人员：用户 2026-10-28 提供"梦馨现在只有 cathy Li 邮箱是 cathy@hlmbedding.com"。企业负责人账号是 Lucas（`lucas@sunnyshutter.ca`）。用户审四件套后确认："6B也行。做下去吧"。
- 零 schema；无新权限键

## 1. 做了什么

| 项 | 改动 |
|---|---|
| 家纺外贸岗位模板 | `role-defaults.ts` 新增 `HOME_TEXTILE_TRADE_INDUSTRY_PACK = "home_textile_trade_v1"`：<br>• 行业包岗位只有 `owner`（老板）= 系统 `org_owner` 全部键 + `organization.read` + `organization.dashboard.read`（代码合成）；<br>• 外贸业务员复用系统 `trade_rep`；<br>• 登记 `POSITION_PROFILE_SETS` / `POSITION_TEMPLATE_SETS` |
| 梦馨进入岗位模式 | 行业包有岗位模板即 `hasPositionTemplates = true`，4c2–6c 的岗位模式规则自动作用于梦馨，判定代码未改：导航、落地、管理层、兼容回退关闭、派生角色、外贸 / 营收 / 收件人、压扁 |
| 绑定文件 | 新 `config/positions/mengxin.json`：`cathy@hlmbedding.com` → `trade_rep`，`lucas@sunnyshutter.ca` → `owner` |
| 入驻 / 交接 / 邀请注册后落岗位（D5，实施中补充） | 新 `src/lib/authorization/onboarding-positions.ts` 的 `ensureDefaultPositions`：seed + 按既有规则自动绑；入驻 / 交接时给指定负责人绑 `owner`（审计 `via: "onboarding"`）。调用点：`provisionFactoryOrg`、`updateOnboardingSettings`（带 `ownerUserId`）、企业邀请码注册（`/api/auth/register`）。见 §3 |

## 2. 怎么验

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint:baseline` | PASS；改动文件 eslint 0 problem |
| `npm run test:ci` | PASS（含新 `mengxin-positions.test`） |
| `bash scripts/check-test-registry.sh` | OK（465） |
| `openspec validate perm-6b-mengxin-positions --strict` | valid |
| `mengxin-positions.test`（新，纯） | **42 / 42**，覆盖见下方说明 |
| `mengxin-positions-db.isolated.test`（新，本地 Postgres 16，真实路由） | **25 / 25**，覆盖见下方说明 |
| 导航对比（4c2 对比法：同一脚本分别在 main 与本分支运行） | 4 组场景全部一致，见 §2a |
| 回归：受影响目录测试文件（起隔离库） | 见 §2b |

`mengxin-positions.test` 覆盖：
- 行业包登记与岗位模式；`owner` 键（⊇ `org_owner`、管理层信号、外贸三键、无成员 / 岗位管理键、无窗饰业务键）；
- 绑定文件；
- Cathy 压扁前后的派生角色 / 外贸布局 / 落地（`/tasks`，与旧模式相同）；
- Lucas 绑 `owner` 是管理层、只有 `org_owner` 时不是；
- 收件人与默认负责人；
- 入驻 / 交接 / 邀请注册三处调用 `ensureDefaultPositions`，且不按 `org_owner` 成员角色批量绑 `owner`。

`mengxin-positions-db.isolated.test` 覆盖（按上线顺序：先 seed）：
- **seed 与模式**：seed 落 `owner` / `trade_rep`，不落窗饰岗位；Cathy 自动绑 `trade_rep`；`active-org` 返回 `positionMode: true`；`/api/auth/me` 里 Cathy 的 `effectiveRole = trade`。
- **Cathy**：外贸读写 200 / 201，营收驾驶舱 200，发布策略 403；是默认询盘负责人。
- **无绑定成员**：外贸 403（兼容回退已关）。
- **Lucas（平台 admin，只有系统 `org_owner` 绑定）**：外贸 200，但还不是管理层收件人。经 PERM-7 接口绑 `owner` 后，成为管理层收件人，并可发布策略。
- **入驻新家纺工厂（D5）**：`provisionFactoryOrg` 后指定老板绑 `owner`、审计 via `onboarding`、是外贸管理层收件人；重复入驻不重复绑定。
- **压扁 dry-run**：Cathy `trade → user` 进计划、无阻断；Lucas（平台 admin）不在范围；不写库。

### 2a. 导航对比（main 旧模式 vs 本分支岗位模式；模块全开）

| 场景 | 默认落地 / 首页重定向 | 可见导航 |
|---|---|---|
| Cathy（平台 `trade` + `trade_rep`）vs 本分支同一人 | `/` → `/tasks`，两边相同 | 25 项，完全相同 |
| Cathy vs 本分支压扁后（`user` + `trade_rep`） | 相同 | 25 项，完全相同 |
| Lucas（平台 admin、`org_owner`）vs 本分支加绑 `owner` | 停在 `/`，两边相同 | 56 项，完全相同 |
| Lucas 为 super_admin | 相同 | 58 项，完全相同 |

Lucas 若仍是平台 admin 且**未绑 `owner`**，岗位模式下不是管理层，首页与管理层菜单会缩小。所以上线顺序要求给他绑 `owner`，或先改为 super_admin。

**按生产实情复核（2026-10-29）**：生产上 Cathy 是平台 `boss`（不是 `trade`）。本地按生产建同样的数据（Lucas 平台 `admin` + `org_owner`；Cathy 平台 `boss` + `org_member`；先 main 代码 seed、再执行 §4 的两段 SQL），同一脚本分别用 main 与本分支代码读库：

| 对象 | 派生角色 | 管理层 | 首页 | 外贸读写 | 可见导航 |
|---|---|---|---|---|---|
| Cathy：main（旧模式，`trade_rep` 绑定）vs 本分支（`trade_rep` + `owner`） | boss → boss | 是 → 是 | `/` → `/` | 有 → 有 | 52 → 52，完全相同 |
| Cathy：本分支压扁后（平台 `user`） | boss | 是 | `/` | 有 | 52，完全相同 |
| Lucas：main vs 本分支（`org_owner` + `owner`） | admin → admin | 是 → 是 | `/` → `/` | 有 → 有 | 57 → 57，完全相同 |

收件人：工作收件人、管理层收件人都是 Cathy + Lucas，两边相同；默认询盘负责人两边都回退为企业 owner（Lucas）——Cathy 派生 `boss`，不在"外贸 / 销售"候选里，与今天一致。

### 2b. 回归

受影响目录（authorization / rbac / navigation / organizations / auth / trade / revenue-spine / sales / agent-core / ai / tenancy / capabilities / messaging / secretary / muse-bridge / marketing）中 `scripts/test-all.sh` 登记的 **142** 个测试文件，起本地隔离库逐个运行：**138 过、4 败**。
- 4 个失败都是 `capabilities/phase3a3-approvals-smoke`、`phase3a4-acceptance`、`phase3a4-governance-smoke`、`phase3a5-overview-acceptance`，断言"Sunny / 梦馨组织存在 / 双租户组织存在"。原因是本地库没有双租户种子，main 上同样失败，与本次无关。
- `organizations/onboarding-db.isolated` 82/82：修复 D5 之前在本分支失败，见 §3。

## 3. 判断与实施中的变更

- **既有测试无需修改**：没有测试假定"梦馨是旧模式"。`platform-role-collapse` 用的是 `mengxin` 字符串的纯数据和无行业包的企业，不受影响。
- **新入驻的家纺外贸企业（实施中补充，design D5）**：
  - 发现：`provisionFactoryOrg` 原本不跑 seed。行业包有了岗位模板后，新入驻的家纺外贸企业上线即岗位模式、没有任何绑定，老板与业务员全部 403。`onboarding-db.isolated` 在 main 上 82/82，在本分支一度失败，就是这个原因。
  - 修复：新增 `ensureDefaultPositions`，在三处调用：
    - 入驻（`provisionFactoryOrg`）：落模板并按既有规则自动绑，再给指定负责人绑 `owner`；
    - 交接负责人（`updateOnboardingSettings` 带 `ownerUserId`）：同上；
    - 企业邀请码注册：只落模板与自动绑（平台 `trade` → `trade_rep`），不绑 `owner`。
  - 口径：只给平台管理员在入驻 / 交接中**显式指定**的负责人绑 `owner`，不按 `org_owner` 成员角色批量绑；已有 active `owner` 绑定的人不重复写。
  - 修复后 `onboarding-db.isolated` 82/82，测试未改。窗饰新企业同样受益：入驻后即有系统模板绑定。

- **生产核对（2026-10-29，design D6）**：
  - Cathy 实际是平台 `boss`，无任何岗位绑定；梦馨没有 `trade_rep` 岗位（6a 之后没跑过 seed）。由于 6a 起外贸接口按权限键判定、平台 `boss` 不再隐含外贸，Cathy 在 SQL 补绑前很可能已经打不开外贸。
  - 用户定 Cathy = 外贸业务员 + 老板，绑定文件改为 `trade_rep`、`owner`；合并前后可用功能一致（§2a）。
  - 生产侧没有可用的本地仓库，改用 Neon SQL Editor 执行与 seed 等价的 SQL（§4）。

## 4. 上线顺序（BREAKING：合并即对梦馨生效）

在 Neon Console → 项目「青砚-AI工作助手」→ 分支 `production`（Default）→ SQL Editor（数据库 `neondb`）执行，SQL 全文见 `docs/QINGYAN_PERM-6b_MENGXIN_SQL.md`。三段 SQL 都只新增、不删不改，可重复执行；本地按生产实情核对过，执行后再跑本分支的 seed 不再新增任何行。

1. **查看（只读）**：列出梦馨每位成员的平台角色、企业角色、当前岗位与已落地岗位模板。
2. **合并前 · 外贸业务员**（2026-10-29 已执行，Cathy 显示 `trade_rep`）：落 `trade_rep` 岗位（`trade.read` / `trade.manage`，全企业）与模板，给 `cathy@hlmbedding.com` 绑定。执行后旧模式下即生效（绑定与兼容回退取并集），Cathy 的外贸权限立刻恢复。
3. **合并前 · 老板**：落家纺 `owner` 岗位（18 条权限，与本分支 `role-defaults.ts` 一致）与模板，给 Cathy、Lucas 绑定。旧模式下同样立即生效，不改变两人今天的可用功能。
4. 再执行一次第 1 步：Cathy 显示 `owner, trade_rep`，Lucas 显示 `org_owner, owner`。
5. 我合并 6b。合并即进入岗位模式，两人可用功能与合并前相同（§2a），无需再跑 seed。
6. 可选：Lucas 改 super_admin（`UPDATE "User" SET role = 'super_admin' WHERE lower(email) = 'lucas@sunnyshutter.ca';`，重新登录生效），7b 合并前必须做。
7. 可选：压扁（Cathy `boss → user`），需本地仓库或另做 SQL；不压扁也不影响功能（岗位模式下平台角色不参与判定）。
8. 漏了第 2 / 3 步就合并：Cathy 会 403 或失去老板级功能。补执行对应 SQL 即恢复，不需要回滚代码。

有本地仓库时，第 2 / 3 步也可以改为在本分支（或合并后的 main）上跑 seed，再执行 `bind-positions --file config/positions/mengxin.json`。

## 5. 合并后

- `/opsx:archive perm-6b-mengxin-positions --yes`，独立小 PR；TASKFLOW PERM-6b → `[x]`。
- 下一个：PERM-7b（AI 工具策略平台 admin 档、`requirePlatformAdmin` 其余入口）。

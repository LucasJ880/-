# USR-1 报告：邀请码直接绑定企业 + 用户管理按企业隔离

| 项 | 值 |
|---|---|
| TASKFLOW | USR-1 |
| OpenSpec change | `openspec/changes/org-scoped-user-onboarding/` |
| 起因 | Lucas 2026-11-09：新员工用销售邀请码注册后什么都看不到（码上勾了公司 Sunny）；用户管理在 Sunny 下也看到所有企业的人 |
| 分支 | `claude/tender-dijkstra-1i94ag`（基于 main `439a19a`） |
| 截图 | `docs/acceptance/usr-1/01–06`（虚构数据，隔离库 + `next dev`） |

## 1. 为什么

- 平台「邀请码」页的「公司归属」只决定登录后左上角的联合品牌 logo（`InviteCode.companyIdsJson`），**不决定加入哪个企业**。用这种码注册会走旧路径：给新人建一个「××的工作区」个人企业。Sunny 是岗位模式企业，没有成员关系和岗位就什么都看不到。
- `InviteCode.orgId` / `orgRole` 两列和注册接口的「企业码 → 直接进企业」路径早就有（厂家入驻向导在用），只是平台邀请码页填不了企业。
- 平台「用户管理」列全平台所有用户，管理员在 Sunny 下打开分不清谁是 Sunny 的员工。

## 2. 改了什么

**邀请码绑定企业**
- `POST /api/admin/invite-codes`：新增选填 `orgId` / `orgRole`（`org_member` 缺省、`org_admin`）。绑定企业时平台角色必须是 `sales` / `trade`、企业必须存在且启用，否则 400。校验函数 `validateAdminInviteOrgBinding` 与注册时的 `checkOrgBoundInvite` 用同一组常量（能建出来的企业码一定能注册成功）。
- `PATCH /api/admin/invite-codes/{id}`：给已有的码补绑 / 改绑 / 解绑企业（解绑同时清空 `orgRole`）；只影响以后的注册。
- `GET /api/admin/invite-codes`：每个码带 `org`（id / 名称 / 状态）。
- 邀请码页：新建表单加「加入企业」「企业内角色」，默认选中当前企业（个人工作区不在下拉里）；选了企业后「绑定角色」只剩销售 / 外贸，并自动带上该企业关联的公司 logo；表单下方写明用这个码注册会进哪个企业、绑什么岗位。列表加「企业」列，铅笔按钮可对已有的码补绑 / 改绑 / 解绑。
- `GET /api/organizations`（平台管理员分支）多返回 `companyId`，供上面自动带 logo。
- 注册：企业码的占用条件从「已用次数 = 读到的值」改为「已用次数 < 上限」（无上限不限）。单次码语义不变；多次使用的团队码不会因两人同时注册误报「已达上限」。其余沿用既有路径：加入企业、当前企业设为该企业、岗位模式企业自动绑默认岗位（sales → `sales_rep`、trade → `trade_rep`）、不建个人工作区。

**用户管理按企业隔离**
- `GET /api/users`（仍只放行平台 super_admin）：`orgId=…` 只列该企业 active 成员并带企业内角色；`scope=platform` 列全平台（原行为）；都没传用当前工作企业；没有当前企业 → 400 `ORG_SCOPE_REQUIRED`（不回落到全平台）；企业不存在 → 404。响应带 `scope`。范围判断是纯函数 `src/lib/users/list-scope.ts`。
- 「用户管理」页：默认「当前企业：××」，只列该企业在册员工，多一列「企业内角色」，底部「×× 共 N 人」；「全平台」是显式按钮；没选企业时提示先选企业。

零 schema（全部是既有列）、零出站、零 LLM、无新队列；两处接口的权限都没放宽。

## 3. 测试与门禁（实际运行）

| 检查 | 结果 |
|---|---|
| `onboarding-rules.test.ts`（+USR-1 绑定校验，含"能建出来的码一定过注册校验"） | 34 passed |
| `list-scope.test.ts`（新增） | 4 passed |
| `list-status.test.ts`（历史欠账，本次补注册并移出基线） | OK |
| `org-scoped-users-db.isolated.test.ts`（新增，隔离库 + 真实路由 + 真实会话） | 31 passed；无库跳过 |
| `onboarding-db.isolated`（企业码注册回归） / `platform-admin-scope-db.isolated` / `ops-authorize-db.isolated`（`/api/users` 权限回归） | 82 / 23 / 32 passed |
| `check-test-registry.sh` | OK，已注册 557，基线剩 68 |
| `npm run typecheck` | exit 0 |
| `npm run lint:baseline` / `test-runtime-architecture.sh` | PASS / PASS（改动文件 0 error；唯一 warning 是用户页原有的头像 `<img>`） |
| `npm run test:ci` | 见 PR 描述 |
| `openspec validate org-scoped-user-onboarding --strict` | valid |

DB 测试覆盖：建码（sales + 企业 → 201；运营角色 / 已归档企业 / 不存在企业 / `org_owner` → 400 不建码；不填企业 = 原行为；平台 admin → 403）、列表企业名、补绑 / 改绑到归档企业被拒 / 解绑、真实注册（加入企业 A、当前企业 = A、只有 A 的成员关系、无个人工作区、`sales_rep` 岗位）、上限 2 第三人 400 且不建用户、补绑后的不限次数码两人都进企业、不绑企业的码仍建个人工作区、用户列表企业范围只含 A 的 active 成员（不含企业 B、无企业账号、已离开 A 的人）、企业内角色、`scope=platform`、`ORG_SCOPE_REQUIRED`、按当前工作企业、404、平台 admin / boss 403。

界面验收（隔离库 + `next dev`，虚构企业 Fixture Blinds Co.）：
- `01` 新建表单默认选中当前企业，角色自动为销售，公司 logo 自动带上，提示写明进哪个企业；
- `02`/`03` 旧销售码（只有公司 logo）用铅笔补绑企业，列表显示「Fixture Blinds Co. · 成员」；
- `04` 在**注册页**用企业码注册的新销售 Sam Ng：登录即进入该企业的「销售首页」，侧栏是销售入口；库里核对为 sales 平台角色、只属于该企业、`sales_rep` 岗位；
- `05` 用户管理在 Fixture Blinds 下只列 4 名员工（含刚注册的 Sam Ng），带企业内角色；
- `06` 切「全平台」后列出所有企业与个人工作区账号。

过程记录：
- 第一次截新员工首页时侧栏为空——演示企业没有配置启用模块（侧栏在"有成员身份但企业未配模块"时按既有规则全部隐藏）。给演示企业配上 `sales` / `window_covering` 后正常。真实 Sunny 已配模块，这是演示数据问题，不是代码问题。
- 截图时 `/admin/users` 控制台有一条 React hydration 不匹配提示；把页面换回 main 的版本同样出现（2 次），是既有问题，与本改动无关。
- DB 测试第一次清理阶段失败（不绑企业的普通用户码注册时旧 bootstrap 会建默认项目，清理没删项目）；补上清理并清掉残留后重跑全过。

以上全部是测试数据，不是真实业务证据。

## 4. 已知局限

- 已经注册过的账号（例如 Lucas 这次新注册、落进个人工作区的账号）不会被自动搬进企业：仍需平台管理员在「成员与组织 → Sunny」把人加进来并设 `sales_rep` 岗位。修改邀请码只影响以后的注册。
- 绑定企业的码只能分配销售 / 外贸；运营、老板等仍走成员页手动添加 + 岗位绑定。
- 企业管理员仍不能自助管理成员（`identity/member-management` 不变）。
- 邀请码列表不按企业筛选（企业列可见）。

## 5. 上线

无迁移、无新 env、无数据脚本；随部署生效。回滚 = 还原文件（已绑定企业的码仍按既有注册路径进企业）。

上线后建议操作（Lucas）：
1. 在「邀请码」页把现有的 Sunny 销售码用铅笔补绑到 Sunny 企业（企业内角色：成员）；
2. 已经注册进个人工作区的那个新账号，在「成员与组织 → Sunny」加为成员并设 `sales_rep` 岗位；
3. 「用户管理」在 Sunny 下核对员工名单。

注意：当前 main 的生产部署仍被 PROC-1 的生产迁移闸门挡住（`20261105120000_add_procurement_records_foundation` 未在生产库执行，见 `docs/QINGYAN_PROC-1_RELEASE_RUNBOOK.md` §3–§4）。迁移执行前，本 PR 合并后也不会上生产。

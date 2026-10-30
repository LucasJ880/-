# PERM-6c 报告：营收中心按外贸键；外贸收件人与默认询盘负责人按岗位；压扁纳入 trade

- change：`openspec/changes/perm-6c-revenue-and-trade-recipients/`（proposal / specs ×4 / design / tasks 6/6）
- 任务书：`docs/QINGYAN_PERM-6_TRADE_TASKBRIEF.md`（6c 段）
- 拍板："拍板结果 · PERM-6c"（2026-10-28："合并后先做6C 的proposal"、"按照你推荐的方式开始实施6C"）
  - 营收中心只认外贸键；
  - 管理层收件人要求持外贸键；
  - 压扁纳入 `trade` 放在 6c。
- 顺序：6c 先于 6b（6b 等梦馨人员与邮箱）。
- 零 schema；不新增权限键。

## 1. 做了什么

| 项 | 改动 |
|---|---|
| 营收中心（D4 / F1） | `resolveRevenueAccess(request, keys, opts?)` 改用 6a 的 `requireTradePermission` + `resolveTradeOrgId`。13 个路由文件、14 个处理器：<br>• GET → `trade.read` 或 `trade.manage`；<br>• POST（转阶段 / 记互动 / 客户已回复 / 跑 FDE / 手工建询盘）→ `trade.manage`；<br>• 策略 PUT → `trade.settings.manage`，策略 GET → 三键任一。<br>删除 `REVENUE_SPINE_ROLES`、`roleCanAccessRevenueSpine` 与策略 PUT 的 `isAdmin \|\| boss` |
| 导航 | `biz-revenue` / `biz-revenue-today` 的 `requiredPlatformRoles` 去掉 `sales`（只影响旧模式） |
| 收件人（D2 / F2） | 新 `src/lib/trade/recipients.ts`：<br>• 工作收件人 = 持 `trade.read` / `trade.manage`；<br>• 管理层收件人 = `isManagementWorkspaceUser`（两种模式同工作区口径）且持外贸读或写键；<br>• 默认负责人 = 派生角色 `trade` / `sales` 的最早在职成员 → 企业 owner。<br>接入点：<br>• `booth-summary.managementOf` 转调 → 展会小结 / 老板早报 / SLA 分级共用；<br>• `inquiry-sla` 首次提醒与 24 小时升级；<br>• `notifyInquiryMembers`（网站询盘 + 通道入站）。<br>删除 `isManagementMember` 与两组角色常量 |
| 默认询盘负责人（D3 / F3） | `resolveInquiryOwner` 的成员查询改为 `resolveDefaultInquiryOwner`（`preferredUserId` 优先不变） |
| 压扁纳入 `trade` | `COLLAPSIBLE_PLATFORM_ROLES` 加 `trade`，前置校验与闸门不变 |
| 侧栏（F4） | 外贸两段式布局按 `effectiveRole`（`/api/auth/me`，4c5） |
| 入职清单（F5） | 岗位模式"业务员"认销售工作键或 `trade.manage`，不再看平台 `trade` |
| 清理 | `BOOTH_CARD_ROLES`（6a 已标 deprecated、无调用方）删除 |
| 残留清单 | `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md` D2–D4 标 6c 已收口；新增 F 组（F1–F5 与"不需要改"复核） |

## 2. 怎么验

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint:baseline` | PASS；改动文件 eslint 0 problem |
| `npm run test:ci` | PASS（含新 `trade-recipients.test`） |
| `bash scripts/check-test-registry.sh` | OK（461） |
| `openspec validate perm-6c-revenue-and-trade-recipients --strict` | valid |
| `trade-recipients.test`（新，纯） | **68 / 68**，覆盖见下方说明 |
| `trade-recipients-db.isolated.test`（新，本地 Postgres 16，真实路由 + 函数） | **23 / 23**，覆盖见下方说明 |
| 回归：test-all 中 trade / revenue-spine / authorization / rbac / navigation / sales / agent-core / ai / auth / organizations / messaging / secretary 目录 102 个测试文件（起隔离库） | **102 / 102** |

`trade-recipients.test` 覆盖：
- 工作 / 管理层 / 默认负责人三个选择函数的矩阵：
  - 旧模式：梦馨两人、平台 boss / manager / admin 非负责人、`org_admin`、super_admin；
  - 岗位模式：owner 压扁前后、`trade_rep`、`sales_rep`、平台 boss 只绑 `sales_rep`；
- 接入点源码断言；
- 营收路由表：13 个文件无 `requireRole` / `isAdmin`；14 个处理器的键组与方法一致；
- 导航不再含 `sales`；
- 压扁范围；
- 侧栏与入职清单。

`trade-recipients-db.isolated.test` 覆盖：
- **营收中心（旧模式）**：
  - 业务员 200；老板 200、发布策略 200；
  - 业务员发布策略 403；
  - 平台 sales 403；不是负责人的平台 boss 403；
  - `org_admin` 读策略 200、驾驶舱 403；
  - super_admin 显式企业 200。
- **营收中心（岗位模式）**：owner 200、`trade_rep` 200、`sales_rep` 403。
- **收件人**：
  - 旧模式工作 = 老板 + 业务员，管理层 = 老板（`managementOf` 同一规则）；
  - 岗位模式工作 = owner + `trade_rep` + seed 自动绑的平台 `trade`，管理层 = owner。
- **默认负责人**：旧模式给业务员（老板先加入也不抢）；岗位模式给 `trade_rep`；`preferredUserId` 优先。
- **压扁 dry-run**：有绑定的平台 `trade` 进计划，无绑定的阻断，不写库。

既有测试的改动：
- `booth-summary.test`、`inquiry-sla.test`：旧的 `isManagementMember` 断言换成新规则断言。
- `scoring-draft.test`：角色矩阵换成键组断言。
- `platform-role-collapse`：
  - 纯测试 37：范围含 `trade`，`trade` 缺绑定 / 同时在梦馨时阻断；
  - 隔离库 38：`trade` 被压扁并能还原。
- `sla-tiers-db.isolated`（54 / 54）：fixture 里的"经理"（平台 manager、`org_member`、无外贸键）原本期望收到升级。按拍板 2 已不再算外贸管理层，所以给经理绑了 `trade_rep`，测试仍验证多收件人升级。被排除的情形由新隔离库测试覆盖。

## 3. 判断与实施中的变更

- **策略 GET 收紧要求**：初稿是"GET 都要读键"。但只持设置键的 `org_admin` 能发布策略、却读不到当前策略，于是改为策略 GET 接受三键任一（策略里没有客户数据）。spec 与 design D1 已同步。
- **收件人一次加载**：`loadTradeMemberSignals` 每个成员解析一次有效权限键，只在确有提醒时调用。`inquiry-sla` 一次加载后同时筛出工作收件人与管理层，不重复查询。
- **成员筛选沿用今天的口径**：通知类只要求成员 active；默认负责人另要求用户 active。
- **`recipients.ts` 不引用 `booth-summary`**：后者转调前者，避免 `owner-brief` 注释里提到的引用环。纯测试有断言。

## 4. 已知限制与上线

- **BREAKING（合并即生效）**：
  - 平台 `sales` / `boss` / `manager` / `admin`（不是企业负责人、无外贸岗位）调营收中心 403；
  - 他们也不再收外贸提醒、早报、展会小结；
  - 只持设置键的 `org_admin` 不再收外贸管理层提醒；
  - 旧模式导航的营收入口不再对平台 `sales` 显示。
- **梦馨生产两人**：结果全部与今天一致（design"等价性"表）。
- **Sunny**：
  - 没开外贸，早报不生成（按模块判断）；
  - 销售员压扁前若用过营收中心，现在 403。这是有意为之，堵住越过本人范围的口子。
- **压扁 `trade`**：只对岗位模式企业生效。Sunny 无外贸成员；梦馨要等 6b 进入岗位模式后才能执行。
- **生产动作**：无数据动作。上线前确认需要收外贸提醒的人是 `org_owner`，或绑了外贸岗位 / 老板岗位。

## 5. 合并后

- `/opsx:archive perm-6c-revenue-and-trade-recipients --yes`，独立小 PR；TASKFLOW PERM-6c → `[x]`。
- 下一个：`perm-6b-mengxin-positions`，需 Lucas 提供梦馨人员与邮箱。6b 后可对梦馨执行压扁（含 `trade`）。
- 另议：AI 工具策略里的平台 `admin` 档（跨所有域）；PERM-7（owner 界面绑岗位）。

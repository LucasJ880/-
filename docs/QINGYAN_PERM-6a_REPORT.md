# PERM-6a 报告：外贸接口按岗位权限键；平台 admin 不再隐含外贸

- change：`openspec/changes/perm-6a-trade-keys/`（proposal / specs ×2 / design / tasks 6/6）
- 任务书：`docs/QINGYAN_PERM-6_TRADE_TASKBRIEF.md`（6a / 6b / 6c 总方案）
- 拍板：任务书"拍板结果 · PERM-6"（2026-10-28："按照你推荐的方式开始做6A"）
  - 拆 6a / 6b / 6c；
  - 外贸业务员范围 6a 保持 `ORG`；
  - 收回平台 admin 的隐含外贸；
  - owner 界面绑岗位另立 PERM-7。
- 零 schema

## 1. 做了什么

| 项 | 改动 |
|---|---|
| 权限键 | `trade.read`（MEDIUM）、`trade.manage`（HIGH）、`trade.settings.manage`（HIGH）；均 ORG、HUMAN only |
| 系统模板 | 新 `trade_rep`（外贸业务员：读 + 写），登记进岗位模板；<br>`org_owner` 加三键；`org_admin` 只加 `trade.settings.manage`；<br>窗饰 `owner` 加三键 |
| 兼容回退 / seed | 旧模式企业 `org_member` + 平台 `trade` → `trade_rep`（岗位模式企业不回退，4c3 规则不变）；<br>`seedOrgAuthorizationProfiles` 把平台 `trade` 的 active 成员自动绑 `trade_rep`（同平台 `sales` → `sales_rep`） |
| 守卫 | `src/lib/trade/access.ts` 新增 `requireTradePermission(request, keys)`：<br>• 返回值与 `requireRole` 同形，调用点只换一行；<br>• super_admin 直接放行；其余人先按成员关系解析当前企业，持任一键才放行（403 `TRADE_PERMISSION_REQUIRED`）。<br>另有 `requireTradePlatformAdmin`（只 super_admin）和 `holdsTradePermission` |
| 接口 | `src/app/api/trade/**` 82 个路由文件、110 个处理器的 `requireRole` 全部替换：<br>• GET → `TRADE_READ_KEYS`（读或写）；<br>• 其余方法 → `TRADE_MANAGE_KEYS`；<br>• 消息通道入口（列表 / 详情 / 新增 / 修改 / 删除）→ `TRADE_CHANNEL_KEYS`（三键任一），管理动作再经 `canManageTradeChannels`；<br>• 发件档案 / 发件人 → `TRADE_SETTINGS_KEYS`；<br>• 删除发件人 → `requireTradePlatformAdmin`；<br>• webhook / cron 不变（机器入口） |
| 平台 admin 收回 | `resolveTradeOrgId` / `assertUserCanAccessTradeOrg` 的"显式 orgId 访问任意企业"只给 `isPlatformSuperAdmin`；<br>`roleCanManageTradeChannels`、发件邮箱 `fromEmail` 修改、线索调研调试评分同样只认 super_admin |
| 消息通道 | `canManageTradeChannels` 改为 super_admin 或持 `trade.settings.manage` |
| 派生角色 | `effective-platform-role.ts` 在运营档之后加"持 `trade.read` → `trade`"；管理层 / 销售 / 运营优先 |
| 导航 | 岗位模式 `tradeEntry` = 平台 `trade` 或管理层或持 `trade.read`；旧模式不变 |
| 清理 | 路由里不再引用 `BOOTH_CARD_ROLES` / `PROFILE_ROLES` / `SENDER_ROLES`；`BOOTH_CARD_ROLES` 导出保留，标 `@deprecated` |

不需要改：
- 外贸聊天助手 `src/lib/trade/chat-assistant.ts`。它调用 `runAgent`，引擎 `src/lib/agent-core/engine.ts` 已经用 `resolveEffectivePlatformRole` 派生角色（4c4），工具策略自动用到新的 `trade` 档。

## 2. 怎么验

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint:baseline` | PASS（error 39，低于基线 53）；改动文件 0 error |
| `npm run test:ci` | PASS（含新 `trade-access.test`） |
| `bash scripts/check-test-registry.sh` | OK（459） |
| `openspec validate perm-6a-trade-keys --strict` | valid |
| `trade-access.test`（新，纯） | **127 / 127**，覆盖见下方说明 |
| `trade-access-db.isolated.test`（新，本地 Postgres 16，真实路由） | **27 / 27**，覆盖见下方说明 |
| `authorize.test` | 159 / 159（外贸兼容回退断言改为 `trade_rep`；岗位键数 18） |
| `embed-intake.test` | 31 / 31（平台 admin 不再能管通道，断言改为 false） |
| 回归：test-all 中 trade / revenue-spine / authorization / rbac / navigation / sales / agent-core / ai / auth 目录 89 个测试文件（起本地隔离库） | **89 / 89**（§2a） |

`trade-access.test` 覆盖：
- 键登记、模板内容、兼容回退映射、seed 自动绑；
- 派生角色 `trade` 档与优先级；
- 通道矩阵（平台 admin 不再隐含）；
- 守卫源码顺序（先解析企业再判键）；
- **路由表**：
  - 82 个文件无 `requireRole(`；
  - 110 个处理器的守卫键与方法一致；
  - 通道写处理器都经 `canManageTradeChannels`；
  - webhook / cron 不看岗位；
- 发件邮箱 / 调试评分只 super_admin；
- 导航认 `trade.read`。

`trade-access-db.isolated.test` 覆盖：
- 旧模式（未 seed）：
  - 平台 `trade` 成员读 200、写 201（兼容回退）；
  - 老板（平台 admin、`org_owner`）读写 200 / 201；
  - 平台 `sales` 403；企业管理员读业务数据 403。
- 平台 admin：
  - 本企业 `org_member` 403（不再隐含）；
  - 显式 orgId 访问非成员企业 403 `ORG_CONTEXT_MISMATCH`。
- 跨企业 query / body orgId 被拒。
- 消息通道：
  - 企业管理员新建通道 201、列表可管理；
  - 外贸业务员改通道 403 `CHANNEL_MANAGE_FORBIDDEN`、列表不可管理；
  - 平台 `sales` 403。
- 岗位模式：
  - `trade_rep` 读写 200 / 201，`sales_rep` 403，`owner` 200；
  - seed 自动绑平台 `trade` 成员。
- super_admin：显式企业 200、未指定企业 400。
- 旧模式 seed 后行为不变。

### 2a. 回归

本地起隔离库（Postgres 16），按 `scripts/test-all.sh` 的注册命令逐个运行 trade / revenue-spine / authorization / rbac / navigation / sales / agent-core / ai / auth 目录的 **89 个测试文件：89 过、0 败**。

其中包含：
- 外贸既有测试：嵌入表单、邮件入站、WhatsApp / 微信进 Revenue Spine、展会卡、发件人、通道入站标识、每日检查等，含各自隔离库端到端；
- `authorize`、`effective-platform-role`、`position-nav`、`platform-role-collapse`（纯 + 隔离库）、`residual-reads`（纯 + 隔离库）；
- 销售授权 e2e。

Sunny / 梦馨双租户种子相关的 `capabilities/phase3a*` 不在这些目录，未受影响。

## 3. 判断与实施中的变更

- **消息通道守卫（实施中修正）**：替换脚本按方法把通道写处理器设成了 `TRADE_MANAGE_KEYS`。这样只持设置键的企业管理员在入口就被拦，与 spec"管理通道要求 `trade.settings.manage`"冲突。
  - 改为通道入口统一 `TRADE_CHANNEL_KEYS`（三键任一，常量由 `TRADE_CHANNEL_LIST_KEYS` 改名），管理动作再经 `canManageTradeChannels`。
  - 业务员拿到的仍是今天的 `CHANNEL_MANAGE_FORBIDDEN`。
  - 经通道发消息（`channels/[channel]/send`）是业务写操作，仍是 `trade.manage`。
  - design D3、tasks 2.1 已同步。纯测试与隔离库测试都有断言兜底。
- **守卫里多解析一次企业**：
  - 非 super_admin 的企业解析只依赖成员关系与 `activeOrgId`，守卫与路由解析结果一致。
  - 显式 orgId 不一致时，守卫先返回 `ORG_CONTEXT_MISMATCH`（与路由自己解析的响应相同）。
- **`resolveTradeOrgId` 是共用的**（design D5）。销售（`sales/org-context.ts`）、租户上下文（`tenancy/context.ts`）、秘书动作、营收中心都经它解析企业。
  - 平台 admin 在这些入口也改为按成员关系。
  - 销售 4a 后本来就按 `authorize()`，平台 admin 在非成员企业无键；租户上下文没有调用方开 `allowPlatformBypass`，非成员本来就 403。两处实际行为不变。
  - 营收中心（`requireRole` 仍含 `admin`，6c 处理）里平台 admin 只能进自己所在的企业。
- **企业管理员（系统 `org_admin`）只拿设置键**：
  - 能管通道和发件设置，看不到外贸业务数据，与"系统模板 `org_admin` 不挂业务数据"一致（4c1 教训）。
  - 旧模式里"平台 `trade` + `org_admin`"的人兼容回退会落到 `org_admin` 模板，失去外贸读写。生产上梦馨没有这样的人（见 §4）。

## 4. 已知限制与上线

- **BREAKING（合并即生效）**：
  - 平台 `admin`（非 super_admin）不再有隐含外贸。是本企业 `org_owner` 的仍可用（系统模板）；否则需要绑 `trade_rep`。
  - 平台 admin 不能再用显式 orgId 进非成员企业（外贸 / 销售 / 营收共用的企业解析）。
  - 旧模式企业里不是 `org_owner` 的平台 `boss` / `manager` 失去展会卡 / 发件档案 / 发件人。
  - 删除发件人、改发件邮箱只剩平台 super_admin。
- **梦馨（旧模式）**：生产两人，行为不变。
  - 老板：平台 admin + `org_owner` → `org_owner` 模板含外贸三键。
  - 外贸业务员：平台 `trade` + `org_member` → 兼容回退 `trade_rep`。
  - 合并后建议重跑 seed，把回退变成实绑。
- **Sunny（岗位模式）**：
  - 没开外贸，导航不变；`owner` 模板加了外贸三键，开外贸后老板直接可见。
  - 业务员要外贸时绑 `trade_rep`。
- **生产动作**：
  1. 合并后对梦馨与 Sunny 重跑 `seedOrgAuthorizationProfiles`：
     - 梦馨外贸业务员自动绑 `trade_rep`；
     - 两家的 `org_owner` / `org_admin` / `owner` 模板拿到新键。
  2. 查 `User.role='admin'` 的账号：需要外贸又不是 `org_owner` 的，绑 `trade_rep`，或改为 super_admin。

## 5. 合并后

- `/opsx:archive perm-6a-trade-keys --yes`，独立小 PR；TASKFLOW PERM-6a → `[x]`。
- 下一个：`perm-6b-mengxin-positions`。开工前需要 Lucas 确认梦馨人员与邮箱（任务书判断点 4）。
- 之后：`perm-6c-revenue-and-trade-recipients`（营收中心与外贸收件人）、PERM-7（owner 在界面上绑岗位）。

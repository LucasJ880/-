# Design

## Context

- `src/app/api/trade/**`：82 个路由文件中，75 个用 `const auth = await requireRole(request, …)`，共 110 处，写法完全一致，随后 `resolveTradeOrgId(request, auth.user, …)` 解析企业。
  - `requireRole`（`src/lib/auth/guards.ts:102`）对平台 admin / super_admin 直接放行，其余要求 `User.role` 在列表内。
  - 数据范围：除外贸聊天按本人外全部是全企业；没有按负责人过滤的路由。
- `resolveTradeOrgId`（`src/lib/trade/access.ts:77`，销售 / 外贸 / 营收共用）：
  - 平台 admin / super_admin 显式传 orgId 即可访问任意存在的企业，不查成员关系；
  - 其余人按 active 成员关系 + `activeOrgId` 解析，显式 orgId 只能与之一致。
- 消息通道管理 `canManageTradeChannels`：平台 admin 或企业 `org_owner` / `org_admin`。
  - 发件档案 / 发件人：`PROFILE_ROLES` / `SENDER_ROLES` = boss / manager / admin；
  - 删除发件人 `["admin"]`；`fromEmail` 只 `isAdmin` 可改；
  - 展会卡 `BOOTH_CARD_ROLES` = trade / boss / manager / admin。
- 权限目录、系统模板、窗饰模板都没有外贸键。
- 梦馨（旧模式）生产有 2 名成员：平台 admin + `org_owner`，平台 `trade` + `org_member`。
- 4c3 已关闭岗位模式企业的兼容回退；4c4 派生角色把 `trade` 当保留角色原样透传。

## Goals / Non-Goals

**Goals**：
- 外贸接口按键判定，等价迁移（全企业范围不变）；
- 平台 admin / boss / manager 不再有隐含外贸权限；
- 企业负责人按模板获得外贸，修复"导航显示、接口 403"；
- 梦馨在 6b 落岗位前行为不变；
- 为 6b / Sunny 开外贸铺好岗位路径。

**Non-Goals**：
- 按负责人收窄（6b）；
- 营收中心与外贸收件人（6c）；
- 外贸业务逻辑；
- webhook / cron 鉴权。

## Decisions

### D1 三个键，按读 / 写 / 设置分
- `trade.read`、`trade.manage`、`trade.settings.manage`。
- 今天外贸接口不分读写（同一角色列表），6a 等价迁移只需要"持有外贸 = 读写"。但仍把读写分开：6b 要给只读角色（例如老板只看）留位置。
- 设置类（通道 / 发件档案 / 发件人）单独成键，等价于今天"企业负责人 / 管理员能管通道"的口径。
- 否决：细到 `trade.outreach.send` / `trade.booth.manage`——6a 没有任何岗位需要区分它们；等 6b 按梦馨分工再加，避免先造无人使用的键。

### D2 守卫保持 `requireRole` 的调用形状
`requireTradePermission(request, keys)` 返回 `AuthResult | NextResponse`，每个调用点只替换一行：

```ts
const auth = await requireRole(request, ["trade", "admin"]);
```

改为：

```ts
const auth = await requireTradePermission(request, TRADE_READ_KEYS);
```

守卫内部：
- `requireAuth`；
- 平台 super_admin 直接返回（平台管理员持全部键，企业由路由自己的 `resolveTradeOrgId` 按显式 orgId 处理）；
- 其余人 `resolveTradeOrgId(request, user)` 解析企业。非 super_admin 的解析只依赖成员关系与 `activeOrgId`，显式 orgId 仅作交叉校验，所以在守卫里解析与路由里解析结果一致；
- 然后 `authorize()` 持任一键即放行。

替换用脚本按处理器方法决定：GET → `TRADE_READ_KEYS`（`trade.read` 或 `trade.manage`），其余方法 → `TRADE_MANAGE_KEYS`。三组角色常量按 D3 处理。
- 否决：把守卫与企业解析合成一个、路由删掉自己的 `resolveTradeOrgId`——要改 110 处的后续逻辑（`bodyOrgId` 等），风险大、收益小。

### D3 设置类与平台级操作
- 发件档案（`PROFILE_ROLES`）、发件人（`SENDER_ROLES`）→ `trade.settings.manage`；
- 发件人 DELETE（`["admin"]`）与 `fromEmail` 修改（`isAdmin`）→ 平台 super_admin。这两项是平台级配置，与 4b"平台用户管理只 super_admin"一致；
- 展会卡（`BOOTH_CARD_ROLES`）→ 按方法走读 / 写键；
- 消息通道：
  - 通道入口（列表 / 详情 / 新增 / 修改 / 删除）的守卫 → 三键任一（`TRADE_CHANNEL_KEYS`），企业管理员只持设置键也能进入；
  - 写与查看密钥 → `canManageTradeChannels` 改为 super_admin 或持 `trade.settings.manage`；只持读写键的业务员在这里得 `CHANNEL_MANAGE_FORBIDDEN`，与今天一致；
  - 经通道发消息（`channels/[channel]/send`）是业务写操作 → `trade.manage`。

### D4 模板与兼容回退
- **新系统模板 `trade_rep`**（`trade.read` + `trade.manage`，ORG），登记进 `SYSTEM_POSITION_TEMPLATES`。
- **`org_owner`**（系统）：加三个外贸键。梦馨老板（平台 admin、`org_owner`）经 seed 自动绑或兼容回退获得外贸，不因收回平台 admin 而断。
- **`org_admin`**（系统）：只加 `trade.settings.manage`，等价于今天的通道管理口径。系统模板的 `org_admin` 本来就不含业务数据。
- **窗饰 `owner`**：三个外贸键。Sunny 若开外贸，老板可见。
- **兼容回退**：`compatProfileKeyForMembership` 增加 `org_member` + 平台 `trade` → `trade_rep`（只在旧模式企业生效，4c3 规则不变）。
- **seed**：平台 `trade` 的 active 成员自动绑 `trade_rep`，同平台 `sales` → `sales_rep`；已有 owner / admin 绑定的不覆盖。
- 否决：给系统 `org_admin` 加外贸读写——4c1 教训：seed 会自动把 `org_admin` 成员绑到系统模板，业务数据不应挂在管理员模板上。

### D5 平台 admin 收回，含企业解析
- `resolveTradeOrgId` 的 admin 分支改为只对 `isPlatformSuperAdmin`。
- 它同时被销售 / 营收入口使用：
  - 销售在 4a 后按 `authorize()` 判定，平台 admin 在非成员企业本来就没有键；
  - 营收（6c 前）仍是 `requireRole`，平台 admin 访问非成员企业会变成"按成员关系解析"，与其他模块口径一致。

### D6 AI 与导航
- **派生角色**：在 `operations` 之后加"持 `trade.read` → `trade`"。管理层 / 销售 / 运营优先，与 4c4"取最高一项"一致。外贸聊天助手 `chat-assistant.ts` 的工具策略改用派生角色。
- **导航**：岗位模式 `tradeEntry` 判定由"平台 `trade` 或管理层"扩为"平台 `trade` 或管理层或持 `trade.read`"。旧模式不变。

## 与八条硬纪律的关系

1. **零 schema**：不涉及。新键是代码常量，模板走既有 RoleProfile 种子。
2. **出站先审批**：触碰。外贸发信 / 报价路径本身不变，只换鉴权；本次不新增出站。
3. **第三套队列**：不涉及。
4. **脱敏**：不涉及。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：触碰。发件人 / 发件档案接口只改鉴权，`fromEmail` 与授权邮箱分离的逻辑不动。
7. **确定性优先**：触碰。全部查表，无 LLM。
8. **测试注册**：触碰。纯测试注册 `test-all` 与 `test-ci-unit`，隔离库测试注册 `test-all`。

## Risks / Trade-offs

- **BREAKING**：
  - 平台 `admin`（非 super_admin、非 `org_owner`、无外贸岗位）失去外贸；平台 admin 不能再显式访问非成员企业。
  - 旧模式企业里不是 `org_owner` 的平台 `boss` / `manager` 失去展会卡 / 发件档案 / 发件人。
  - 上线前确认这些人在需要的企业里是 `org_owner` 或绑了岗位。
- 每个外贸请求多一次企业解析 + 1–3 次授权查询（路由里还会再解析一次企业）。
- 外贸读写同键持有，6a 不区分只读，6b 再细分。

## 验证方式

- `npx tsx src/lib/trade/__tests__/trade-access.test.ts`（新，纯）：
  - 键登记与 HUMAN-only；模板内容（`trade_rep` / `org_owner` / `org_admin` / 窗饰 `owner`）；
  - 兼容回退映射；派生角色 `trade` 档与优先级；`roleCanManageTradeChannels` 新口径；
  - **路由表源码断言**：`src/app/api/trade/**` 无 `requireRole(`；每个处理器的守卫键与方法一致（GET 读键、其余写键、通道入口、设置类、super_admin 类）；webhook / cron 不含守卫；
  - `resolveTradeOrgId` 只对 super_admin 开显式企业通道。
- `trade-access-db.isolated.test.ts`（新，隔离库，真实路由）：
  - 旧模式平台 `trade` 成员读写 200（兼容回退）；
  - `org_owner`（平台 admin）200；
  - 平台 admin 非成员显式 orgId 被拒；`sales_rep` 403；
  - 岗位模式 `user` + `trade_rep` 200；
  - 平台 super_admin 显式企业 200；
  - `org_admin` 改通道 200、`trade_rep` 改通道 403；
  - 跨企业 orgId 不一致被拒。
- 回归：trade / revenue-spine 既有测试，`authorize`、`effective-platform-role`、`position-nav`、`platform-role-collapse`、`residual-reads`。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate perm-6a-trade-keys --strict`。

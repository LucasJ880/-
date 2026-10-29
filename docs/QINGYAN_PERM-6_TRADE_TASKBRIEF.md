# PERM-6 外贸按岗位 — 任务书（总体方案）

TASKFLOW：PERM-6（`docs/QINGYAN_PERMISSION_TASKFLOW.md`，待新增行）；前置：PERM-4c5（压扁写库闸门已打开，外贸读点 D2–D4 明确留给本阶段）。
依据：`docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md` D2–D4；任务书 `docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md` Out of scope"外贸模块 `requireRole`（另立 PERM-6）"；PERM-5b 报告"owner 界面绑定留 PERM-6"。

## Why

PERM-1 至 PERM-4c5 已让销售、运营、招投标、会计、安装、导航、AI 一侧按岗位。外贸模块仍完全按平台角色，具体有四块：
- **接口**：`src/app/api/trade/**` 共 82 个路由文件，其中 75 个用 `requireRole`，共 110 处。
  - 98 处只放行平台 `trade` / `admin`；
  - 展会卡用 `BOOTH_CARD_ROLES`（trade / boss / manager / admin）；
  - 发件档案、发件人用 boss / manager / admin；
  - 渠道写入看 `canManageTradeChannels`（平台 admin 或企业 `org_owner` / `org_admin`）；
  - webhook 6 个、cron 1 个不看用户角色（签名 / 密钥），不改；
  - 数据范围：除外贸聊天按本人外，**全部是全企业**，没有按负责人过滤的路由。
- **营收中心**：`revenue-spine` 13 个 `/api/revenue/*` 用 `requireRole(["trade","sales","boss","manager","admin"])`。
- **外贸收件人**：询盘晨报、SLA 升级、展会汇总、询盘通知、默认询盘负责人，都按平台角色选人（`inquiry-sla.ts`、`website-inquiry.ts`、`booth-summary.ts`、`inquiry-intake.ts`、`sla-tiers.ts`、`owner-brief.ts`）。
- **不一致**：导航与管理总览把外贸显示给 boss / manager，但 98 处接口只放行 trade / admin，boss / manager 进外贸页面后多数接口返回 403。
- **既有越权口子**：`resolveTradeOrgId`（`src/lib/trade/access.ts:86-100`）对平台 admin / super_admin 只要显式传 orgId 就放行任意企业，不查成员关系。`docs/PLATFORM_CONTROL_PLANE_AUDIT.md:306` 已记录。
- **AI 外贸工具**：`_policy.ts` 的 `trade_*`（13 个）与 `product_content_*`（13 个）只给 `admin` / `trade`；外贸聊天助手直接传原始 `User.role`。
- **权限目录**：现在没有任何外贸 / 营收 / 询盘 / 产品内容权限键；系统模板与窗饰模板都不涉及外贸。

两个后果：
1. **梦馨（外贸主业）无法落岗位。** 梦馨的行业包 `home_textile_trade_v1` 没有岗位模板，仍走"平台角色 + 成员角色兼容回退"的旧模式。外贸权限不能按"业务员只看自己的客户、主管看全部、老板审批"细分，平台角色压扁也无法推广到梦馨。
2. **Sunny 以后要开外贸时没有路径。** Sunny 已是岗位模式，压扁后 `trade` 是唯一保留的业务平台角色（4c3 不动 `trade`）。

本阶段把外贸按岗位权限键判定，并给梦馨落岗位，使两家企业最终都只剩 `super_admin / user` 两种平台角色（设计稿 §2.1 终态）。

## What（拆成 3 个 change，各一个 PR）

### PERM-6a `perm-6a-trade-keys`：外贸权限键与接口授权
- **新增权限键**（暂定，审核定名）：
  - `trade.read`（看外贸客户 / 询盘 / 活动 / 报价 / 样品）；
  - `trade.manage`（写）；
  - `trade.outreach.send`（对外发信 / 报价，出站仍走审批）；
  - `trade.channel.manage`（渠道 / 发件档案 / 发件人）；
  - `trade.booth.manage`（展会卡）；
  - `product_content.manage`（产品内容总监）。
- **新增系统模板 `trade_rep`**：持 `trade.read` / `trade.manage` / `trade.outreach.send`，范围待拍板。
- **兼容回退**：旧模式企业中平台角色 `trade` 的成员回退到 `trade_rep`，方式同今天平台 `sales` → `sales_rep`。梦馨在 6b 落岗位前行为不变。
- **管理层**：系统模板 `org_owner` / `org_admin` 补外贸读写键，修复上面"导航显示、接口 403"的不一致（旧模式经兼容回退，岗位模式经老板岗位）。
- **接口改造**：`src/app/api/trade/**` 的 `requireRole` 改为 `requireTradePermission(request, key)`，内部走 `authorize()`，按读 / 写 / 发 / 渠道 / 展会分键。webhook / cron 路由不看用户角色，维持签名或 cron 鉴权。
- AI 外贸工具在岗位模式企业按外贸键派生（扩展 4c4 的派生规则：持 `trade.read` → `trade`）。

### PERM-6b `perm-6b-mengxin-positions`：梦馨落岗位
- 为 `home_textile_trade_v1` 定义岗位模板。生产上梦馨目前只有 2 名成员：老板（平台 `admin`、`org_owner`）和 1 名外贸业务员（平台 `trade`，默认询盘负责人）。按此暂定 2–3 个岗位：老板 `owner`、外贸业务员 `trade_rep`，可选外贸主管。
- 绑定文件 `config/positions/mengxin.json`，用既有 `bind-positions` 脚本执行。
- 梦馨切换为岗位模式：导航、落地、AI、兼容回退收口，全部沿用 4c2–4c5 已有逻辑，只需行业包有模板即自动生效。
- 之后对梦馨执行平台角色压扁（4c3 脚本，`trade` 也压成 `user`）。

### PERM-6c `perm-6c-revenue-and-trade-recipients`：营收中心与外贸收件人
- `revenue-spine/access.ts` 与 `/api/revenue/policy` 改按外贸 / 销售键。
- 询盘晨报、SLA 升级、展会汇总、询盘通知、默认询盘负责人按岗位键选人（残留清单 D2–D4）。
- 收口后，4c3 压扁脚本可以连 `trade` 一起压（脚本范围从 `boss/manager/operations/sales` 扩到含 `trade`）。

## 判断点（2026-10-28 已拍板，见文末）

1. **拆分**：按上面 6a → 6b → 6c 三个 change 的顺序，还是合并？推荐拆分，每个 ≤ 8 tasks。
2. **外贸业务员的数据范围**：业务员只看自己负责的客户 / 询盘（`PRINCIPAL` / `ASSIGNED`），还是全企业外贸数据都能看（`ORG`）？今天平台 `trade` 实际看全企业。推荐保持 `ORG`，6a 只做等价迁移；收窄放到 6b，按梦馨岗位细分。
3. **平台 `admin`（非 super_admin）在外贸**：今天 `requireRole` 对 admin 直接放行，`resolveTradeOrgId` 还允许它显式访问任意企业。4a / 4b / 4c 已在其他模块收回平台 admin 的隐含权限。外贸也收回、只认 super_admin 与岗位（并让 `resolveTradeOrgId` 的跨企业放行只留给 super_admin），还是暂时保留？推荐收回，与前面一致。注意梦馨老板的平台角色就是 `admin`：收回前须先给他补系统模板或岗位绑定，否则他会失去外贸。
4. **梦馨的岗位与人员**：生产文档显示梦馨只有老板 + 1 名外贸业务员。请确认人员是否就这两位、以后会不会加外贸主管 / 内容人员，并提供两人邮箱（写绑定文件用）。6a 不需要这些，可以先做。
5. **owner 在界面上绑岗位**（PERM-5b 留下的项）：并入 PERM-6，还是另立 PERM-7？推荐另立。它涉及界面和审批，与外贸授权无关。

## Out of scope

- Sunny 开通外贸模块本身（业务决定；6a 之后 Sunny 给相应的人绑外贸岗位即可）。
- 外贸业务逻辑、页面改版。
- 数字员工外贸岗位（5b 只开放了 4 个岗位；外贸数字员工另议）。

## Impact（以 6a 为例）

- 修改：
  - `src/lib/authorization/{permissions,role-defaults,resolve-effective-permissions}.ts`；
  - `src/lib/auth/guards.ts`（新增 `requireTradePermission`）；
  - `src/app/api/trade/**`（75 个文件）；
  - `src/lib/rbac/effective-platform-role.ts`（外贸键派生）。
- 测试：外贸授权纯测试（键 × 路由表源码断言）、隔离库 e2e（旧模式平台 `trade` 行为不变、岗位模式按键、跨企业不可见）。
- 零 schema。
- **行为变化**：仅当第 3 点决定收回平台 `admin` 时，平台 admin 会失去外贸访问。其余在 6a 中等价。


### 拍板结果 · PERM-6（2026-10-28："按照你推荐的方式开始做 6A"）
1. **拆成三个 change**：`perm-6a-trade-keys` → `perm-6b-mengxin-positions` → `perm-6c-revenue-and-trade-recipients`，各一个 PR。
2. **外贸业务员数据范围**：6a 保持全企业（`ORG`，等价迁移），按负责人收窄放到 6b 按梦馨岗位细分。
3. **平台 `admin`（非 super_admin）收回外贸隐含权限**：只认平台 super_admin 与岗位键；`resolveTradeOrgId` 的"显式 orgId 访问任意企业"只留给 super_admin。梦馨老板（平台 admin、`org_owner`）经系统模板 `org_owner` 获得外贸键，不受影响。
4. **梦馨人员**：6b 开工前提供（目前生产为老板 + 1 名外贸业务员）。
5. **owner 界面绑岗位**另立 **PERM-7**。

### 拍板结果 · PERM-6c（2026-10-28："合并后先做6C 的proposal"；"按照你推荐的方式开始实施6C"）
顺序：6c 先于 6b（6b 等梦馨人员与邮箱）。change `perm-6c-revenue-and-trade-recipients` 的三个待拍板全部按推荐：
1. **营收中心只认外贸键**：平台 `sales` 不再进营收中心（Sunny 销售车道不经此 API；同时堵住销售员经营收中心看全企业商机）。
2. **外贸管理层收件人要求持外贸读或写键**：只持设置键的 `org_admin`、不是企业负责人的平台 boss / manager / admin 不再收外贸升级与早报。
3. **压扁范围加 `trade` 放在 6c**：6b 只需落岗位与执行压扁。

### 拍板结果 · PERM-6b 人员（2026-10-28："梦馨现在只有 cathy Li 邮箱是 cathy@hlmbedding.com"）
- 梦馨实际人员只有 Cathy Li（`cathy@hlmbedding.com`，外贸业务员，生产为平台 `trade` / `org_member`）；企业负责人账号是 Lucas（`lucas@sunnyshutter.ca`，`org_owner`）。
- 6b 按此只落两个岗位：行业包 `owner`（Lucas）与系统 `trade_rep`（Cathy）；数据范围维持全企业，不预建外贸主管。

### 拍板结果 · PERM-6b Cathy 岗位（2026-10-29）
- 生产核对：Cathy 是平台 `boss`（不是文档里的 `trade`），无任何岗位绑定；梦馨没有 `trade_rep` 岗位（6a 后未跑 seed）。
- 用户定："外贸业务员 + 老板（推荐）"——Cathy 绑 `trade_rep` + `owner`，合并前后可用功能一致。

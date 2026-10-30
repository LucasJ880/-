# Proposal

TASKFLOW：PERM-6a（`docs/QINGYAN_PERMISSION_TASKFLOW.md`，本 change 新增行）。
任务书：`docs/QINGYAN_PERM-6_TRADE_TASKBRIEF.md`，拍板见文末"拍板结果 · PERM-6"（2026-10-28："按照你推荐的方式开始做 6A"）。

## Why

外贸模块是最后一个完全按平台角色判定的模块：

- **接口**：`src/app/api/trade/**` 82 个路由文件中，75 个用 `requireRole`，共 110 处。
  - 98 处只放行平台 `trade` / `admin`；
  - 展会卡、发件档案、发件人另有三组角色常量；
  - 渠道管理看平台 admin 或企业 `org_owner` / `org_admin`。
- **权限目录**：没有任何外贸键。

由此带来三个问题：

- 梦馨无法给外贸人员落岗位（6b）；Sunny 以后开外贸也没有岗位路径。
- 导航与管理总览把外贸显示给老板，但多数外贸接口对老板返回 403。
- `resolveTradeOrgId` 允许平台 admin 显式访问任意企业，不查成员关系（销售 / 外贸 / 营收共用）。

本次把外贸接口改为按岗位权限键判定（等价迁移，范围仍是全企业），并收回平台 admin 的隐含外贸权限。

## What Changes

- **新增权限键**（ORG，只允许人类主体）：
  - `trade.read`（看外贸数据，MEDIUM）；
  - `trade.manage`（写外贸数据，HIGH）；
  - `trade.settings.manage`（消息通道、发件档案、发件人，HIGH）。
- **模板**：
  - 新系统模板 `trade_rep`（外贸业务员），含 `trade.read`、`trade.manage`；同时登记为系统岗位模板。
  - 系统模板 `org_owner` 加三个外贸键；`org_admin` 加 `trade.settings.manage`（等价于今天企业负责人 / 管理员能管消息通道）。
  - 窗饰 `owner` 加三个外贸键。
- **兼容回退与 seed**：
  - 旧模式企业中，平台 `trade` 的 `org_member` 无绑定时回退到 `trade_rep`（同平台 `sales` → `sales_rep`）。
  - `seedOrgAuthorizationProfiles` 把平台 `trade` 的 active 成员自动绑到 `trade_rep`，这样岗位模式企业的外贸人员也有绑定。
- **新守卫 `requireTradePermission(request, keys)`**（`src/lib/trade/access.ts`）：
  - 平台 super_admin 直接放行（平台管理员全权）；
  - 其余人在 `resolveTradeOrgId` 解析的企业里经 `authorize()` 持任一键才放行；
  - 返回与 `requireRole` 相同的 `{ user }`，调用点只换一行。
- **接口改造**（`src/app/api/trade/**` 全部 110 处）：
  - GET → `trade.read` 或 `trade.manage`；
  - 写方法 → `trade.manage`；
  - 发件档案、发件人 → `trade.settings.manage`；
  - 发件人 DELETE 与 `fromEmail` 修改 → 平台 super_admin；
  - 消息通道的写与查看密钥 → `trade.settings.manage`（`canManageTradeChannels` 改按键）；
  - webhook / cron 不变（签名 / 密钥鉴权）。
- **平台 admin 收回**：
  - `requireTradePermission` 不认平台 `admin`；
  - `resolveTradeOrgId` 的"显式 orgId 访问任意企业"只留给平台 super_admin；平台 admin 与普通成员一样按成员关系解析（同时影响共用它的销售 / 营收入口，与 4a 口径一致）。
- **AI 与导航**：
  - 岗位派生平台角色（4c4）新增：持 `trade.read`（且不满足更高项）→ `trade`；
  - 导航外贸入口在岗位模式下也认 `trade.read`；
  - 外贸聊天助手的工具策略用派生角色。

## Capabilities

### New Capabilities
- `trade/access`：外贸权限键、守卫、模板与兼容回退、平台 admin 不再隐含、企业解析、消息通道与发件设置、AI 与导航

### Modified Capabilities
- `agents/position-derived-role`：派生规则新增 `trade` 一档

## Out of scope

- 6b 梦馨岗位模板与绑定、按负责人收窄数据范围；6c 营收中心 `/api/revenue/*` 与外贸收件人（残留清单 D2–D4）。
- 外贸业务逻辑、页面；外贸数字员工；PERM-7（owner 界面绑岗位）。

## Impact

- 修改：
  - `src/lib/authorization/{permissions,role-defaults,resolve-effective-permissions,seed-org-profiles}.ts`；
  - `src/lib/trade/{access,channel-access}.ts`；
  - `src/app/api/trade/**`（75 个文件）；
  - `src/lib/rbac/effective-platform-role.ts`、`src/lib/navigation/filter.ts`、`src/lib/trade/chat-assistant.ts`。
- 新增测试：
  - `src/lib/trade/__tests__/trade-access.test.ts`（纯）；
  - `trade-access-db.isolated.test.ts`（隔离库）。
- **BREAKING**：
  - 平台 `admin`（非 super_admin）若不是企业 `org_owner`、也没有外贸岗位，失去外贸接口；且不能再用显式 orgId 访问非成员企业（销售 / 外贸 / 营收）。
  - 平台 `boss` / `manager` 在旧模式企业里只有作为 `org_owner` 时才保留展会卡、发件档案、发件人。
- 上线：对两家企业重跑 `seedOrgAuthorizationProfiles`（新模板、新键、平台 `trade` 自动绑）。
- 零 schema。

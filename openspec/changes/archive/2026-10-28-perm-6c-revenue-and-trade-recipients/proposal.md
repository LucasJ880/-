# Proposal

TASKFLOW：PERM-6c（`docs/QINGYAN_PERMISSION_TASKFLOW.md`，行已在 6a 新增）。
任务书：`docs/QINGYAN_PERM-6_TRADE_TASKBRIEF.md`（6c 段），拍板见"拍板结果 · PERM-6"。用户 2026-10-28："合并后先做 6C 的 proposal"（6b 等梦馨人员信息，6c 先做）。
依据：残留清单 `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md` D2 / D3 / D4。

## Why

6a 已让外贸接口按岗位键判定，外贸一侧还剩三类按平台角色的读点：

- **营收中心**（D4）：13 个 `/api/revenue/*`（`src/lib/revenue-spine/access.ts:14,19`）用 `requireRole(["trade","sales","boss","manager","admin"])`。策略发布另要求平台 `admin` 或 `boss`（`api/revenue/policy/route.ts:32`）。
- **外贸收件人**（D2）：按平台角色或企业角色选人。
  - 询盘首次提醒、网站询盘通知：平台 `trade / boss / manager / admin / super_admin`（`trade/inquiry-sla.ts:216`、`trade/website-inquiry.ts:1002`）；
  - 管理层：老板询盘早报、展会小结、首响 SLA 分级升级、旧 24 小时升级，都用 `managementOf`（`trade/booth-summary.ts:18,146-157`）——企业 `org_owner / org_admin` 或平台 `boss / manager / admin / super_admin`。
- **默认询盘负责人**（D3）：组织内最早加入的平台 `trade / sales` 成员（`revenue-spine/inquiry-intake.ts:147`）。

由此带来四个问题：

- **压扁后失效**：
  - 岗位模式企业压扁后，销售 / 老板调营收中心 403；
  - 老板收不到升级与早报；
  - 默认负责人选不到人。
- **与 6a 不一致**：平台 admin / boss / manager 不是企业负责人时，6a 后已打不开外贸页面，却仍收到外贸提醒，点进去 403。
- **范围口子**：营收中心按全企业返回商机（`revenue-spine/cockpit.ts:43-54` 等）。Sunny 销售员在销售模块只看本人（4a，`sales_rep` 为 `PRINCIPAL` / `ASSIGNED`），平台 `sales` 却能经营收中心看到全企业商机与汇总。
- **平台 `trade` 仍不能压扁**：压扁脚本只处理 `boss / manager / operations / sales`。6b 让梦馨进入岗位模式后要连 `trade` 一起压，前提是外贸读点都已按岗位。除 D2–D4 外还剩两处：
  - 侧栏"核心 + 更多"外贸布局按原始平台角色（`navigation/trade-layout.ts:40`，调用方 `components/sidebar.tsx:405`）；
  - 入职清单的"业务员"在岗位模式只认销售键（`organizations/onboarding.ts:607`）。

## What Changes

- **营收中心按外贸键**：
  - `resolveRevenueAccess(request, keys)` 改用 6a 的 `requireTradePermission`；
  - GET → `trade.read` 或 `trade.manage`；写（转阶段、记互动、客户已回复、跑 FDE、手工建询盘）→ `trade.manage`；策略发布 `PUT /api/revenue/policy` → `trade.settings.manage`；
  - 平台 super_admin 照旧全权。
  - **BREAKING**：平台 `sales / boss / manager` 不再因平台角色进营收中心。企业负责人经 `org_owner` / 窗饰 `owner` 模板（含外贸三键）照常可用。
  - 旧模式导航的营收入口去掉平台 `sales`，与接口一致（梦馨无销售成员）。
- **外贸收件人按岗位**：新 `src/lib/trade/recipients.ts`，一处定义、各处共用。
  - **外贸工作收件人**（询盘首次提醒、网站询盘通知）= 本企业持 `trade.read` 或 `trade.manage` 的在职成员。
  - **外贸管理层收件人**（老板早报、展会小结、SLA 分级升级 / 草稿逾期、旧 24 小时升级）= 本企业管理层且持外贸读或写键。
    - 管理层沿用 `isManagementWorkspaceUser`：岗位模式 = 老板岗位或 super_admin；旧模式 = 原规则。
    - 找不到人时仍回退到企业 owner（`sla-tiers` 现有兜底不变）。
  - **默认询盘负责人** = 最早加入的、岗位派生平台角色（4c4）为 `trade` 或 `sales` 的在职成员 → 否则企业 owner。旧模式与今天完全一致，岗位模式压扁前后一致。
- **平台 `trade` 可压扁**：
  - `COLLAPSIBLE_PLATFORM_ROLES` 加 `trade`。脚本仍只处理岗位模式企业，前置校验不变（必须有 active 岗位绑定、不能同时是旧模式企业成员）。
  - 侧栏外贸布局改用 `/api/auth/me` 的 `effectiveRole`。
  - 入职清单岗位模式"业务员"也认 `trade.manage`。
  - 残留清单补"F 组 外贸"并标状态。

## Capabilities

### New Capabilities
- `revenue/spine-access`：营收中心接口的权限键与策略发布权限
- `trade/notification-recipients`：外贸工作收件人、外贸管理层收件人、默认询盘负责人的选人规则

### Modified Capabilities
- `authorization/platform-role-collapse`：压扁范围加入 `trade`
- `authorization/position-mode-residual-reads`：入职清单"业务员"认 `trade.manage`；外贸侧栏布局按派生角色

## 待拍板（2026-10-28 已按推荐拍板，见任务书"拍板结果 · PERM-6c"）

1. **营收中心对平台 `sales`**：
   - **推荐**：只认外贸键。营收中心是梦馨的询盘流水线，Sunny 车道不经它（`access.ts` 注释），岗位模式导航也只给外贸 / 管理层。同时堵住 Sunny 销售员经营收中心看全企业商机的口子。
   - 备选：另认销售商机读键（需要判 ORG 范围，否则业务员仍看到全企业）。
2. **管理层收件人是否要求持外贸键**：
   - **推荐**：要求。收到的人点进去要能处理，与 6a 收回平台 admin 一致。
   - 影响：只持设置键的企业管理员（`org_admin`）、不是企业负责人的平台 boss / manager / admin，不再收外贸升级与早报。生产梦馨两人不受影响。
3. **压扁范围加 `trade` 放在 6c**：
   - **推荐**：放在 6c。对 Sunny 无影响（无外贸成员）；梦馨要到 6b 进入岗位模式才可压，6b 只需落岗位与执行。
   - 备选：留到 6b。

## Out of scope

- 6b：梦馨岗位模板 / 绑定 / 按负责人收窄；PERM-7：owner 界面绑岗位。
- AI 工具策略里的平台 `admin` 档：`agent-core/tools/_policy.ts` 各域工具都放行 `admin`，且派生角色把 `admin` 原样透传。它跨销售 / 外贸 / 项目所有域，不属外贸收口，另议。
- 外贸 / 营收业务逻辑、页面；webhook / cron 鉴权；通知文案。

## Impact

- 修改：
  - `src/lib/revenue-spine/{access,inquiry-intake,owner-brief,sla-tiers}.ts`；
  - `src/app/api/revenue/**`（13 个文件）；
  - `src/lib/trade/{booth-summary,inquiry-sla,website-inquiry}.ts`；
  - `src/lib/authorization/platform-role-collapse.ts`；
  - `src/lib/navigation/{registry,trade-layout}.ts`、`src/components/sidebar.tsx`；
  - `src/lib/organizations/onboarding.ts`；
  - `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md`。
- 新增：
  - `src/lib/trade/recipients.ts`；
  - 测试 `src/lib/trade/__tests__/trade-recipients.test.ts`（纯）与 `trade-recipients-db.isolated.test.ts`（隔离库）。
- 零 schema。不新增权限键。不新增队列 / 调度。
- **BREAKING**：
  - 营收中心不再认平台 `sales / boss / manager`；
  - 外贸收件人不再认平台 `boss / manager / admin`（不是企业负责人、也无外贸岗位的人）；
  - 企业管理员不再收外贸管理层提醒（若按推荐拍板）。

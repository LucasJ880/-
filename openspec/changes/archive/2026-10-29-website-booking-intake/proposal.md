# Proposal — website-booking-intake（CAL-2：网站预约一键转入青砚）

TASKFLOW：**CAL-2**（Phase K — Sunny 日程归因与期间看板；设计稿 `docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md` §2，原案为网站 book-now 直连 webhook）。

## Why

网站 book-now 的客户自主预约只落在 Google 共享日历里，青砚里没有客户、没有预约，销售要手抄。原案依赖网站插件发 webhook，但插件类型与能力至今无法核实（本会话访问不到 `sunnyshutter.ca`），用户 2026-10-29 选定改为基于 CAL-1 已观察到的 Google 日历事件做"一键转入"，不依赖插件。

## What Changes

- 新增"网站预约待转入"列表 `GET /api/sales/website-bookings`：
  - 来源是 CAL-1 账本里归因为网站的新建事件；
  - 排除已删除、已转入、已忽略的，只列开始时间不早于组织当地 7 天前的，最多 200 条；
  - 列表只给标题、起止时间与日历，不给描述与联系方式。
- 新增详情与预填 `GET /api/sales/website-bookings/{eventId}`：
  - 用日历观察的读取账号实时读取该事件的描述与地点，不落库；
  - 按固定规则（标签行、邮箱、北美电话格式、地点）给出姓名、电话、邮箱、地址的预填建议，并提示调用者名下电话相同的已有客户。
- 新增转入 `POST /api/sales/website-bookings/{eventId}/convert`（销售认领）：
  - 在一个事务里新建客户（或关联调用者名下已有客户）和预约，预约记下该 Google 事件 ID，调用者成为客户归属人，预约负责人缺省为本人；
  - 同一事件只能转入一次（409 `ALREADY_CONVERTED`）；
  - 不新建、不修改任何 Google 事件；
  - 写审计。
- 新增忽略 `POST /api/sales/website-bookings/{eventId}/dismiss`：不是真预约（测试、重复）的事件从待转入列表移除，写审计。
- 新增 `/sales/website-bookings` 页面（列表 + 转入表单），首页在有待转入时显示"网站预约待转入 N 条"入口。
- 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 CAL-2 行描述为本方案；原案中的 Muse / 微信变更推送拆为新行 CAL-3。

## Capabilities

### New Capabilities
- `calendar/website-booking-intake`：网站预约待转入列表、详情预填、转入（销售认领）、忽略与页面。

### Modified Capabilities
- 无（CAL-1 `calendar/change-attribution` 的观察与归因不改；转入后该事件因预约记下了事件 ID，按既有规则 R1 归因为青砚）。

受影响的 Muse 意图：无（不触碰 `muse-bridge`）。

## Impact

- 新增：`src/lib/calendar-watch/intake-pure.ts`（待转入推导、描述解析、输入校验）、`src/lib/calendar-watch/intake.ts`（取数、读取事件详情、转入事务）、`src/app/api/sales/website-bookings/**`、`src/app/(main)/sales/website-bookings/page.tsx` 与首页入口。
- 依赖：CAL-1 账本（`calendar.watch.observed`）与配置（读取账号、观察日历）；既有 `getGoogleEventDetail`（只读）、`normalizePhone`、`authorize`、`writeAuditLog`。
- 授权：查看 = 持 `sales.customer.create` 或全企业范围的 `sales.customer.read`；转入 = 持 `sales.customer.create`（Sunny 为销售人员，客户归本人）。不改任何岗位权限。
- 无 schema、无 cron、无队列、无出站、无 LLM；对 Google 只读。

## Out of scope

- 不接网站 webhook，不改网站。
- 不自动转入：每条都要销售确认表单后才建客户与预约。
- 不让老板或运营代为转入、分派给别人（Sunny 的老板岗位没有新建客户权限，用户选定"销售认领"；改权限另开 change）。
- 不做 Muse / 微信变更推送（拆为 CAL-3）。
- 不把转入后的青砚修改同步到共享日历以外的地方；转入不改变既有预约同步行为（见 design 风险）。
- 不跨销售查重（只提示调用者本人名下的同电话客户，与新建客户接口一致）。

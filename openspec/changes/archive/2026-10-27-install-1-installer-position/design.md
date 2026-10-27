# Design: install-1-installer-position

## Context

见 proposal.md「Why」。现状（已读代码）：
- `Appointment`（`type=install`、`assignedToId`、`startAt/endAt`、`status`、`completedAt`、`googleEventId`）已是安装预约；`BlindsOrder.appointmentId / expectedInstallDate / installedAt`；`blinds-orders/[id]/transition` 转 `scheduled` 时按 `installDate + assignedToId` 创建预约（assignedToId 缺省为操作者本人，无岗位校验）；工艺单详情页目前只传 installDate，没有安装工选择。
- `BlindsOrderItem` 每行一扇窗；无照片字段，无 JSON 位。
- 文件：`putPrivateBlob` + `/api/files/[...path]` 代理，代理按路径前缀 + `hasOrgAccess` 放行，前缀表写在路由注释与 `authorize` 函数里。
- `AuditLog`（`action / targetType / targetId / afterData`）是 config 允许的扩展数据落点。
- `workspace-policy` 支持 `permissionKeys`；`mobile-tab-bar` 用 `workspaceContextFromNav` 决定入口。
- `appointments` GET 的 `ownOnly` 分支已覆盖 `assignedToId = 本人`，日历页据此渲染。

## Goals / Non-Goals

**Goals:**
- 不加表、不加字段实现：任务 = 预约，收口 = AuditLog + 私有 Blob。
- 安装工的一切判定走 `authorize(install.*)`，ASSIGNED 范围对应 `Appointment.assignedToId`。
- 手机优先的两页（列表 / 任务），拍照用原生相机输入。

**Non-Goals:**
- 不改 `appointments` 路由与日历页的渲染逻辑；不改 Google 同步。
- 不改 `blinds-orders` 列表 / 详情的项目可见性（`getVisibleProjectIds`）。
- 不做照片删除；不做多图批量上传。
- 不动 `nav-role-policy.ts` 的平台角色逻辑（PERM-4）。

## 八条硬纪律对照

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守。任务用 Appointment / BlindsOrder 既有列；收口记录写 AuditLog；图片存私有 Blob |
| 2 | 出站先审批 | 不涉及。无对外发送；安装工不触发邮件 / 微信 |
| 3 | 禁止第三套队列 | 不涉及 |
| 4 | 脱敏 | 不涉及 Muse。安装接口不返回金额 / 折扣 / 成本（spec 有 SHALL NOT） |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守。范围判定、收口聚合、完成条件全是查表 / 纯函数 |
| 8 | 测试注册 | 遵守。`src/lib/install/__tests__/*.test.ts` 注册进 `scripts/test-all.sh` |

## Decisions

### D1 安装任务 = Appointment(type=install)，不建 InstallTask
`BlindsOrder.appointmentId` 已把工艺单和预约连起来；日历、Google 同步、提醒都已围绕 Appointment。新 API 只是按岗位范围过滤 + 联出工艺单。
- 否决：用 `Task`（assigneeId / dueDate）。理由：Task 无时间段、无客户 / 地址、不进日历页；且工艺单已指向 Appointment。
- 否决：建 InstallTask 表。理由：零 schema。

### D2 收口记录 = AuditLog 行，照片 = 私有 Blob
`logAudit({ action: "install.window.completed", targetType: "blinds_order_item", targetId: itemId, afterData: { orderId, appointmentId, pathname, proxyUrl, note } })`。读取：`db.auditLog.findMany({ where: { targetType: "blinds_order_item", targetId: { in: itemIds }, action: "install.window.completed" }, orderBy: { createdAt: "desc" } })`，纯函数 `aggregateCloseout(items, logs)` 得每窗最新 + 张数。
- 否决：把路径塞进 `BlindsOrderItem.itemRemark`。理由：覆盖人工备注，且无时间 / 人。
- 否决：`Appointment.notes` 存 JSON。理由：notes 是给人看的文本，被编辑会毁掉记录。
- 取舍：AuditLog 是追加式，天然"历史保留、最新为准"，正好符合补拍语义；代价是按 targetId 查询（AuditLog 有 orgId 索引，targetId 查询量小：一次最多几十扇窗）。

### D3 范围判定：ASSIGNED ↔ `Appointment.assignedToId`
`authorize({ permission: "install.task.read", resource: { type: "appointment", id, assignedToId, orgId } })`；`decideFromBindings` 的 ASSIGNED 匹配已支持 `resource.assignedToId`。列表接口先判"有无 ORG 范围"决定 where（全企业 vs `assignedToId = 本人`），再逐条不重复判。
- 否决：只按平台角色 `installer`。理由：设计稿 §2.1 平台角色只剩 super_admin / user。

### D4 照片代理前缀规则
`/api/files/[...path]` 新增前缀 `install-photos/{orgId}/{orderId}/{itemId}/...`：先 `hasOrgAccess`，再 `authorize(install.photo.read)`（ORG）或"该 orderId 的预约 assignedToId = 本人"。
- 否决：全体 org 成员可看。理由：spec 要求销售不能看；照片含客户室内画面。

### D5 完成收口 = 预约 completed + 工艺单 installed（状态机）
复用 `canTransition(order.status, "installed")` 与 `timestampField`，写 `OrderStatusLog`（operatorId = 安装工）；工艺单不在 `scheduled`（或 `ready`）→ 409。预约已 completed → 幂等 200。
- 否决：安装工只改预约，工艺单由出单人手动转。理由：用户要的就是"拍完即收口"。

### D6 安装工入口与默认工作区
`workspace-policy` 加 `WorkspaceId "install"` 与 `canAccessInstallWorkspace(ctx) = hasAnyPermission(ctx, ["install.task.read"])`；`getDefaultWorkspace` 在销售 / 运营 / 招投标都不命中时若可进 install → `/install`；`resolveHomeRedirect` 同步。`mobile-tab-bar` 与 `navigation/registry.ts` 加 `/install`（模块 `window_covering`），`NAV_HREF_MODULES["/install"] = ["window_covering"]`。`permissionKeys` 由服务端注入（`workspaceContextFromNav` 已支持；layout 处用 `resolveEffectiveBindings` 取键）。
- 否决：等 PERM-4 统一改导航再做。理由：没有入口安装工用不了。

### D7 上传实现
multipart 直接在路由里处理（`request.formData()` → `validatePhotoUpload` → `putPrivateBlob`），纯函数（类型白名单 jpeg/png/webp、≤ 8MB、`installPhotoPathname`、`parseInstallPhotoPath`）放在 `src/lib/install/closeout.ts`，不另建 `photo-upload.ts`；限流 `install-photo` 30 次/分钟。
- 否决：直接复用 chat 上传函数。理由：它绑定 AI_CHAT_BLOB_ROOT 与对话附件语义。

### D8 工艺单状态机：confirmed / in_production 可直接转 scheduled（实施时补充）
现网工艺单详情页只走 draft → confirmed → completed，不单独维护 ready（"待安装"）。若坚持 ready → scheduled，"安排安装"按钮对 Sunny 实际流程永远不可用。因此 `TRANSITIONS` 增加 `confirmed → ready | scheduled`、`in_production → scheduled`，其余边不变；`complete` 收口仍按 `canTransition(order.status, "installed")`（scheduled → installed）。
- 否决：改详情页先手动转 ready 再排期。理由：多一步无业务含义的点击。
- 顺带：详情页 `STATUS_MAP` 补 in_production / ready / scheduled / installed / cancelled 标签；installed 的下一步是"标记完成"。

### D9 `permissionKeys` 注入点（实施时补充）
服务端 `resolveWorkspaceContextFromCookies` 与 `GET /api/auth/active-org` 都用 `resolveEffectiveBindings` 算出 ALLOW 键集合注入 `permissionKeys`；侧栏 / 抽屉 / 底栏从 active-org 读取后传给 `workspaceContextFromNav`；`NavigationItem.workspaceAccess` 新增 `"install"`。`/install` 两页服务端用 `canAccessInstallWorkspace || isManagementWorkspaceUser` 放行。

## Risks / Trade-offs

- [AuditLog 作为业务记录，若将来有归档 / 清理策略会丢收口证据] → 在 REPORT 明示 `install.window.completed` 行不可清理；PERM-3 若引入订单扩展 JSON 位再迁移。
- [`Appointment` 无 orgId，靠 `customer.orgId`；工艺单没有 customerId 时 transition 建预约会写空 customerId] → 安排安装要求工艺单有 customerId，否则 400（现有代码写 `""` 是隐患，本 change 顺手改为 400）。
- [安装工手机网络差，大图上传失败] → 前端用 `capture=environment` + 客户端压缩到 ≤ 1600px 再传；服务端仍限 8MB。
- [`getVisibleProjectIds` 让安装工看不到 `/blinds-orders/[id]`] → 安装工不进工艺单页，所需窗信息全部由 `/api/install/tasks/{id}` 提供。
- [日历页 `/sales/calendar` 属销售工作区，安装工可能被工作区策略挡] → `canAccessSalesWorkspace` 不变；安装工的"日历"由 `/install` 周视图满足；既有日历页对安装工的放行留 PERM-4。

## Migration Plan

1. 合并后对 Sunny 跑 `seedOrgAuthorizationProfiles`（新模板与追加绑定）。
2. `config/positions/sunny.json` 补安装工邮箱后执行绑定脚本。
3. 回滚：revert PR；已写的 AuditLog 与 Blob 无害保留。

## 验证方式

- `npx tsx src/lib/install/__tests__/closeout.test.ts`：聚合（最新 / 张数 / 未收口清单）、完成条件、路径生成、类型 / 大小校验。
- `npx tsx src/lib/install/__tests__/scope.test.ts`：ASSIGNED vs ORG 的 where 与逐条判定（用 `decideFromBindings`）。
- `npx tsx src/lib/authorization/__tests__/authorize.test.ts`：installer 快照、出单 / 运营 / 老板追加键、sales_rep 无 install 键。
- `npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npm run test:ci`。
- 浏览器：本地 `next dev` + 本地 Blob 盘（`isLocalBlobStoreEnabled`）用 Playwright 走 `/install` → 任务页 → 上传 → 缩略图 → 完成收口；沙箱无 DB 时写入 REPORT 的手工走查步骤。

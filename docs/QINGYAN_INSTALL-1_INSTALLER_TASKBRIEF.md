# INSTALL-1 任务书：安装工岗位 + 安装任务 + 逐窗拍照收口

| 项 | 值 |
|---|---|
| 编号 | INSTALL-1（权限主线 `docs/QINGYAN_PERMISSION_TASKFLOW.md` 新增段） |
| 动机 | Lucas 2026-10-27：新增"安装工"岗位；安装工只看分配给他的安装任务；日历上能看到安装时间；按工艺单上的窗户逐个完成后拍照上传，用于收口 |
| 设计稿 | `docs/QINGYAN_PERMISSION_REDESIGN_DESIGN.md` §3 新增 `installer` 行、§6 新增 INSTALL-1 |
| 依赖 | PERM-1（岗位模板集、绑定脚本）已合并；PERM-2 不是前置 |
| 执行者 | Claude Code（`/opsx:propose install-1-installer-position`） |
| 审核 | Claude（chat）；Lucas 拍板 |
| 纪律 | 零 schema（照片记录落 AuditLog + 私有 Blob，任务用既有 Appointment / BlindsOrder）；确定性优先；测试注册 |

---

## 0. 先读（已核实的现状）

- `prisma/schema.prisma` `Appointment`：`type`（measure / install / …）、`assignedToId`、`startAt / endAt`、`status`（scheduled / in_progress / completed …）、`googleEventId`。**这就是安装任务的载体**，无需新表。
- `BlindsOrder.appointmentId` / `expectedInstallDate` / `installedAt`；状态机 `src/lib/blinds/order-state-machine.ts`（… ready → scheduled → installed → completed）。
- `src/app/api/blinds-orders/[id]/transition/route.ts`：转 `scheduled` 时已按 `installDate + assignedToId` 创建 `type=install` 的 Appointment 并回写 `appointmentId`。**分配安装工的入口已存在**，只需把 assignedToId 的候选限制为持安装岗位的人。
- `BlindsOrderItem`：每行一扇窗（location / 尺寸 / 面料 / 工艺切割数据），无照片字段。
- `src/app/api/sales/appointments/route.ts` GET：按 `customer.orgId` 限企业，`ownOnly` 时只返回 `assignedToId / createdById / customer.createdById` 为本人的；日历页 `src/app/(main)/sales/calendar/page.tsx` 用它渲染。
- 文件：`src/lib/files/blob-access.ts` `putPrivateBlob({ pathname, body, contentType })` 返回 `proxyUrl`（登录 + 前缀鉴权后流式转发）；现有上传路由样例 `src/app/api/ai/upload-image/route.ts`（multipart、限流、组织解析）。
- `AuditLog`：`orgId / userId / action / targetType / targetId / afterData(String)`，`logAudit()`；config 允许的扩展数据落点之一。
- `src/lib/rbac/workspace-policy.ts`：`WorkspacePolicyContext.permissionKeys` 已支持按权限键放行工作区；`src/components/mobile-tab-bar.tsx` 是手机端入口。
- `BlindsOrder` 无 orgId，租户通过 `projectId` / `customerId` 间接限定；`blinds-orders` API 用 `getVisibleProjectIds`。

---

## 1. 做四件事

### A. 岗位与权限键
- Registry 新增：`install.task.read`（ASSIGNED / ORG）、`install.task.update`（ASSIGNED / ORG：开始 / 完成 / 备注）、`install.window.complete`（ASSIGNED / ORG：逐窗拍照）、`install.task.assign`（ORG：安排安装、指定安装工）、`install.photo.read`（ORG：看收口照片）。
- 窗饰岗位集新增 `installer`（安装工）：`install.task.read`、`install.task.update`、`install.window.complete` 均 **ASSIGNED**；不含任何 `sales.*` 读写、不含 `install.task.assign`。
- `owner`、`ops_lead`、三个 `fulfillment_*` 追加 `install.task.assign`、`install.task.read`（ORG）、`install.photo.read`（ORG）；`accounting` 追加 `install.photo.read`（ORG）（收口是结算依据）。
- `config/positions/sunny.json` 加 `"TODO:安装工": ["installer"]` 占位。

### B. 安装任务只看自己的 + 日历
- 新 API `GET /api/install/tasks?start&end`：返回 `type=install` 且（`install.task.read` 为 ORG 范围者全企业，否则 `assignedToId = 本人`）的 Appointment，联出 `BlindsOrder`（code、customerName、address、items 的 location / 尺寸 / 产品 / 面料）与每扇窗的收口状态。ASSIGNED 判定走 `authorize(install.task.read, resource.assignedToId)`。
- 新页面 `/install`（手机优先）：按日期分组的"我的安装任务"列表（时间、客户、地址、窗数、已收口数），点开进入任务页。日历需求以本页"按周 / 按日"视图满足；同时安装工在 `/sales/calendar` 的既有日历里也能看到自己的 install 预约（appointments GET 的 ownOnly 分支已覆盖 assignedToId=本人）——需确认安装工岗位进 `/sales/calendar` 的工作区放行：`workspace-policy` 新增 `install` 工作区，`install.task.read` 持有者默认进 `/install`，`/sales/calendar` 对其只读放行。
- 安排安装：`transition` 路由的 `assignedToId` 只接受持 `install.task.read`（任一范围）的用户；`blinds-orders/[id]` 页"安排安装"下拉只列安装岗位的人（新 API `GET /api/install/installers`）。

### C. 逐窗拍照收口
- 新 API `POST /api/install/tasks/{appointmentId}/items/{itemId}/photo`（multipart，≤ 8MB，jpeg / png / webp / heic 转 jpeg 可选）：校验本人被分配或 ORG 范围 → `putPrivateBlob` 到 `install-photos/{orgId}/{orderId}/{itemId}/{ts}.jpg` → `logAudit({ action: "install.window.completed", targetType: "blinds_order_item", targetId: itemId, afterData: { orderId, appointmentId, pathname, proxyUrl, note, byUserId } })` → 返回该窗最新收口记录。同一窗可多次上传（补拍），以最新为准，历史保留。
- `GET /api/install/tasks/{appointmentId}`：任务详情 + 每扇窗的收口记录（从 AuditLog 按 `targetType=blinds_order_item` + `targetId in items` 读，取每窗最新 + 数量）。
- 页面 `/install/[appointmentId]`：窗列表（位置 / 尺寸 / 产品），每行"拍照"按钮（`<input type=file accept=image/* capture=environment>`），已收口显示缩略图 + 时间；顶部"开始安装"（Appointment → in_progress）；全部窗收口后出现"完成收口"按钮。
- 完成收口 `POST /api/install/tasks/{appointmentId}/complete`：要求全部窗至少一张照片，否则 409 列出未收口的窗；通过则 Appointment → `completed`（completedAt）、BlindsOrder → `installed`（走状态机，`installedAt`），审计 `install.task.completed`。
- Blob 代理读取：`install-photos/` 前缀对持 `install.photo.read`（ORG）或该任务的被分配人放行。
- 工艺单详情页 `blinds-orders/[id]` 新增"收口"标签：按窗显示照片缩略图与时间（持 `install.photo.read` 可见）。

### D. 手机入口与导航
- `mobile-tab-bar.tsx` 对持 `install.task.read` 的用户显示"安装"入口；侧栏导航新增 `/install` 条目（`window_covering` 模块）。
- 安装工默认工作区 `/install`（`getDefaultWorkspace`：无其它工作区且持 `install.task.read` → `/install`）。

## 2. 受影响意图
- 出单人 / 运营主管在工艺单转 `scheduled` 时必须选安装工（原来可选任意用户）。
- 安装工登录后只看到 `/install`（和自己的日历），看不到销售、报价、客户列表。
- 工艺单 `installed` 状态现在可以由安装工通过"完成收口"推进（原来只能由有工艺单权限的人手动转）。

## 3. Out of scope
- 不做照片 AI 质检、不做客户签收、不做安装费结算。
- 不改 Google Calendar 同步逻辑（既有 `appointments/[id]/sync` 对 install 类型照常可用）。
- 不做 PERM-3 的出单按品类过滤；不动 `blinds-orders` 既有的项目可见性判定。
- 不做安装工的微信通知（现有 `notifiedAt` 逻辑若已覆盖 install 预约则沿用）。

## 4. 验收
- 纯函数测试：收口状态聚合（每窗最新 / 全部完成判定 / 未收口清单）、照片路径生成、任务范围判定（ASSIGNED vs ORG）。
- 岗位快照：`installer` 全 ASSIGNED、无 `sales.*`；`owner / ops_lead / fulfillment_*` 含 `install.task.assign`。
- 路由：非被分配安装工访问他人任务 403；未全部收口调 complete → 409 含未收口窗号；完成后 Appointment `completed`、BlindsOrder `installed`。
- 浏览器（本地 Playwright，mock 登录如仓库已有做法）：`/install` 列表 → 任务页 → 上传一张图 → 缩略图出现 → 全部窗后出现"完成收口"。
- `npm test` 全绿；新测试注册；`openspec validate install-1-installer-position --strict` 通过。

# Proposal: install-1-installer-position

**TASKFLOW：** INSTALL-1（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）；承载任务书 `docs/QINGYAN_INSTALL-1_INSTALLER_TASKBRIEF.md`。
**受影响的 Muse 意图：** 无。本 change 不触碰 `src/lib/muse-bridge/**`。

## Why

Sunny 的安装环节没有系统岗位：安装工看不到只属于自己的任务，安装时间只在工艺单的文本字段里，装完没有任何逐窗证据，收口全靠口头。Lucas 2026-10-27 决定新增"安装工"岗位，并把"按工艺单逐窗拍照"作为收口依据。

## What Changes

- 新增岗位 `installer`（安装工）进窗饰岗位模板集，所有权限为 ASSIGNED 范围；新增 5 个权限键 `install.task.read / install.task.update / install.window.complete / install.task.assign / install.photo.read`。安排安装的人由运营和会计决定：`ops_lead`、`accounting`、`owner` 追加安排 + 查看 + 照片查看（ORG）；三个出单岗只追加查看 + 照片查看，不能安排；`ops_staff` 不追加。
- 安装任务复用既有 `Appointment`（`type=install`，`assignedToId` 为安装工）与 `BlindsOrder.appointmentId`，不建新表。新增 `GET /api/install/tasks`（只返回分配给本人的；持 ORG 范围者返回全企业）、`GET /api/install/tasks/{id}`（含工艺单每扇窗与收口状态）、`GET /api/install/installers`（持安装任务读权的人，供安排安装时选择）。
- 新增安装工页面 `/install`（按日期分组的我的安装任务，含周视图）与 `/install/{id}`（窗列表、逐窗拍照、开始安装、完成收口）；手机底栏与侧栏加"安装"入口；安装工默认工作区 `/install`。
- 逐窗拍照：`POST /api/install/tasks/{id}/items/{itemId}/photo` 把图片存私有 Blob `install-photos/{orgId}/{orderId}/{itemId}/{ts}.jpg`，收口记录写 AuditLog（`install.window.completed`，目标 `blinds_order_item`）；同一窗可补拍，以最新为准。文件代理对 `install-photos/` 前缀按"被分配人或持照片查看权"放行。
- 完成收口：`POST /api/install/tasks/{id}/complete` 要求每扇窗至少一张照片，否则 409 列出未收口窗；通过则 Appointment → `completed`，BlindsOrder → `installed`（走既有状态机），审计 `install.task.completed`。
- 工艺单转 `scheduled` 时 `assignedToId` 必须是持安装任务读权的人；工艺单详情页"安排安装"增加安装工下拉与安装时间；详情页新增"收口"标签展示每窗照片（持 `install.photo.read`）。
- `config/positions/sunny.json` 加 `TODO:安装工` 占位；写 `docs/QINGYAN_INSTALL-1_REPORT.md`；TASKFLOW INSTALL-1 改 `[G]`。

## Capabilities

### New Capabilities
- `installation/install-tasks`：安装任务——谁能看到哪些安装任务、安装时间如何展示、谁能安排与改派、任务的开始 / 完成状态。
- `installation/window-closeout`：逐窗收口——按工艺单每扇窗上传照片、补拍、照片的存放与可见范围、全部收口后推进工艺单。
- `authorization/position-catalog`：（已在 PERM-1 delta 中新建，尚未归档；本 change 以 ADDED Requirement 叠加）`installer` 岗位与 `install.*` 权限键，以及出单 / 运营 / 老板 / 会计岗位的追加绑定。

### Modified Capabilities
（无既有已归档能力需修改。）

## Impact

- `src/lib/authorization/permissions.ts`（+5 键）、`role-defaults.ts`（`installer` + 既有岗位追加绑定）。
- 新：`src/lib/install/*`（纯函数：范围判定、收口聚合、照片路径）、`src/app/api/install/**`（tasks / tasks/[id] / tasks/[id]/items/[itemId]/photo / tasks/[id]/complete / installers）、`src/app/(main)/install/**`（列表与任务页）。
- 改：`src/app/api/blinds-orders/[id]/transition/route.ts`（assignedToId 校验）、`src/app/(main)/blinds-orders/[id]/page.tsx`（安排安装下拉 + 收口标签）、`src/app/api/files/[...path]/route.ts`（`install-photos/` 前缀规则）、`src/lib/rbac/workspace-policy.ts`（`install` 工作区与默认跳转）、`src/components/mobile-tab-bar.tsx`、`src/lib/navigation/registry.ts`、`src/lib/tenancy/modules.ts`（`/install` → `window_covering`）。
- 数据库：零 schema。Appointment / BlindsOrder / AuditLog 既有表 + 私有 Blob。
- 测试：新增 `src/lib/install/__tests__/*.test.ts`（注册）；`authorize.test.ts` 加 installer 快照。
- 对外行为：工艺单 `scheduled` 转换对非安装岗 assignedToId 返回 400；工艺单 `installed` 可由安装工经"完成收口"推进。

## Out of scope

- 照片 AI 质检、客户签收、安装费结算、微信通知改造。
- Google Calendar 同步逻辑（既有 `appointments/[id]/sync` 对 install 类型沿用）。
- 出单按品类过滤（PERM-3）；`blinds-orders` 列表 / 详情既有的项目可见性判定。
- 照片删除与编辑；只允许补拍追加。

# INSTALL-1 报告 — 安装工岗位 + 安装任务 + 逐窗拍照收口

change：`openspec/changes/install-1-installer-position/`（proposal / specs ×3 / design / tasks 9/9）
任务书：`docs/QINGYAN_INSTALL-1_INSTALLER_TASKBRIEF.md`　设计稿：`docs/QINGYAN_PERMISSION_REDESIGN_DESIGN.md` §3 installer 行、§6 INSTALL-1
零 schema：任务 = `Appointment(type=install)`；收口记录 = `AuditLog(action=install.window.completed)`；照片 = 私有 Blob。

## 1. 做了什么

### 1.1 岗位与权限
| 文件 | 内容 |
|---|---|
| `src/lib/authorization/permissions.ts` | 新增 5 键：`install.task.read` / `install.task.update` / `install.window.complete`（ASSIGNED + ORG）、`install.task.assign` / `install.photo.read`（仅 ORG） |
| `src/lib/authorization/role-defaults.ts` | 窗饰集新增 `installer`（三键 ASSIGNED）；`owner / ops_lead / accounting` 追加 assign + read + photo.read（ORG）；`fulfillment_*` 只追加 read + photo.read（**无 assign**，用户决定：排安装由运营和会计定）；`ops_staff` 不追加；岗位模板加"安装工" |
| `config/positions/sunny.json` | `"TODO:安装工": ["installer"]` 占位 |
| `src/lib/authorization/__tests__/authorize.test.ts` | 67 条（+15）：installer 快照、assign 归属、sales_rep / ops_staff 无 install 键 |

### 1.2 安装领域纯函数（`src/lib/install/`）
- `scope.ts`：`installScopeFromDecision`（authorize 结果 → org / assigned / none）、`installTaskWhere`（type=install + customer.orgId + assigned 时 assignedToId + 区间）、`canSeeInstallTask`、`groupByDay`
- `closeout.ts`：`aggregateCloseout(items, logs)`（每窗最新 / 张数 / 已收口数 / allCompleted）、`missingWindows`、`installPhotoPathname`、`validatePhotoUpload`（jpeg/png/webp ≤ 8MB）、`parseInstallPhotoPath`
- `service.ts`：数据库侧读取与序列化（任务 / 工艺单 / 收口日志），统一 404 / 403 / 409 响应；**不返回金额、成本、原始存储 URL**
- 测试 `__tests__/scope.test.ts`（15）、`__tests__/closeout.test.ts`（16），已注册 `scripts/test-all.sh`（420）

### 1.3 API
| 路由 | 行为 |
|---|---|
| `GET /api/install/tasks?start&end` | authorize(install.task.read) → ASSIGNED 只看本人 / ORG 全企业 / 无 → 403；返回预约 + 工艺单摘要 + 已收口/总窗数 |
| `GET /api/install/tasks/{id}` | 资源级 authorize（ASSIGNED ↔ assignedToId）；未关联工艺单 409 `NO_ORDER`；每窗收口状态 |
| `GET /api/install/installers` | 调用方须持 `install.task.assign` 或 `install.task.read`(ORG)；返回持 `install.task.read` 的用户 id / 姓名（`listUsersWithPermission`） |
| `POST /api/install/tasks/{id}/start` | install.task.update；scheduled/confirmed → in_progress；审计 `install.task.started`；重复 200 幂等 |
| `POST /api/install/tasks/{id}/items/{itemId}/photo` | install.window.complete；限流 30/min；类型 & 大小校验；`putPrivateBlob("install-photos/{orgId}/{orderId}/{itemId}/{ts}.{ext}")`；审计 `install.window.completed`（targetType `blinds_order_item`）；返回该窗最新记录；itemId 不属该单 404 |
| `POST /api/install/tasks/{id}/complete` | install.task.update；缺窗 409 `WINDOWS_MISSING` + 清单；全部 → 事务：预约 completed + 工艺单 installed（状态机 + OrderStatusLog）；审计 `install.task.completed`；已完成 200 幂等；工艺单状态不允许 409 `ORDER_STATUS` |
| `GET /api/files/install-photos/...` | 新前缀：org 成员 + （`install.photo.read` ORG 或该工艺单预约的被分配人）；平台 admin 放行 |
| `POST /api/blinds-orders/{id}/transition`（toStatus=scheduled） | 工艺单无 customerId → 400 `NO_CUSTOMER`；缺安装时间 400；执行者须持 `install.task.assign` → 否则 403；`assignedToId` 必填且须持 `install.task.read` → 否则 400 `NOT_INSTALLER`；同时回写 `installDate`（YYYY-MM-DD） |

### 1.4 页面与入口
- `/install`（`src/app/(main)/install/page.tsx` + `src/components/install/install-task-list.tsx`）：服务端按 `canAccessInstallWorkspace || 管理层` 放行；列表按日分组（今天高亮）/ 周视图切换（周一起、前后翻周）；卡片：时间段、客户、地址、工艺单号、已收口/总窗
- `/install/[id]`（`install-task-detail.tsx`）：任务头（时间 / 客户 / 地址→地图 / 电话→拨号 / 开始安装）；每窗卡片（序号 / 位置 / 尺寸 / 产品 / 面料 / 操控 / 安装方式 / 备注 / 拍照按钮 `accept=image/* capture=environment` / 缩略图 + 时间 + 张数 / 点缩略图展开历史）；客户端 `createImageBitmap` 压到最长边 1600px jpeg 再传；底部固定"完成收口"（未全部收口时禁用并显示还差几扇；409 时列出未收口窗）
- 工作区：`workspace-policy.ts` 新增 `install`（`canAccessInstallWorkspace` 按 `install.task.read`）；`getDefaultWorkspace` / `resolveHomeRedirect`：非销售 / 运营 / 招投标专职且持安装权限 → `/install`；`permissionKeys` 由 `resolveWorkspaceContextFromCookies` 与 `GET /api/auth/active-org` 用 `resolveEffectiveBindings` 注入
- 入口：`navigation/registry.ts` `ws-install`（WORK 组、`workspaceAccess: "install"`、模块 window_covering）；`mobile-tab-bar.tsx` 安装工首栏即"安装"，其他持权者追加"安装"页签；`NAV_HREF_MODULES["/install"]`
- 工艺单详情 `blinds-orders/[id]/page.tsx`：状态在 confirmed / in_production / ready 时显示"安排安装"→ 对话框（安装工下拉来自 `/api/install/installers` + `datetime-local`）→ transition scheduled；`appointmentId` 存在且 `/api/install/tasks/{appointmentId}` 返回 200 时显示"收口 n/m"标签（每窗缩略图 / 时间 / 张数 / 备注）；`STATUS_MAP` 补齐 in_production / ready / scheduled / installed / cancelled

### 1.5 状态机调整（design D8）
`src/lib/blinds/order-state-machine.ts`：`confirmed → ready | scheduled`、`in_production → scheduled`。原因：现网工艺单不维护 ready，否则"安排安装"永远不可用。其余边不变。

## 2. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/install/__tests__/scope.test.ts` | 15 passed |
| `npx tsx src/lib/install/__tests__/closeout.test.ts` | 16 passed（含 409 清单 / 补拍 / 坏 JSON / 路径 / 类型大小） |
| `npx tsx src/lib/authorization/__tests__/authorize.test.ts` | 67 passed（10 个岗位模板、17 个新键） |
| navigation ia / workspace / active-matcher / trade-layout | 63 / 30 / 21 / 5 passed |
| rbac default-workspace / workspace-policy | 7 / 24 passed |
| `npm run typecheck` | 0 error |
| `npx eslint`（本 change 全部文件） | 0 error |
| `npm run lint:baseline` | PASS（相对基线 −14 error） |
| `npm run test:ci` | PASS（runtime-architecture 守卫 9/9） |
| `bash scripts/check-test-registry.sh` | OK（420 注册 / 基线 72） |
| `grep -rnE "grandTotal\|price\|msrp\|costPrice" src/app/api/install` | 空 |
| `openspec validate install-1-installer-position --strict` | valid |

全量 `npm test`（沙箱）：423/437 通过，14 失败。其中 13 条与 PERM-1/2 报告的基线完全相同（无 PostgreSQL / 无外网 / 无 Chromium 字体的环境失败：Agent Trace 只读查询、Phase3A-2/3/4/5 的 DB / Smoke / Acceptance、Governance Hygiene ×2、Gmail Draft OAuth、T4 真实 Postgres 矩阵、报价 PDF 分页 e2e）；第 14 条是 `test-all.sh` 内置的 `npx tsc --noEmit` 在沙箱 Node 22 默认堆上 OOM，单独以 `NODE_OPTIONS=--max-old-space-size=8192` 跑 tsc 为 0 error（CI 用 Node 24，无此问题）。
沙箱无 PostgreSQL / 无 Blob，浏览器端到端未跑，见 §5 手工走查。

## 3. 判断点（审核请重点看）
1. **ASSIGNED ↔ assignedToId**：安装工所有判定都走 `authorize(..., resource: { type: "appointment", assignedToId })`；列表 where 由 `installTaskWhere` 生成，ORG 范围不加 assignedToId。
2. **排安装只有运营 / 会计 / 老板**：`install.task.assign` 只给 owner / ops_lead / accounting；fulfillment_* 只有 read + photo.read；transition 路由先查执行者 assign，再查被分配人 read。
3. **收口记录放 AuditLog**：追加式、按 `targetType+targetId` 索引查询；补拍 = 新行；最新一条为当前照片。`install.window.completed` 行不可清理。
4. **照片可见范围**：文件代理对 `install-photos/` 要求 org 成员 + （photo.read ORG 或被分配人）；销售 403。
5. **完成收口推进工艺单**：事务内 预约 completed + 工艺单 installed + OrderStatusLog（operatorId = 安装工）；工艺单已 installed / completed 时只收预约。
6. **状态机加边**（D8）是本 change 唯一对既有行为的改动；若不接受，回退 `order-state-machine.ts` 一处即可，其余不受影响（但"安排安装"只能从 ready 发起）。

## 4. 已知限制
- `AuditLog` 作为业务记录：任何归档 / 清理策略必须排除 `install.window.completed` / `install.task.*`。PERM-3 若引入订单扩展 JSON 位再迁移。
- 既有日历页 `/sales/calendar` 属销售工作区，安装工进不去；安装工的日历由 `/install` 周视图满足（PERM-4 统一导航时再放行）。
- 安装工看不到 `/blinds-orders/[id]`（`getVisibleProjectIds`），所需窗信息全部由 `/api/install/tasks/{id}` 提供。
- 不做照片删除、不做多图批量上传；每次一张，可补拍。
- `GET /api/install/installers` 只读 DB 岗位绑定，平台 super_admin 不在候选里（他本来就不该被排去安装）。
- 旧数据：#transition 之前已创建、`customerId=""` 的预约不受影响，但 `/api/install/tasks` 按 `customer.orgId` 过滤会看不到它们。

## 5. 手工走查（上线后 / 本地 `next dev` + 本地 Blob 盘）
0. 前置：`seedOrgAuthorizationProfiles(Sunny)` 落 installer 模板；`config/positions/sunny.json` 补安装工邮箱；`ALLOW_POSITION_BINDING=true npx tsx scripts/bind-positions.ts --org <sunnyOrgId> --file config/positions/sunny.json --actor <lucas> --dry-run` → 去掉 `--dry-run` 执行。
1. 运营（Marty）登录 → 工艺单详情（状态 confirmed）→ "安排安装" → 下拉里只有安装工 → 选人 + 时间 → 确认 → 工艺单变"已排期"、`installDate` 回写。
2. 出单人（蒋晨 / Bob）同一按钮 → 接口 403"只有运营 / 会计 / 老板岗位可以安排安装"。
3. 安装工登录 → 落地 `/install`，底栏首栏"安装"，无销售 / 报价 / 客户入口 → 列表只有自己的任务 → 周视图正确分天。
4. 任务页 → "开始安装" → 状态安装中 → 对每扇窗拍照 → 缩略图 + 时间 → 对同一窗补拍 → 张数 2 → 全部拍完前"完成收口"禁用；点击后若有漏窗显示清单。
5. 全部拍完 → "完成收口" → 预约 completed、工艺单"已安装"；再点一次 → 200 幂等。
6. 老板（Bob）打开工艺单详情 → "收口 n/m" 标签 → 每窗缩略图可打开（`/api/files/install-photos/...` 200）。
7. 销售（Alex）直接访问同一张照片代理地址 → 403；访问 `/install` → 重定向。
8. 审计中心：`install.task.started` / `install.window.completed` ×N / `install.task.completed` 各一条，afterData 无原始 Blob URL。

## 6. 上线动作
见 `docs/QINGYAN_PERMISSION_HANDOFF.md`「下一步」第 4 条；合并后独立小 PR `/opsx:archive install-1-installer-position --yes`，确认 `openspec list --specs` 出现 `installation/install-tasks`、`installation/window-closeout`。

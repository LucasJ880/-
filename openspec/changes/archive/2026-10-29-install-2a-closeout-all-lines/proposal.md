# Proposal: install-2a-closeout-all-lines

**TASKFLOW：** INSTALL-2a（`docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2 段）；承载方案 `docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` §0 F2、§4.1、§9 第一行（2026-10-28 Lucas 拍板）。
**受影响的 Muse 意图：** 无。本 change 不触碰 `src/lib/muse-bridge/**`。

## Why

收口单元今天只取 `BlindsOrderItem`，而 Shutters（Vinyl）、窗帘、国内下单、外采购行都在工艺参数里，只有这些行的单窗数为 0，"完成收口（还差 0 扇）"永远禁用、`/complete` 永远 409 且清单为空——Sunny 的主力产品装完收不了口。同时照片的收口记录用吞错的审计写入，记录失败时接口仍报成功，安装工以为拍过了，收口时才发现缺。

## What Changes

- 把收口单元定义为"工艺单行 + 工艺参数的 Vinyl 窗 / 窗帘行 / 国内下单行 / 外采购行"，每个单元有确定的单元 id、序号、位置、尺寸、品类标签；任务列表、任务详情、完成收口、工艺单"收口"标签使用同一套单元。
- 让 `POST /api/install/tasks/{id}/items/{unitId}/photo` 接受工艺参数单元 id（`spec-<段>-<序号>`）；工艺参数单元的收口记录写审计动作 `install.window.completed`、目标类型 `blinds_order_unit`、目标 `<工艺单 id>:<段>:<序号>`，内容含拍照时的位置快照。
- 规定工艺参数单元的照片只在"拍照时位置 = 当前位置"时计入收口；位置不一致的单元显示"位置已变，请补拍"，计为未收口。
- 让没有任何收口单元的工艺单在 `/complete` 返回 409 `NO_UNITS`（含说明），任务页显示"工艺单没有可收口的行，请联系出单补齐"，不再显示"还差 0 扇"。
- 把照片收口记录改为写入失败即报错：照片已存但记录未写入时返回 500 并提示重拍，不返回成功。
- 写 `docs/QINGYAN_INSTALL-2a_REPORT.md`，TASKFLOW INSTALL-2a 改 `[G]`。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `installation/window-closeout`：收口单元的定义（新增工艺参数单元）、上传接口接受工艺参数单元、聚合规则（位置快照比对）、完成收口对零单元的 409、记录写入失败不得报成功、照片存储路径的单元段。
- `installation/install-tasks`：任务列表的"窗数 / 已收口窗数"与任务详情的"每扇窗"改为按收口单元计算与返回（含单元品类标签）。

## Impact

- 改：`src/lib/install/closeout.ts`（单元构建 / 单元 id 编解码 / 聚合）、`src/lib/install/service.ts`（批量读工艺参数与两类收口记录、序列化单元）、`src/app/api/install/tasks/route.ts`、`src/app/api/install/tasks/[id]/route.ts`、`src/app/api/install/tasks/[id]/complete/route.ts`、`src/app/api/install/tasks/[id]/items/[itemId]/photo/route.ts`、`src/components/install/install-task-detail.tsx`、`src/components/install/install-types.ts`、`src/app/(main)/blinds-orders/[id]/page.tsx`（收口标签显示单元品类）。
- 只读复用：`src/lib/sunny-process/process-spec.ts`（`sanitizeSpec` / 段结构）、`src/lib/sunny-process/autogen.ts`（工艺参数审计动作常量）。
- 数据库：零 schema。新增审计目标类型字符串 `blinds_order_unit`（既有 `AuditLog.targetType` 列）。
- 测试：扩 `src/lib/install/__tests__/closeout.test.ts`；新增 `src/lib/install/__tests__/closeout-units.test.ts`（注册 `scripts/test-all.sh`）；新增隔离库端到端 `src/lib/install/__tests__/closeout-db.isolated.test.ts`（注册）。
- 对外行为：任务列表 / 详情的窗数对含工艺参数行的单变大；`/complete` 新增 409 `NO_UNITS`；上传接口记录失败时由 200 变为 500。

## Out of scope

- 逐单元"有问题"标记、维修单（INSTALL-2c）。
- 第二次安装 / 按访次聚合 / 照片代理放行历史访次的被分配人（INSTALL-2d）。
- 尾款确认、质保邮件、任何通知（INSTALL-2b）。
- 窗帘布帘 + 纱帘合并为一个单元：本 change 一行一个单元，不合并。
- 工艺参数被改后自动迁移照片：只做位置比对提示，不迁移。
- 修改工艺参数的结构或给工艺参数行加稳定 id。

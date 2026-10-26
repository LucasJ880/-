# Proposal: org-cockpit-proactive-notify

**TASKFLOW：** A-3 后续（A-3 报告 §4 第 5 条 GATE 决策项的落地，不是任务书新编号）。状态列沿用 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` 的 A-3 行。本分支叠在 C-2（`claude/fde-preferences-in-followup`）之上，逻辑上只依赖 A-3。
**受影响的 Muse 意图：** 无。
**已决定（不重开）：** 用户 2026-10-26 第二轮：A-3 的"主动提醒扫描随旧首页停止"另开 change 处理，不接受静默丢失；D-2（首页直接替换为岗位视图、新首页只读）不变。

## Why

旧首页每 5 分钟 `POST /api/proactive/scan`。A-3 换上只读的岗位视图后，没开自动化偏好的管理层就再也收不到主动提醒（截止临近、开标临近、客户跟进等）。本 change 让既有的每小时 `proactive-scan` 定时任务为这些管理层补发提醒通知，只写通知，不执行任何自动动作。

## What Changes

- **定时任务多一轮"只提醒"**：`/api/cron/proactive-scan` 照旧先处理开了自动化偏好的用户，然后为管理层补一轮。
  - 管理层范围：
    - 在职组织成员（组织在用）中组织角色为 `org_owner` / `org_admin` 的人，以及平台角色为 `boss` / `manager` 的人（角色集合与首页 `/` 的管理层判定相同；但只从组织成员关系里找，见偏差 5）；
    - 账号在职，且 30 天内登录过；
    - 已在自动化那一轮处理过的人不重复处理；
    - 平台 `admin` / `super_admin` 不在范围内（他们的扫描覆盖全平台项目）。
  - 只扫描、只写通知：与旧首页同一套扫描（`urgent` / `warning` 建议写通知），**不执行**自动动作。
  - 每轮最多 100 人，另设时间预算，到时即停；按用户 id 排序，从上一轮最后处理的人之后接着排（游标记在本定时任务自己的运行记录里），人数超上限或预算截断时后面几轮接着处理。
- **通知按用户去重**（`src/lib/proactive/notify.ts`）：`Notification.sourceKey` 全局唯一，而原来的 key `proactive:{dedupeKey}` 不含用户，同一条提醒全平台只写给第一个被扫到的人。key 改为 `proactive:{userId}:{dedupeKey}`；本人名下已有旧格式 key 的视为已发，不重发；返回实际新建条数。仍是零 schema。
- **补发整轮出错计入运行状态**：取候选等整轮出错时失败计数加 1，运行记为部分成功，岗位心跳与时间线能看到。
- **扫描函数加选项**：`runProactiveScanForUser` 增加可选的"不执行自动动作"。不传时行为不变，`POST /api/proactive/scan` 与自动化那一轮都不受影响。
- **运行结果可区分两轮**：定时任务的运行结果按用户标出 `mode`（`automation` / `notify_only`），元数据分别计数；两轮主体抽成依赖可注入的函数，路由只负责鉴权与运行记录。
- **新增测试**：
  - 管理层候选、去重、游标续排（含预算截断）的纯函数；
  - 只提醒不执行自动动作；
  - 两轮主体（假依赖：计数、mode、整轮失败计入）；
  - 通知按用户去重（假 Notification 表，按全局唯一 sourceKey 语义）；
  - 定时任务接入点的静态断言；
  - 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- **写报告并更新状态**：`docs/QINGYAN_ORG_COCKPIT_A-3b_REPORT.md` 与 HANDOFF。

**与任务书的偏差（GATE 审核时请逐条确认）：**
1. **频率从"打开首页时每 5 分钟"变成"每小时一次"**：沿用既有定时任务（`15 * * * *`），不新增 cron。主动提醒是"几天内截止 / 开标"一类的提醒，小时级足够。
2. **【GATE 注意项】覆盖范围比旧首页略宽**：
   - 旧首页只在管理层打开首页时扫描；
   - 现在对 30 天内登录过的管理层都扫描，不管当天开没开首页。
   - 通知按用户去重，同一条提醒对同一个人不会反复出现。
   - 另外，A 组织是 `org_admin`、当前活跃组织是 B 的人，首页不算管理层，补发算。
3. **平台管理员不补发**：平台 `admin` / `super_admin` 的扫描范围是全平台项目，定时补发会把所有组织的提醒都推给平台账号。他们仍可开自动化偏好，走原有一轮。
4. **不改通知偏好口径**：主动提醒的通知写入方式与旧首页相同（直接写 `Notification`），不新增偏好开关。
5. **只从组织成员关系里找管理层**：没有任何在职组织成员关系的平台 `boss` / `manager`，首页算管理层，补发不覆盖（他们的项目可见性本来就来自组织成员关系）。
6. **【GATE 注意项】顺带修正通知去重**：`notify.ts` 原本不在本 change 范围内（design 原 Non-Goal）。交叉审查发现全局唯一 sourceKey 让同组织第二位管理层永远收不到同一条提醒，旧首页时代就存在，本 change 的固定扫描顺序会让它固定下来，所以一并修正。上线后，过去被别人占掉的提醒会补发给本人一次。

## Capabilities

### New Capabilities
- `cockpit/manager-proactive-notify`：管理层主动提醒在只读首页之后的补发。包括：
  - 范围、去重与上限；
  - 只提醒、不执行自动动作；
  - 运行结果；
  - 不新增 cron。

### Modified Capabilities
（无。A-3 的 `cockpit/home-view` 不修改：首页仍只读。）

## Impact

- 新文件：
  - `src/lib/proactive/manager-notify.ts`（候选查询条件、去重与上限的纯函数、依赖可注入的补发执行器）
  - `src/lib/proactive/__tests__/manager-notify.test.ts`
  - `docs/QINGYAN_ORG_COCKPIT_A-3b_REPORT.md`
- 修改：
  - `src/lib/proactive/run-scan.ts`（可选的不执行自动动作）
  - `src/lib/proactive/notify.ts`（sourceKey 带 userId、识别旧格式、返回实际新建条数）
  - `src/app/api/cron/proactive-scan/route.ts`（改为调用两轮主体）
  - `scripts/test-all.sh`、`scripts/test-ci-unit.sh`
  - `docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md`
- 零 schema；不新增 cron / 队列（沿用 `vercel.json` 既有的 `proactive-scan`）；无 LLM 调用；无外发（只写站内通知）。

## Out of scope

- 不改首页（仍只读，D-2）；不改 `POST /api/proactive/scan`。
- 不改扫描规则（`scanner.ts` / `sales-scanner.ts`）与通知文案；不迁移已有通知的 sourceKey。
- 不执行任何自动动作（自动动作仍只对开了自动化偏好的用户执行）。
- 不加用户级开关或通知偏好。

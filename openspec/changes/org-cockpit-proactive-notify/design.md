# Design: org-cockpit-proactive-notify

## Context

- `runProactiveScanForUser(userId, role)`（`src/lib/proactive/run-scan.ts`）分三步：
  1. 扫项目（`scanProjectsForUser`）和销售（`scanSalesForUser`）；
  2. `syncSuggestionsToNotifications` 把 `urgent` / `warning` 建议写进 `Notification`，按 `proactive:{dedupeKey}` 去重；
  3. 用户开了自动化偏好时，`executeAutoActions` 执行低风险自动动作。
- 调用方只有两个：
  - `POST /api/proactive/scan`：旧首页挂载时及每 5 分钟调用，A-3 之后没有调用方了；
  - `GET /api/cron/proactive-scan`：每小时 `15 * * * *`，只处理 `UserNotificationPreference.metadata` 非空且自动化开启的用户，最多 100 人，`runTrackedAutomation("proactive-scan")` 记运行。
- 首页 `/` 的管理层判定是 `isManagementWorkspaceUser`：平台 super_admin / admin / boss / manager，或组织角色 org_owner / org_admin。
- 项目可见性 `getVisibleProjectIds`：平台 super_admin / admin 返回 `null`，即全部项目；其他人按组织成员身份与项目成员身份算。

## Goals / Non-Goals

**Goals**
- 恢复"没开自动化偏好的管理层也能收到主动提醒通知"；
- 不执行自动动作；
- 不新增 cron；
- 既有两个调用方的行为不变。

**Non-Goals**
- 不改 `src/lib/proactive/scanner.ts`、`sales-scanner.ts`、`notify.ts`、`auto-actions.ts`、`automation-prefs.ts`；
- 不改 `src/app/api/proactive/scan/route.ts`、`src/app/(main)/page.tsx`、`src/components/cockpit/**`；
- 不改 `vercel.json`。

## Decisions

### D1：`runProactiveScanForUser` 加可选参数，默认行为不变

```ts
runProactiveScanForUser(userId, role, options?: { autoActions?: boolean })
```

- `autoActions` 默认 `true`。为 `false` 时跳过 `executeAutoActions`，返回 `autoActions: []`。
- `POST` 接口与自动化那一轮不传 options，代码路径不变。
- **否决**：在定时任务里复制一份扫描 + 通知的代码。两份写法一旦漂移，补发与旧首页的口径就不一致。

### D2：候选与去重是纯函数，查询条件可断言

新文件 `src/lib/proactive/manager-notify.ts` 提供以下内容。

- `managerCandidateWhere(now)`：`OrganizationMember` 的查询条件：
  - 成员 `status = active`；
  - 账号 `status = active`、`lastLoginAt ≥ now − 30 天`；
  - 组织角色 `org_owner` / `org_admin`，或平台角色 `boss` / `manager`；
  - 平台角色不是 `admin` / `super_admin`。
- `planManagerNotifyRun({ candidates, alreadyScanned, cap, now })`：
  - 按 userId 去重；
  - 去掉已在自动化一轮处理过的；
  - 再次排除平台管理员（双保险）；
  - 按 userId 排序，起点 = `(当前小时序号 × cap) mod 人数`，取 `cap` 人。无状态轮转：人数 ≤ cap 时每轮全覆盖；超过时 ⌈人数 / cap⌉ 轮覆盖全部。
- `runManagerNotify(deps, { now, alreadyScanned, budgetMs })`：
  - 依赖可注入：取候选、单人扫描、时钟；
  - 逐个调用 `runProactiveScanForUser(userId, role, { autoActions: false })`；
  - 时间预算用完就停；
  - 单人失败不影响其他人；
  - 返回每人的 `{ userId, mode: "notify_only", suggestions, notifications | error }`。
- **否决**：
  - 按最近登录排序取前 100：人数超过上限时，排在后面的人永远轮不到；
  - 在 `UserNotificationPreference` 里记"上次补发时间"：要写偏好表，改了别的功能的数据。

### D3：定时任务接入

`/api/cron/proactive-scan` 分两轮：
- 自动化一轮照旧，结果每条加 `mode: "automation"`；
- 再跑 `runManagerNotify`：
  - `alreadyScanned` 传自动化一轮处理过的 userId；
  - 时间预算 = 240 秒减去已用时间（`maxDuration` 为 300 秒）。

结果合并后，计数与元数据如下：
- `processedCount` = 两轮人数之和；
- `metadata.enabledUsers` 保留原义（自动化一轮人数），新增 `metadata.notifyOnlyUsers`。

**否决**：放进 `revenue-spine` 或 `daily-brief` 等别的定时任务。主动提醒的运行应记在 `proactive-scan` 名下，A-1 / A-2 的岗位心跳按这个 key 看。

### D4：平台管理员排除

- 平台 `admin` / `super_admin` 的项目可见性是全部项目，补发会把所有组织的截止提醒推给平台账号。
- 他们在旧首页上也会这样，但那是本人打开首页时才触发。定时补发不应替他们做。
- 他们开了自动化偏好的，仍走原有一轮。

## 与八条硬纪律的关系

1. **零 schema**：只读既有表（`OrganizationMember`、`User`），写既有 `Notification`；不加列、不加表。
2. **出站先审批**：只写站内通知，不发邮件、不发微信，不执行自动动作，没有外发。
3. **禁止第三套队列**：沿用 `vercel.json` 里既有的 `proactive-scan`（每小时），不新增 cron / 队列。
4. **脱敏**：通知内容与旧首页相同（建议标题与描述），不新增字段；运行结果只记 userId、计数与错误信息。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：扫描规则是既有确定性规则，不新增 LLM 调用。
8. **测试注册**：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

| 验证项 | 命令或做法 | 期望结果 |
|---|---|---|
| 候选条件、去重、轮转、预算、只提醒 | `npx tsx src/lib/proactive/__tests__/manager-notify.test.ts` | 全部通过 |
| 定时任务接入与默认行为不变 | 同上，静态断言 `route.ts` / `run-scan.ts` | 通过 |
| 全量 / 类型 / lint / CI 子集 | `npm test`、`npm run typecheck`、`npm run lint:baseline`、`npm run test:ci` | 与基线一致 / 通过 |
| 规格 | `openspec validate org-cockpit-proactive-notify --strict` | 通过 |
| staging | 没开自动化偏好的组织所有者名下放一个 2 天后截止的项目，等一轮定时任务 | 收到一条截止临近通知，没有任何自动动作执行 |

## Risks / Trade-offs

- **[覆盖比旧首页略宽]**：30 天内登录过的管理层都会收到提醒，不管当天开没开首页。去重保证同一条只出现一次。列为 GATE 注意项。
- **[30 天窗口]**：`lastLoginAt` 只在登录时更新，会话长期不过期的人可能被误判为不活跃。
- **[时间预算]**：自动化一轮人多时，补发一轮可能处理不完，靠轮转在后续几轮补齐。

## Migration Plan

无数据迁移。上线后第一轮定时任务即开始补发。回滚：撤销 PR。补发写入的通知是普通通知，用户可正常已读或删除。

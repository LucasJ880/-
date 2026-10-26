# A-3b 完成报告：定时任务为管理层补发主动提醒（openspec change `org-cockpit-proactive-notify`）

任务来源：A-3 报告 §4 第 5 条 GATE 决策项。旧首页每 5 分钟 `POST /api/proactive/scan`，换成只读岗位视图后停了；用户 2026-10-26 第二轮决定另开 change，不接受静默丢失。不是任务书新编号，状态沿用 A-3 行。
分支：`claude/org-cockpit-proactive-notify`。叠在 C-2 `claude/fde-preferences-in-followup` 之上，PR base = C-2 分支，依次合并后改回 `main`。
OpenSpec change：`openspec/changes/org-cockpit-proactive-notify/`（proposal / `specs/cockpit/manager-proactive-notify/spec.md` / design / tasks，`openspec validate --strict` 通过）。

---

## 1. 做了什么

| 文件 | 内容 |
|---|---|
| `src/lib/proactive/run-scan.ts`（改） | `runProactiveScanForUser(userId, role, { autoActions? })`：`false` 时只扫描、只写通知，不执行自动动作；不传时行为不变 |
| `src/lib/proactive/notify.ts`（改） | 通知 `sourceKey` 改为 `proactive:{userId}:{dedupeKey}`；本人名下已有旧格式 `proactive:{dedupeKey}` 的视为已发；返回 `createMany` 实际新建条数；依赖可注入 |
| `src/lib/proactive/manager-notify.ts`（新） | 管理层候选条件（在职成员、组织在用、账号在职、30 天内登录、org_owner / org_admin 或平台 boss / manager，排除平台 admin / super_admin）；去重与排除；游标续排（候选查询分段从游标之后读）；时间预算；单人失败隔离；两轮主体 `runProactiveScanCron(deps)` |
| `src/app/api/cron/proactive-scan/route.ts`（改） | 只负责 cron 鉴权与 `runTrackedAutomation("proactive-scan", …)` |
| 测试（新，已注册进两个测试脚本） | `src/lib/proactive/__tests__/manager-notify.test.ts` 23 条 |

运行一轮的样子：
1. 自动化一轮照旧（开了自动化偏好的用户，最多 100 人），结果标 `mode: "automation"`，新增每人 `notifications`；
2. 补发一轮：排除第 1 轮处理过的人，用剩余预算（240 秒减已用），每轮最多 100 人，结果标 `mode: "notify_only"`；
3. 元数据：`enabledUsers` / `notifyOnlyUsers` / `notifyOnlyPlanned` / `notifyOnlyStoppedByBudget` / `notifyOnlyCandidatesTruncated` / `notifyOnlyResumeAfter`（游标）/ 出错时 `notifyOnlyError`、`notifyOnlyResumeError`；补发整轮出错时运行记 `partial`。

## 2. 怎么验的

| # | 验证 | 结果 |
|---|---|---|
| 1 | `manager-notify.test.ts` 单独运行 | 23 / 23 |
| 2 | 候选范围 | 查询条件逐字段断言（含组织在用、30 天窗口、排除平台管理员）；计划里再排除一次平台管理员；同一人多个组织只算一次 |
| 3 | 游标续排 | 150 人两轮覆盖；80 / 100 / 200 / 250 人 × 每轮只处理 40 / 60 人，若干轮内全覆盖；2100 人、每段只读 2000 行，21 轮内全覆盖（含 userId 最大的 100 人）；多轮端到端经运行记录 metadata 传游标 |
| 4 | 两轮主体 | 假依赖：3 + 5 计数与 mode；剩余预算 = 240 秒 − 已用（自动化一轮用 150 秒 → 90 秒）；补发的 now 为补发开始时刻；整轮出错 → partial、计数按人、游标沿用；读游标失败 → 从头并记元数据 |
| 5 | 通知按用户去重 | 假 Notification 表按全局唯一 sourceKey 语义：同组织两位管理层各一条；连续两轮不重复；本人名下旧 key 视为已发、别人名下旧 key 不挡本人；冲突跳过的不计入返回值 |
| 6 | 只提醒不执行自动动作；既有调用方 | 默认依赖调 `runProactiveScanForUser(..., { autoActions: false })`；`POST /api/proactive/scan` 文件未改；自动化一轮查询 / 排序 / 上限 / 调用与原先一致；`vercel.json` 仍只有一条 `15 * * * *` |
| 7 | 变异检查 | 旧 key、计数、整轮失败计入、游标、enabledUsers 位置、游标沿用、剩余预算、now、partial：各至少 1 条断言失败 |
| 8 | `npm run typecheck`（全量） | （门禁跑完后补） |
| 9 | `npm run lint:baseline` | （门禁跑完后补） |
| 10 | `npm test` 对比基线 | （门禁跑完后补） |
| 11 | `npm run test:ci` | 退出 0，`CI unit subset PASS`（含 `schedule.test.ts` 182 条——第二轮审查发现的阻塞已修） |
| 12 | `bash scripts/check-test-registry.sh` | （门禁跑完后补） |
| 13 | `git diff --stat claude/fde-preferences-in-followup -- prisma/ vercel.json` | （门禁跑完后补） |
| 14 | `openspec validate org-cockpit-proactive-notify --strict`；`/opsx:verify` | valid。verify：tasks 待 3.x 勾选后 6 / 6；4 条 requirement / 15 个 scenario 均有测试断言（「已归档组织」「长期未登录」为查询条件断言）；design D1–D5 与实现一致；无 CRITICAL / WARNING。未验证：真实 DB 下的定时任务全链路（容器无 DB），留 staging |

## 3. 与任务书的偏差（请 GATE 逐条确认，详见 proposal）

1. **频率从"打开首页时每 5 分钟"变成"每小时一次"**：沿用既有定时任务，不新增 cron。
2. **【GATE 注意项】覆盖范围比旧首页略宽**：30 天内登录过的管理层都会扫，不管当天开没开首页；A 组织是 org_admin、当前活跃组织是 B 的人也算。
3. **平台管理员不补发**：他们的项目可见性是全平台。
4. **不改通知偏好口径**：直接写 `Notification`，不新增偏好开关。
5. **只从组织成员关系里找管理层**：没有任何在职组织成员关系的平台 boss / manager 不覆盖。
6. **【GATE 注意项】顺带修正通知去重**（原 Non-Goal 里的 `notify.ts`）：全局唯一 sourceKey + 不含用户的 key，让同组织第二位管理层永远收不到同一条提醒（旧首页时代就有，A-3b 的固定扫描顺序会让它固定下来）。上线后，过去被别人占掉的提醒会给本人补发一次；回滚则旧代码会按旧格式给每人再写一条。

## 4. 交叉审查（独立审查代理两轮，只给代码与规格）

### 第一轮（审 `9a30113a`）

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| 1 | 阻塞 | `Notification.sourceKey` 全局唯一，key 不含 userId：同一条提醒全平台只写给第一个被扫到的人，且每轮虚报 `notifications: 1` | key 带 userId；旧格式在本人名下视为已发；返回实际 `count`；假表测试 |
| 2 | 应修 | 按小时轮转起点与本轮实际处理人数无关，预算截断时固定漏人（80 人、每轮 40 人，后 40 人一周都轮不到） | 改为游标续排，游标记在本定时任务自己的运行记录 |
| 3 | 应修 | 补发整轮出错只写元数据，运行记 succeeded，心跳与时间线看不到 | 记 partial |
| 4 | 应修 | "运行结果区分两轮"与"同一条提醒不重复"的测试是空断言 | 两轮主体抽成可注入函数；通知去重用假表做行为测试 |
| — | 可选 | 已归档组织；候选无排序；spec 场景措辞；design 签名与风险描述；两轮字段不对称 | 加组织在用条件；候选按 userId 排序并标截断；措辞与文字修正；自动化结果补 `notifications` |

### 第二轮（只审第一轮的修复 `4ddefa9c`）

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| 1 | 阻塞 | 路由不再出现 `"proactive-scan"` 字面量，已注册的 `schedule.test.ts` 失败，`test:ci` 会红 | 路由写回字面量；测试断言同步 |
| 2 | 应修 | 候选按 userId 取前 2000 行、游标只在内存里用：超过 2000 行时 userId 最大的一批人永远轮不到 | 候选查询分两段（游标之后 + 从头），游标进查询；2100 人分段假 DB 测试 |
| 3 | 应修 | 剩余预算与 now 的接线断言测不出回归（固定时钟） | 假时钟在自动化一轮递增，断言预算与 now |
| 4 | 应修 | spec "手动扫描接口行为不变"与去重口径变化自相矛盾；候选上限与截断元数据没写进 spec | 改为"除通知去重口径与返回计数外不变"；补候选上限 Requirement 文字与 Scenario |
| — | 可选 | 单人扫描无超时；读游标失败静默；整轮出错 `failedCount + 1` 计数加不起来；通知默认依赖缺静态断言；回滚风险；上线补发一次与 `notifications` 字段未进 spec | 单人超时列为 GATE 注意项（预算留 60 秒余量）；读游标失败记 `notifyOnlyResumeError`；改为返回 `status: "partial"`、计数按人；补静态断言；design 写回滚风险；spec 补两条 |

## 5. GATE 注意项与 staging 待验

- 偏差 2、6 两条注意项；以及：**单人扫描没有超时**——若某人扫描超过 60 秒余量，函数会被平台终止，这次运行被下一轮关成 failed、不写游标，下一轮从同一位置重来（扫描是既有只读查询，正常远低于 60 秒）。
- staging：
  1. 没开自动化偏好的组织所有者名下放一个 2 天后截止的项目，等一轮 `proactive-scan`：收到一条截止临近通知，没有任何自动动作执行；
  2. 同组织再加一位 org_admin（同样能看到该项目）：下一轮该管理员也收到一条；
  3. admin 页自动化运行记录：`metadata.notifyOnlyUsers` 与 `notifyOnlyResumeAfter` 有值；
  4. 同一条提醒连续两轮只出现一次。

## 6. 已知限制

- 补发频率是每小时；当天才建的"明天截止"项目最多晚一小时提醒。
- 候选每段最多读 2000 行；规模远超时仍能轮到，但每轮只看游标附近的 4000 行，元数据会标截断。

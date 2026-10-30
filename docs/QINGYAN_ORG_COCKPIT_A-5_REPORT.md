# A-5 完成报告：夜间岗位日结（openspec change `org-cockpit-daily-digest`）

任务书：`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` §A-5
分支：`claude/vigilant-edison-73bk9i`（基线 `origin/main` @ `a2537b8`，叠加链 #244–#256 合并并归档之后）
OpenSpec change：`openspec/changes/org-cockpit-daily-digest/`（proposal / specs 增量 4 份 / design D1–D6 / tasks 4/4，`openspec validate --strict` 通过）
决定来源：Lucas 2026-10-30——"A-5 按照你推荐的做"：日结写 `AuditLog`（`cockpit.post_daily_digest`），每组织每天一条、只含计数，**不进 MemoryClaim**，零 LLM。

---

## 1. 做了什么

| 场景 | 之前 | 现在 |
|---|---|---|
| 每个岗位"昨天做了什么" | A-4 工作量面板只在打开驾驶舱时现算，不留痕；过了 30 天窗口就看不到 | 每个组织本地 **00 点**，把**前一个本地日**按岗位的计数固定成一条审计，**01 点补一次**（00 点失败 / 漏触发 / 当地夏令时没有 00 点时补写，已写则跳过）；company.log 里显示为「岗位日结 · 组织」，来源「系统」 |
| 内容 | — | 逐行（七个岗位 + 询盘销售 · 展会 + 未归属）只记十个计数：AI 运行、起草、批准、驳回、过期、取消、作废、系统失败、执行失败、守卫拦截。全 0 的行不写；整组织全 0 不写 |
| 不含 | — | 平台级自动化运行数、token、成本、标题、正文、客户、金额、员工 |
| 幂等 | — | 同一组织同一本地日只一条：事务内按"组织 + 本地日"加 advisory lock，先查后写；重跑返回"已存在" |
| 运行记录 | — | 驾驶舱心跳多一个自动化「岗位日结（审计记录）」，归「运维与知识」岗位；只在有组织到点时记一次运行；部分组织失败记部分成功，全部失败记失败 |
| 企业记忆 / 通知 / 动作 | — | 不写 MemoryClaim、不发通知 / 微信 / Muse、不建审批、不调 LLM（Corporate Memory 写入口径不变） |

### 与任务书的偏差（GATE 逐条确认）

1. **写 AuditLog，不写 MemoryClaim**：Corporate Memory 只允许人工写入（`assertWritableActorType` 拒 system / ai / agent），不为日结开系统写入例外。任务书验收"`corporate-memory/access.ts` 的访问控制不变"自然满足。
2. **本地 00 点汇总前一天（01 点补一次），而不是 23:30 汇总当天**：唤醒 cron 是整点；23 点跑会漏掉 23 点之后落定的结局（审批超时任务每 2 小时把过期审批落定）。
3. **只用 A-4 的聚合，不含 A-2 时间线摘要**：时间线是同一批记录的逐条展示；日结只要计数。平台级自动化运行（不带组织）不进日结。
4. **操作人挂组织所有者**：`AuditLog.userId` 必填；来源由 company.log 的系统动作表标为「系统」，与"审批被系统作废"同一做法。

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/cockpit/daily-digest.ts`（新） | 常量（动作名、自动化键、门控小时 `[0, 1]`、十个计数字段）；`digestDayFor`（前一个本地日）；`buildPostDailyDigest`（取 A-4 那一列、只留十个计数、去掉全 0 行）；`runPostDailyDigest` / `runPostDailyDigests`（逐组织收错，结果 `written / exists / empty / error`；全部失败给运行 `failed`）；默认依赖：A-4 `getOrgWorkload`（同一个 `now`）+ 事务内锁 → 查 → `writeAuditLog` |
| `src/app/api/cron/daily-brief/route.ts` | 一次查询在用组织（多取 `ownerId`），`[7]` 挑简报组织、`[0, 1]` 挑日结组织；两组都空才 `skipped`；日结组织非空时在简报**之后** `runTrackedAutomation("post-daily-digest", …)`，整段异常收住、不影响简报；简报逻辑不变；响应多一个 `postDailyDigest` |
| `src/lib/automation/registry.ts` | 注册 `post-daily-digest`（运维类、组织时区、"每日 00:00（汇总前一天；01:00 补一次）"） |
| `src/lib/cockpit/posts.ts` / `schedule.ts` | 归 `ops_knowledge`；调度 = daily-brief 唤醒、组织本地 0 点与 1 点（最长正常间隔 23 小时） |
| `src/lib/cockpit/audit-labels.ts` | `cockpit.post_daily_digest` →「岗位日结」，列入系统写入动作 |
| `src/lib/cockpit/workload-read-model.ts` | `getOrgWorkload` 的第一个参数放宽为只需 `orgId`（驾驶舱接口仍传管理层查看人） |
| 测试 | 新：`daily-digest.test.ts`（注册进 `test-all.sh` 与 `test-ci-unit.sh`）、`daily-digest-db.isolated.test.ts`（注册进 `test-all.sh`）；补断言：`posts.test.ts`、`schedule.test.ts`、`audit-labels.test.ts` |

审计 `afterData` 形如：

```json
{ "day": "2026-10-30", "timezone": "America/Toronto",
  "rows": [ { "key": "tender", "name": "投标", "agentRuns": 0, "proposed": 2, "approved": 2, "rejected": 1, "expired": 0,
              "cancelled": 0, "superseded": 0, "systemFailed": 0, "executionFailed": 0, "guardrailBlocked": 0 } ],
  "truncated": false, "source": "system" }
```

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/cockpit/__tests__/daily-digest.test.ts` | **53 / 53**：日期选择（多伦多 00 / 01 点、上海、2026-11-01 与 2027-03-14 夏令时切换日、哈瓦那 2026-03-08 没有 00 点由 01 点补写）；只取十个计数、全 0 行 / 空日不写、截断透传、展会子行与未归属；锁键与已有记录条件；假依赖下 written / exists / empty / error、部分失败 partial、全部失败 failed；注册表 / 岗位 / 调度 / 标签；路由源码（两组门控各绑变量、两组都空才 skipped、日结在简报之后且异常收住、简报四步不变）；日结源码不碰企业记忆 / 通知 / 审批 / LLM，事务内锁 → 查 → 写 |
| 隔离库 `daily-digest-db.isolated.test.ts` | **15 / 15**：真实 A-4 读模型 + 事务写入。前一天投标起草 2 / 批准 2 / 驳回 1、项目起草 1 / 过期 1（次日 00:30 起草的不算，前一天起草、当天批准的算批准）；内容不含标题 / 正文 / 成本 / token；重跑与 00:45 → exists；两次并发 → 一条；01:30 补写同一天、内容一致；无活动组织 → empty；只多一条审计，MemoryClaim / 通知 / 审批数不变 |
| `posts.test.ts` / `schedule.test.ts` / `audit-labels.test.ts` | 224 / 193 / 11 passed（新增：归 `ops_knowledge`；门控 `[0, 1]` 与路由一致、最长正常间隔 23 小时；company.log「岗位日结 · 组织」来源 system） |
| 变异检查 | 把路由里简报 `[7]` 与日结 `[0, 1]` 对调 → `daily-digest.test.ts` 失败（审查指出原先的宽松正则抓不到，已改为绑定变量） |
| 独立审查（只给代码与规格） | 无正确性缺陷；6 条建议中采纳 5 条：01 点补一次、日结排到简报之后、全部失败记 failed、门控断言绑定变量、`digestDayFor` 移进 try；文档漂移（D5 依赖名）已对齐。第 6 条中"平台级运行出现在各组织 company.log"与 daily-brief 现状一致，不改 |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | 退出 0 |
| 改动文件 `npx eslint` | 0 问题 |
| `npm run lint:baseline` | PASS（errors 38 ≤ 基线 53，无新增 fingerprint） |
| `npm run test:ci` | PASS |
| `bash scripts/check-test-registry.sh` | OK（524 注册；欠账基线 71 条不变） |
| `openspec validate org-cockpit-daily-digest --strict` | valid |
| `git diff --stat origin/main -- prisma/ vercel.json` | 空 |

### 3.1 全量 `npm test`

隔离库、`NODE_OPTIONS=--max-old-space-size=8192`、合并最新 main（`3385deb`）后：**538 / 547**（PRICE-3 记录 535 / 545；+2 为本 change 的两个新测试，全部通过；PRICE-3 记的 TypeScript 默认堆不足在加大堆后通过）。9 个失败与 PRICE-3 报告逐条一致、均为既有环境性问题，与本 change 无关：Mention Gateway M2-A Identity DB、Sunny 工艺单 DB 端到端、Phase3A-3 Approvals Smoke、Phase3A-4 Governance Smoke、Phase3A-4 Acceptance、Phase3A-5 Overview Acceptance、Autopilot A2-P0 Isolated E2E、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局。驾驶舱全部测试（A-1..A-5）在全量中 0 失败。

## 4. 判断点

1. **00 点汇总前一天，01 点补一次**（D1）：整点唤醒下最完整的口径；夏令时切换日按当地 00:00（`localDayKeys` / `localDayStart`），25 / 23 小时的那天都有测试。只跑 00 点时，一次读取失败、漏触发或部署窗口就会让那天永久缺日结；哈瓦那、开罗、圣地亚哥、贝鲁特、亚速尔等地夏令时开始那天当地没有 00 点。01 点再跑一次，锁 + 先查后写保证不重复。
2. **只取十个计数**（D2）：模板文字没有计数之外的信息；token / 成本是另一类口径（A-4 已有），平台自动化运行不属于任何组织。
3. **锁 + 先查后写**（D3）：并发重试只会出一条；`afterData` 是 JSON 字符串列，查已有记录用 `"day":"<本地日>"` 包含匹配（`day` 是第一个键，行里没有 `day` 字段）。
4. **日结排在简报之后、异常收住**：不占简报的执行时间；简报本身抛错或超时使日结没跑时由 01 点补。同一时刻一个组织不可能同时处于本地 0 / 1 点与 7 点，两组同时非空只出现在相差 6–7 小时的不同时区组织之间。

## 5. 上线后 / 已知限制

- 部署即生效：下一个本地 00 点开始写前一天的日结；不回填历史。回滚 = 回退本 PR，已写的审计保留。
- 每组织每天两次 A-4 读取（00 点写、01 点多为 `exists`）；`post-daily-digest` 每天记两次运行。
- 00 点读取之后才提交、时间戳却在前一天的少量记录不进日结（先写者为准，与 A-4 现算口径一致）。
- A-4 读取上限触顶时日结与驾驶舱同一口径，`truncated: true` 原样记下。
- 不做：日结的阅读页面 / 接口（company.log 已能看到这条审计；时间线不读计数）、LLM 摘要版（D-1）、推送。
- staging 待验：多伦多组织本地 00:00 后 company.log 出现「岗位日结 · 组织」一条，计数与驾驶舱工作量面板前一天那列一致。

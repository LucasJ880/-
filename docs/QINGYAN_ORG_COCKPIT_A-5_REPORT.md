# A-5 完成报告：夜间岗位日结（openspec change `org-cockpit-daily-digest`）

任务书：`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` §A-5
分支：`claude/vigilant-edison-73bk9i`（基线 `origin/main` @ `a2537b8`，叠加链 #244–#256 合并并归档之后）
OpenSpec change：`openspec/changes/org-cockpit-daily-digest/`（proposal / specs 增量 4 份 / design D1–D6 / tasks 4/4，`openspec validate --strict` 通过）
决定来源：Lucas 2026-10-30——"A-5 按照你推荐的做"：日结写 `AuditLog`（`cockpit.post_daily_digest`），每组织每天一条、只含计数，**不进 MemoryClaim**，零 LLM。

---

## 1. 做了什么

| 场景 | 之前 | 现在 |
|---|---|---|
| 每个岗位"昨天做了什么" | A-4 工作量面板只在打开驾驶舱时现算，不留痕；过了 30 天窗口就看不到 | 每个组织本地 **00 点**，把**前一个本地日**按岗位的计数固定成一条审计，company.log 里显示为「岗位日结 · 组织」，来源「系统」 |
| 内容 | — | 逐行（七个岗位 + 询盘销售 · 展会 + 未归属）只记十个计数：AI 运行、起草、批准、驳回、过期、取消、作废、系统失败、执行失败、守卫拦截。全 0 的行不写；整组织全 0 不写 |
| 不含 | — | 平台级自动化运行数、token、成本、标题、正文、客户、金额、员工 |
| 幂等 | — | 同一组织同一本地日只一条：事务内按"组织 + 本地日"加 advisory lock，先查后写；重跑返回"已存在" |
| 运行记录 | — | 驾驶舱心跳多一个自动化「岗位日结（审计记录）」，归「运维与知识」岗位；只在有组织到点时记一次运行，单个组织失败记为部分成功 |
| 企业记忆 / 通知 / 动作 | — | 不写 MemoryClaim、不发通知 / 微信 / Muse、不建审批、不调 LLM（Corporate Memory 写入口径不变） |

### 与任务书的偏差（GATE 逐条确认）

1. **写 AuditLog，不写 MemoryClaim**：Corporate Memory 只允许人工写入（`assertWritableActorType` 拒 system / ai / agent），不为日结开系统写入例外。任务书验收"`corporate-memory/access.ts` 的访问控制不变"自然满足。
2. **本地 00 点汇总前一天，而不是 23:30 汇总当天**：唤醒 cron 是整点；23 点跑会漏掉 23 点之后落定的结局（审批超时任务每 2 小时把过期审批落定）。
3. **只用 A-4 的聚合，不含 A-2 时间线摘要**：时间线是同一批记录的逐条展示；日结只要计数。平台级自动化运行（不带组织）不进日结。
4. **操作人挂组织所有者**：`AuditLog.userId` 必填；来源由 company.log 的系统动作表标为「系统」，与"审批被系统作废"同一做法。

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/cockpit/daily-digest.ts`（新） | 常量（动作名、自动化键、门控小时 0、十个计数字段）；`digestDayFor`（前一个本地日）；`buildPostDailyDigest`（取 A-4 那一列、只留十个计数、去掉全 0 行）；`runPostDailyDigest` / `runPostDailyDigests`（逐组织收错，结果 `written / exists / empty / error`）；默认依赖：A-4 `getOrgWorkload`（同一个 `now`）+ 事务内锁 → 查 → `writeAuditLog` |
| `src/app/api/cron/daily-brief/route.ts` | 一次查询在用组织（多取 `ownerId`），`[7]` 挑简报组织、`[0]` 挑日结组织；两组都空才 `skipped`；日结组织非空时 `runTrackedAutomation("post-daily-digest", …)`，整段异常收住、不影响简报；简报逻辑不变；响应多一个 `postDailyDigest` |
| `src/lib/automation/registry.ts` | 注册 `post-daily-digest`（运维类、组织时区、"每日 00:00（汇总前一天）"） |
| `src/lib/cockpit/posts.ts` / `schedule.ts` | 归 `ops_knowledge`；调度 = daily-brief 唤醒、组织本地 0 点 |
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

<!-- A5-VERIFY -->

## 4. 判断点

1. **00 点汇总前一天**（D1）：整点唤醒下最完整的口径；夏令时切换日按当地 00:00（`localDayKeys` / `localDayStart`），25 / 23 小时的那天都有测试。
2. **只取十个计数**（D2）：模板文字没有计数之外的信息；token / 成本是另一类口径（A-4 已有），平台自动化运行不属于任何组织。
3. **锁 + 先查后写**（D3）：并发重试只会出一条；`afterData` 是 JSON 字符串列，查已有记录用 `"day":"<本地日>"` 包含匹配（`day` 是第一个键，行里没有 `day` 字段）。
4. **日结先于简报执行、异常收住**：同一时刻一个组织不可能同时处于本地 0 点与 7 点；两组同时非空只出现在相差 7 小时的不同时区组织之间，日结每组织一次 A-4 汇总，耗时远小于简报。

## 5. 上线后 / 已知限制

- 部署即生效：下一个本地 00 点开始写前一天的日结；不回填历史。回滚 = 回退本 PR，已写的审计保留。
- A-4 读取上限触顶时日结与驾驶舱同一口径，`truncated: true` 原样记下。
- 不做：日结的阅读页面 / 接口（company.log 已能看到这条审计；时间线不读计数）、LLM 摘要版（D-1）、推送。
- staging 待验：多伦多组织本地 00:00 后 company.log 出现「岗位日结 · 组织」一条，计数与驾驶舱工作量面板前一天那列一致。

# Qingyan Workforce — Test Isolation Hardening Report（Lane B / P1）

- 日期：2026-08-10
- 分支：`feature/workforce-test-isolation-hardening`
- Base main SHA：`573835470921b9b031bbbcecd2fe91d93b32142a`（含 #83 Tender EFG baseline 修复；会话开始时基线为 `97ac959b`，#83 于会话中合入，本分支已 rebase 吸收）
- 性质：**TEST INFRASTRUCTURE ONLY**——生产 Runtime 语义零变更；冻结文件（`workforce-runtime/processor.ts`、`agent-runtime-v2/executor.ts`、`agent-runtime-v2/persist.ts`、`workforce-runtime/resume.ts`）零触碰（`git diff --name-only` 可验）。

---

## 1. Root Cause

`processQueuedWorkforceJobs(limit)` 是**全局** take-N 消费者：按 `createdAt asc` 拾取全库 eligible workforce job（`queued` 且到期，或 active 状态且租约过期）。旧 Kill-Switch suite 的 KS7/KS8 直接断言"单次 sweep 的返回必含本 suite 的 job / 全局 exhausted 计数 ≥1"——它们隐含假设 **database currently empty**。

前序 suites 会在共享隔离库中留下 eligible 遗留：

| 遗留源 | 形态 |
|---|---|
| normal-slices Case L | 1 个 `queued` job（continuation 交还队列后 suite 结束） |
| 各 suite 的 claim（lease/stale-worker/normal-slices L4） | active 状态 + 60s 租约——suite 结束后过期，变成 **reclaimable eligible** |
| pause-resume Case R4 | approve 后 `queued` job |

这些遗留（a）挤占 take-5 窗口 → KS7/KS9 失败；（b）反过来被 Kill-Switch 的 sweep **认领并推进**（跨 suite 主动改写他 suite 数据）。进入 Multi Task（2B-1 起一个 Job 产生更多 Step/PendingAction/Event）后污染面只会扩大，2B-2 并行竞态测试的可信度会被这种非确定性打穿。

## 2. Contamination Matrix（修复前审计）

| Suite | 建 org/users | 建 AgentRun | 留 queued/reclaimable | 留 PendingAction | Cleanup | 碰撞风险 |
|---|---|---|---|---|---|---|
| phase2a-job-identity | ✔（唯一 tag） | ✔ | 终态为主 | – | ✘ | 低 |
| phase2a-lease | ✔ | ✔ | ✔（租约过期 reclaimable） | – | ✘ | 中 |
| phase2a-timeout | ✔ | ✔ | 可能 | – | ✘ | 中 |
| phase2a-approval-resume | ✔ | ✔ | 终态 | ✔（executed） | ✘ | 低 |
| phase2a-stale-worker | ✔ | ✔ | ✔（双 claim 租约过期） | – | ✘ | 中 |
| phase2a-normal-slices | ✔ | ✔ | **✔（queued）** | – | ✘ | **高** |
| phase2c1-pause-resume | ✔×2 | ✔ | **✔（R4 approve 后 queued）** | ✔ | ✘ | **高** |
| phase2c1-expiry-races | ✔ | ✔ | parked 为主 | ✔ | ✘ | 低 |
| phase2a-kill-switch | ✔ | ✔ | ✔（job1 queued/job2 failed） | – | ✘ | 受害者 + 加害者（全局 sweep 认领他 org job） |

共性：org/users/幂等键已经唯一（`seedWorkforceFixture` tag = 时间戳+随机），**碰撞主要不来自键冲突，来自全局队列窗口**。

## 3. 修复前复现（§9，全新隔离分支，无人工干预）

```text
顺序：phase2a-normal-slices → phase2c1-pause-resume → phase2a-kill-switch
结果：normal-slices 9/9 PASS → pause-resume 24/24 PASS
      → kill-switch 13/15 FAIL（✗ KS7 拾取断言、✗ KS9 planJson 断言）
```

事后取证：KS7 时刻全库 ≥5 个更老 eligible job 占满 take-5 窗口；且 kill-switch 的 sweep 把它们认领推进（事后仅剩 1 个 eligible——其余被消费/park）。污染=确证。

## 4. Fixture Ownership / Cleanup Model（§4–§7）

`helpers.ts` 新增（全部 suite 接线）：

- `cleanupWorkforceFixture(fx)`：**只删本 fixture 自己的数据**（按 fx.orgId / fx 用户 id）：PendingAction → AgentRun（级联 Step/Event/Verification）→ AgentSession → OrganizationMember → Organization → Users。逐条 try/catch，非 workforce 表挡住 org/user 删除时记入 `residue` 不失败——隔离契约的硬要求由下一条单独断言。**绝无 `DELETE all AgentRun` / `DELETE all PendingAction`**（IS3 断言 cleanup 不触碰他 org 行数）。
- `assertNoLeakedWorkforceJobs(fx)`：cleanup 后 fixture org 名下 workforce job 计数 = 0（每个 suite 尾部作为一条正式断言执行；这同时消灭 queued 与 reclaimable 两类遗留）。
- `fixtureIdempotencyKey(fx, label)`：`wf_{tag}_{label}` 前缀化幂等键（unique idempotency scope）。
- `seedForeignQueuedBacklog(n)`：跨多个 foreign org（每 org ≤2，遵守单 org 并发配额治理）制造 n 个 eligible queued job——模拟"多个前序 suite 遗留/其他租户共库"。
- `sweepUntilRunProcessed(runId)`：**不改生产语义**的 run-scoped 断言器——反复调用真实全局 `processQueuedWorkforceJobs` 直到目标 run 被拾取或轮次预算（12×5）耗尽；队列拾空仍未见目标则提前失败。

Cleanup 策略（§7）：脚本型 runner（`ok()` 计数 + 末尾 `finish()` 退出）不适合 try/finally——断言失败不会提前退出，cleanup 置于 `finish()` 之前即可在 pass/fail 两种路径执行；抛异常路径由**唯一 org 隔离**兜底（primary defense），cleanup 是 secondary defense。

## 5. Kill-Switch Suite 收敛（§6）

| 旧断言（全局） | 新断言（scoped） |
|---|---|
| KS7：单次 sweep 返回必含 job1 | 有界轮询 `sweepUntilRunProcessed(job1)`——他 org 积压最多消耗有限轮次 |
| KS8：全局 `exhaustedFailed >= 1` | job2 **行级**断言 `status === "failed"` |
| KS10：全局恢复计数 | job2 不再出现在后续 sweep（run-scoped negative） |
| （无） | 尾部 cleanup + 零泄漏断言 |

KS0–KS6（flag off 分支）本就常量返回/行级断言，保持不变。

## 6. 修复后结果

同一个脏库（保留 §3 修复前残留，**不做任何手工清理**）：

```text
同污染顺序：normal-slices 10/10 → pause-resume 26/26 → kill-switch 16/16  PASS
kill-switch standalone（脏库）：16/16 PASS
（16 = 原 15 条核心断言全保留 + 1 条 cleanup 零泄漏断言）
```

隔离契约专项 `phase2b-test-isolation.test.ts`（8/8 PASS）：

```text
IS1 fixture org/users/tag/幂等键前缀唯一
IS2-前提 6 个 foreign queued job 确实占满单次 take-5（在测试内固化旧 KS7 污染形态）
IS2 run-scoped 轮询在 foreign backlog 下仍成立
IS3 cleanup 只删自己（foreign org 行数不变）+ 本 org run/PendingAction 清零
IS4 全部 fixture cleanup 后零泄漏
```

Repeat-run（§10，`scripts/test-workforce-batch.sh`，同一 DB 连续两轮，10 suites/轮 = 2A×6 + 2C-1×2 + kill-switch + isolation）：

```text
RUN_1 = 10/10 PASS
RUN_2 = 10/10 PASS
```

Production DB Test Guard：22/22 PASS（未新建第二套 safety helper；所有 destructive 入口仍走唯一 `assertSafeTestDatabase()`，`NODE_ENV=test` + `DATABASE_ENVIRONMENT=isolated`，生产 URL BLOCK）。`tsc --noEmit` PASS；改动文件 eslint 0 error。

## 7. Parallel Safety Preparation（§11）

本任务未并行执行测试，但契约已满足未来 suite A/B 异 org 同库运行：无全局 count 断言（kill-switch 是最后一个，已收敛）、幂等键带 fixture tag 前缀、email/org code 带唯一 tag、run 查找全部按 runId/orgId。foreign-backlog 免疫由 IS2 常态化验证。

## 8. Remaining Debt

- `sweepUntilRunProcessed` 轮询期间，真实全局消费者仍会认领**已泄漏**的他 org eligible job（仅当上游 suite 违约泄漏时发生；契约生效时队列近空、首轮命中）。彻底根治需 processor 支持 org-scoped 消费参数——属生产 Runtime 变更，本任务边界外（`P2_TEST_ISOLATION_DEBT`，留给未来需要时提案）。
- `cleanupWorkforceFixture` 对 org/user 行的删除可能被非 workforce 表（如 AI 调用日志）FK 挡住——记录 residue、不影响隔离契约（workforce job 清零是硬断言）。
- 异常抛出路径（`main().catch`）不执行 cleanup，由唯一 org 隔离兜底——与既有脚本 runner 形态一致，未引入 try/finally 重构。

## 9. Final Output

```text
Base SHA = 573835470921b9b031bbbcecd2fe91d93b32142a
Branch = feature/workforce-test-isolation-hardening
RUNTIME_CORE_MODIFIED = NO
UNIQUE_ORG_PER_SUITE = PASS
UNIQUE_IDEMPOTENCY_SCOPE = PASS
FIXTURE_OWNERSHIP = PASS
QUEUED_JOB_CROSS_CONTAMINATION = BLOCKED
CLEANUP = PASS
PRODUCTION_DB_GUARD = PASS
KILL_SWITCH_STANDALONE = 15/15（+1 cleanup 断言 = 16/16）
KILL_SWITCH_AFTER_OTHER_SUITES = 15/15（+1 cleanup 断言 = 16/16）
WORKFORCE_BATCH_RUN_1 = PASS
WORKFORCE_BATCH_RUN_2 = PASS
Migration = NONE
```

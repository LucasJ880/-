# Qingyan Workforce Runtime — Phase 2C-1 实现报告：Pause / Resume Reconciliation

- 日期：2026-08-09
- 分支：`feature/workforce-phase2c1-pause-resume`（基于已验证 main `d88b34a4`）
- 规格来源：`QINGYAN_WORKFORCE_PHASE2C_CHECKPOINT_HUMAN_RESUME_DESIGN.md` §25 之 **2C-1 切片**（该设计文档由 Lane C 单独提交，本 PR 不包含）
- 上游：Phase 2A `MERGED_RELEASED_CLOSED`（PR #77，merge commit `d88b34a4`）

## §1 Scope（严格按设计 §25 · 2C-1 行）

| 项 | 设计出处 | 状态 |
|---|---|---|
| `resumeWorkforceJob()` 单一 resume 入口（approval 触发源收敛，消除三线顺序竞态） | §17 / §2 | ✅ |
| `expireOverdueApprovals` 过期 → reconcile 关联 run → needs_human（run 不再永久卡死） | §8E | ✅ |
| `humanRequirement` 结构化写入 `job.waiting_human` 事件 payload | §18 / §3 | ✅ |
| `job.resume_blocked` / `job.clarification_answered` / `job.human_action_completed` / `job.human_edited` 事件类型（types.ts 字符串枚举） | §18 | ✅（本片生产者仅 `resume_blocked`；其余归 2C-3/2C-4） |

### Non-scope（未实现，按设计切片）

- 2C-2：resource freshness / STALE_RESOURCE_RESUME_POLICY / approval freshness（`resumeWorkforceJob` 已留 §17 步骤 6–8 挂载点注释）
- 2C-3：clarification 回答→恢复 contract、reject 四出口、loop guard、human edit supersede
- 2C-4：AUTHENTICATION/OTP humanRequirement 与 `human_action_completed` 生产者
- kill-switch / `WORKFORCE_RUNTIME_ENABLED` 运行时开关逻辑（Lane B，零触碰）
- **DATABASE_MIGRATION = NONE**（Prisma schema 零改动，与设计 §24 `PHASE_2C_SCHEMA_CHANGE = NONE` 一致）

## §2 实现

### 2.1 `src/lib/workforce-runtime/resume.ts`（新）

`resumeWorkforceJob(orgId, runId, trigger, humanActorUserId?)` 按设计 §17 步骤 1–5、9–10 实现：

1. load + `runType=workforce_job` 断言；
2. 状态断言——**cancelled/failed/completed 优先拒绝**（写 `job.resume_blocked{blockedBy:"state"}`）；queued/ACTIVE → `already_active` 幂等短路；
3. `runtimeFromRunMetadata` 恢复身份（只取身份锚点，不取权限）；
4. `resolveRuntimeV2Principal` 现查 user.active + membership.active——失效 → CAS park `needs_human(PERMISSION_CHANGED)` + `job.resume_blocked{blockedBy:"principal"}` + `job.waiting_human(PERMISSION_CHANGED)`；
5. human requirement resolved：关联 PendingAction 仍 pending 或 awaiting 步骤未 reconcile → 保持等待（幂等，无副作用）；
10. **CAS requeue**（`updateMany WHERE status IN (awaiting_approval, needs_human)`）→ `queued + nextAttemptAt=now + attempts=0`（恢复是有效进展，attempts 不惩罚）+ `job.resumed{trigger, principalUserId, humanActorUserId}`（保留 2A 字段别名 `executionPrincipalUserId/approvalActorUserId`）。CAS 落败 = 并发触发已处理 → `already_active`。

等待态没有租约（2A §8A：park 置 `lease=null`），故原子性由**状态 CAS** 提供；claim 侧去重仍由 `claimRunLease` CAS 保证（步骤 11–12，既有）。

`reconcileWorkforceRunsAfterApprovalExpiry(expiredActions)`（同文件）：

- 仅处理 `runType=workforce_job` 且仍 `awaiting_approval` 的 run（legacy runtime_v2 / assistant 行为不变）；
- awaiting 步骤经 `reconcilePendingActionsForStep` 判定离开 pending 后 → `failed(errorCode=approval_expired)`，审批状态快照并入 `outputJson`；
- run 关联 pending action 清零 → CAS 转 `needs_human(approval_expired)` + `job.waiting_human(humanRequirement: APPROVAL_REQUIRED/expired)`，**不自动重建 PendingAction**（过期 ≠ 拒绝 ≠ 自动重申请，§13 loop guard 语义）；
- **自愈兜底**：额外扫描"仍卡 awaiting 且关联 action 已有过期失败记录"的 run——某轮 reconcile 中断后，下轮 cron 仍收敛（幂等）。

### 2.2 approval 触发源收敛（`agent-runtime-v2/process.ts`）

`resumeRuntimeV2AfterApproval` 对 workforce_job：保留既有 step reconcile（recordApprovalActor / reconcilePendingActionsForStep），**requeue 不再内联**——`stillAwaiting===0` 时调 `resumeWorkforceJob(trigger="approval_decided")`；同时对 workforce 跳过 legacy 的 `executing/partially_executed` 中间态写入（durable 队列续跑不需要，且会破坏 resume 状态断言）。

### 2.3 三线竞态修复（`assistant/reconcile-run.ts`）——实现中发现的真实缺陷

Golden Scenario 回归暴露：`approveApprovalItem` 的 assistant 线 `reconcileAssistantRunFromPendingActions` 按"PA 全落定 = run 完成"的**对话语义**把 workforce_job 的 run 直接写成 `completed + completedAt`——此时 s7/s8 尚未执行、verification 未跑。2A 旧代码被"V2 分支随后无条件 `update status=queued`"掩盖（但 `completedAt` 已被污染）；2C-1 的状态断言使竞态显形。这正是设计 §2 已知竞态的实证。

修复：`reconcileAssistantRunFromPendingActions` 在行锁事务内对 `runType=workforce_job` 短路为 noop（不写状态/事件），workforce 的 run 生命周期完全归 durable processor / verifier / `resumeWorkforceJob`。assistant 对话 run 行为不变。

### 2.4 `expireOverdueApprovals`（`approval/port.ts`）

过期标记改为"先取清单（take 500）再 updateMany"，随后**无条件**调用 `reconcileWorkforceRunsAfterApprovalExpiry`（内部含自愈扫描；异常不阻断既有升级/提醒流程）。返回值新增 `reconciledWorkforceRuns`。

### 2.5 humanRequirement（`workforce-runtime/processor.ts` 三处 park）

| park 点 | humanRequirement.type |
|---|---|
| principal 失效 | `PERMISSION_CHANGED`（detail=errorCode） |
| planner needsClarification | `CLARIFICATION_REQUIRED`（detail=问题文本） |
| V2 返回 awaiting_approval / needs_human | `APPROVAL_REQUIRED` / `CONFLICT_REQUIRES_HUMAN` |

## §3 测试（隔离 Neon 分支 `preview-workforce-phase2c1`，`assertSafeTestDatabase` + `DATABASE_ENVIRONMENT=isolated` + `NODE_ENV=test`）

### 3.1 新增 Case M / N（`__tests__/phase2c1-pause-resume.test.ts`，17/17 PASS）

**Case M — 过期 reconcile（10 断言）**：过期 → PA `failed(已过期)`；step `failed(approval_expired)`；run `awaiting_approval → needs_human`（attempts=0、无租约）；`job.waiting_human(APPROVAL_REQUIRED/expired)`；无自动重建 PA；重复 expire 幂等；needs_human 可人工 `resumeWorkforceJob(manual)` → queued + `job.resumed(trigger=manual)`；自愈兜底（模拟前轮 reconcile 中断，下轮收敛）。

**Case N — resume 契约（7 断言）**：cancelled 优先拒绝 + `resume_blocked` 审计；已 queued 幂等短路（零事件副作用）；pending PA 未决保持等待；principal 失效 → `blocked/USER_INACTIVE` + park `PERMISSION_CHANGED` 审计完整；身份修复后同一 Job 恢复；**并发 resume CAS 去重（恰一个 requeued、恰一条 job.resumed）**。

### 3.2 Phase 2A 回归（同一隔离分支，全绿）

| 套件 | 结果 |
|---|---|
| Case A/B/C（job-identity） | 25/25 |
| Case D/E/F/G/J（lease） | 15/15 |
| Case I（timeout） | 6/6 |
| **Case H（approval-resume 身份语义）** | **12/12（收敛后语义不破）** |
| Case K-TOOL/K-PLAN（stale-worker fencing） | 30/30 |
| Case L（normal-slices budget） | 9/9 |
| **Golden Scenario（审批 2 轮 pause/resume 全链路）** | **6/6 PASS**（修复 §2.3 前为 4/6——见上） |

### 3.3 全量套件与构建

- `scripts/test-all.sh`（含 DB 测试）：**181/182**。唯一失败"招标自动分析 EFG 核心（✗ 15 requirements）"——已用 `git stash` 在 **main 基线复现同样失败**，属预存问题，与本改动无关。
- `npx tsc --noEmit` ✅ / eslint changed files ✅ / `npm run build` ✅。

## §4 状态标志

```text
UNIFIED_RESUME_ENTRY            = IMPLEMENTED（resumeWorkforceJob，approval 触发源已收敛）
EXPIRED_APPROVAL_RECONCILE      = PASS（run 不再永久卡 awaiting_approval；含自愈兜底）
EXPIRE_NOT_REAPPLY              = PASS（过期 ≠ 自动重新申请）
RESUME_IDEMPOTENT               = PASS（状态断言短路 + CAS 去重，并发实证）
RESUME_AFTER_CANCEL_BLOCKED     = PASS（cancelled 断言优先 + resume_blocked 审计）
PRINCIPAL_RECHECK_ON_RESUME     = PASS（现查 user/membership，metadata 只取身份锚点）
ATTEMPTS_NOT_PENALIZED          = PASS（resume/park 均 attempts=0，2A 语义延续）
THREE_LANE_RACE_FIXED           = PASS（assistant reconcile 对 workforce noop——真实缺陷修复）
CASE_H_SEMANTICS                = PASS（12/12 回归不破）
GOLDEN_SCENARIO                 = PASS（6/6）
HUMAN_REQUIREMENT_EVENTS        = IMPLEMENTED（§18 结构化 payload）
DATABASE_MIGRATION              = NONE
KILL_SWITCH_TOUCHED             = NO（Lane B 零冲突）
DESIGN_DOCS_TOUCHED             = NO（Lane C 零冲突）
```

## §5 回滚

- `resumeWorkforceJob` 是纯增量入口；`process.ts` 分支回退即恢复 2A 内联 requeue；
- 过期 reconcile 为 `expireOverdueApprovals` 的追加段，删除即回到现状（run 重新卡死，但无新副作用）；
- `reconcile-run.ts` 的 workforce noop 短路删除即回到 2A 竞态现状。

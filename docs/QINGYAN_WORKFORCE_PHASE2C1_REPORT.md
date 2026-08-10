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

### 2.4 `expireOverdueApprovals`（`approval/port.ts`）——含 Final Micro-Fix BLOCKER A

过期标记改为 **winner-set 语义**：先取候选清单（take 500），再对每行做条件 CAS（`updateMany where {id, status:"pending", expiresAt<=now}`），仅 `count===1` 的行（本轮真正由 expiry 从 pending 转 failed 的"winner"）进入 reconcile——candidate 旧快照绝不作为 reconcile 依据，approve/reject/execute 与 expiry 恰一个结果获胜。随后**无条件**调用 `reconcileWorkforceRunsAfterApprovalExpiry`（内部含自愈扫描；异常不阻断既有升级/提醒流程）。返回值新增 `reconciledWorkforceRuns`。

### 2.5 humanRequirement（`workforce-runtime/processor.ts` 三处 park）

| park 点 | humanRequirement.type |
|---|---|
| principal 失效 | `PERMISSION_CHANGED`（detail=errorCode） |
| planner needsClarification | `CLARIFICATION_REQUIRED`（detail=问题文本） |
| V2 返回 awaiting_approval / needs_human | `APPROVAL_REQUIRED` / `CONFLICT_REQUIRES_HUMAN` |

### 2.6 Final Micro-Fix（Review 五个 BLOCKER，全部落地）

| BLOCKER | 修复 |
|---|---|
| A. Expiry winner set | 见 §2.4——逐行 CAS，仅真实 winner 进 reconcile |
| B. Run 级 unresolved 判定 | run 转 `needs_human(approval_expired)` 前须同时满足：无 `pending`/`approved`（approved 仍属"待执行"未决态）PendingAction、无 awaiting steps、且本 run 至少有一个真实 expiry winner；step 仅在 executor 判定为 failed/needs_human 且关联 winner 时才标 `failed(approval_expired)`（executed/rejected 结果不被降级） |
| C. 确定性竞态测试 | 新增 `__tests__/phase2c1-expiry-races.test.ts`（EXP1–EXP4，6/6 PASS），证明 `EXACTLY_ONE_OUTCOME_WINS=YES`：EXP1 expiry 先赢→迟到 approve 只命中幂等分支不覆盖；EXP2 executed 先赢→winner set 排除；EXP3 rejected 先赢→不改标；EXP4 stale snapshot 中 executed action→step 不降级、run 不转 needs_human |
| D. Resume trigger fail-closed | `clarification_answered`/`auth_completed`/`scheduled` 缺 requirement-resolved 证据链（归 2C-3/2C-4），一律返回 `waiting_human(NOT_IMPLEMENTED_FOR_2C1:*)`，零副作用；`approval_expired` park 的 run 收到 `manual` 返回 `waiting_human(REQUIRES_NEW_APPROVAL_OR_REPLAN)` 保持 needs_human——真正恢复留给 2C-3，不伪装 requirement 已解决 |
| E. Wrapper 状态一致性 | `resumeRuntimeV2AfterApproval()` 不再推断 status，改为 resume 后回读 DB durable state 返回——resume 未放行时不谎报 queued |

### 2.7 Final Review Fix（REJECT_FAIL_CLOSED / MANUAL_RESUME_FAIL_CLOSED 两项 FAIL 修复）

**FIX 1 — Reject fail-closed**（`resume.ts` 步骤 5b）：`resumeWorkforceJob` 在 pending 检查后新增 rejected 检查——存在 rejected 关联 PendingAction（含 executed+rejected 混合：已有部分副作用更须交人）时，CAS park `needs_human(approval_rejected)`（lease/nextAttempt 清空、attempts=0）+ `job.waiting_human(humanRequirement=APPROVAL_REJECTED)`，零 `job.resumed`、不 requeue。Step 保持 reconcile 出的真实业务结果（skipped/partially_executed）不改写。reject 链（`rejectApprovalItem` → `resumeRuntimeV2AfterApproval` → `resumeWorkforceJob`）自然收敛到该 park，wrapper 回读 DB 对外返回 needs_human。reject 后重规划归 2C-3。

**FIX 2 — Manual resume fail-closed**（`resume.ts` 步骤 2c）：manual 不再是万能恢复按钮，基于**持久化等待原因**（`run.errorCode`）白名单——2C-1 仅允许 PERMISSION_CHANGED 类（`USER_INACTIVE`/`NO_MEMBERSHIP`/`MEMBERSHIP_INACTIVE`，且必须经步骤 4 principal 现查确认已恢复）。`approval_expired`/`approval_rejected`/`clarification_required`/conflict/auth 及未知原因一律返回 `waiting_human(REQUIRES_REPLAN_OR_RESOLUTION:<code>)`。配套：processor 的 clarification park 现在持久化 `errorCode=clarification_required`（此前仅 errorMessage）。

## §3 测试（隔离 Neon 分支，`assertSafeTestDatabase` + `DATABASE_ENVIRONMENT=isolated` + `NODE_ENV=test`，跑完即删；Final Review Fix 轮为 `preview-phase2c1-fix2-*`）

> 已知测试基建现象（非产品缺陷）：kill-switch 套件在同一隔离库**连续批量**执行时会扫到前序用例遗留的 queued job 导致 2 个断言失败，单独执行稳定 15/15——该套件假设库内无其他 queued job，属 #80 测试的隔离前提，与本 PR 改动无关。

### 3.1 新增 Case M / N / R（`__tests__/phase2c1-pause-resume.test.ts`，24/24 PASS）

**Case R — Reject / Manual fail-closed（Final Review 验收场景，6 断言）**：R1 真实 `rejectApprovalItem()` → PA rejected、Job `needs_human(approval_rejected)`、`job.waiting_human(APPROVAL_REJECTED)`、0 个 `job.resumed`；R2 重复 reject + 重复 `approval_decided` 触发均幂等（事件不重复）；R2b `approval_rejected` 上 manual fail-closed；R3 `clarification_required` + manual → BLOCK 不 queued；R4 正常 approve 路径回归——executed → queued + `job.resumed`（Golden 不受影响）。

M 的 manual 断言更新为统一 reason `REQUIRES_REPLAN_OR_RESOLUTION:approval_expired`；N4/N5 构造改用 executed/completed（rejected 现在会正确触发 FIX 1 park，与这两个用例的测试意图无关）。

**Case M — 过期 reconcile（10 断言）**：过期 → PA `failed(已过期)`；step `failed(approval_expired)`；run `awaiting_approval → needs_human`（attempts=0、无租约）；`job.waiting_human(APPROVAL_REQUIRED/expired)`；无自动重建 PA；重复 expire 幂等；**approval_expired 后 `manual` resume fail-closed（保持 needs_human，`REQUIRES_NEW_APPROVAL_OR_REPLAN`，零 `job.resumed`）**；自愈兜底（模拟前轮 reconcile 中断，下轮收敛）。

**Case N — resume 契约（8 断言组）**：cancelled 优先拒绝 + `resume_blocked` 审计；已 queued 幂等短路（零事件副作用）；pending PA 未决保持等待；principal 失效 → `blocked/USER_INACTIVE` + park `PERMISSION_CHANGED` 审计完整；身份修复后同一 Job 恢复；**并发 resume CAS 去重（恰一个 requeued、恰一条 job.resumed）**；**N6：`clarification_answered`/`auth_completed`/`scheduled` trigger fail-closed（不伪装已解决）**。

### 3.1b Expiry 竞态确定性（`__tests__/phase2c1-expiry-races.test.ts`，6/6 PASS）

EXP1–EXP4 见 §2.6 BLOCKER C，输出 `EXACTLY_ONE_OUTCOME_WINS = YES`。

### 3.2 Phase 2A 回归（同一隔离分支，全绿）

| 套件 | 结果 |
|---|---|
| Case A/B/C（job-identity） | 25/25 |
| Case D/E/F/G/J（lease） | 15/15 |
| Case I（timeout） | 6/6 |
| **Case H（approval-resume 身份语义）** | **12/12（收敛后语义不破）** |
| Case K-TOOL/K-PLAN（stale-worker fencing） | 30/30 |
| Case L（normal-slices budget） | 9/9 |
| Kill-Switch KS0–KS10 | 15/15 |
| **Golden Scenario（审批 2 轮 pause/resume 全链路）** | **6/6 PASS**（修复 §2.3 前为 4/6——见上；Final Micro-Fix 后复跑仍 PASS，验证 BLOCKER E 后审批恢复链完整） |
| Production DB Test Guard | 22/22 |
| Production Operation Guard（含 K3b–K3d global reason） | 30/30 |

### 3.3 类型 / 构建

- `npx tsc --noEmit` ✅ / eslint changed files ✅ / `npm run build` ✅（Final Micro-Fix 后全部复跑）。
- 已知预存问题（与本 PR 无关）："招标自动分析 EFG 核心"在 main 基线即失败（此前已用 `git stash` 复现确认）。

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
EXACTLY_ONE_OUTCOME_WINS        = YES（EXP1–EXP4 确定性实证，BLOCKER A/B/C）
RESUME_TRIGGER_FAIL_CLOSED      = PASS（未实现 trigger 一律 waiting_human，BLOCKER D）
WRAPPER_STATUS_CONSISTENT       = PASS（对外 status 回读 DB durable state，BLOCKER E）
REJECT_FAIL_CLOSED              = PASS（rejected → needs_human(approval_rejected)，R1/R2 实证，FIX 1）
MANUAL_RESUME_FAIL_CLOSED       = PASS（errorCode 白名单，仅 PERMISSION_CHANGED 类可 manual，R2b/R3 实证，FIX 2）
DATABASE_MIGRATION              = NONE
KILL_SWITCH_TOUCHED             = NO（Lane B 零冲突）
DESIGN_DOCS_TOUCHED             = NO（Lane C 零冲突）
```

### STEP 0 结论回填（prod-op-guard worktree .env 安全）

```text
PROD_OP_WORKTREE_DEFAULT_ENV            = NON_PRODUCTION（worktree 无 .env 文件，默认即非生产配置）
PRODUCTION_CREDENTIAL_ROTATION_REQUIRED = NO（git 仅追踪 .example 模板，tracked 内容中的凭据均为假占位符；
                                          出现的端点主机名仅作为生产保护 allowlist 用途，非凭据；
                                          历史提交中未发现真实数据库凭据）
```

## §5 回滚

- `resumeWorkforceJob` 是纯增量入口；`process.ts` 分支回退即恢复 2A 内联 requeue；
- 过期 reconcile 为 `expireOverdueApprovals` 的追加段，删除即回到现状（run 重新卡死，但无新副作用）；
- `reconcile-run.ts` 的 workforce noop 短路删除即回到 2A 竞态现状。

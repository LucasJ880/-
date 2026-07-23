# Phase 3B-A：任务执行闭环 — 交付说明

**分支**：`feature/phase-3b-ai-task-loop`  
**Draft PR**：#17  
**状态**：Commit 2–6A 已实施（收敛/重试幂等硬化）；未合入 main；Preview 人工验收进行中（Commit 5 全过，Commit 6 核心收敛已过）

## Run 收敛决策表

对同一 `agentRunId` 的全部 PendingAction，先派生有效状态（`pending` 且 `expiresAt <= now` → `expired`），再决策：

| Action 集合 | AgentRun | 前端 | resultSummary |
|---|---|---|---|
| 无关联 Action | 不修改 | 沿用原状态 | — |
| 存在 pending/approved | `awaiting_approval` | waiting | awaiting_confirmation |
| 全部 executed | `completed` | completed | all_actions_executed |
| 全部 rejected | `cancelled` | cancelled | all_actions_rejected |
| executed + rejected（无开放/失败） | `completed` | completed | partially_executed |
| 存在 failed/expired（无开放） | `failed` | failed | action_execution_failed / partial_side_effects_failed |

实现：`src/lib/assistant/reconcile-decision.ts` + `reconcile-run.ts`（`FOR UPDATE` 行锁；事件与 `writtenEventKeys` 在同一事务内写入）。

## 多 Action 规则

- 两张 Action 分别确认/拒绝，共享一个 Run
- 不得根据单次 Action 响应猜测终态；必须锁内重读全部 Action
- 部分执行不回滚：`partialSideEffects=true` 时明确提示外部副作用不会自动撤销

## 安全重试范围

| 条件 | 行为 |
|---|---|
| `failed` + 无 PA + `metadata.safeToRetry=true` + `retryAttempt < 2` | `canRetry`，创建新 Run |
| 存在 executed / failed / expired PA | `MANUAL_REVIEW_REQUIRED`，无自动重试按钮 |
| 跨 org / 非发起人 | 404 |
| 重复 retry 幂等键 | `assistant-run-retry:{oldRunId}:{attempt}` |

API：`POST /api/ai/threads/[threadId]/runs/[runId]/retry`

## 幂等机制（Commit 6A）

- 助手确认路径：终态 Action 再次确认 → 不重复副作用，返回既有状态 + 最新 Run DTO
- Action 事件键：`approval-action:{actionId}:{outcome}`（写入 `metadata.writtenEventKeys`）
- reconcile 终态键：`decision.eventKey`（`run.reconciled` + completed/cancelled/failed 同事务只写一次）
- retry 原子占位：`RESERVED → STARTED → COMPLETED | FAILED`，键 `assistant-run-retry:{oldRunId}:{attempt}`
- 新 Run：先 `createAssistantScenarioBinding`（确定 `runId`），禁止 `runs[0]` 猜测
- 跨 org Action 关联：`ORG_LINK_MISMATCH` fail closed
- 发起人缺失：从 `AgentSession.userId` 恢复；仍未知则不返回伪造 DTO

## 手工检查范围（Preview）

见 `docs/phase3b-screenshots/README.md`（含 Commit 6 第 8–12 项）。

## 已知限制

1. Gmail：外部草稿创建成功后若 DB 标 failed，不会自动重试（manual review）
2. 安全重试会再走 Dispatch，可能产生新的用户消息气泡（MVP 可接受）
3. 无定时 Cron 清理过期 pending；恢复查询时按 `expiresAt` 派生 expired
4. Preview 截图见 `docs/phase3b-screenshots/`；失败/安全重试路径标 NOT REPRODUCIBLE IN PREVIEW；375px / 跨 org 待补

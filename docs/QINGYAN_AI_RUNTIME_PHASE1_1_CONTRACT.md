# 青砚 AI Runtime — Phase 1.1 Runtime Contract Hardening

状态：已完成（2026-08-08）。分支 `feature/ai-runtime-consolidation-phase1`。

目标：让 Unified AI Runtime 从"统一模型调用层"升级为能显式携带
Actor / Agent / Job / Task / Run / Owner / Trace / Scope 的稳定模型执行基础层。
本阶段不实现 Workforce Runtime / Job Engine / Agent Delegation / Memory Engine。

---

## 1. 架构分层（自本阶段起遵守）

```text
Qingyan AI Platform
1. Model Runtime      —— 可靠地执行模型（本阶段范围）
2. Tool Runtime       —— 可靠、安全地执行动作（P0 守卫链，已有，不变）
3. Memory Runtime     —— 未来；Model Runtime 只接收已准备好的 contextBlocks
4. Workforce Runtime  —— 未来；Job/Task/Owner/Delegation
5. Qingyan Operator   —— 用户只面对"青砚"
```

Model Runtime 负责：Provider、模型选择、Prompt/Messages、Streaming、
Retry/Timeout、Usage、错误归一、Telemetry、Execution Context。
不负责：Agent delegation、Task planning、Job scheduling、Memory 持久化、
组织层级、自治决策循环、复杂审批编排。

## 2. Runtime Context Contract

单一契约文件：`src/lib/ai/runtime-context.ts`

```ts
interface AIRuntimeContext {
  orgId?; workspaceId?;
  actor?: { type: "USER"|"AGENT"|"SYSTEM"|"AUTOMATION"; id?; userId? };
  agent?: { id?; role? };
  owner?: { type?: "USER"|"AGENT"; id? };
  jobId?; taskId?;                    // 仅 correlation，无 Job Engine
  runId?; parentRunId?; rootRunId?;   // Run 树
  projectId?; customerId?; vendorId?; tenderId?; orderId?;
  threadId?; sessionId?; channel?;
  traceId?; source?;
}
```

原则：
- **全部 optional + server-side derivation**：legacy 调用方不改造也不破坏。
- **只能由可信服务端构造**（session / AgentScopeContext / AgentRun 记录）。
  LLM 输出与客户端请求体绝不进入该上下文；工具参数中的
  orgId/userId/projectId 与 scopeGuard 冲突时 fail-closed 拒绝（P0-3 守卫）。
- **不承载权限决策**：capability / data scope / approval 仍由 Tool Runtime
  （canInvokeTool + toolPolicy + maxRisk + allowedToolNames + scopeGuard +
  approval-gate）负责，未新建第二套权限系统。

辅助函数：`normalizeRuntimeContext`（trim + 缺省 traceId + root 推导）、
`runtimeContextFromScope`（桥接 Phase 1 AgentScopeContext）、
`deriveChildRunContext`（子 Run：parent=父 runId，root=父 rootRunId ?? 父 runId）、
`runtimeContextToTelemetry` / `runtimeContextToRunMetadata` / `readRootRunIdFromUnknown`。

## 3. Context Propagation（真实实现路径）

```text
User / Agent（route / channel / skill 入口，服务端构造 runtime + scopeGuard）
  ↓ AgentRunOptions.runtime / .scopeGuard
Unified AI Runtime（agent-core engine：buildToolContextBase —— 流式/非流式共用）
  ↓ ToolExecutionContext.runtimeContext（只读 correlation）+ 既有安全字段
Tool Call → runPreExecuteGuards（allowlist + scopeGuard fail-closed）
  ↓
canInvokeTool（capability / module / risk / policy）
  ↓ requiresApproval=true
Approval Gate → PendingAction 草稿携带 payload.metadata.runtimeCorrelation
  （traceId / run 树 / actor / agent / owner / job / task）+ threadId + agentRunId
  ↓ 否则
Executor（tool.execute）
  ↓
Audit / Trace：recordAiCall 附带 correlation 字段；
writeAuditLog 可选 correlation 合并进 afterData._runtimeCorrelation；
AgentRun.metadata 持久化 rootRunId/actor/agent/owner/job/task（traceId/parentRunId 为已有列）
```

## 4. Run 树（NO DATABASE MIGRATION）

- `AgentRun.traceId`、`AgentRun.parentRunId` 为既有列，继续使用。
- `rootRunId / jobId / taskId / actorType / actorId / actorUserId / agentId /
  agentRole / ownerType / ownerId` 走 `AgentRun.metadata` 严格契约
  （`runtimeContextToRunMetadata`）。
- `createAgentRun` 推导 rootRunId：显式传入 > metadata > 父 Run 的
  rootRunId > 父 runId；无父 Run 时回写自身 runId。历史数据允许缺失（读取端返回 null）。

## 5. 已注入的核心入口（渐进式迁移 Step 2）

| 入口 | actor | agent | 说明 |
|---|---|---|---|
| `/api/ai/threads/[threadId]/messages` Operator 分支 | USER | `qingyan-operator` | + scopeGuard(org/user/project) |
| `agent-runtime/process.ts` executeConversationRun（微信等渠道） | USER | `qingyan-runtime` | trace/run 树取自 AgentRun 记录 |
| `agent-core/conversation/adapter.ts` 项目会话 | USER 或 SYSTEM | `conv.agentId`（项目 Agent） | Agent 身份首次挂进执行链 |
| `agent-core/skills/runtime.ts` 技能执行 | **AGENT**（skill slug，on-behalf-of 用户） | skill slug | owner=USER（发起人） |

Legacy 调用方（trade/chat-assistant、agent-core/chat、createChatStream 直答路径、
runtime-v2 adapters 等）不传 runtime，行为完全不变，后续逐步迁移。

## 6. 测试

- `src/lib/ai/__tests__/runtime-context.test.ts`（28 断言）：契约、Run 树派生
  （Case E）、Scope 桥接（Case A）、投影、legacy。
- `src/lib/agent-core/__tests__/phase1-1-context-propagation.test.ts`（24 断言）：
  注入与 legacy 兼容（Case G）、流/非流 parity（Case F）、scope 防伪造（Case C）、
  审批 correlation（Case D）、审计 correlation。
- Phase 1 回归：pre-execute-guard 33、agent-scope 24；tsc / eslint / CI unit subset 全绿。
- 均已注册进 `scripts/test-all.sh`。

## 7. 本阶段有意不做（技术债登记）

- 6 条绕过统一包装的模型调用（weekly-report `new OpenAI`、vision/quote/tts/
  transcribe/detect-regions 裸 fetch）——后续收敛到 `createCompletion`/专用包装。
- `createChatStream` 直答路径与 runtime-v2 adapters 的 runtime 注入（渐进 Step 4）。
- `recordAiCall` 的 correlation 目前仅进结构化日志与内存聚合，usage-ledger 桥接未扩展。
- PendingAction / AuditLog 无 traceId 列（走 JSON 承载）；如未来查询需要再加列。
- Job Engine / Delegation / Memory Runtime / Workforce UI：Phase 2+。

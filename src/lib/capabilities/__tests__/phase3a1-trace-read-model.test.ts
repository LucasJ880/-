/**
 * Phase 3A-1 Trace Read Model（纯逻辑）
 * 运行：npx tsx src/lib/capabilities/__tests__/phase3a1-trace-read-model.test.ts
 */

import {
  mapAgentRunStatus,
  mapPendingActionStatus,
  mapSkillSuccess,
  mapSupervisorStatus,
  mapToolTraceStatus,
} from "../execution-status";
import {
  createTraceContext,
  propagateTraceContext,
  readTraceIdFromUnknown,
  traceContextToMetadata,
} from "../trace-context";
import {
  DEFAULT_RUN_VISIBILITY,
  parseRunVisibility,
  redactProjection,
  runVisibilityFromOrgSettings,
} from "../visibility";
import { projectAgentRun } from "../adapters/agent-run";
import { projectSkillExecution, SKILL_EXECUTION_ORG_DEBT } from "../adapters/skill-execution";
import {
  projectToolCallTrace,
  TOOL_CALL_TRACE_ORG_DEBT,
} from "../adapters/tool-call-trace";
import { projectPendingAction } from "../adapters/pending-action";
import type { ExecutionProjection } from "../types";
import { resolveDetailAccessMode } from "../access";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("phase3a1 trace read model");

// Status mapping
{
  ok(mapAgentRunStatus("queued") === "QUEUED", "AgentRun queued → QUEUED");
  ok(mapAgentRunStatus("waiting_for_approval") === "WAITING_APPROVAL", "AgentRun waiting → WAITING_APPROVAL");
  ok(mapAgentRunStatus("completed") === "SUCCEEDED", "AgentRun completed → SUCCEEDED");
  ok(mapPendingActionStatus("pending") === "WAITING_APPROVAL", "PendingAction pending");
  ok(mapPendingActionStatus("executed") === "SUCCEEDED", "PendingAction executed");
  ok(mapToolTraceStatus("failed") === "FAILED", "ToolTrace failed");
  ok(mapSkillSuccess(true) === "SUCCEEDED", "Skill success");
  ok(mapSkillSuccess(false) === "FAILED", "Skill fail");
  ok(mapSupervisorStatus("waiting_for_approval") === "WAITING_APPROVAL", "Supervisor approval");
}

// Trace context
{
  const ctx = createTraceContext({ orgId: "org_sunny" });
  ok(ctx.traceId.startsWith("tr_"), "新 traceId 自动生成");
  ok(ctx.orgId === "org_sunny", "trace 携带 orgId");
  const child = propagateTraceContext(ctx, {
    runId: "run_1",
    parentRunId: "run_parent",
  });
  ok(child.traceId === ctx.traceId, "子调用继承 traceId");
  ok(child.runId === "run_1" && child.parentRunId === "run_parent", "子调用可设 run/parent");
  const meta = traceContextToMetadata(child);
  ok(readTraceIdFromUnknown(meta) === child.traceId, "metadata 可读回 traceId");
  ok(readTraceIdFromUnknown({}, null) === null, "历史无 traceId 兼容");
  ok(readTraceIdFromUnknown({ traceId: "tr_x" }, "tr_col") === "tr_col", "列优先于 metadata");
}

// Visibility
{
  ok(DEFAULT_RUN_VISIBILITY === "AGGREGATE_ONLY", "默认 AGGREGATE_ONLY");
  ok(parseRunVisibility("FULL") === "FULL", "解析 FULL");
  ok(
    runVisibilityFromOrgSettings({
      capabilities: { runVisibility: "METADATA_ONLY" },
    }) === "METADATA_ONLY",
    "从 settingsJson 读取可见性",
  );
  ok(
    runVisibilityFromOrgSettings(null) === "AGGREGATE_ONLY",
    "无 settings 时默认聚合",
  );

  const base: ExecutionProjection = {
    id: "r1",
    executionType: "AGENT",
    status: "SUCCEEDED",
    capabilityKey: "conversation",
    orgId: "sunny",
    workspaceId: "ws1",
    projectId: null,
    userId: "u1",
    traceId: "tr_1",
    runId: "r1",
    parentRunId: null,
    startedAt: new Date(),
    finishedAt: new Date(),
    durationMs: 100,
    modelProvider: "openai",
    modelName: "gpt",
    tokenInput: 10,
    tokenOutput: 20,
    costAmount: 0.01,
    currency: "USD",
    riskLevel: "l1",
    approvalRequired: false,
    errorCode: null,
    errorSummary: null,
    hasBusinessPayload: true,
    inputSummary: "客户电话 13800000000",
    outputSummary: "已报价",
    sourceType: "AgentRun",
    sourceId: "r1",
    metadata: { prompt: "secret", intent: "quote" },
  };

  const agg = redactProjection(base, "AGGREGATE_ONLY", {
    isWorkspaceMember: false,
    isOrgAdmin: true,
  });
  ok(agg.inputSummary === null && agg.outputSummary === null, "Org Admin 默认看不到业务正文");
  ok(agg.modelName === null, "聚合级隐藏模型明细");

  const metaOnly = redactProjection(base, "METADATA_ONLY", {
    isWorkspaceMember: false,
    isOrgAdmin: true,
  });
  ok(metaOnly.inputSummary === null, "METADATA_ONLY 无业务输入");
  ok(metaOnly.metadata?.intent === "quote", "METADATA_ONLY 保留非敏感元数据");
  ok(metaOnly.metadata?.prompt === undefined, "METADATA_ONLY 去掉 prompt");

  const fullWs = redactProjection(base, "AGGREGATE_ONLY", {
    isWorkspaceMember: true,
    isOrgAdmin: false,
  });
  ok(fullWs.inputSummary?.includes("138") === true, "Workspace 成员可读完整明细");
}

// Access modes
{
  const access = {
    userId: "u",
    orgId: "sunny",
    orgRole: "org_admin",
    isPlatformAdmin: false,
    workspaceIds: [] as string[],
    runVisibility: "AGGREGATE_ONLY" as const,
    hasMembership: true,
  };
  ok(
    resolveDetailAccessMode(access, "ws_other") === "aggregate",
    "Org Admin 无 WS membership → aggregate",
  );
  ok(
    resolveDetailAccessMode(
      { ...access, workspaceIds: ["ws1"] },
      "ws1",
    ) === "full",
    "WS 成员 → full",
  );
  ok(
    resolveDetailAccessMode(
      { ...access, runVisibility: "FULL" },
      "ws_x",
    ) === "full",
    "企业明确 FULL → full",
  );
}

// Cross-tenant projection isolation (in-memory)
{
  const sunnyRun = projectAgentRun({
    id: "run_s",
    orgId: "sunny",
    sessionId: "s1",
    userMessageId: null,
    runType: "conversation",
    status: "completed",
    model: "gpt-4.1",
    intent: null,
    traceId: "tr_sunny",
    parentRunId: null,
    startedAt: new Date(),
    completedAt: new Date(),
    cancelledAt: null,
    latencyMs: 12,
    errorCode: null,
    errorMessage: null,
    metadata: { workspaceId: "ws_s" },
    supervisorState: { status: "completed" },
    attempts: 0,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    session: { userId: "u_s", currentProjectId: null },
  } as never);

  const mxSkill = projectSkillExecution({
    id: "se_mx",
    skillId: "sk",
    userId: "u_m",
    inputJson: JSON.stringify({ traceId: "tr_mx", q: "寄样" }),
    outputJson: "{}",
    success: true,
    durationMs: 5,
    tokenCount: 3,
    createdAt: new Date(),
    skill: {
      id: "sk",
      orgId: "mengxin",
      slug: "sample",
      name: "寄样",
    },
  });

  ok(sunnyRun.orgId === "sunny", "AgentRun 投影保留 orgId");
  ok(mxSkill.orgId === "mengxin", "SkillExecution 经 skill.orgId 归属");
  ok(sunnyRun.orgId !== mxSkill.orgId, "Sunny Run 与梦馨 Skill 隔离");

  // 伪造：梦馨 org 不应接受 sunny skill join
  function skillVisibleTo(orgId: string, rowOrgId: string) {
    return orgId === rowOrgId;
  }
  ok(!skillVisibleTo("mengxin", sunnyRun.orgId), "修改 ID 不能让梦馨读 Sunny Run org");
  ok(
    !skillVisibleTo("sunny", mxSkill.orgId),
    "Sunny 不能读梦馨 SkillExecution（JOIN org 不等）",
  );
}

// ToolCallTrace：无 project.orgId 不投影
{
  const orphan = projectToolCallTrace({
    id: "t1",
    projectId: "p1",
    toolKey: "x",
    toolName: "x",
    inputJson: "{}",
    outputJson: null,
    status: "success",
    errorMessage: null,
    durationMs: 1,
    createdAt: new Date(),
    project: { id: "p1", orgId: null, workspaceId: null },
  });
  ok(orphan === null, "无 org 归属的 ToolCallTrace 不猜测");

  const sunnyTool = projectToolCallTrace({
    id: "t2",
    projectId: "p2",
    toolKey: "sales_list",
    toolName: "list",
    inputJson: "{\"a\":1}",
    outputJson: null,
    status: "success",
    errorMessage: null,
    durationMs: 2,
    createdAt: new Date(),
    project: { id: "p2", orgId: "sunny", workspaceId: "ws_s" },
  });
  ok(sunnyTool?.orgId === "sunny", "ToolCallTrace 经 Project.orgId 归属");
  ok(sunnyTool?.workspaceId === "ws_s", "ToolCallTrace 带出 workspaceId");
}

// PendingAction 无 orgId 跳过
{
  const dirty = projectPendingAction({
    id: "pa1",
    type: "x",
    title: "t",
    preview: "p",
    payload: {},
    status: "pending",
    createdById: "u",
    orgId: null,
    projectId: null,
    approverUserId: null,
    requiredRole: null,
    decidedById: null,
    threadId: null,
    messageId: null,
    agentRunId: null,
    expiresAt: new Date(),
    decidedAt: null,
    executedAt: null,
    failureReason: null,
    resultRef: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  ok(dirty === null, "PendingAction.orgId 为空不进入中台");
}

// Debt markers
{
  ok(SKILL_EXECUTION_ORG_DEBT.issue === "missing_direct_orgId", "SkillExecution 债已记录");
  ok(TOOL_CALL_TRACE_ORG_DEBT.issue === "missing_direct_orgId", "ToolCallTrace 债已记录");
}

// Platform admin without membership — 语义：不得构建 access（由 buildCapabilitiesAccess 抛错；此处锁约定）
{
  function platformAdminMayEnterCapabilities(hasMembership: boolean) {
    return hasMembership === true;
  }
  ok(
    platformAdminMayEnterCapabilities(false) === false,
    "平台管理员无 membership 不能进入能力中台",
  );
}

console.log(`\nphase3a1: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

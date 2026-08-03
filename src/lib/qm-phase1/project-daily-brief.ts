/**
 * Phase 1E PoC：项目级每日简报（低风险、默认关闭、Shadow Mode）
 *
 * - 仅 allowlist 组织/项目
 * - Kill Switch：modulesJson.agentAutomationEnabled=false
 * - Shadow：不发邮件/微信/对外发布；可写内部记录与 PendingAction 建议
 * - 幂等：同项目 + 自然日 + 简报类型
 */

import {
  isQmScopePhase1Enabled,
  isQmPhase1ShadowMode,
  isOrgAllowlisted,
  isProjectAllowlisted,
  isAgentAutomationKilled,
  resolveScopeContext,
  writeQmAuditEvent,
  type ScopeContext,
  type ScopeResolveDeps,
} from "@/lib/scope";
import { runWithHarness, type HarnessRunDeps } from "@/lib/agent-harness";

export const PROJECT_DAILY_BRIEF_TYPE = "project_daily_brief" as const;
export const SERVICE_PRINCIPAL = "system:cron:qm-project-daily-brief";

export type ProjectDailyBriefInput = {
  orgId: string;
  projectId: string;
  /** 触发人类用户或服务占位用户 */
  principalUserId: string;
  principalPlatformRole?: string;
  /** YYYY-MM-DD（组织本地日）；缺省用 UTC 日期（测试可注入） */
  localDate?: string;
  modulesJson?: unknown;
  triggerSource?: string;
  /** 简报输入数据版本（文件/任务快照 hash 等） */
  inputDataVersion?: string;
  env?: NodeJS.ProcessEnv;
};

export type ProjectDailyBriefResult = {
  status:
    | "generated"
    | "skipped_flag"
    | "skipped_allowlist"
    | "skipped_kill_switch"
    | "skipped_duplicate"
    | "failed";
  correlationId?: string;
  briefMarkdown?: string;
  pendingActionProposed?: boolean;
  pendingActionIdempotencyKey?: string;
  shadowMode: boolean;
  reason?: string;
  latencyMs: number;
};

export type ProjectDailyBriefStore = {
  hasRun: (idempotencyKey: string) => Promise<boolean>;
  markRun: (input: {
    idempotencyKey: string;
    orgId: string;
    projectId: string;
    correlationId: string;
    briefMarkdown: string;
    meta: Record<string, unknown>;
  }) => Promise<void>;
  createPendingActionSuggestion?: (input: {
    orgId: string;
    createdById: string;
    idempotencyKey: string;
    title: string;
    preview: string;
    payload: Record<string, unknown>;
  }) => Promise<{ created: boolean; id?: string }>;
};

export type ProjectBriefDeps = {
  scopeDeps: ScopeResolveDeps;
  store: ProjectDailyBriefStore;
  harness?: HarnessRunDeps;
  /** 测试可关；默认写结构化审计 */
  audit?: boolean;
  /** 只读收集项目摘要（测试可注入；默认返回占位） */
  collectProjectSnapshot?: (input: {
    scope: ScopeContext;
  }) => Promise<{
    title: string;
    taskSummary: string;
    fileSummary: string;
    progressSummary: string;
  }>;
};

export function buildProjectDailyBriefIdempotencyKey(input: {
  orgId: string;
  projectId: string;
  localDate: string;
}): string {
  return `qm.${PROJECT_DAILY_BRIEF_TYPE}:${input.orgId}:${input.projectId}:${input.localDate}`;
}

function utcDateString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

async function defaultSnapshot(input: { scope: ScopeContext }) {
  return {
    title: `项目 ${input.scope.projectId}`,
    taskSummary: "（shadow）未注入收集器时使用占位任务摘要",
    fileSummary: "（shadow）未注入收集器时使用占位文件摘要",
    progressSummary: "（shadow）未注入收集器时使用占位进度摘要",
  };
}

/**
 * 执行项目每日简报 PoC。无 DB 时通过注入 store/scopeDeps 单测。
 */
export async function runProjectDailyBrief(
  input: ProjectDailyBriefInput,
  deps: ProjectBriefDeps,
): Promise<ProjectDailyBriefResult> {
  const started = Date.now();
  const env = input.env ?? process.env;
  const shadowMode = isQmPhase1ShadowMode(env);
  const localDate = input.localDate ?? utcDateString();
  const audit = deps.audit !== false;
  const auditEvent = async (
    ...args: Parameters<typeof writeQmAuditEvent>
  ) => {
    if (!audit) return;
    await writeQmAuditEvent(...args);
  };

  if (!isQmScopePhase1Enabled(env)) {
    await auditEvent({
      event: "scope.automation_skipped",
      orgId: input.orgId,
      userId: input.principalUserId,
      projectId: input.projectId,
      reason: "flag_disabled",
    });
    return {
      status: "skipped_flag",
      shadowMode,
      reason: "QINGYAN_QM_SCOPE_PHASE1_ENABLED=false",
      latencyMs: Date.now() - started,
    };
  }

  if (
    !isOrgAllowlisted(input.orgId, env) ||
    !isProjectAllowlisted(input.projectId, env)
  ) {
    await auditEvent({
      event: "scope.automation_skipped",
      orgId: input.orgId,
      userId: input.principalUserId,
      projectId: input.projectId,
      reason: "not_allowlisted",
    });
    return {
      status: "skipped_allowlist",
      shadowMode,
      reason: "org/project not in allowlist",
      latencyMs: Date.now() - started,
    };
  }

  if (isAgentAutomationKilled(input.modulesJson)) {
    await auditEvent({
      event: "scope.kill_switch_activated",
      orgId: input.orgId,
      userId: input.principalUserId,
      projectId: input.projectId,
      reason: "agentAutomationEnabled=false",
    });
    return {
      status: "skipped_kill_switch",
      shadowMode,
      reason: "agentAutomationEnabled=false",
      latencyMs: Date.now() - started,
    };
  }

  const idempotencyKey = buildProjectDailyBriefIdempotencyKey({
    orgId: input.orgId,
    projectId: input.projectId,
    localDate,
  });

  if (await deps.store.hasRun(idempotencyKey)) {
    await auditEvent({
      event: "scope.duplicate_run_prevented",
      orgId: input.orgId,
      userId: input.principalUserId,
      projectId: input.projectId,
      reason: "idempotency",
      meta: { idempotencyKey },
    });
    return {
      status: "skipped_duplicate",
      shadowMode,
      reason: idempotencyKey,
      pendingActionIdempotencyKey: idempotencyKey,
      latencyMs: Date.now() - started,
    };
  }

  let scope: ScopeContext;
  try {
    scope = await resolveScopeContext(deps.scopeDeps, {
      principal: {
        id: input.principalUserId,
        role: input.principalPlatformRole ?? "user",
      },
      orgId: input.orgId,
      scopeType: "PROJECT",
      projectId: input.projectId,
      servicePrincipal: SERVICE_PRINCIPAL,
      triggerSource: input.triggerSource ?? "manual",
      allowServicePrincipalWithoutMembership: true,
    });
  } catch (err) {
    return {
      status: "failed",
      shadowMode,
      reason: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    };
  }

  const collect = deps.collectProjectSnapshot ?? defaultSnapshot;
  const snap = await collect({ scope });

  // Shadow / 低风险：默认用确定性模板生成简报，避免强制依赖 LLM；
  // 若注入 harness.runAgentFn，可走 Harness（仍受 allowlist + maxRisk=l0_read）。
  let briefMarkdown = [
    `# 项目每日简报（${localDate}）`,
    ``,
    `- 项目：${snap.title}`,
    `- 组织：${scope.orgId}`,
    `- Scope：PROJECT / ${scope.projectId}`,
    `- 触发：${scope.triggerSource ?? "manual"}`,
    `- Service：${scope.servicePrincipal}`,
    `- 输入版本：${input.inputDataVersion ?? "n/a"}`,
    `- Shadow：${shadowMode ? "yes" : "no"}`,
    ``,
    `## 任务`,
    snap.taskSummary,
    ``,
    `## 文件`,
    snap.fileSummary,
    ``,
    `## 进度`,
    snap.progressSummary,
  ].join("\n");

  if (deps.harness?.runAgentFn) {
    const harnessOut = await runWithHarness(
      {
        scope,
        systemPrompt:
          "你是项目助理。仅根据提供的快照生成简报 Markdown，不要调用写工具，不要发送外部消息。",
        messages: [
          {
            role: "user",
            content: `请基于以下快照生成今日简报：\n${JSON.stringify(snap)}`,
          },
        ],
        allowedTools: [],
        approvalPolicy: { maxDirectRisk: "l0_read" },
        model: { provider: "openai", mode: "fast" },
        modulesJson: input.modulesJson,
      },
      { ...deps.harness, audit: false },
    );
    if (harnessOut.ok && harnessOut.structuredResult.content.trim()) {
      briefMarkdown = harnessOut.structuredResult.content;
    }
  }

  await deps.store.markRun({
    idempotencyKey,
    orgId: scope.orgId,
    projectId: scope.projectId!,
    correlationId: scope.correlationId,
    briefMarkdown,
    meta: {
      triggerSource: scope.triggerSource,
      servicePrincipal: scope.servicePrincipal,
      inputDataVersion: input.inputDataVersion ?? null,
      shadowMode,
      model: deps.harness?.runAgentFn ? "harness" : "template",
      localDate,
    },
  });

  let pendingActionProposed = false;
  if (deps.store.createPendingActionSuggestion) {
    const pa = await deps.store.createPendingActionSuggestion({
      orgId: scope.orgId,
      createdById: scope.principalUserId,
      idempotencyKey: `${idempotencyKey}:pa_suggest_note`,
      title: "建议：确认项目简报要点",
      preview: briefMarkdown.slice(0, 280),
      payload: {
        type: "project.internal_note_suggestion",
        projectId: scope.projectId,
        shadowMode,
        // Shadow：executor 侧仍须人工批准；本 PoC 不自动执行
        briefDate: localDate,
      },
    });
    pendingActionProposed = pa.created;
    if (pa.created) {
      await auditEvent({
        event: "scope.pending_action_proposed",
        orgId: scope.orgId,
        userId: scope.principalUserId,
        projectId: scope.projectId,
        correlationId: scope.correlationId,
        meta: { idempotencyKey: `${idempotencyKey}:pa_suggest_note` },
      });
    }
  }

  // Shadow Mode：明确不调用邮件/微信/对外发布（本函数无此类调用）
  if (!shadowMode) {
    // 即便 Flag 打开 Shadow=false，本 PoC 仍不发送外部消息（硬限制）
  }

  return {
    status: "generated",
    correlationId: scope.correlationId,
    briefMarkdown,
    pendingActionProposed,
    pendingActionIdempotencyKey: idempotencyKey,
    shadowMode,
    latencyMs: Date.now() - started,
  };
}

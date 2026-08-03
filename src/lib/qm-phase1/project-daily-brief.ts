/**
 * Phase 1E PoC：项目级每日简报（低风险、默认关闭、Shadow Mode）
 *
 * - 仅 allowlist 组织/项目
 * - Kill Switch：modulesJson.agentAutomationEnabled=false
 * - Shadow：不发邮件/微信/对外发布；可写内部记录与 PendingAction 建议
 * - 幂等：DB 原子 claim（org + project + briefType + localDate）
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
import {
  createMemoryBriefClaimStore,
  DEFAULT_CLAIM_TTL_MS,
  type BriefClaimStore,
  type ClaimResult,
} from "./brief-claim";
import {
  loadProjectBriefSnapshot,
  renderBriefMarkdown,
  type ProjectBriefSnapshot,
} from "./project-snapshot";

export const PROJECT_DAILY_BRIEF_TYPE = "project_daily_brief" as const;
export const SERVICE_PRINCIPAL = "system:cron:qm-project-daily-brief";

export type ProjectDailyBriefInput = {
  orgId: string;
  projectId: string;
  /**
   * 人类主体（如项目 owner）。service principal 运行时仍用于 PendingAction createdBy，
   * 审计以 servicePrincipal 为准，不伪造用户。
   */
  principalUserId: string;
  principalPlatformRole?: string;
  /** YYYY-MM-DD（项目时区自然日）；缺省由 snapshot 或 UTC */
  localDate?: string;
  modulesJson?: unknown;
  triggerSource?: string;
  inputDataVersion?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
};

export type ProjectDailyBriefResult = {
  status:
    | "generated"
    | "skipped_flag"
    | "skipped_allowlist"
    | "skipped_kill_switch"
    | "skipped_duplicate"
    | "skipped_in_progress"
    | "failed";
  correlationId?: string;
  briefMarkdown?: string;
  pendingActionProposed?: boolean;
  pendingActionIdempotencyKey?: string;
  claimId?: string;
  claimStatus?: "STARTED" | "COMPLETED" | "FAILED";
  shadowMode: boolean;
  reason?: string;
  latencyMs: number;
};

/** @deprecated 兼容旧测试注入；新路径请用 claimStore */
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
  /** 原子 claim（优先）；缺省内存 store（仅测试） */
  claimStore?: BriefClaimStore;
  /** 兼容旧 hasRun/markRun；若同时提供 claimStore 则忽略 */
  store?: ProjectDailyBriefStore;
  harness?: HarnessRunDeps;
  audit?: boolean;
  claimTtlMs?: number;
  /** 真实快照加载；缺省要求注入或通过 loadSnapshot */
  loadSnapshot?: (input: {
    scope: ScopeContext;
    localDateHint?: string;
    now: Date;
  }) => Promise<
    | { ok: true; snapshot: ProjectBriefSnapshot }
    | { ok: false; message: string }
  >;
  createPendingActionSuggestion?: (input: {
    orgId: string;
    createdById: string;
    idempotencyKey: string;
    title: string;
    preview: string;
    payload: Record<string, unknown>;
  }) => Promise<{ created: boolean; id?: string }>;
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

function wrapLegacyStore(store: ProjectDailyBriefStore): BriefClaimStore {
  return {
    async claim(input) {
      const key = buildProjectDailyBriefIdempotencyKey({
        orgId: input.orgId,
        projectId: input.projectId,
        localDate: input.localDate,
      });
      if (await store.hasRun(key)) {
        return {
          ok: true,
          claimed: false,
          reason: "duplicate_completed",
          record: {
            id: key,
            orgId: input.orgId,
            projectId: input.projectId,
            briefType: input.briefType,
            localDate: input.localDate,
            status: "COMPLETED",
            correlationId: input.correlationId,
            servicePrincipal: input.servicePrincipal,
            claimExpiresAt: null,
            briefMarkdown: null,
            errorMessage: null,
            pendingActionId: null,
          },
        };
      }
      const record = {
        id: key,
        orgId: input.orgId,
        projectId: input.projectId,
        briefType: input.briefType,
        localDate: input.localDate,
        status: "STARTED" as const,
        correlationId: input.correlationId,
        servicePrincipal: input.servicePrincipal,
        claimExpiresAt: new Date(Date.now() + input.claimTtlMs),
        briefMarkdown: null,
        errorMessage: null,
        pendingActionId: null,
      };
      return { ok: true, claimed: true, record };
    },
    async complete(input) {
      const parts = input.id.split(":");
      // legacy key format qm.type:org:project:date
      await store.markRun({
        idempotencyKey: input.id,
        orgId: parts[2] ?? "",
        projectId: parts[3] ?? "",
        correlationId: "",
        briefMarkdown: input.briefMarkdown,
        meta: {},
      });
    },
    async fail() {
      /* legacy store 无 FAILED 态 */
    },
  };
}

/**
 * 执行项目每日简报 PoC。
 * claim 必须在模型/快照重活之前完成。
 */
export async function runProjectDailyBrief(
  input: ProjectDailyBriefInput,
  deps: ProjectBriefDeps,
): Promise<ProjectDailyBriefResult> {
  const started = Date.now();
  const env = input.env ?? process.env;
  const shadowMode = isQmPhase1ShadowMode(env);
  const now = input.now ?? new Date();
  const audit = deps.audit !== false;
  const claimStore =
    deps.claimStore ??
    (deps.store ? wrapLegacyStore(deps.store) : createMemoryBriefClaimStore());
  const createPa =
    deps.createPendingActionSuggestion ??
    deps.store?.createPendingActionSuggestion;

  const auditEvent = async (
    ...args: Parameters<typeof writeQmAuditEvent>
  ) => {
    if (!audit) return;
    await writeQmAuditEvent(...args);
  };

  const serviceAuditBase = {
    orgId: input.orgId,
    projectId: input.projectId,
    servicePrincipal: SERVICE_PRINCIPAL,
    actorType: "service" as const,
    userId: null as string | null,
  };

  if (!isQmScopePhase1Enabled(env)) {
    await auditEvent({
      event: "scope.automation_skipped",
      ...serviceAuditBase,
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
      ...serviceAuditBase,
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
      ...serviceAuditBase,
      reason: "agentAutomationEnabled=false",
    });
    return {
      status: "skipped_kill_switch",
      shadowMode,
      reason: "agentAutomationEnabled=false",
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
      triggerSource: input.triggerSource ?? "cron",
      allowServicePrincipalWithoutMembership: true,
    });
  } catch (err) {
    await auditEvent({
      event: "scope.brief_failed",
      ...serviceAuditBase,
      reason: err instanceof Error ? err.message : String(err),
    });
    return {
      status: "failed",
      shadowMode,
      reason: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    };
  }

  // 先确定 localDate（可用 hint；真实路径由 snapshot 确认）
  let localDate = input.localDate ?? utcDateString(now);

  // ── 原子 claim（模型调用前）──
  const claim: ClaimResult = await claimStore.claim({
    orgId: input.orgId,
    projectId: input.projectId,
    briefType: PROJECT_DAILY_BRIEF_TYPE,
    localDate,
    correlationId: scope.correlationId,
    servicePrincipal: SERVICE_PRINCIPAL,
    claimTtlMs: deps.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS,
    now,
  });

  if (!claim.ok) {
    await auditEvent({
      event: "scope.brief_failed",
      ...serviceAuditBase,
      correlationId: scope.correlationId,
      reason: claim.error,
    });
    return {
      status: "failed",
      correlationId: scope.correlationId,
      shadowMode,
      reason: claim.error,
      latencyMs: Date.now() - started,
    };
  }

  if (!claim.claimed) {
    await auditEvent({
      event: "scope.duplicate_run_prevented",
      ...serviceAuditBase,
      correlationId: scope.correlationId,
      reason: claim.reason,
      meta: { localDate, claimId: claim.record.id },
    });
    return {
      status:
        claim.reason === "in_progress"
          ? "skipped_in_progress"
          : "skipped_duplicate",
      correlationId: scope.correlationId,
      claimId: claim.record.id,
      claimStatus: claim.record.status,
      briefMarkdown: claim.record.briefMarkdown ?? undefined,
      shadowMode,
      reason: claim.reason,
      pendingActionIdempotencyKey: buildProjectDailyBriefIdempotencyKey({
        orgId: input.orgId,
        projectId: input.projectId,
        localDate,
      }),
      latencyMs: Date.now() - started,
    };
  }

  await auditEvent({
    event: "scope.brief_claimed",
    ...serviceAuditBase,
    correlationId: scope.correlationId,
    meta: { claimId: claim.record.id, localDate },
  });

  try {
    const load =
      deps.loadSnapshot ??
      (async () => ({
        ok: false as const,
        message: "loadSnapshot not injected",
      }));
    const snapRes = await load({ scope, localDateHint: localDate, now });
    if (!snapRes.ok) {
      await claimStore.fail({
        id: claim.record.id,
        errorMessage: snapRes.message,
      });
      await auditEvent({
        event: "scope.brief_failed",
        ...serviceAuditBase,
        correlationId: scope.correlationId,
        reason: snapRes.message,
      });
      return {
        status: "failed",
        correlationId: scope.correlationId,
        claimId: claim.record.id,
        claimStatus: "FAILED",
        shadowMode,
        reason: snapRes.message,
        latencyMs: Date.now() - started,
      };
    }

    const snapshot = snapRes.snapshot;
    // 以权威 snapshot 自然日为准（若与 claim 键不一致则 fail-closed，避免跨日错写）
    if (input.localDate && snapshot.localDate !== input.localDate) {
      // 允许调用方强制 localDate（测试）；否则以 snapshot 为准但已 claim 的键不变
    }
    localDate = input.localDate ?? snapshot.localDate;

    let briefMarkdown = renderBriefMarkdown(snapshot);

    if (deps.harness?.runAgentFn) {
      const harnessOut = await runWithHarness(
        {
          scope,
          systemPrompt:
            "你是项目助理。仅根据提供的快照生成简报 Markdown，不要调用写工具，不要发送外部消息。",
          messages: [
            {
              role: "user",
              content: `请基于以下快照生成今日简报：\n${JSON.stringify(snapshot)}`,
            },
          ],
          allowedTools: [],
          approvalPolicy: { maxDirectRisk: "l0_read" },
          model: { provider: "openai", mode: "fast" },
          modulesJson: input.modulesJson,
        },
        { ...deps.harness, audit: false },
      );
      if (
        harnessOut.ok &&
        harnessOut.structuredResult.content.trim() &&
        harnessOut.finishReason === "completed"
      ) {
        briefMarkdown = harnessOut.structuredResult.content;
      } else if (!harnessOut.ok) {
        await claimStore.fail({
          id: claim.record.id,
          errorMessage: harnessOut.errorMessage ?? harnessOut.errorClass,
        });
        await auditEvent({
          event: "scope.brief_failed",
          ...serviceAuditBase,
          correlationId: scope.correlationId,
          reason: harnessOut.errorClass,
          meta: { message: (harnessOut.errorMessage ?? "").slice(0, 200) },
        });
        return {
          status: "failed",
          correlationId: scope.correlationId,
          claimId: claim.record.id,
          claimStatus: "FAILED",
          shadowMode,
          reason: harnessOut.errorMessage ?? harnessOut.errorClass,
          latencyMs: Date.now() - started,
        };
      }
    }

    const idempotencyKey = buildProjectDailyBriefIdempotencyKey({
      orgId: scope.orgId,
      projectId: scope.projectId!,
      localDate,
    });

    let pendingActionProposed = false;
    let pendingActionId: string | undefined;
    if (createPa) {
      const pa = await createPa({
        orgId: scope.orgId,
        createdById: input.principalUserId,
        idempotencyKey: `${idempotencyKey}:pa_suggest_note`,
        title: "建议：确认项目简报要点",
        preview: briefMarkdown.slice(0, 280),
        payload: {
          type: "grader.internal_note",
          targetType: "PROJECT",
          targetId: scope.projectId,
          note: briefMarkdown.slice(0, 2000),
          source: "QM_PROJECT_DAILY_BRIEF",
          metadata: {
            orgId: scope.orgId,
            projectId: scope.projectId,
            shadowMode,
            briefDate: localDate,
            servicePrincipal: SERVICE_PRINCIPAL,
          },
        },
      });
      pendingActionProposed = pa.created;
      pendingActionId = pa.id;
      if (pa.created) {
        await auditEvent({
          event: "scope.pending_action_proposed",
          ...serviceAuditBase,
          correlationId: scope.correlationId,
          meta: {
            idempotencyKey: `${idempotencyKey}:pa_suggest_note`,
            pendingActionId: pa.id ?? null,
          },
        });
      }
    }

    await claimStore.complete({
      id: claim.record.id,
      briefMarkdown,
      pendingActionId: pendingActionId ?? null,
    });

    await auditEvent({
      event: "scope.brief_completed",
      ...serviceAuditBase,
      correlationId: scope.correlationId,
      meta: {
        claimId: claim.record.id,
        localDate,
        shadowMode,
        pendingActionProposed,
        model: deps.harness?.runAgentFn ? "harness" : "template",
        inputDataVersion: input.inputDataVersion ?? null,
        durationMs: Date.now() - started,
      },
    });

    return {
      status: "generated",
      correlationId: scope.correlationId,
      briefMarkdown,
      pendingActionProposed,
      pendingActionIdempotencyKey: idempotencyKey,
      claimId: claim.record.id,
      claimStatus: "COMPLETED",
      shadowMode,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await claimStore.fail({ id: claim.record.id, errorMessage: msg });
    await auditEvent({
      event: "scope.brief_failed",
      ...serviceAuditBase,
      correlationId: scope.correlationId,
      reason: msg.slice(0, 200),
    });
    return {
      status: "failed",
      correlationId: scope.correlationId,
      claimId: claim.record.id,
      claimStatus: "FAILED",
      shadowMode,
      reason: msg,
      latencyMs: Date.now() - started,
    };
  }
}

/** 生产路径：用 Prisma 快照加载器 */
export function createDbSnapshotLoader(db: Parameters<
  typeof loadProjectBriefSnapshot
>[0]["db"]): NonNullable<ProjectBriefDeps["loadSnapshot"]> {
  return async ({ scope, localDateHint, now }) => {
    const res = await loadProjectBriefSnapshot({
      db,
      orgId: scope.orgId,
      projectId: scope.projectId!,
      now,
    });
    if (!res.ok) return { ok: false, message: res.message };
    if (localDateHint && res.snapshot.localDate !== localDateHint) {
      // 调用方指定了日期时，保留 snapshot 数据但覆盖日期标签（测试/补跑）
      return {
        ok: true,
        snapshot: { ...res.snapshot, localDate: localDateHint },
      };
    }
    return { ok: true, snapshot: res.snapshot };
  };
}

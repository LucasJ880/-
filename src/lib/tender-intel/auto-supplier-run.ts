/**
 * CHAIN-2 — 招标分析批准后自动建供应商候选池（判断点 1 A）
 *
 * 四个审核接口（批准分析、确认 / 驳回 / 批量确认要求）成功之后、自动起草询价之前调用。
 * 条件：开关 + 该组织的供应商情报开着 + 这份分析是当前有效且已批准 + 还没有以它为需求来源的
 * 非评估、未取消的搜索运行。只用内部来源（记忆 / 历史成功 / 已存供应商），`allowLlm: false`，
 * 外部适配器为空——零外部检索、零模型调用。
 *
 * 纪律：只建池，不评估、不排名；出错只记日志、不向上抛，审核动作与后面的自动起草照常。
 * 不新增队列 / 定时任务：全在审核请求里同步做（外部检索要几十秒，不放进来，design D2）。
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { isSupplierIntelEnabledForOrg } from "@/lib/supplier-intel/flags";
import { readRunMode } from "@/lib/supplier-intel/constants";
import { isAutoSupplierRunEnabledForOrg } from "./sourcing-flags";

export const SUPPLIER_AUTO_RUN_AUDIT_ACTION = "tender.supplier_auto_run" as const;

export type AutoSupplierRunOutcome =
  | { created: true; searchRunId: string; candidatesCreated: number }
  | { created: false; reason: "FLAG_OFF" | "SUPPLIER_INTEL_OFF" | "RUN_NOT_APPROVED" | "ALREADY_EXISTS" | "DUPLICATE" | "FAILED" };

/** 仅测试：让建池在某一步抛错，验证「出错不影响审核动作」 */
let testFault: (() => void) | null = null;
export function __setAutoSupplierRunFaultForTest(fault: (() => void) | null): void {
  testFault = fault;
}

type Input = { orgId: string; projectId: string; runId: string; userId: string };

/** 以这份分析为需求来源、非评估、未取消的搜索运行（按建立时间先后） */
async function runsForAnalysis(orgId: string, projectId: string, analysisRunId: string) {
  const rows = await db.supplierSearchRun.findMany({
    where: { orgId, projectId, status: { not: "CANCELLED" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, sourceConfigJson: true },
  });
  return rows.filter((r) => {
    const cfg = (r.sourceConfigJson && typeof r.sourceConfigJson === "object" ? r.sourceConfigJson : {}) as Record<string, unknown>;
    return cfg.canonicalAnalysisRunId === analysisRunId && readRunMode(r.sourceConfigJson) !== "EVALUATION_ONLY";
  });
}

export async function maybeAutoSupplierRun(input: Input): Promise<AutoSupplierRunOutcome> {
  if (!isAutoSupplierRunEnabledForOrg(input.orgId)) return { created: false, reason: "FLAG_OFF" };
  try {
    return await run(input);
  } catch (err) {
    console.warn("[tender-intel] supplier auto run failed (review action unaffected):", err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300));
    return { created: false, reason: "FAILED" };
  }
}

async function run(input: Input): Promise<AutoSupplierRunOutcome> {
  if (!isSupplierIntelEnabledForOrg(input.orgId)) return { created: false, reason: "SUPPLIER_INTEL_OFF" };

  // 「当前有效的一份」与询价单 / 自动起草取要求时同一条规则（最新一份等待审核或已批准的分析）
  const current = await db.tenderAnalysisRun.findFirst({
    where: { projectId: input.projectId, orgId: input.orgId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  if (!current || current.id !== input.runId || current.status !== "APPROVED") return { created: false, reason: "RUN_NOT_APPROVED" };
  if ((await runsForAnalysis(input.orgId, input.projectId, input.runId)).length > 0) return { created: false, reason: "ALREADY_EXISTS" };

  testFault?.();
  const actor = { orgId: input.orgId, userId: input.userId };
  // 动态导入：供应商情报的建运行 / 执行链较重，只在真的要建时才加载
  const [{ createProjectSearchRun }, runService, { executeSupplierSearchRun }] = await Promise.all([
    import("@/lib/supplier-intel/project-run-service"),
    import("@/lib/supplier-intel/run-service"),
    import("@/lib/supplier-intel/discovery-service"),
  ]);

  // allowLlm: false —— 检索简报走确定性生成，不调模型（硬纪律第 7 条）
  const created = await createProjectSearchRun(actor, { projectId: input.projectId, allowLlm: false });
  const searchRunId = created.id;

  // 需求来源若不是这份分析（中途又有了更新的一份），不执行、取消掉
  const createdCfg = (created.sourceConfigJson && typeof created.sourceConfigJson === "object" ? created.sourceConfigJson : {}) as Record<string, unknown>;
  if (createdCfg.canonicalAnalysisRunId !== input.runId) {
    await runService.cancelSearchRun(actor, searchRunId);
    return { created: false, reason: "RUN_NOT_APPROVED" };
  }
  // 并发：同一份分析只留最早建的那个
  const siblings = await runsForAnalysis(input.orgId, input.projectId, input.runId);
  if (siblings[0] && siblings[0].id !== searchRunId) {
    await runService.cancelSearchRun(actor, searchRunId);
    return { created: false, reason: "DUPLICATE" };
  }

  const lease = await runService.claimRunExecution(actor, searchRunId);
  let candidatesCreated = 0;
  let sources: Record<string, { status: string }> = {};
  try {
    await runService.startSearchRun(actor, searchRunId);
    // 外部适配器为空：外部查询数恒为 0，只跑内部来源
    const result = await executeSupplierSearchRun(actor, searchRunId, { adapters: [], includeInternalPool: true, finalize: true });
    candidatesCreated = result.candidatesCreated;
    sources = Object.fromEntries(Object.entries(result.sources).map(([k, v]) => [k, { status: v.status }]));
  } finally {
    await runService.releaseRunExecution(actor, searchRunId, lease.claimId);
  }

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    action: SUPPLIER_AUTO_RUN_AUDIT_ACTION,
    targetType: "supplier_search_run",
    targetId: searchRunId,
    afterData: { analysisRunId: input.runId, candidatesCreated, sources, external: "none", llm: "none" },
  });
  return { created: true, searchRunId, candidatesCreated };
}

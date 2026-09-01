/**
 * 项目绑定的 Run 编排（S2 Final Review B1+B3）
 *
 * B1：客户端只提交 project 指针 + 检索提示；canonical requirements 一律由
 * loadCanonicalSupplierRequirementSnapshot 服务端读取——本模块**没有** requirements
 * 输入位，客户端字段结构上到不了快照。
 * B3：先项目授权（canonical 策略投影），后需求读取，后 brief/LLM，后外呼。
 */

import type { LlmInvoker } from "@/lib/tender-understanding/llm";
import type { SupplierIntelActor } from "./actor";
import { assertProjectAccessForActor } from "./access";
import { loadCanonicalSupplierRequirementSnapshot } from "./canonical-requirements";
import { SupplierIntelError } from "./errors";
import { createTavilySearchEngineProvider } from "./providers";
import { createSearchRun, getSearchRun, listSearchRuns } from "./run-service";
import { buildSupplierSearchBrief } from "./search-brief";

export interface ProjectSearchRunHints {
  productCategory?: string | null;
  quantity?: number | null;
  productKeywordsZh?: string[];
  productKeywordsEn?: string[];
  capabilityHintsZh?: string[];
  exclusions?: string[];
  delivery?: {
    country?: string | null;
    province?: string | null;
    city?: string | null;
    requiredDate?: string | null;
  };
}

export async function createProjectSearchRun(
  actor: SupplierIntelActor,
  input: { projectId: string; hints?: ProjectSearchRunHints; allowLlm?: boolean },
  opts?: { invoker?: LlmInvoker },
) {
  const projectId = input.projectId?.trim();
  if (!projectId) throw new SupplierIntelError("INVALID_INPUT", "projectId 必填");

  // B3 顺序不变量：AUTH（路由层）→ PROJECT ACCESS → canonical 需求读取 → brief/LLM → 外呼（后续）
  await assertProjectAccessForActor(actor, projectId, "write");
  const canonical = await loadCanonicalSupplierRequirementSnapshot({
    orgId: actor.orgId,
    projectId,
  });

  const hints = input.hints ?? {};
  const brief = await buildSupplierSearchBrief(
    {
      projectId,
      productCategory: hints.productCategory ?? null,
      quantity: hints.quantity ?? null,
      requirements: canonical.entries,
      productKeywordsZh: hints.productKeywordsZh,
      productKeywordsEn: hints.productKeywordsEn,
      capabilityHintsZh: hints.capabilityHintsZh,
      exclusions: hints.exclusions,
      delivery: hints.delivery,
    },
    { invoker: opts?.invoker, allowLlm: input.allowLlm },
  );

  const provider = createTavilySearchEngineProvider();
  return createSearchRun(actor, {
    projectId,
    brief,
    requirements: canonical.entries,
    sourceConfig: {
      provider: provider.providerId,
      providerAvailable: provider.isAvailable(),
      internalAdapters: ["memory", "historical", "saved"],
      adapters: ["DOUYIN", "XIAOHONGSHU", "WECHAT_CHANNELS", "OPEN_WEB"],
      supplier1688Adapter: "DEFERRED",
      // B1 审计：需求快照来自哪次 canonical 分析
      canonicalAnalysisRunId: canonical.analysisRunId,
      canonicalAnalysisRunStatus: canonical.analysisRunStatus,
      canonicalUncertainCount: canonical.uncertainCount,
    },
    promptName: brief.generator.llm?.promptName ?? null,
    promptVersion: brief.generator.llm?.promptVersion ?? null,
  });
}

/** B3/T9：项目范围列表——先项目读权限，只回本项目的 Run */
export async function listProjectSearchRuns(
  actor: SupplierIntelActor,
  projectId: string,
  opts?: { status?: string },
) {
  await assertProjectAccessForActor(actor, projectId, "read");
  return listSearchRuns(actor, { status: opts?.status, projectId });
}

/** B3：项目绑定 Run 的读取——HTTP 面只暴露项目绑定 Run，读取先过项目读权限 */
export async function getProjectSearchRun(actor: SupplierIntelActor, runId: string) {
  const run = await getSearchRun(actor, runId);
  if (!run || !run.projectId) {
    // 非项目绑定 Run 不经 HTTP 面暴露（M1 HTTP 全部项目绑定）；不泄露存在性
    throw new SupplierIntelError("NOT_FOUND", "搜索运行不存在");
  }
  await assertProjectAccessForActor(actor, run.projectId, "read");
  return run;
}

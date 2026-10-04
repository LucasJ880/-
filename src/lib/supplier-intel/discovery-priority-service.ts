/**
 * S4-B：找厂优先级的服务端装配——把项目的 Brief 词与线索已有字段交给纯函数。
 * Brief 来源（服务端、确定性）：本项目最近一次**发现** Run 的 briefSnapshotJson；没有发现 Run 时
 * 用 canonical 需求快照现算一份确定性 Brief（不调 LLM）。canonical 不可用 → 优先级不可用（返回 null，
 * 不静默给 0 分）。
 */

import { db } from "@/lib/db";
import type { SupplierIntelActor } from "./actor";
import { loadCanonicalSupplierRequirementSnapshot } from "./canonical-requirements";
import { computeDiscoveryPriority, type DiscoveryPriorityBriefInput, type DiscoveryPriorityResult, type DiscoveryPrioritySignalInput } from "./discovery-priority";
import { SupplierIntelError } from "./errors";
import { buildDeterministicBrief } from "./search-brief";

function readBriefFields(json: unknown): DiscoveryPriorityBriefInput | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  if (!("productKeywords" in o) && !("commercialSearchTermsZh" in o)) return null;
  return {
    productKeywords: arr(o.productKeywords), productCategory: typeof o.productCategory === "string" ? o.productCategory : null,
    commercialSearchTermsZh: arr(o.commercialSearchTermsZh), capabilitySearchTermsZh: arr(o.capabilitySearchTermsZh), searchTermsEn: arr(o.searchTermsEn),
  };
}

export interface ProjectPriorityBrief { brief: DiscoveryPriorityBriefInput; source: { kind: "DISCOVERY_RUN"; runId: string } | { kind: "CANONICAL_DETERMINISTIC" } }

/** 项目读权限由调用方（路由 / 上层服务）先行裁决 */
export async function loadProjectPriorityBrief(orgId: string, projectId: string): Promise<ProjectPriorityBrief | null> {
  const runs = await db.supplierSearchRun.findMany({ where: { orgId, projectId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, briefSnapshotJson: true, sourceConfigJson: true } });
  for (const r of runs) {
    const mode = (r.sourceConfigJson as { runMode?: string } | null)?.runMode;
    if (mode === "EVALUATION_ONLY") continue;
    const brief = readBriefFields(r.briefSnapshotJson);
    if (brief) return { brief, source: { kind: "DISCOVERY_RUN", runId: r.id } };
  }
  try {
    const canonical = await loadCanonicalSupplierRequirementSnapshot({ orgId, projectId });
    const brief = buildDeterministicBrief({ projectId, requirements: canonical.entries });
    return { brief: readBriefFields(brief) ?? { productKeywords: brief.productKeywords }, source: { kind: "CANONICAL_DETERMINISTIC" } };
  } catch (err) {
    if (err instanceof SupplierIntelError) return null;
    throw err;
  }
}

export function prioritizeSignal(brief: DiscoveryPriorityBriefInput | null, signal: DiscoveryPrioritySignalInput): DiscoveryPriorityResult | null {
  return brief ? computeDiscoveryPriority(brief, signal) : null;
}

/** 便捷：给一批线索批量标注（同一 Brief 只装配一次） */
export async function annotateSignalsWithPriority<T extends DiscoveryPrioritySignalInput & { id: string }>(actor: SupplierIntelActor, projectId: string, signals: T[]): Promise<Array<T & { discoveryPriority: DiscoveryPriorityResult | null }>> {
  const loaded = await loadProjectPriorityBrief(actor.orgId, projectId);
  return signals.map((s) => ({ ...s, discoveryPriority: prioritizeSignal(loaded?.brief ?? null, s) }));
}

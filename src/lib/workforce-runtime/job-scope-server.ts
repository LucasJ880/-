/**
 * VIS-1b：workforce 作业可读判定的服务端接线（spec agents/workforce-job-scope；design D5）
 *
 * - resolveRunWorkDomain：既有 resolveEffectiveWorkDomain 的薄包装（规则不改；解析不出 → null）；
 * - loadWorkforceJobScope：列表与详情接口的判定输入（与 D2 同法：接口已解析的企业 + 共享拼装函数）。
 */

import { db } from "@/lib/db";
import { loadNavigationContextForOrg } from "@/lib/navigation/context-server";
import type { RouteGateContext } from "@/lib/navigation/filter-context";
import { WORKFORCE_JOB_RUN_TYPE } from "./constants";
import { createWorkforceJobReadFilter, readsEveryWorkDomain, type WorkDomainResolver, type WorkforceRunForScope } from "./readable-domains";
import { resolveEffectiveWorkDomain } from "./work-domain";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export const resolveRunWorkDomain: WorkDomainResolver = async (run) => {
  const result = await resolveEffectiveWorkDomain({ orgId: run.orgId, runId: run.id, runMetadata: asRecord(run.metadata) });
  return result.ok ? result.workDomain : null;
};

/**
 * 当前用户在该企业的作业可读判定。能读全部工作域（含解析不出）的人返回 canRead = undefined：
 * 列表走改动前的单次查询、不逐条解析工作域（审查：老板翻页不该多付逐条查询）。
 */
export async function loadWorkforceJobReadFilter(
  user: { id: string; role: string | null },
  orgId: string,
): Promise<{ ctx: RouteGateContext; canRead: ((run: WorkforceRunForScope) => Promise<boolean>) | undefined }> {
  const ctx = await loadNavigationContextForOrg(user, orgId);
  return { ctx, canRead: readsEveryWorkDomain(ctx) ? undefined : createWorkforceJobReadFilter(ctx, resolveRunWorkDomain) };
}

/** 详情接口用：取作业行的最小字段（与 getWorkforceJobView 同样按 orgId + id + runType 三条件） */
export async function loadWorkforceRunForScope(orgId: string, jobId: string): Promise<WorkforceRunForScope | null> {
  return db.agentRun.findFirst({
    where: { id: jobId, orgId, runType: WORKFORCE_JOB_RUN_TYPE },
    select: { id: true, orgId: true, metadata: true },
  });
}

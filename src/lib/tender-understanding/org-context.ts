/**
 * 招标 Model Policy 的权威组织上下文。
 *
 * orgId 只来自服务端已落库的项目归属 / 分析 run（run.orgId 在入队时从 project.orgId 复制）。
 * 禁止把请求体、技能 input、客户端传入的 orgId 当作 entitlement 依据。
 */

import { db } from "@/lib/db";

export function pickCanonicalTenderOrg(input: {
  projectOrgId?: string | null;
  runOrgId?: string | null;
}): string | null {
  const project = input.projectOrgId?.trim() || "";
  const run = input.runOrgId?.trim() || "";
  if (project) {
    if (run && run !== project) return null;
    return project;
  }
  return run || null;
}

export async function loadCanonicalProjectOrgId(
  projectId: string,
): Promise<string | null> {
  const id = projectId?.trim();
  if (!id) return null;
  const project = await db.project.findUnique({
    where: { id },
    select: { orgId: true },
  });
  return project?.orgId?.trim() || null;
}

export async function resolveTenderOrgForProject(input: {
  projectId: string;
  runOrgId?: string | null;
}): Promise<string | null> {
  const projectOrgId = await loadCanonicalProjectOrgId(input.projectId);
  return pickCanonicalTenderOrg({
    projectOrgId,
    runOrgId: input.runOrgId,
  });
}

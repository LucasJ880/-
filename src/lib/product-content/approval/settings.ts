import { db } from "@/lib/db";
import type { AgentApprovalSettings } from "@prisma/client";
import { publishOrgRule } from "@/lib/org-rules/service";

export async function getOrCreateApprovalSettings(
  orgId: string,
): Promise<AgentApprovalSettings> {
  const existing = await db.agentApprovalSettings.findUnique({
    where: { orgId },
  });
  if (existing) return existing;

  return db.agentApprovalSettings.create({
    data: { orgId, version: 1, effectiveAt: new Date() },
  });
}

/** 更新产品内容审批设置并递增版本 */
export async function updateApprovalSettings(params: {
  orgId: string;
  userId: string;
  patch: Partial<
    Omit<
      AgentApprovalSettings,
      "id" | "orgId" | "createdAt" | "updatedAt" | "version" | "effectiveAt"
    >
  >;
}): Promise<AgentApprovalSettings> {
  const existing = await getOrCreateApprovalSettings(params.orgId);
  const now = new Date();
  const updated = await db.agentApprovalSettings.update({
    where: { orgId: params.orgId },
    data: {
      ...params.patch,
      version: existing.version + 1,
      effectiveAt: now,
      updatedById: params.userId,
    },
  });

  await publishOrgRule({
    orgId: params.orgId,
    ruleKey: "product_content_approval",
    userId: params.userId,
    effectiveAt: now,
    config: {
      defaultExecutionMode: updated.defaultExecutionMode,
      askBeforeExternalSend: updated.askBeforeExternalSend,
      askBeforePublish: updated.askBeforePublish,
      askBeforeHighCostModel: updated.askBeforeHighCostModel,
      maxAutoCostPerJobCents: updated.maxAutoCostPerJobCents,
      maxAutoCostPerDayCents: updated.maxAutoCostPerDayCents,
    },
  }).catch(() => {});

  return updated;
}

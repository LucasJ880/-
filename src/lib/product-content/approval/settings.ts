import { db } from "@/lib/db";
import type { AgentApprovalSettings } from "@prisma/client";

export async function getOrCreateApprovalSettings(
  orgId: string,
): Promise<AgentApprovalSettings> {
  const existing = await db.agentApprovalSettings.findUnique({
    where: { orgId },
  });
  if (existing) return existing;

  return db.agentApprovalSettings.create({
    data: { orgId },
  });
}

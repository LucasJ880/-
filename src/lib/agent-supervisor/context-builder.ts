/**
 * 最小上下文装配 — 按 org 隔离，禁止整库注入
 */

import { db } from "@/lib/db";
import type { SupervisorPageContext, SupervisorState } from "./types";
import { listWorkers } from "./worker-registry";

export async function buildSupervisorContext(input: {
  orgId: string;
  userId: string;
  pageContext?: SupervisorPageContext;
}): Promise<SupervisorState["resolvedContext"]> {
  const org = await db.organization.findUnique({
    where: { id: input.orgId },
    select: { id: true, name: true, code: true, status: true },
  });

  const skills = await db.agentSkill.findMany({
    where: {
      orgId: input.orgId,
      isActive: true,
      slug: {
        in: listWorkers().flatMap((w) => w.allowedSkills),
      },
    },
    select: { slug: true, name: true, domain: true },
    take: 40,
  });

  const missingContext: string[] = [];
  let currentEntity: Record<string, unknown> | undefined;

  if (input.pageContext?.projectId) {
    const project = await db.project.findFirst({
      where: { id: input.pageContext.projectId, orgId: input.orgId },
      select: {
        id: true,
        name: true,
        status: true,
        category: true,
        tenderStatus: true,
      },
    });
    if (project) currentEntity = { type: "project", ...project };
    else missingContext.push("projectId 不属于当前组织或不存在");
  }

  if (input.pageContext?.customerId) {
    const customer = await db.salesCustomer.findFirst({
      where: { id: input.pageContext.customerId, orgId: input.orgId },
      select: { id: true, name: true, phone: true, email: true },
    });
    if (customer) {
      currentEntity = { ...(currentEntity || {}), customer };
    } else {
      missingContext.push("customerId 不属于当前组织或不存在");
    }
  }

  const relevantFacts: Array<Record<string, unknown>> = [];
  if (org) {
    relevantFacts.push({
      sourceType: "organization",
      sourceId: org.id,
      sourceReference: org.code,
      verified: true,
      name: org.name,
    });
  }

  return {
    organization: org
      ? { id: org.id, name: org.name, code: org.code, status: org.status }
      : undefined,
    currentEntity,
    relevantFacts,
    missingContext,
    availableSkills: skills,
  };
}

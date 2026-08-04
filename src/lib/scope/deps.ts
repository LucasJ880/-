/**
 * 生产用 ScopeResolveDeps（Prisma）。不在模块顶层执行查询。
 */

import { db } from "@/lib/db";
import type { ScopeResolveDeps } from "./resolve";

export function createPrismaScopeDeps(): ScopeResolveDeps {
  return {
    findOrg: async (orgId) =>
      db.organization.findUnique({
        where: { id: orgId },
        select: { id: true, status: true },
      }),
    findMembership: async (userId, orgId) =>
      db.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId } },
        select: { role: true, status: true },
      }),
    findProject: async (projectId) =>
      db.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          orgId: true,
          ownerId: true,
          intakeStatus: true,
        },
      }),
    findProjectMember: async (userId, projectId) =>
      db.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { role: true, status: true },
      }),
    findThread: async (threadId) =>
      db.aiThread.findUnique({
        where: { id: threadId },
        select: {
          id: true,
          userId: true,
          orgId: true,
          projectId: true,
        },
      }),
    loadWorkspaceIds: async (userId, orgId) => {
      try {
        const rows = await db.workspaceMember.findMany({
          where: {
            userId,
            status: "active",
            workspace: { orgId, status: "active" },
          },
          select: { workspaceId: true },
        });
        return rows.map((r) => r.workspaceId);
      } catch {
        return [];
      }
    },
  };
}

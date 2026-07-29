/**
 * 集成测试用最小 Organization / User fixture（写入后由调用方 cleanup）
 */
import type { PrismaClient } from "@prisma/client";

export async function ensureTestUserOrg(
  db: PrismaClient,
  input: {
    userId: string;
    orgId: string;
    email?: string;
    orgCode?: string;
    name?: string;
  },
) {
  const email =
    input.email ||
    `${input.userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}@test.local`;
  const orgCode =
    input.orgCode ||
    `t_${input.orgId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}`;

  await db.user.upsert({
    where: { id: input.userId },
    create: {
      id: input.userId,
      email,
      name: input.name || "Test User",
      status: "active",
      role: "user",
    },
    update: { status: "active" },
  });

  await db.organization.upsert({
    where: { id: input.orgId },
    create: {
      id: input.orgId,
      name: input.name || `Test Org ${input.orgId.slice(0, 8)}`,
      code: orgCode,
      ownerId: input.userId,
      status: "active",
    },
    update: { status: "active", ownerId: input.userId },
  });

  await db.organizationMember.upsert({
    where: {
      orgId_userId: { orgId: input.orgId, userId: input.userId },
    },
    create: {
      orgId: input.orgId,
      userId: input.userId,
      role: "admin",
      status: "active",
    },
    update: { status: "active", role: "admin" },
  });
}

export async function cleanupTestUserOrg(
  db: PrismaClient,
  input: { userIds: string[]; orgIds: string[] },
) {
  await db.organizationMember
    .deleteMany({ where: { orgId: { in: input.orgIds } } })
    .catch(() => undefined);
  await db.organization
    .deleteMany({ where: { id: { in: input.orgIds } } })
    .catch(() => undefined);
  await db.user
    .deleteMany({ where: { id: { in: input.userIds } } })
    .catch(() => undefined);
}

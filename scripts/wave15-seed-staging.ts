#!/usr/bin/env tsx
/**
 * Wave1.5 Staging 合成测试数据（仅 Staging 白名单库）
 *
 * 要求：
 *   QINGYAN_RUNTIME_ENV=staging
 *   通过 assertWave15SeedTargetAllowed（assessRuntimeIsolation 白名单）
 *   WAVE15_SEED_PASSWORD 提供统一测试密码（不写入仓库、不输出摘要）
 *
 * 创建：Org A/B、Admin(双组织)、Member(A)、Outsider(B)、客户/报价/项目、pending internal_note
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import {
  assertWave15SeedTargetAllowed,
} from "../src/lib/env/runtime-isolation";

async function main() {
  // 任何 Prisma 初始化/查询前 fail-closed
  const gate = assertWave15SeedTargetAllowed();
  if (!gate.ok) {
    throw new Error(`拒绝：${gate.message} (${gate.reason})`);
  }

  const password = process.env.WAVE15_SEED_PASSWORD?.trim();
  if (!password || password.length < 10) {
    throw new Error("拒绝：需要 WAVE15_SEED_PASSWORD（>=10）");
  }

  const db = new PrismaClient();
  try {
    const hash = await bcrypt.hash(password, 10);

    const admin = await db.user.upsert({
      where: { email: "wave15-admin@test.qingyan.local" },
      update: {
        passwordHash: hash,
        status: "active",
        role: "admin",
        name: "WAVE15 TEST Admin",
        orgAccessMode: "MULTI_ORG",
        canSelfSwitchOrg: true,
      },
      create: {
        email: "wave15-admin@test.qingyan.local",
        passwordHash: hash,
        name: "WAVE15 TEST Admin",
        role: "admin",
        status: "active",
        orgAccessMode: "MULTI_ORG",
        canSelfSwitchOrg: true,
      },
    });
    const member = await db.user.upsert({
      where: { email: "wave15-member@test.qingyan.local" },
      update: {
        passwordHash: hash,
        status: "active",
        role: "user",
        name: "WAVE15 TEST Member",
      },
      create: {
        email: "wave15-member@test.qingyan.local",
        passwordHash: hash,
        name: "WAVE15 TEST Member",
        role: "user",
        status: "active",
      },
    });
    const outsider = await db.user.upsert({
      where: { email: "wave15-outsider@test.qingyan.local" },
      update: {
        passwordHash: hash,
        status: "active",
        role: "user",
        name: "WAVE15 TEST Outsider",
      },
      create: {
        email: "wave15-outsider@test.qingyan.local",
        passwordHash: hash,
        name: "WAVE15 TEST Outsider",
        role: "user",
        status: "active",
      },
    });

    async function ensureOrg(code: string, name: string, ownerId: string) {
      const existing = await db.organization.findUnique({ where: { code } });
      if (existing) return existing;
      return db.organization.create({
        data: {
          code,
          name,
          ownerId,
          status: "active",
          modulesJson: { enabled: ["sales", "projects", "trade"] },
        },
      });
    }

    const orgA = await ensureOrg(
      "wave15-test-org-a",
      "WAVE15 TEST Org A",
      admin.id,
    );
    const orgB = await ensureOrg(
      "wave15-test-org-b",
      "WAVE15 TEST Org B",
      admin.id,
    );

    async function ensureMember(orgId: string, userId: string, role: string) {
      await db.organizationMember.upsert({
        where: { orgId_userId: { orgId, userId } },
        update: { role, status: "active" },
        create: { orgId, userId, role, status: "active" },
      });
    }

    await ensureMember(orgA.id, admin.id, "org_admin");
    await ensureMember(orgB.id, admin.id, "org_admin");
    await ensureMember(orgA.id, member.id, "org_member");
    await ensureMember(orgB.id, outsider.id, "org_member");

    await db.user.update({
      where: { id: admin.id },
      data: { activeOrgId: orgA.id },
    });
    await db.user.update({
      where: { id: member.id },
      data: { activeOrgId: orgA.id },
    });
    await db.user.update({
      where: { id: outsider.id },
      data: { activeOrgId: orgB.id },
    });

    async function ensureCustomer(
      orgId: string,
      createdById: string,
      name: string,
    ) {
      const found = await db.salesCustomer.findFirst({ where: { orgId, name } });
      if (found) return found;
      return db.salesCustomer.create({
        data: {
          orgId,
          createdById,
          name,
          email: `${name.replace(/\s+/g, "-").toLowerCase()}@test.qingyan.local`,
          phone: null,
          status: "active",
          source: "other",
          notes: "WAVE15 synthetic only",
        },
      });
    }

    const custA = await ensureCustomer(
      orgA.id,
      admin.id,
      "WAVE15 TEST Customer A",
    );
    const custB = await ensureCustomer(
      orgB.id,
      outsider.id,
      "WAVE15 TEST Customer B",
    );

    async function ensureQuote(
      orgId: string,
      customerId: string,
      createdById: string,
    ) {
      const found = await db.salesQuote.findFirst({
        where: { orgId, customerId },
      });
      if (found) return found;
      const token = randomBytes(16).toString("hex");
      return db.salesQuote.create({
        data: {
          orgId,
          customerId,
          createdById,
          status: "draft",
          shareToken: token,
          notes: "WAVE15 TEST Quote",
          grandTotal: 100,
          currency: "CAD",
        },
      });
    }

    const quoteA = await ensureQuote(orgA.id, custA.id, admin.id);
    const quoteB = await ensureQuote(orgB.id, custB.id, outsider.id);

    async function ensureProject(
      orgId: string,
      ownerId: string,
      name: string,
      code: string,
    ) {
      const found = await db.project.findFirst({ where: { orgId, name } });
      if (found) return found;
      return db.project.create({
        data: {
          orgId,
          ownerId,
          name,
          code,
          status: "active",
          description: "WAVE15 synthetic project",
        },
      });
    }

    const projA = await ensureProject(
      orgA.id,
      admin.id,
      "WAVE15 TEST Project A",
      "WAVE15-PA",
    );
    const projB = await ensureProject(
      orgB.id,
      outsider.id,
      "WAVE15 TEST Project B",
      "WAVE15-PB",
    );

    const pending = await db.pendingAction.findFirst({
      where: {
        orgId: orgA.id,
        type: "grader.internal_note",
        status: "pending",
      },
    });
    const pendingId =
      pending?.id ||
      (
        await db.pendingAction.create({
          data: {
            type: "grader.internal_note",
            title: "WAVE15 TEST Internal Note",
            preview: "Synthetic pending action for isolation tests",
            status: "pending",
            createdById: admin.id,
            orgId: orgA.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            payload: {
              type: "grader.internal_note",
              targetType: "PROJECT",
              targetId: projA.id,
              note: "WAVE15 TEST note body",
              metadata: { orgId: orgA.id },
            },
          },
        })
      ).id;

    const summary = {
      runtimeEnv: gate.runtimeEnv,
      dbPlane: gate.dbPlane,
      dbFingerprint: gate.dbFingerprint,
      org_a_id: orgA.id,
      org_b_id: orgB.id,
      admin_email: admin.email,
      member_email: member.email,
      outsider_email: outsider.email,
      customer_a_id: custA.id,
      customer_b_id: custB.id,
      quote_a_id: quoteA.id,
      quote_b_id: quoteB.id,
      project_a_id: projA.id,
      project_b_id: projB.id,
      pending_action_id: pendingId,
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("[wave15-seed] FAIL", e instanceof Error ? e.message : e);
  process.exit(1);
});

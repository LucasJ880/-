/**
 * Workforce Phase 2A 测试共享工具
 *
 * 安全红线：DB 测试只允许在隔离测试库（NODE_ENV=test + 显式 DATABASE_URL）
 * 上运行，绝不允许指向生产库。生产环境 NODE_ENV=production，本守卫直接跳过。
 */

import { db } from "@/lib/db";

export function requireIsolatedTestDb(): void {
  if (process.env.NODE_ENV !== "test") {
    console.log(
      "⏭  跳过 Workforce DB 测试（需 NODE_ENV=test + 隔离 Neon 分支 DATABASE_URL）",
    );
    process.exit(0);
  }
  if (!process.env.DATABASE_URL) {
    console.log("⏭  跳过 Workforce DB 测试（未提供 DATABASE_URL）");
    process.exit(0);
  }
}

let pass = 0;
let fail = 0;

export function ok(cond: boolean, name: string, detail?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : "");
  }
}

export function finish(): void {
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

export type WorkforceFixture = {
  orgId: string;
  ownerUserId: string;
  approverUserId: string;
  tag: string;
};

/** 建立最小 org + Owner(UserA) + Approver(UserB, org_admin) fixture */
export async function seedWorkforceFixture(
  prefix: string,
): Promise<WorkforceFixture> {
  const tag = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const owner = await db.user.create({
    data: {
      email: `wf_owner_${tag}@test.qingyan.local`,
      name: `WF Owner ${tag}`,
      role: "sales",
      status: "active",
    },
  });
  const approver = await db.user.create({
    data: {
      email: `wf_approver_${tag}@test.qingyan.local`,
      name: `WF Approver ${tag}`,
      role: "admin",
      status: "active",
    },
  });
  const org = await db.organization.create({
    data: {
      name: `WF Test Org ${tag}`,
      code: `wf_${tag}`,
      ownerId: approver.id,
      status: "active",
    },
  });
  await db.organizationMember.createMany({
    data: [
      { orgId: org.id, userId: owner.id, role: "org_member", status: "active" },
      {
        orgId: org.id,
        userId: approver.id,
        role: "org_admin",
        status: "active",
      },
    ],
  });

  // Workforce flag：仅 allowlist 用户可创建（测试内启用）
  process.env.WORKFORCE_RUNTIME_ENABLED = "1";
  process.env.WORKFORCE_RUNTIME_ORG_ALLOWLIST = "";
  process.env.WORKFORCE_RUNTIME_ROLE_ALLOWLIST = "";
  const existing = process.env.WORKFORCE_RUNTIME_USER_ALLOWLIST;
  process.env.WORKFORCE_RUNTIME_USER_ALLOWLIST = existing
    ? `${existing},${owner.id}`
    : owner.id;

  return { orgId: org.id, ownerUserId: owner.id, approverUserId: approver.id, tag };
}

/** 黄金场景目标（匹配 planner 确定性模板，测试无需 LLM 规划） */
export const GOLDEN_GOAL =
  "帮我检查最近需要跟进的销售客户，整理优先顺序和下一步建议。";

export function metaOf(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
}

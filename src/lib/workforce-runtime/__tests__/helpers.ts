/**
 * Workforce Phase 2A 测试共享工具
 *
 * 安全红线：所有 destructive 入口先经统一 Production DB Test Guard
 * （src/lib/testing/assert-safe-test-database.ts，fail-closed）：
 * 生产库 / 未识别远程库 → HARD FAIL（抛错、非零退出，绝非 skip/exit 0）；
 * 隔离远程测试库需显式 DATABASE_ENVIRONMENT=isolated。
 *
 * 注意：本文件顶层禁止 import "@/lib/db" —— 安全检查完成前不得触发
 * Prisma client 实例化/连接；db 一律在函数内动态 import（guard-first）。
 */

import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

export function requireIsolatedTestDb(scriptName?: string): void {
  // 唯一先行豁免：完全未配置 DATABASE_URL（无连接可言，按既有约定 skip，
  // 保证无 DB 环境下 test-all 不误报）。只要配置了 URL，一律进统一 Guard。
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("⏭  跳过 Workforce DB 测试（未提供 DATABASE_URL）");
    process.exit(0);
  }

  // 统一 fail-closed Guard：生产库任何信号组合都 HARD FAIL（非零退出）
  assertSafeTestDatabase({
    scriptName: scriptName ?? "workforce-runtime phase2a destructive test",
  });

  if (process.env.NODE_ENV !== "test") {
    console.log("⏭  跳过 Workforce DB 测试（需 NODE_ENV=test）");
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
  // guard-first：db 动态 import，确保安全检查前不建 Prisma 连接
  const { db } = await import("@/lib/db");
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

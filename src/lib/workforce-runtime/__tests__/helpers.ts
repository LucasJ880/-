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

/** 本 suite 专属幂等键（unique org tag 前缀，跨 suite 无碰撞） */
export function fixtureIdempotencyKey(
  fx: WorkforceFixture,
  label: string,
): string {
  return `wf_${fx.tag}_${label}`;
}

/**
 * Fixture ownership cleanup（Test Isolation Hardening §5/§7）：
 * 只删除本 fixture 自己创建的数据（按 fx.orgId / fx 用户 id 定位），
 * 绝不做 DELETE all AgentRun / DELETE all PendingAction。
 *
 * 目的：suite 结束后不在共享隔离库中留下任何 eligible workforce job
 * （queued / 可 reclaim 的过期租约 run），防止后续 suite 的
 * processQueuedWorkforceJobs take-N 窗口被挤占或误认领。
 *
 * 删除顺序按 FK 依赖：PendingAction（引用 User）→ AgentRun（级联
 * Step/Event/Verification）→ AgentSession → OrganizationMember →
 * Organization → User。org/user 删除可能被非 workforce 表（如 AI 调用
 * 日志）挡住——记录为 residue 但不失败：隔离契约的硬要求是
 * "零 eligible workforce job"，由 assertNoLeakedWorkforceJobs 单独断言。
 */
export async function cleanupWorkforceFixture(
  fx: WorkforceFixture,
): Promise<{ residue: string[] }> {
  const { db } = await import("@/lib/db");
  const residue: string[] = [];
  const attempt = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      residue.push(`${label}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
  };

  await attempt("pendingAction", () =>
    db.pendingAction.deleteMany({ where: { orgId: fx.orgId } }),
  );
  await attempt("agentRun", () =>
    db.agentRun.deleteMany({ where: { orgId: fx.orgId } }),
  );
  await attempt("agentSession", () =>
    db.agentSession.deleteMany({ where: { orgId: fx.orgId } }),
  );
  await attempt("organizationMember", () =>
    db.organizationMember.deleteMany({ where: { orgId: fx.orgId } }),
  );
  await attempt("organization", () =>
    db.organization.deleteMany({ where: { id: fx.orgId } }),
  );
  await attempt("users", () =>
    db.user.deleteMany({
      where: { id: { in: [fx.ownerUserId, fx.approverUserId] } },
    }),
  );
  return { residue };
}

/**
 * 隔离契约硬断言：cleanup 后本 fixture org 名下不允许残留任何
 * workforce job 行（更不允许残留 eligible 行）。返回 true = 无泄漏。
 */
export async function assertNoLeakedWorkforceJobs(
  fx: WorkforceFixture,
): Promise<boolean> {
  const { db } = await import("@/lib/db");
  const leaked = await db.agentRun.count({
    where: { orgId: fx.orgId, runType: "workforce_job" },
  });
  if (leaked > 0) {
    console.error(
      `  [leak] org ${fx.orgId} 残留 ${leaked} 个 workforce job（cleanup 未生效）`,
    );
  }
  return leaked === 0;
}

/**
 * 外部积压模拟（Test Isolation Hardening §6/§11）：在多个独立 foreign org
 * 中创建共 N 个 eligible queued workforce job（每 org ≤2 个，遵守单 org
 * 并发配额治理），模拟"多个前序 suite 遗留 / 其他租户并行使用同一隔离库"
 * 的真实形态。返回全部 fixture 供调用方逐一 cleanup。
 */
export async function seedForeignQueuedBacklog(
  count: number,
): Promise<{ fixtures: WorkforceFixture[]; runIds: string[] }> {
  const { createWorkforceJob } = await import("../job");
  const PER_ORG = 2;
  const fixtures: WorkforceFixture[] = [];
  const runIds: string[] = [];
  while (runIds.length < count) {
    const fx = await seedWorkforceFixture("foreign");
    fixtures.push(fx);
    for (let i = 0; i < PER_ORG && runIds.length < count; i++) {
      const job = await createWorkforceJob({
        workDomain: "sales",
        orgId: fx.orgId,
        userId: fx.ownerUserId,
        role: "sales",
        goal: `${GOLDEN_GOAL}（foreign backlog ${runIds.length}）`,
      });
      if (!job.ok) throw new Error(`seedForeignQueuedBacklog: ${job.error}`);
      runIds.push(job.runId);
    }
  }
  return { fixtures, runIds };
}

/**
 * run-scoped sweep 辅助（Kill-Switch §6）：反复调用全局
 * processQueuedWorkforceJobs 直到目标 run 被拾取或轮次预算耗尽。
 * 生产消费者天然是全局 take-N —— 测试不改生产语义，只把"断言"
 * 收敛到本 fixture 的 runId（其他 org 的积压最多消耗有限轮次）。
 */
export async function sweepUntilRunProcessed(
  runId: string,
  opts?: { maxRounds?: number; batch?: number },
): Promise<{ swept: boolean; rounds: number }> {
  const { processQueuedWorkforceJobs } = await import("../processor");
  const maxRounds = opts?.maxRounds ?? 12;
  const batch = opts?.batch ?? 5;
  for (let round = 1; round <= maxRounds; round++) {
    const sweep = await processQueuedWorkforceJobs(batch);
    if (sweep.runIds.includes(runId)) return { swept: true, rounds: round };
    if (
      sweep.processed === 0 &&
      sweep.runIds.length === 0 &&
      sweep.exhaustedFailed === 0
    ) {
      // 队列已空仍未见目标 run：目标不 eligible，提前失败
      return { swept: false, rounds: round };
    }
  }
  return { swept: false, rounds: maxRounds };
}

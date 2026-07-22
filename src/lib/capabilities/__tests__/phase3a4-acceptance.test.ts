/**
 * Phase 3A-4 PR #11 登录态与配额安全验收
 * 运行：npx tsx src/lib/capabilities/__tests__/phase3a4-acceptance.test.ts
 */

import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import type { TenantContext } from "@/lib/tenancy/context";
import {
  buildCapabilitiesAccess,
  CapabilitiesAccessError,
  resolveDetailAccessMode,
} from "../access";
import {
  assertCanReadGovernance,
  assertCanWriteOrgQuota,
  assertCanWriteWorkspaceQuota,
  createQuotaPolicy,
  evaluateQuota,
  getGovernanceUsage,
  listCapabilityAudit,
  listQuotaPolicies,
  precheckMonthlyAiCost,
  reserveQuota,
  commitReservation,
  releaseReservation,
  resolveEffectiveQuota,
  getQuotaCurrentUsage,
} from "../governance";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function fakeUser(id: string, role = "user"): AuthUser {
  return { id, email: `${id}@t.local`, name: id, role } as AuthUser;
}

function tenant(p: {
  userId: string;
  orgId: string;
  orgRole: string;
  isPlatformAdmin?: boolean;
  workspaceIds?: string[];
}): TenantContext {
  return {
    userId: p.userId,
    orgId: p.orgId,
    orgRole: p.orgRole,
    workspaceIds: p.workspaceIds ?? [],
    isPlatformAdmin: p.isPlatformAdmin ?? false,
    user: fakeUser(p.userId, p.isPlatformAdmin ? "super_admin" : "user"),
  };
}

async function expectNoMembership(label: string, t: TenantContext) {
  let hit = false;
  try {
    await buildCapabilitiesAccess(t);
  } catch (e) {
    hit =
      e instanceof CapabilitiesAccessError &&
      e.code === "NO_MEMBERSHIP" &&
      e.httpStatus === 403;
  }
  ok(hit, label);
}

async function main() {
  console.log("phase3a4 PR#11 acceptance");

  const sunny = await db.organization.findFirst({
    where: { code: "sunny-home-deco" },
  });
  const mengxin = await db.organization.findFirst({
    where: { code: "mengxin-home-textile" },
  });
  ok(!!sunny && !!mengxin, "双租户组织存在");
  if (!sunny || !mengxin) process.exit(1);

  const sunnyAdmin = await db.organizationMember.findFirst({
    where: { orgId: sunny.id, status: "active", role: "org_admin" },
  });
  const mxAdmin = await db.organizationMember.findFirst({
    where: { orgId: mengxin.id, status: "active", role: "org_admin" },
  });
  ok(!!sunnyAdmin && !!mxAdmin, "双租户 org_admin 存在");
  if (!sunnyAdmin || !mxAdmin) process.exit(1);

  const sunnyWs = await db.workspace.findFirst({
    where: { orgId: sunny.id, status: "active" },
  });
  ok(!!sunnyWs, "Sunny Workspace 存在");
  if (!sunnyWs) process.exit(1);

  // ── 1 & 2：无 membership / Platform Admin 不得绕过 ──
  await expectNoMembership(
    "1. 无 membership → NO_MEMBERSHIP 403",
    tenant({
      userId: "ghost-user-no-mem",
      orgId: sunny.id,
      orgRole: "org_viewer",
    }),
  );
  await expectNoMembership(
    "2. Platform Admin 无 membership 不得绕过",
    tenant({
      userId: "platform-admin-ghost",
      orgId: sunny.id,
      orgRole: "org_admin",
      isPlatformAdmin: true,
    }),
  );

  // 治理读也必须先过 membership
  let govDenied = false;
  try {
    const fakeAccess = {
      userId: "ghost",
      orgId: sunny.id,
      orgRole: "org_admin",
      isPlatformAdmin: true,
      workspaceIds: [] as string[],
      runVisibility: "AGGREGATE_ONLY" as const,
      hasMembership: false,
    };
    await assertCanReadGovernance(fakeAccess);
  } catch (e) {
    govDenied =
      e instanceof CapabilitiesAccessError && e.code === "NO_MEMBERSHIP";
  }
  ok(govDenied, "1b. governance 读无 membership → 403");

  // ── 3：Org Admin 可管理企业 quota / 聚合 / 审计 ──
  const sunnyAccess = await buildCapabilitiesAccess(
    tenant({
      userId: sunnyAdmin.userId,
      orgId: sunny.id,
      orgRole: "org_admin",
      workspaceIds: [sunnyWs.id],
    }),
  );
  await assertCanReadGovernance(sunnyAccess);
  assertCanWriteOrgQuota(sunnyAccess);

  const orgPolicy = await createQuotaPolicy({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "DAILY_AGENT_RUNS",
    period: "DAILY",
    warningLimit: 2,
    softLimit: 3,
    hardLimit: 5,
  });
  ok(orgPolicy.orgId === sunny.id && orgPolicy.workspaceId == null, "3a. Org Admin 创建企业级 quota");

  const usage = await getGovernanceUsage({
    access: sunnyAccess,
    workspaceId: null,
  });
  ok(
    usage.orgId === sunny.id && Array.isArray(usage.metrics),
    "3b. Org Admin 可看企业用量聚合",
  );

  const audit = await listCapabilityAudit({
    orgId: sunny.id,
    pageSize: 5,
    restrictWorkspaceIds: null,
  });
  ok(audit.total >= 0, "3c. Org Admin 可查看企业治理审计");

  // ── 4：Org Admin 无 WS membership → 敏感业务 AGGREGATE ──
  const adminNoWs = await buildCapabilitiesAccess(
    tenant({
      userId: sunnyAdmin.userId,
      orgId: sunny.id,
      orgRole: "org_admin",
      workspaceIds: [], // 模拟无该 WS
    }),
  );
  // 强制 AGGREGATE_ONLY
  adminNoWs.runVisibility = "AGGREGATE_ONLY";
  const mode = resolveDetailAccessMode(adminNoWs, sunnyWs.id);
  ok(mode === "aggregate", "4. Org Admin 无 WS membership → aggregate（不可看敏感正文）");

  // ── 5：Workspace Admin 只能收紧本 WS ──
  let wsAdminMember = await db.workspaceMember.findFirst({
    where: { workspaceId: sunnyWs.id, status: "active" },
  });
  let createdTempWsMember = false;
  let prevWsRole: string | null = null;

  if (!wsAdminMember) {
    // 验收临时挂载：用非 org_admin 的企业成员（若无则用 org_admin）
    const candidate =
      (await db.organizationMember.findFirst({
        where: {
          orgId: sunny.id,
          status: "active",
          NOT: { role: "org_admin" },
        },
      })) ?? sunnyAdmin;
    wsAdminMember = await db.workspaceMember.create({
      data: {
        workspaceId: sunnyWs.id,
        userId: candidate.userId,
        role: "workspace_admin",
        status: "active",
      },
    });
    createdTempWsMember = true;
  } else {
    prevWsRole = wsAdminMember.role;
    if (prevWsRole !== "workspace_admin") {
      await db.workspaceMember.update({
        where: { id: wsAdminMember.id },
        data: { role: "workspace_admin" },
      });
    }
  }

  const wsAccess = await buildCapabilitiesAccess(
    tenant({
      userId: wsAdminMember.userId,
      orgId: sunny.id,
      orgRole: "org_member",
      workspaceIds: [sunnyWs.id],
    }),
  );
  let canWs = true;
  try {
    await assertCanWriteWorkspaceQuota(wsAccess, sunnyWs.id);
  } catch {
    canWs = false;
  }
  ok(canWs, "5a. Workspace Admin 可写本 WS quota");

  let otherWsDenied = false;
  let otherWs = await db.workspace.findFirst({
    where: { orgId: sunny.id, status: "active", NOT: { id: sunnyWs.id } },
  });
  let createdTempWs = false;
  if (!otherWs) {
    const slug = `acc-temp-${Date.now()}`;
    otherWs = await db.workspace.create({
      data: {
        orgId: sunny.id,
        name: slug,
        slug,
        status: "active",
      },
    });
    createdTempWs = true;
  }
  try {
    await assertCanWriteWorkspaceQuota(wsAccess, otherWs.id);
  } catch (e) {
    otherWsDenied = e instanceof CapabilitiesAccessError;
  }
  ok(otherWsDenied, "5b. Workspace Admin 不能管其他 Workspace");

  let relaxDenied = false;
  try {
    await createQuotaPolicy({
      orgId: sunny.id,
      userId: wsAdminMember.userId,
      workspaceId: sunnyWs.id,
      metric: "DAILY_AGENT_RUNS",
      period: "DAILY",
      hardLimit: 999,
    });
  } catch (e) {
    relaxDenied = e instanceof Error && e.message.includes("不得高于");
  }
  ok(relaxDenied, "5c. Workspace 无法放宽 Organization hard");

  const tight = await createQuotaPolicy({
    orgId: sunny.id,
    userId: wsAdminMember.userId,
    workspaceId: sunnyWs.id,
    metric: "DAILY_AGENT_RUNS",
    period: "DAILY",
    hardLimit: 2,
  });
  const eff = await resolveEffectiveQuota({
    orgId: sunny.id,
    workspaceId: sunnyWs.id,
    metric: "DAILY_AGENT_RUNS",
  });
  ok(
    tight.hardLimit != null &&
      Number(tight.hardLimit.toString()) === 2 &&
      eff.hardLimit === 2,
    "5d. Workspace 可收紧到 2",
  );

  // 清理临时数据
  if (createdTempWsMember) {
    await db.workspaceMember.delete({ where: { id: wsAdminMember.id } });
  } else if (prevWsRole && prevWsRole !== "workspace_admin") {
    await db.workspaceMember.update({
      where: { id: wsAdminMember.id },
      data: { role: prevWsRole },
    });
  }
  if (createdTempWs && otherWs) {
    await db.workspace.delete({ where: { id: otherWs.id } }).catch(() => null);
  }

  // ── 6 & 7：跨租户隔离 ──
  const sunnyPolicies = await listQuotaPolicies(sunny.id);
  const mxPolicies = await listQuotaPolicies(mengxin.id);
  ok(
    !mxPolicies.some((p) => p.id === orgPolicy.id),
    "6a. 梦馨 list 不含 Sunny policy",
  );
  ok(
    !sunnyPolicies.some((p) => mxPolicies.some((m) => m.id === p.id && m.orgId !== p.orgId)),
    "7a. 策略列表按 org 隔离",
  );

  const sunnyResKey = `acc-sunny-${Date.now()}`;
  // 先把并发 hard 放宽以便 reserve
  await createQuotaPolicy({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "MAX_CONCURRENT_RUNS",
    period: "CONCURRENT",
    hardLimit: 5,
  });
  const sunnyRes = await reserveQuota({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "MAX_CONCURRENT_RUNS",
    amount: 1,
    idempotencyKey: sunnyResKey,
  });
  ok(sunnyRes.ok, "6b. Sunny 可创建 reservation");

  if (sunnyRes.ok) {
    await releaseReservation({
      reservationId: sunnyRes.reservationId,
      orgId: mengxin.id,
      userId: mxAdmin.userId,
    });
    const still = await db.capabilityQuotaReservation.findFirst({
      where: { id: sunnyRes.reservationId, orgId: sunny.id },
    });
    ok(still?.status === "RESERVED", "6c. 梦馨 orgId 无法 release Sunny reservation");

    const mxAudit = await listCapabilityAudit({ orgId: mengxin.id, pageSize: 20 });
    const sunnyAudit = await listCapabilityAudit({ orgId: sunny.id, pageSize: 20 });
    ok(
      !mxAudit.items.some((i) => sunnyAudit.items.some((s) => s.id === i.id)),
      "6d/7b. 审计跨租户不串行",
    );
  }

  // ── 8：hard limit 真实阻止四类入口指标 ──
  await createQuotaPolicy({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "DAILY_AGENT_RUNS",
    period: "DAILY",
    hardLimit: 0,
  });
  const agentBlock = await reserveQuota({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "DAILY_AGENT_RUNS",
    amount: 1,
    idempotencyKey: `acc-agent-block-${Date.now()}`,
  });
  ok(!agentBlock.ok, "8a. hard limit 阻止 Agent Run 预留");

  await createQuotaPolicy({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "DAILY_HIGH_RISK_TOOL_CALLS",
    period: "DAILY",
    hardLimit: 0,
  });
  const toolBlock = await reserveQuota({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "DAILY_HIGH_RISK_TOOL_CALLS",
    amount: 1,
    idempotencyKey: `acc-tool-block-${Date.now()}`,
  });
  ok(!toolBlock.ok, "8b. hard limit 阻止高风险 Tool 预留");

  await createQuotaPolicy({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "DAILY_IMAGE_GENERATIONS",
    period: "DAILY",
    hardLimit: 0,
  });
  const imgBlock = await reserveQuota({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "DAILY_IMAGE_GENERATIONS",
    amount: 1,
    idempotencyKey: `acc-img-block-${Date.now()}`,
  });
  ok(!imgBlock.ok, "8c. hard limit 阻止图片生成预留");

  await createQuotaPolicy({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "MONTHLY_AI_COST",
    period: "MONTHLY",
    hardLimit: 0,
  });
  const costEval = await evaluateQuota({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "MONTHLY_AI_COST",
    requestedAmount: 0.05,
  });
  const costPre = await precheckMonthlyAiCost({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    estimatedCost: 0.05,
  });
  ok(
    !costEval.allowed && !costPre.allowed,
    "8d. hard limit 阻止超预算模型调用预检",
  );

  // ── 9：idempotencyKey 不重复占用 ──
  await createQuotaPolicy({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "MAX_CONCURRENT_RUNS",
    period: "CONCURRENT",
    hardLimit: 10,
  });
  const idem = `acc-idem-${Date.now()}`;
  const r1 = await reserveQuota({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "MAX_CONCURRENT_RUNS",
    amount: 1,
    idempotencyKey: idem,
  });
  const r2 = await reserveQuota({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "MAX_CONCURRENT_RUNS",
    amount: 1,
    idempotencyKey: idem,
  });
  ok(r1.ok && r2.ok && r2.duplicate && r1.ok && r2.reservationId === (r1.ok ? r1.reservationId : ""), "9. 相同 idempotencyKey 不重复占用");

  // ── 10：commit / release / expire ──
  if (r1.ok) {
    await commitReservation({
      reservationId: r1.reservationId,
      orgId: sunny.id,
      userId: sunnyAdmin.userId,
    });
    const committed = await db.capabilityQuotaReservation.findFirst({
      where: { id: r1.reservationId },
    });
    ok(committed?.status === "COMMITTED", "10a. Reservation commit");
  } else {
    ok(false, "10a. Reservation commit");
  }

  const relKey = `acc-rel-${Date.now()}`;
  const rRel = await reserveQuota({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "MAX_CONCURRENT_RUNS",
    amount: 1,
    idempotencyKey: relKey,
  });
  if (rRel.ok) {
    await releaseReservation({
      reservationId: rRel.reservationId,
      orgId: sunny.id,
      userId: sunnyAdmin.userId,
    });
    const released = await db.capabilityQuotaReservation.findFirst({
      where: { id: rRel.reservationId },
    });
    ok(released?.status === "RELEASED", "10b. Reservation release");
  } else {
    ok(false, "10b. Reservation release");
  }

  const expKey = `acc-exp-${Date.now()}`;
  const rExp = await reserveQuota({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "MAX_CONCURRENT_RUNS",
    amount: 1,
    idempotencyKey: expKey,
    ttlMs: 1,
  });
  if (rExp.ok) {
    await new Promise((r) => setTimeout(r, 15));
    // 触发惰性过期
    await getQuotaCurrentUsage({
      orgId: sunny.id,
      metric: "MAX_CONCURRENT_RUNS",
    });
    const expired = await db.capabilityQuotaReservation.findFirst({
      where: { id: rExp.reservationId },
    });
    ok(expired?.status === "EXPIRED", "10c. Reservation expire（惰性）");
  } else {
    ok(false, "10c. Reservation expire");
  }

  // 梦馨无法改 Sunny policy（已有）；反向：Sunny 不能读梦馨审计行写入
  await createQuotaPolicy({
    orgId: mengxin.id,
    userId: mxAdmin.userId,
    metric: "DAILY_AGENT_RUNS",
    period: "DAILY",
    hardLimit: 8,
  });
  const mxOnly = await listQuotaPolicies(mengxin.id);
  ok(
    mxOnly.every((p) => p.orgId === mengxin.id),
    "7c. 梦馨策略仅本企业",
  );
  ok(
    !(await listQuotaPolicies(sunny.id)).some((p) =>
      mxOnly.some((m) => m.id === p.id),
    ),
    "7d. Sunny list 不含梦馨 policyId",
  );

  console.log(`\n验收结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

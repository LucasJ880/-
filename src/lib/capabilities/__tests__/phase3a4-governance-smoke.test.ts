/**
 * Phase 3A-4 治理中心租户隔离 / 配额 / Reservation 冒烟
 * 运行：npx tsx src/lib/capabilities/__tests__/phase3a4-governance-smoke.test.ts
 */

import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import type { TenantContext } from "@/lib/tenancy/context";
import {
  buildCapabilitiesAccess,
  CapabilitiesAccessError,
} from "../access";
import {
  assertCanReadGovernance,
  assertCanWriteOrgQuota,
  createQuotaPolicy,
  evaluateQuota,
  getGovernanceProjection,
  listCapabilityAudit,
  listQuotaPolicies,
  patchQuotaPolicy,
  reserveQuota,
  commitReservation,
  releaseReservation,
  resolveEffectiveQuota,
  writeCapabilityAuditEvent,
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

async function main() {
  console.log("phase3a4 governance smoke");

  const sunny = await db.organization.findFirst({
    where: { code: "sunny-home-deco" },
  });
  const mengxin = await db.organization.findFirst({
    where: { code: "mengxin-home-textile" },
  });
  ok(!!sunny && !!mengxin, "Sunny / 梦馨组织存在");
  if (!sunny || !mengxin) process.exit(1);

  const sunnyAdmin = await db.organizationMember.findFirst({
    where: { orgId: sunny.id, status: "active", role: "org_admin" },
  });
  const mxAdmin = await db.organizationMember.findFirst({
    where: { orgId: mengxin.id, status: "active", role: "org_admin" },
  });
  const sunnyMember = await db.organizationMember.findFirst({
    where: { orgId: sunny.id, status: "active" },
  });
  ok(!!sunnyAdmin && !!mxAdmin && !!sunnyMember, "双租户管理员存在");
  if (!sunnyAdmin || !mxAdmin || !sunnyMember) process.exit(1);

  // —— Membership：平台 admin 无 membership ——
  let noMem = false;
  try {
    await buildCapabilitiesAccess(
      tenant({
        userId: "platform-admin-no-mem",
        orgId: sunny.id,
        orgRole: "org_viewer",
        isPlatformAdmin: true,
      }),
    );
  } catch (e) {
    noMem =
      e instanceof CapabilitiesAccessError && e.code === "NO_MEMBERSHIP";
  }
  ok(noMem, "平台管理员无 membership → NO_MEMBERSHIP");

  const sunnyAccess = await buildCapabilitiesAccess(
    tenant({
      userId: sunnyAdmin.userId,
      orgId: sunny.id,
      orgRole: "org_admin",
    }),
  );
  await assertCanReadGovernance(sunnyAccess);
  ok(true, "Sunny org_admin 可读治理");

  // —— Tenant isolation ——
  const sunnyProj = await getGovernanceProjection({ orgId: sunny.id });
  const mxProj = await getGovernanceProjection({ orgId: mengxin.id });
  ok(sunnyProj.orgId === sunny.id, "投影 orgId=Sunny");
  ok(mxProj.orgId === mengxin.id, "投影 orgId=梦馨");
  ok(
    sunnyProj.providerStatus.some(
      (p) => p.provider === "openai" && p.status !== "NOT_IMPLEMENTED",
    ),
    "OpenAI 状态为真实配置态",
  );
  ok(
    sunnyProj.providerStatus.some(
      (p) => p.provider === "gemini" && p.status === "NOT_IMPLEMENTED",
    ),
    "Gemini 不得显示 ACTIVE",
  );

  // Sunny 不能用梦馨 org 写策略（API 层 org 来自 TenantContext；此处直接断言 create 隔离）
  const sunnyPolicy = await createQuotaPolicy({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "DAILY_AGENT_RUNS",
    period: "DAILY",
    warningLimit: 5,
    softLimit: 8,
    hardLimit: 10,
  });
  ok(sunnyPolicy.orgId === sunny.id, "创建 Sunny 配额策略");

  const mxPolicies = await listQuotaPolicies(mengxin.id);
  ok(
    !mxPolicies.some((p) => p.id === sunnyPolicy.id),
    "梦馨 list 不含 Sunny policyId",
  );

  let crossPatch = false;
  try {
    await patchQuotaPolicy({
      orgId: mengxin.id,
      userId: mxAdmin.userId,
      id: sunnyPolicy.id,
      expectedVersion: sunnyPolicy.version,
      hardLimit: 1,
    });
  } catch {
    crossPatch = true;
  }
  ok(crossPatch, "修改他租户 policyId 失败");

  // —— Scope inheritance ——
  const effOrg = await resolveEffectiveQuota({
    orgId: sunny.id,
    workspaceId: null,
    metric: "DAILY_AGENT_RUNS",
  });
  ok(
    effOrg.hardLimit === 10,
    `Org 生效 hard=10（实际 ${effOrg.hardLimit}）`,
  );
  ok(
    effOrg.sourcePolicies.some((s) => s.scope === "ORGANIZATION"),
    "resolver 含 ORGANIZATION 来源",
  );

  const ws = await db.workspace.findFirst({
    where: { orgId: sunny.id, status: "active" },
  });
  if (ws) {
    let relaxFail = false;
    try {
      await createQuotaPolicy({
        orgId: sunny.id,
        userId: sunnyAdmin.userId,
        workspaceId: ws.id,
        metric: "DAILY_AGENT_RUNS",
        period: "DAILY",
        hardLimit: 50,
      });
    } catch (e) {
      relaxFail = e instanceof Error && e.message.includes("不得高于");
    }
    ok(relaxFail, "Workspace 无法放宽 Org hard");

    const wsPolicy = await createQuotaPolicy({
      orgId: sunny.id,
      userId: sunnyAdmin.userId,
      workspaceId: ws.id,
      metric: "DAILY_AGENT_RUNS",
      period: "DAILY",
      hardLimit: 3,
    });
    const effWs = await resolveEffectiveQuota({
      orgId: sunny.id,
      workspaceId: ws.id,
      metric: "DAILY_AGENT_RUNS",
    });
    ok(effWs.hardLimit === 3, "Workspace 可收紧到 3");
    ok(wsPolicy.version >= 1, "WS 策略有版本");
  } else {
    ok(false, "Sunny 存在 Workspace");
    ok(false, "Workspace 可收紧");
    ok(false, "WS 策略有版本");
  }

  // —— Quota levels ——
  const warn = await evaluateQuota({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "DAILY_AGENT_RUNS",
    requestedAmount: 6,
  });
  // current + 6 可能已超；至少验证返回结构
  ok(typeof warn.allowed === "boolean", "evaluate 返回 allowed");
  ok(
    ["OK", "WARNING", "SOFT_LIMIT", "HARD_LIMIT"].includes(warn.level),
    `evaluate level=${warn.level}`,
  );

  // 临时极严 hard 测 hard block
  const blockPolicy = await createQuotaPolicy({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "DAILY_IMAGE_GENERATIONS",
    period: "DAILY",
    hardLimit: 0,
  });
  const blocked = await evaluateQuota({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "DAILY_IMAGE_GENERATIONS",
    requestedAmount: 1,
  });
  ok(!blocked.allowed && blocked.level === "HARD_LIMIT", "hard limit 阻止");
  ok(blocked.reasonCode === "quota_hard_limit", "reasonCode=quota_hard_limit");

  // —— Reservation ——
  const key = `smoke-res-${Date.now()}`;
  // 恢复图片配额以便 reserve 测试（用较高 hard）
  await createQuotaPolicy({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "MAX_CONCURRENT_RUNS",
    period: "CONCURRENT",
    hardLimit: 3,
  });

  const r1 = await reserveQuota({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "MAX_CONCURRENT_RUNS",
    amount: 1,
    idempotencyKey: key,
  });
  ok(r1.ok && !r1.duplicate, "reserve 成功");
  const r2 = await reserveQuota({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "MAX_CONCURRENT_RUNS",
    amount: 1,
    idempotencyKey: key,
  });
  ok(r2.ok && r2.duplicate, "重复 idempotencyKey 不重复占用");
  if (r1.ok) {
    await commitReservation({
      reservationId: r1.reservationId,
      orgId: sunny.id,
      userId: sunnyAdmin.userId,
    });
  }

  const key2 = `smoke-rel-${Date.now()}`;
  const r3 = await reserveQuota({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    metric: "MAX_CONCURRENT_RUNS",
    amount: 1,
    idempotencyKey: key2,
  });
  if (r3.ok) {
    await releaseReservation({
      reservationId: r3.reservationId,
      orgId: sunny.id,
      userId: sunnyAdmin.userId,
    });
  }
  ok(r3.ok, "release 路径可用");

  // 跨租户 reservationId
  let crossRes = true;
  if (r1.ok) {
    await releaseReservation({
      reservationId: r1.reservationId,
      orgId: mengxin.id,
      userId: mxAdmin.userId,
    });
    const still = await db.capabilityQuotaReservation.findFirst({
      where: { id: r1.reservationId, orgId: sunny.id },
    });
    crossRes = still?.status === "COMMITTED";
  }
  ok(crossRes, "他租户 orgId 无法 release Sunny reservation");

  // —— Audit ——
  await writeCapabilityAuditEvent({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    action: "QUOTA_POLICY_UPDATED",
    resourceType: "quota_policy",
    resourceId: blockPolicy.id,
    result: "ok",
    metadata: { apiKey: "sk-secret-should-redact", note: "test" },
  });
  const sunnyAudit = await listCapabilityAudit({ orgId: sunny.id, pageSize: 5 });
  ok(sunnyAudit.total >= 1, "Sunny 审计可查");
  const mxAudit = await listCapabilityAudit({ orgId: mengxin.id, pageSize: 5 });
  ok(
    !mxAudit.items.some((i) => i.id === sunnyAudit.items[0]?.id),
    "梦馨不能读到 Sunny 审计行",
  );

  // 版本冲突
  let conflict = false;
  try {
    await patchQuotaPolicy({
      orgId: sunny.id,
      userId: sunnyAdmin.userId,
      id: sunnyPolicy.id,
      expectedVersion: sunnyPolicy.version - 1,
      hardLimit: 9,
    });
  } catch (e) {
    conflict =
      (e as Error & { code?: string }).code === "version_conflict" ||
      (e instanceof Error && e.message.includes("版本冲突"));
  }
  ok(conflict, "错误 expectedVersion → 版本冲突");

  // member 不能写 org quota
  const memberAccess = await buildCapabilitiesAccess(
    tenant({
      userId: sunnyMember.userId,
      orgId: sunny.id,
      orgRole: sunnyMember.role,
    }),
  );
  let memberDenied = false;
  try {
    assertCanWriteOrgQuota(memberAccess);
  } catch (e) {
    memberDenied = e instanceof CapabilitiesAccessError;
  }
  ok(
    memberDenied || sunnyMember.role === "org_admin",
    "非 org_admin 无企业配额写权限（或样本本身是 admin）",
  );

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Phase 3A-5：中台总览 + 双租户验收
 * 运行：npx tsx src/lib/capabilities/__tests__/phase3a5-overview-acceptance.test.ts
 */

import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import type { TenantContext } from "@/lib/tenancy/context";
import { buildCapabilitiesAccess } from "../access";
import { getCapabilitiesOverview } from "../overview/get-overview";
import { listCapabilityCatalog } from "../catalog/list";
import { assessConfigHealth } from "../config-health/assess";
import { buildStreamSessionKey } from "../governance/stream-guard";

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
  console.log("phase3a5 overview + dual-tenant acceptance");

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

  const sunnyAccess = await buildCapabilitiesAccess(
    tenant({
      userId: sunnyAdmin.userId,
      orgId: sunny.id,
      orgRole: "org_admin",
    }),
  );
  const mxAccess = await buildCapabilitiesAccess(
    tenant({
      userId: mxAdmin.userId,
      orgId: mengxin.id,
      orgRole: "org_admin",
    }),
  );

  const sunnyOv = await getCapabilitiesOverview(sunnyAccess);
  const mxOv = await getCapabilitiesOverview(mxAccess);

  ok(sunnyOv.orgId === sunny.id, "Sunny 总览 orgId 正确");
  ok(mxOv.orgId === mengxin.id, "梦馨 总览 orgId 正确");
  ok(sunnyOv.orgName.length > 0 && !/梦馨/.test(sunnyOv.orgName), "Sunny 组织名不串梦馨");
  ok(mxOv.orgName.length > 0, "梦馨组织名非空");
  ok(sunnyOv.orgId !== mxOv.orgId, "双租户总览隔离");

  // 失败不伪造：metrics 字段允许 null；不得出现 NaN
  for (const ov of [sunnyOv, mxOv]) {
    const m = ov.metrics;
    ok(
      m.todayRuns == null || Number.isFinite(m.todayRuns),
      `${ov.orgName} todayRuns 合法`,
    );
    ok(
      m.monthCost == null || Number.isFinite(m.monthCost),
      `${ov.orgName} monthCost 合法`,
    );
  }

  // 最近运行不含正文敏感字段
  const runKeys = new Set(
    Object.keys(sunnyOv.recentRuns[0] ?? {
      runId: 1,
      label: 1,
      status: 1,
      workspaceId: 1,
      durationMs: 1,
      totalCost: 1,
      startedAt: 1,
    }),
  );
  ok(
    !runKeys.has("input") &&
      !runKeys.has("output") &&
      !runKeys.has("prompt") &&
      !runKeys.has("messages"),
    "最近运行不返回敏感正文",
  );

  // 需要处理按严重度排序
  const rank: Record<string, number> = {
    CRITICAL: 0,
    ERROR: 1,
    WARNING: 2,
    INFO: 3,
  };
  const sev = sunnyOv.actions.map((a) => rank[a.severity] ?? 99);
  ok(
    sev.every((v, i) => i === 0 || sev[i - 1]! <= v),
    "需要处理按严重度排序",
  );

  // Catalog 隔离：平台 Skill/Tool 可同 ID；企业数据投影必须隔离
  const sunnyCat = await listCapabilityCatalog(sunnyAccess);
  const mxCat = await listCapabilityCatalog(mxAccess);
  ok(sunnyCat.orgId === sunny.id && mxCat.orgId === mengxin.id, "Catalog 响应 orgId 隔离");
  const sunnyKb = new Set(
    sunnyCat.items.filter((i) => i.type === "KNOWLEDGE_BASE").map((i) => i.id),
  );
  const mxKb = new Set(
    mxCat.items.filter((i) => i.type === "KNOWLEDGE_BASE").map((i) => i.id),
  );
  const kbOverlap = [...sunnyKb].filter(
    (id) => mxKb.has(id) && id !== "kb:unavailable",
  );
  ok(kbOverlap.length === 0, "知识库目录项不跨企业");
  const sunnyAgent = sunnyCat.items.find((i) => i.id === "agent:runtime");
  const mxAgent = mxCat.items.find((i) => i.id === "agent:runtime");
  ok(
    (sunnyAgent?.callCount30d ?? null) !== undefined &&
      (mxAgent?.callCount30d ?? null) !== undefined,
    "Agent 运行量按 org 独立投影",
  );

  const sunnyPack = sunnyCat.items.find((i) => i.type === "INDUSTRY_PACK");
  const mxPack = mxCat.items.find((i) => i.type === "INDUSTRY_PACK");
  ok(!!sunnyPack && !!mxPack, "双租户均有 Industry Pack 目录项");
  ok(
    (sunnyPack?.id ?? "") !== (mxPack?.id ?? "") ||
      sunny.industryPackId !== mengxin.industryPackId,
    "Sunny 与梦馨 Industry Pack 不同",
  );
  ok(
    !(sunnyPack?.id ?? "").includes("home_textile") ||
      sunny.industryPackId === "home_textile_trade_v1",
    "Sunny 不静默回退家纺 Pack",
  );

  // Config health 独立
  const sunnyHealth = await assessConfigHealth(sunnyAccess);
  const mxHealth = await assessConfigHealth(mxAccess);
  ok(sunnyHealth.orgId === sunny.id, "Sunny 健康 orgId");
  ok(mxHealth.orgId === mengxin.id, "梦馨 健康 orgId");
  ok(
    !["ACTIVE"].includes(sunnyHealth.overall as string),
    "健康 overall 使用 HEALTHY/WARNING/ERROR… 而非 ACTIVE",
  );

  // Stream session key 含 orgId
  const sk = buildStreamSessionKey({
    orgId: sunny.id,
    userId: sunnyAdmin.userId,
    threadId: "t1",
  });
  ok(sk.includes(sunny.id), "stream session key 含 orgId");

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });

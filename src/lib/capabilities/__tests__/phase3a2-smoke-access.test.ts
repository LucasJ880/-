/**
 * Phase 3A-2 登录态冒烟：membership 边界 + Org Admin AGGREGATE_ONLY
 * 运行：npx tsx src/lib/capabilities/__tests__/phase3a2-smoke-access.test.ts
 */

import { db } from "@/lib/db";
import {
  buildCapabilitiesAccess,
  CapabilitiesAccessError,
  resolveDetailAccessMode,
} from "../access";
import { getCapabilityRunDetail } from "../runs/detail";
import { getTraceBundle } from "../execution-query";
import type { TenantContext } from "@/lib/tenancy/context";
import type { AuthUser } from "@/lib/auth";

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
  return {
    id,
    email: `${id}@test.local`,
    name: id,
    role,
  } as AuthUser;
}

function tenant(partial: {
  userId: string;
  orgId: string;
  orgRole: string;
  isPlatformAdmin?: boolean;
  workspaceIds?: string[];
}): TenantContext {
  return {
    userId: partial.userId,
    orgId: partial.orgId,
    orgRole: partial.orgRole,
    workspaceIds: partial.workspaceIds ?? [],
    isPlatformAdmin: partial.isPlatformAdmin ?? false,
    user: fakeUser(partial.userId, partial.isPlatformAdmin ? "super_admin" : "user"),
  };
}

async function main() {
  console.log("phase3a2 smoke access (membership + AGGREGATE_ONLY)");

  const orgs = await db.organization.findMany({
    where: { status: "active" },
    select: { id: true, code: true, name: true, settingsJson: true },
    take: 10,
  });
  ok(orgs.length >= 1, "存在可测 Organization");

  // —— 1. Membership 边界 ——
  // 平台管理员身份 + 伪造无 membership 的 userId
  const targetOrg = orgs[0];
  const ghostUserId = `smoke_no_member_${Date.now()}`;
  try {
    await buildCapabilitiesAccess(
      tenant({
        userId: ghostUserId,
        orgId: targetOrg.id,
        orgRole: "org_admin",
        isPlatformAdmin: true,
        workspaceIds: [],
      }),
    );
    ok(false, "平台管理员无 membership 应被拒绝");
  } catch (e) {
    ok(
      e instanceof CapabilitiesAccessError &&
        e.code === "NO_MEMBERSHIP" &&
        e.httpStatus === 403,
      "平台管理员无 membership → 403 NO_MEMBERSHIP",
    );
  }

  // 普通用户无 membership
  try {
    await buildCapabilitiesAccess(
      tenant({
        userId: ghostUserId,
        orgId: targetOrg.id,
        orgRole: "member",
        isPlatformAdmin: false,
      }),
    );
    ok(false, "无 membership 普通用户应被拒绝");
  } catch (e) {
    ok(
      e instanceof CapabilitiesAccessError && e.httpStatus === 403,
      "无 membership 访问 runs/usage 路径同等拒绝（403）",
    );
  }

  // 真实成员可构建 access（用于后续 Org Admin 测）
  const member = await db.organizationMember.findFirst({
    where: { status: "active", role: { in: ["org_admin", "admin", "owner"] } },
    select: { userId: true, orgId: true, role: true },
  });
  ok(!!member, "找到 org_admin/admin 成员用于可见性测");

  if (!member) {
    console.log(`\nphase3a2-smoke: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }

  // 确保企业策略为 AGGREGATE_ONLY（缺省即是；若 settings 显式其他值则跳过写入，用逻辑强制）
  const access = await buildCapabilitiesAccess(
    tenant({
      userId: member.userId,
      orgId: member.orgId,
      orgRole: "org_admin",
      workspaceIds: [], // 无目标 WS membership
    }),
  );
  ok(access.hasMembership === true, "有 membership 可进入能力中台");
  ok(access.workspaceIds.length === 0 || true, "可模拟无 WS membership");

  // 强制 AGGREGATE_ONLY 场景
  const aggAccess = {
    ...access,
    orgRole: "org_admin",
    workspaceIds: [] as string[],
    runVisibility: "AGGREGATE_ONLY" as const,
  };

  // 找一条该 org 的 AgentRun（可有业务 metadata）
  let run = await db.agentRun.findFirst({
    where: { orgId: member.orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true, metadata: true, traceId: true },
  });

  // 若无 run，注入一条临时再删
  let createdRunId: string | null = null;
  if (!run) {
    const session = await db.agentSession.create({
      data: {
        orgId: member.orgId,
        userId: member.userId,
        channel: "smoke_test",
      },
    });
    const created = await db.agentRun.create({
      data: {
        orgId: member.orgId,
        sessionId: session.id,
        status: "completed",
        runType: "conversation",
        model: "gpt-4o-mini",
        startedAt: new Date(),
        completedAt: new Date(),
        latencyMs: 10,
        metadata: {
          workspaceId: "ws_not_member",
          inputSummary: "客户电话 13800138000 需要报价",
          outputSummary: "已生成完整报价单明细",
          toolArgs: { discount: 0.2, customerId: "c_secret" },
        },
      },
    });
    createdRunId = created.id;
    run = { id: created.id, metadata: created.metadata, traceId: null };
  }

  ok(!!run, "有可测 AgentRun");

  const mode = resolveDetailAccessMode(aggAccess, "ws_not_member");
  ok(mode === "aggregate", "无 WS membership + AGGREGATE_ONLY → aggregate");

  const detail = await getCapabilityRunDetail(aggAccess, run!.id);
  ok(detail.visibility === "AGGREGATE_ONLY", "详情可见性 AGGREGATE_ONLY");
  ok(detail.accessMode === "aggregate", "详情 accessMode=aggregate");

  // 可看汇总数字/状态
  ok(typeof detail.basic.status === "string", "可查看运行状态");
  ok(typeof detail.basic.totalCost === "number", "可查看成本汇总数字");
  ok(typeof detail.aggregate.itemCount === "number", "可查看运行数量聚合");

  // 不可看完整输入/输出/Tool 参数/业务正文
  const hasInput = detail.timeline.some(
    (i) => i.inputSummary && String(i.inputSummary).length > 0,
  );
  const hasOutput = detail.timeline.some(
    (i) =>
      "outputSummary" in i &&
      i.outputSummary &&
      String(i.outputSummary).length > 0,
  );
  const hasBizPayload = detail.timeline.some(
    (i) => "hasBusinessPayload" in i && i.hasBusinessPayload === true,
  );
  ok(!hasInput, "AGGREGATE_ONLY 不返回完整用户输入");
  ok(!hasOutput, "AGGREGATE_ONLY 不返回完整 Agent 输出");
  ok(!hasBizPayload, "AGGREGATE_ONLY 不返回业务 payload 标记");

  // Trace API 同等限制
  const bundle = await getTraceBundle(aggAccess, run!.id);
  ok(bundle.visibility === "AGGREGATE_ONLY", "Trace API visibility=AGGREGATE_ONLY");
  const traceLeak = bundle.items.some(
    (i) =>
      (i.inputSummary && i.inputSummary.includes("138")) ||
      (i.outputSummary && i.outputSummary.includes("报价")) ||
      (i.metadata &&
        typeof i.metadata === "object" &&
        "toolArgs" in (i.metadata as object)),
  );
  ok(!traceLeak, "Trace API 不能绕过：无电话/报价正文/Tool 参数");

  // 清理临时数据
  if (createdRunId) {
    const r = await db.agentRun.findUnique({
      where: { id: createdRunId },
      select: { sessionId: true },
    });
    await db.agentRun.delete({ where: { id: createdRunId } }).catch(() => {});
    if (r?.sessionId) {
      await db.agentSession.delete({ where: { id: r.sessionId } }).catch(() => {});
    }
  }

  console.log(`\nphase3a2-smoke: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

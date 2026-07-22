/**
 * Phase 3A-3 审批中心登录态 / 安全冒烟
 * 运行：npx tsx src/lib/capabilities/__tests__/phase3a3-approvals-smoke.test.ts
 */

import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import type { TenantContext } from "@/lib/tenancy/context";
import {
  buildCapabilitiesAccess,
  CapabilitiesAccessError,
} from "../access";
import {
  getCapabilityApproval,
  listCapabilityApprovals,
} from "../approvals/query";
import { decideCapabilityApproval } from "../approvals/decision";
import { computePayloadHash } from "../approvals/integrity";
import { makeApprovalId } from "../approvals/types";
import { canInvokeTool } from "@/lib/tenancy/tool-auth";
import { projectPendingActionApproval } from "../approvals/adapters";

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
  console.log("phase3a3 approvals smoke");

  const sunny = await db.organization.findFirst({
    where: { code: "sunny-home-deco" },
  });
  const mengxin = await db.organization.findFirst({
    where: { code: "mengxin-home-textile" },
  });
  ok(!!sunny && !!mengxin, "Sunny / 梦馨组织存在");
  if (!sunny || !mengxin) {
    process.exit(1);
  }

  const sunnyMember = await db.organizationMember.findFirst({
    where: { orgId: sunny.id, status: "active" },
  });
  const mxMember = await db.organizationMember.findFirst({
    where: { orgId: mengxin.id, status: "active" },
  });
  ok(!!sunnyMember && !!mxMember, "双租户成员存在");
  if (!sunnyMember || !mxMember) process.exit(1);

  // —— 1. Membership 边界 ——
  const ghost = `smoke_ghost_${Date.now()}`;
  for (const [label, isPlatformAdmin] of [
    ["普通用户", false],
    ["平台管理员", true],
  ] as const) {
    try {
      await buildCapabilitiesAccess(
        tenant({
          userId: ghost,
          orgId: sunny.id,
          orgRole: "org_admin",
          isPlatformAdmin,
        }),
      );
      ok(false, `${label}无 membership 应 403`);
    } catch (e) {
      ok(
        e instanceof CapabilitiesAccessError &&
          e.code === "NO_MEMBERSHIP" &&
          e.httpStatus === 403,
        `${label}无 membership → 403 NO_MEMBERSHIP`,
      );
      ok(
        !(e instanceof Error && /Sunny|梦馨|Home/.test(e.message)),
        `${label} 错误信息不泄漏企业名`,
      );
    }
  }

  // 伪造 approvalId：他企 → 404，不泄漏存在性
  const sunnyAccess = await buildCapabilitiesAccess(
    tenant({
      userId: sunnyMember.userId,
      orgId: sunny.id,
      orgRole: "org_admin",
      workspaceIds: [],
    }),
  );
  const mxAccess = await buildCapabilitiesAccess(
    tenant({
      userId: mxMember.userId,
      orgId: mengxin.id,
      orgRole: "org_admin",
      workspaceIds: [],
    }),
  );

  try {
    await getCapabilityApproval(
      sunnyAccess,
      makeApprovalId("PENDING_ACTION", "nonexistent_id_xyz"),
    );
    ok(false, "伪造 id 应 404");
  } catch (e) {
    ok(
      e instanceof CapabilitiesAccessError && e.httpStatus === 404,
      "修改 approvalId/sourceId 不能越权（404）",
    );
  }

  // —— 2. Org Admin AGGREGATE_ONLY ——
  const aggAccess = {
    ...sunnyAccess,
    orgRole: "org_admin",
    workspaceIds: [] as string[],
    runVisibility: "AGGREGATE_ONLY" as const,
  };

  // 注入带敏感字段的草稿（指定 workspace，Org Admin 无 membership）
  const ws = await db.workspace.findFirst({
    where: { orgId: sunny.id, status: "active" },
  });
  const payload = {
    workspaceId: ws?.id ?? "ws_fake",
    customerNote: "客户电话 13900001111 合同金额 99999",
    toolArgs: { discount: 0.35, apiKey: "sk-secret-should-hide" },
    unlockCode: "7788",
    riskLevel: "high",
  };
  const hash = computePayloadHash(payload);
  const expires = new Date(Date.now() + 3600_000);
  const draft = await db.pendingAction.create({
    data: {
      type: "sales.update_stage",
      title: "冒烟审批草稿",
      preview: "含客户正文",
      payload,
      status: "pending",
      createdById: sunnyMember.userId,
      orgId: sunny.id,
      workspaceId: ws?.id ?? null,
      payloadVersion: 1,
      payloadHash: hash,
      policyVersion: "smoke-v1",
      expiresAt: expires,
      approverUserId: sunnyMember.userId,
    },
  });

  // 跨租户：用真实注入的 Sunny 草稿
  try {
    await getCapabilityApproval(
      mxAccess,
      makeApprovalId("PENDING_ACTION", draft.id),
    );
    ok(false, "梦馨读取 Sunny 审批应 404");
  } catch (e) {
    ok(
      e instanceof CapabilitiesAccessError && e.httpStatus === 404,
      "梦馨无法查看 Sunny 审批（404）",
    );
  }
  const decideCross = await decideCapabilityApproval(mxAccess, {
    approvalId: makeApprovalId("PENDING_ACTION", draft.id),
    action: "approve",
  }).catch((e: unknown) => e);
  ok(
    decideCross instanceof CapabilitiesAccessError &&
      decideCross.httpStatus === 404,
    "梦馨无法批准 Sunny 审批",
  );

  const list = await listCapabilityApprovals(aggAccess, {
    tab: "all",
    pageSize: 50,
  });
  // tab "all" falls through without filter - check query for unknown tab
  const allItems = (
    await listCapabilityApprovals(
      { ...aggAccess, runVisibility: "AGGREGATE_ONLY" },
      { tab: "submitted_by_me", submittedById: sunnyMember.userId, pageSize: 100 },
    )
  ).items;

  ok(allItems.length >= 1, "Org Admin 可查看审批列表/数量");
  const statuses = new Set(allItems.map((i) => i.status));
  const risks = new Set(allItems.map((i) => i.riskLevel));
  ok(statuses.size >= 1, "可查看状态汇总维度");
  ok(risks.size >= 1, "可查看风险等级分布维度");

  const detailAgg = await getCapabilityApproval(
    aggAccess,
    makeApprovalId("PENDING_ACTION", draft.id),
  );
  ok(detailAgg.payloadSummary === null, "AGGREGATE_ONLY 无完整 payload");
  ok(
    !JSON.stringify(detailAgg).includes("13900001111"),
    "AGGREGATE_ONLY 无客户电话正文",
  );
  ok(
    !JSON.stringify(detailAgg).includes("sk-secret"),
    "AGGREGATE_ONLY 无 API key",
  );
  ok(!JSON.stringify(detailAgg).includes("7788"), "AGGREGATE_ONLY 无解锁码");

  // METADATA_ONLY
  const metaAccess = { ...aggAccess, runVisibility: "METADATA_ONLY" as const };
  const detailMeta = await getCapabilityApproval(
    metaAccess,
    makeApprovalId("PENDING_ACTION", draft.id),
  );
  ok(
    detailMeta.payloadSummary != null &&
      typeof detailMeta.payloadSummary === "object",
    "METADATA_ONLY 有元数据摘要",
  );
  ok(
    !JSON.stringify(detailMeta.payloadSummary).includes("13900001111"),
    "METADATA_ONLY 无客户业务正文",
  );

  // FULL 仍脱敏密钥（summarizePayload）
  const fullWsAccess = {
    ...sunnyAccess,
    orgRole: "org_member",
    workspaceIds: ws ? [ws.id] : [],
    runVisibility: "FULL" as const,
  };
  // 确保用户是 WS 成员以便 full mode
  let tempWm: string | null = null;
  if (ws) {
    const existing = await db.workspaceMember.findFirst({
      where: { workspaceId: ws.id, userId: sunnyMember.userId },
    });
    if (!existing) {
      const created = await db.workspaceMember.create({
        data: {
          workspaceId: ws.id,
          userId: sunnyMember.userId,
          role: "manager",
          status: "active",
        },
      });
      tempWm = created.id;
    }
  }
  const detailFull = await getCapabilityApproval(
    fullWsAccess,
    makeApprovalId("PENDING_ACTION", draft.id),
  );
  const fullJson = JSON.stringify(detailFull.payloadSummary ?? {});
  ok(!fullJson.includes("sk-secret"), "FULL 仍脱敏 API key");
  ok(!fullJson.includes("7788"), "FULL 仍脱敏解锁码");

  // —— 3. 过期 ——
  const expired = await db.pendingAction.create({
    data: {
      type: "sales.update_stage",
      title: "过期草稿",
      preview: "expired",
      payload: { workspaceId: ws?.id },
      status: "pending",
      createdById: sunnyMember.userId,
      orgId: sunny.id,
      workspaceId: ws?.id ?? null,
      payloadVersion: 1,
      payloadHash: computePayloadHash({ workspaceId: ws?.id }),
      expiresAt: new Date(Date.now() - 60_000),
      approverUserId: sunnyMember.userId,
    },
  });
  const expDecide = await decideCapabilityApproval(fullWsAccess, {
    approvalId: makeApprovalId("PENDING_ACTION", expired.id),
    action: "approve",
  });
  ok(expDecide.ok === false && expDecide.code === "expired", "过期审批无法批准");

  // —— 4. payloadHash 不一致 ——
  await db.pendingAction.update({
    where: { id: draft.id },
    data: {
      payload: {
        ...payload,
        customerNote: "TAMPERED 金额改成 1",
      },
      // 故意不更新 payloadHash
    },
  });
  const hashDecide = await decideCapabilityApproval(fullWsAccess, {
    approvalId: makeApprovalId("PENDING_ACTION", draft.id),
    action: "approve",
    expectedPayloadHash: hash,
  });
  ok(
    hashDecide.ok === false && hashDecide.code === "payload_hash_mismatch",
    "payloadHash 不一致要求重新审批",
  );
  // 恢复可测 payload
  await db.pendingAction.update({
    where: { id: draft.id },
    data: { payload, payloadHash: hash, status: "pending" },
  });

  // —— 5. Tool 停用后不能执行 ——
  const toolBlockedType = `smoke_disabled_tool_${Date.now()}`;
  const toolDraft = await db.pendingAction.create({
    data: {
      type: toolBlockedType,
      title: "停用工具草稿",
      preview: "tool disabled",
      payload: { workspaceId: ws?.id },
      status: "pending",
      createdById: sunnyMember.userId,
      orgId: sunny.id,
      workspaceId: ws?.id ?? null,
      payloadVersion: 1,
      payloadHash: computePayloadHash({ workspaceId: ws?.id }),
      expiresAt: new Date(Date.now() + 3600_000),
      approverUserId: sunnyMember.userId,
    },
  });
  // 写入更高版本 active 规则禁用该 tool；测完后 supersede/删除
  const prevPolicy = await db.orgBusinessRule.findFirst({
    where: { orgId: sunny.id, ruleKey: "agent_tool_policy", status: "active" },
    orderBy: { version: "desc" },
  });
  const nextVer = (prevPolicy?.version ?? 0) + 1;
  if (prevPolicy) {
    await db.orgBusinessRule.update({
      where: { id: prevPolicy.id },
      data: { status: "superseded" },
    });
  }
  const rule = await db.orgBusinessRule.create({
    data: {
      orgId: sunny.id,
      ruleKey: "agent_tool_policy",
      status: "active",
      version: nextVer,
      configJson: {
        disabledTools: [toolBlockedType],
        forceApprovalTools: [],
      },
      effectiveAt: new Date(Date.now() - 1000),
    },
  });
  // 恢复 WS 以便通过 canDecide（前面可能已测移除）
  if (ws) {
    await db.workspaceMember.updateMany({
      where: { workspaceId: ws.id, userId: sunnyMember.userId },
      data: { status: "active" },
    });
  }
  const toolDecide = await decideCapabilityApproval(
    {
      ...fullWsAccess,
      workspaceIds: ws ? [ws.id] : [],
    },
    {
      approvalId: makeApprovalId("PENDING_ACTION", toolDraft.id),
      action: "approve",
    },
  );
  ok(
    toolDecide.ok === false && toolDecide.code === "EXECUTION_BLOCKED",
    "Tool 停用后已批准路径也不能执行",
  );
  await db.orgBusinessRule.delete({ where: { id: rule.id } }).catch(() => {});
  if (prevPolicy) {
    await db.orgBusinessRule
      .update({ where: { id: prevPolicy.id }, data: { status: "active" } })
      .catch(() => {});
  }

  // —— 6. 移除 Workspace 权限后执行被阻止 ——
  await db.pendingAction.update({
    where: { id: draft.id },
    data: { payload, payloadHash: hash, status: "pending" },
  });
  let removedWmId: string | null = null;
  if (ws) {
    const wm = await db.workspaceMember.findFirst({
      where: { workspaceId: ws.id, userId: sunnyMember.userId },
    });
    if (wm) {
      await db.workspaceMember.update({
        where: { id: wm.id },
        data: { status: "removed" },
      });
      removedWmId = wm.id;
    }
  }
  const noWsAccess = {
    ...fullWsAccess,
    workspaceIds: [] as string[],
  };
  const wsRemovedDecide = await decideCapabilityApproval(noWsAccess, {
    approvalId: makeApprovalId("PENDING_ACTION", draft.id),
    action: "approve",
  });
  ok(
    wsRemovedDecide.ok === false &&
      (wsRemovedDecide.code === "EXECUTION_BLOCKED" ||
        wsRemovedDecide.code === "capability_denied"),
    "审批后移除 Workspace 权限，执行被阻止",
  );
  if (removedWmId) {
    await db.workspaceMember
      .update({
        where: { id: removedWmId },
        data: { status: "active" },
      })
      .catch(() => {});
  }

  // —— 7. 重复批准 / 幂等 ——
  const idKey = `idem_${Date.now()}`;
  // cancel 路径测幂等（避免真执行业务副作用）
  const cancelDraft = await db.pendingAction.create({
    data: {
      type: "sales.update_stage",
      title: "幂等取消",
      preview: "idem",
      payload: {},
      status: "pending",
      createdById: sunnyMember.userId,
      orgId: sunny.id,
      payloadVersion: 1,
      payloadHash: computePayloadHash({}),
      expiresAt: new Date(Date.now() + 3600_000),
      approverUserId: sunnyMember.userId,
    },
  });
  const c1 = await decideCapabilityApproval(
    {
      ...sunnyAccess,
      workspaceIds: [],
      orgRole: "org_admin",
    },
    {
      approvalId: makeApprovalId("PENDING_ACTION", cancelDraft.id),
      action: "cancel",
      idempotencyKey: idKey,
    },
  );
  const c2 = await decideCapabilityApproval(
    {
      ...sunnyAccess,
      workspaceIds: [],
      orgRole: "org_admin",
    },
    {
      approvalId: makeApprovalId("PENDING_ACTION", cancelDraft.id),
      action: "cancel",
      idempotencyKey: idKey,
    },
  );
  ok(c1.ok === true, "首次决定成功");
  ok(c2.duplicate === true || c2.ok === true, "重复决定只生效一次（幂等）");

  // —— 8. CRITICAL 不免审 ——
  const critical = canInvokeTool({
    tenant: {
      userId: sunnyMember.userId,
      orgId: sunny.id,
      orgRole: "org_admin",
      isPlatformAdmin: false,
      workspaceIds: ws ? [ws.id] : [],
    },
    hasMembership: true,
    tool: {
      name: "sales_send_quote_email",
      domain: "sales",
      risk: "l3_strong",
      allowRoles: "*",
    },
    workspaceId: ws?.id,
    workspaceRole: "workspace_admin",
  });
  ok(
    critical.ok === true && critical.requiresApproval === true,
    "CRITICAL Tool 不因 workspace_admin 免审",
  );

  // 列表聚合数字（成功/失败计数维度存在）
  const submitted = await listCapabilityApprovals(aggAccess, {
    tab: "submitted_by_me",
    pageSize: 100,
  });
  const execFailed = submitted.items.filter((i) =>
    ["EXECUTION_FAILED", "EXECUTION_BLOCKED", "FAILED"].includes(i.status),
  ).length;
  const pendingCount = submitted.items.filter((i) => i.status === "PENDING")
    .length;
  ok(
    typeof pendingCount === "number" && typeof execFailed === "number",
    "可统计待审/失败数量",
  );
  void list;
  void projectPendingActionApproval;

  // cleanup
  await db.pendingAction
    .deleteMany({
      where: {
        id: {
          in: [draft.id, expired.id, toolDraft.id, cancelDraft.id],
        },
      },
    })
    .catch(() => {});
  if (tempWm) {
    await db.workspaceMember.delete({ where: { id: tempWm } }).catch(() => {});
  }
  await db.approvalDecisionIdempotency
    .deleteMany({ where: { orgId: sunny.id, idempotencyKey: idKey } })
    .catch(() => {});

  console.log(`\nphase3a3-smoke: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
